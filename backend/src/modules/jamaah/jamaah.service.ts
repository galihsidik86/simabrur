import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { nextNumber } from '../../utils/numbering.js';
import { jamaahRepository } from './jamaah.repository.js';
import { isPassportValid, needsMahram, passportValidUntilLimit, regNumberKey, ageAt } from './jamaah.rules.js';
import { REQUIRED_DOC_TYPES, type createRegistrationSchema } from './jamaah.validation.js';
import { issueInvoice } from '../payments/payments.service.js';

type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;

export const jamaahService = {
  async list(opts: { tab: string; q?: string; page: number; limit: number }) {
    const { rows, docs, total } = await jamaahRepository.list(opts);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = rows.map((r: any) => {
      const jDocs = docs.filter((d) => d.jamaah_id === r.jamaah_id);
      const badge = (type: string) => {
        const d = jDocs.find((x) => x.doc_type === type);
        if (!d) return 'missing';
        return d.status; // pending | verified | rejected
      };
      const verifiedRequired = REQUIRED_DOC_TYPES.filter((t) => badge(t) === 'verified').length;
      const total = r.total_amount != null ? Number(r.total_amount) : null;
      const paid = Number(r.paid ?? 0);
      return {
        invoiceId: r.invoice_id,
        totalAmount: total,
        paidAmount: paid,
        paidPct: total ? Math.min(100, Math.round((paid / total) * 100)) : 0,
        registrationId: r.registration_id,
        regNumber: r.reg_number,
        jamaahId: r.jamaah_id,
        name: r.full_name,
        gender: r.gender,
        age: r.birth_date ? ageAt(r.birth_date.toISOString?.().slice(0, 10) ?? String(r.birth_date), new Date().toISOString().slice(0, 10)) : null,
        city: r.birth_place,
        packageName: r.package_name,
        departureDate: r.departure_date,
        paymentScheme: r.payment_scheme,
        registrationStatus: r.registration_status,
        docs: ['KTP', 'KK', 'PPR', 'FTO', 'VKS'].map((t) => ({ type: t, status: badge(t) })),
        docsComplete: verifiedRequired >= REQUIRED_DOC_TYPES.length
      };
    });
    return { data, total };
  },

  async detail(jamaahId: string) {
    const found = await jamaahRepository.detail(jamaahId);
    if (!found) throw errors.notFound('Jamaah tidak ditemukan');
    const { jamaah, registrations, documents } = found;
    return {
      ...jamaah,
      registrations: registrations.map((r) => {
        const upcharge =
          r.room_type === 'triple' ? Number(r.triple_upcharge) : r.room_type === 'double' ? Number(r.double_upcharge) : 0;
        return {
          id: r.id,
          regNumber: r.reg_number,
          packageName: r.package_name,
          departureDate: r.departure_date,
          returnDate: r.return_date,
          roomType: r.room_type,
          roomNumber: r.room_number,
          groupName: r.group_name,
          paymentScheme: r.payment_scheme,
          status: r.status,
          totalPrice: Number(r.base_price) + upcharge
        };
      }),
      documents
    };
  },

  /**
   * Pendaftaran jamaah (wizard publik). Seluruh aturan PLAN.md §4.7 dijaga di sini:
   * kuota real-time (lock baris departure), paspor ≥ 7 bulan, mahram P<45, nomor UMR/HAJ.
   */
  async register(req: Request, input: CreateRegistrationInput) {
    return db.transaction(async (trx) => {
      const dep = await trx('departures as d')
        .join('packages as p', 'p.id', 'd.package_id')
        .select('d.*', 'p.type as package_type', 'p.name as package_name', 'p.base_price', 'p.triple_upcharge', 'p.double_upcharge')
        .where('d.id', input.departureId)
        .forUpdate('d')
        .first();
      if (!dep) throw errors.notFound('Jadwal keberangkatan tidak ditemukan');
      if (dep.status !== 'open') throw errors.conflict('Jadwal keberangkatan sudah ditutup');
      if (dep.seats_taken >= dep.quota) throw errors.conflict('Kuota keberangkatan sudah penuh');

      const j = input.jamaah;
      const departureDate = new Date(dep.departure_date).toISOString().slice(0, 10);

      if (j.passportExpiry && !isPassportValid(j.passportExpiry, departureDate)) {
        const limit = passportValidUntilLimit(departureDate).toISOString().slice(0, 10);
        throw errors.badRequest(
          `Paspor tidak memenuhi syarat: harus berlaku hingga minimal ${limit} (≥ 7 bulan setelah keberangkatan)`
        );
      }
      if (needsMahram(j.gender, j.birthDate, departureDate) && !j.mahramName) {
        throw errors.badRequest('Jamaah perempuan di bawah 45 tahun wajib mencantumkan mahram/pendamping');
      }

      // Reuse profil jamaah bila NIK sudah terdaftar
      let jamaahRow = await trx('jamaah').where({ nik: j.nik }).first();
      const profile = {
        full_name: j.fullName,
        gender: j.gender,
        birth_place: j.birthPlace,
        birth_date: j.birthDate,
        phone: j.phone,
        email: j.email ?? null,
        address: j.address,
        emergency_contact_name: j.emergencyContactName,
        emergency_contact_phone: j.emergencyContactPhone,
        passport_no: j.passportNo ?? null,
        passport_issued_at: j.passportIssuedAt ?? null,
        passport_expiry: j.passportExpiry ?? null,
        mahram_name: j.mahramName ?? null,
        mahram_relation: j.mahramRelation ?? null
      };
      if (jamaahRow) {
        [jamaahRow] = await trx('jamaah').where({ id: jamaahRow.id }).update({ ...profile, updated_at: trx.fn.now() }).returning('*');
        const dup = await trx('registrations').where({ jamaah_id: jamaahRow.id, departure_id: dep.id }).first();
        if (dup) throw errors.conflict(`NIK ini sudah terdaftar pada keberangkatan tersebut (${dup.reg_number})`);
      } else {
        [jamaahRow] = await trx('jamaah').insert({ nik: j.nik, ...profile }).returning('*');
      }

      const regNumber = await nextNumber(trx, regNumberKey(dep.package_type, departureDate));
      const [registration] = await trx('registrations')
        .insert({
          reg_number: regNumber,
          jamaah_id: jamaahRow.id,
          departure_id: dep.id,
          room_type: input.roomType,
          payment_scheme: input.paymentScheme,
          source: input.source,
          status: 'pending_documents'
        })
        .returning('*');

      await trx('departures').where({ id: dep.id }).increment('seats_taken', 1);

      // Fase 3: invoice + jadwal termin terbit otomatis bersama registrasi
      const invoice = await issueInvoice(trx, registration.id);

      const upcharge =
        input.roomType === 'triple' ? Number(dep.triple_upcharge) : input.roomType === 'double' ? Number(dep.double_upcharge) : 0;

      // Fase 7: sumber "agent:<kode-referral>" → lead terkonversi + komisi pending
      const referral = /^agent:(.+)$/i.exec(input.source ?? '');
      if (referral) {
        const agent = await trx('agents').whereRaw('upper(referral_code) = ?', [referral[1].toUpperCase()]).first();
        if (agent) {
          await trx('leads').insert({
            agent_id: agent.id,
            jamaah_id: jamaahRow.id,
            name: jamaahRow.full_name,
            phone: jamaahRow.phone,
            source: 'referral',
            status: 'converted'
          });
          const base = Number(dep.base_price) + upcharge;
          await trx('commissions').insert({
            agent_id: agent.id,
            registration_id: registration.id,
            base_amount: base,
            pct: agent.commission_pct,
            amount: Math.round((base * Number(agent.commission_pct)) / 100)
          });
        }
      }

      await audit(req, {
        action: 'registrations.create',
        entity: 'registrations',
        entityId: registration.id,
        newValues: { regNumber, jamaahId: jamaahRow.id, departureId: dep.id, roomType: input.roomType, paymentScheme: input.paymentScheme }
      });

      return {
        registrationId: registration.id,
        regNumber,
        jamaahId: jamaahRow.id,
        invoiceId: invoice.id,
        status: registration.status,
        packageName: dep.package_name,
        departureDate,
        totalPrice: Number(dep.base_price) + upcharge
      };
    });
  },

  /** Validasi paspor live untuk wizard (sebelum registrasi dibuat). */
  async passportCheck(departureId: string, expiry: string) {
    const dep = await db('departures').where({ id: departureId }).first();
    if (!dep) throw errors.notFound('Jadwal keberangkatan tidak ditemukan');
    const departureDate = new Date(dep.departure_date).toISOString().slice(0, 10);
    const limit = passportValidUntilLimit(departureDate).toISOString().slice(0, 10);
    return { valid: isPassportValid(expiry, departureDate), minValidUntil: limit, departureDate };
  },

  async uploadDocument(req: Request, jamaahId: string, docType: string, fileUrl: string) {
    const jamaah = await db('jamaah').where({ id: jamaahId }).first();
    if (!jamaah) throw errors.notFound('Jamaah tidak ditemukan');
    const [doc] = await db('documents')
      .insert({ jamaah_id: jamaahId, doc_type: docType, file_url: fileUrl, status: 'pending' })
      .onConflict(['jamaah_id', 'doc_type'])
      .merge({ file_url: fileUrl, status: 'pending', verified_at: null, verified_by: null, note: null, updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'documents.upload', entity: 'documents', entityId: doc.id, newValues: { jamaahId, docType } });
    return doc;
  },

  async verifyDocument(req: Request, documentId: string, status: 'verified' | 'rejected', note?: string | null) {
    const before = await jamaahRepository.documentById(documentId);
    if (!before) throw errors.notFound('Dokumen tidak ditemukan');
    const [doc] = await db('documents')
      .where({ id: documentId })
      .update({
        status,
        note: note ?? null,
        verified_at: status === 'verified' ? db.fn.now() : null,
        verified_by: req.user?.id ?? null,
        updated_at: db.fn.now()
      })
      .returning('*');

    // Bila seluruh dokumen wajib terverifikasi → registrasi aktif
    if (status === 'verified') {
      const verified = await db('documents')
        .where({ jamaah_id: doc.jamaah_id, status: 'verified' })
        .whereNot('doc_type', 'NKH');
      if (verified.length >= REQUIRED_DOC_TYPES.length) {
        await db('registrations')
          .where({ jamaah_id: doc.jamaah_id, status: 'pending_documents' })
          .update({ status: 'active', updated_at: db.fn.now() });
      }
    }
    await audit(req, {
      action: `documents.${status}`,
      entity: 'documents',
      entityId: documentId,
      oldValues: { status: before.status },
      newValues: { status, note }
    });
    return doc;
  }
};
