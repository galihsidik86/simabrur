import type { Request } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { nextNumber } from '../../utils/numbering.js';
import { jamaahRepository } from './jamaah.repository.js';
import { isPassportValid, needsMahram, passportValidUntilLimit, regNumberKey, ageAt } from './jamaah.rules.js';
import { REQUIRED_DOC_TYPES, type createRegistrationSchema, type updateJamaahSchema } from './jamaah.validation.js';
import { issueInvoice, paymentsService } from '../payments/payments.service.js';
import { notifyAgent } from '../agent-portal/notify.js';
import { todayWib } from '../../utils/date.js';
import { reverseJournal } from '../accounting/journal.engine.js';
import { withTransaction } from '../../utils/tx.js';

type CreateRegistrationInput = z.infer<typeof createRegistrationSchema>;
type UpdateJamaahInput = z.infer<typeof updateJamaahSchema>;

/** Kolom DATE Postgres kembali sebagai string 'YYYY-MM-DD' (lihat config/db.ts); helper ini defensif bila tipe berubah. */
function toISODate(v: unknown): string {
  return (v as { toISOString?: () => string })?.toISOString?.().slice(0, 10) ?? String(v);
}

export const jamaahService = {
  async list(opts: { tab: string; q?: string; status?: string; identityPending?: boolean; page: number; limit: number }) {
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
        age: r.birth_date ? ageAt(r.birth_date.toISOString?.().slice(0, 10) ?? String(r.birth_date), todayWib()) : null,
        city: r.birth_place,
        packageName: r.package_name,
        departureDate: r.departure_date,
        paymentScheme: r.payment_scheme,
        registrationStatus: r.registration_status,
        identityConfirmationRequired: Boolean(r.identity_confirmation_required),
        docs: ['KTP', 'KK', 'PPR', 'FTO', 'VKS'].map((t) => ({ type: t, status: badge(t) })),
        docsComplete: verifiedRequired >= REQUIRED_DOC_TYPES.length
      };
    });
    return { data, total };
  },

  async updateProfile(req: Request, jamaahId: string, input: UpdateJamaahInput) {
    const before = await db('jamaah').where({ id: jamaahId }).first();
    if (!before) throw errors.notFound('Jamaah tidak ditemukan');

    // DOM-01 (M, staf): validasi paspor ≥ 7 bulan terhadap keberangkatan registrasi
    // aktif jamaah ini bila staf melengkapi/mengubah paspor.
    if (input.passportExpiry) {
      const activeDeps = await db('registrations as r')
        .join('departures as d', 'd.id', 'r.departure_id')
        .where('r.jamaah_id', jamaahId)
        .whereIn('r.status', ['pending_documents', 'active'])
        .select('d.departure_date')
        .orderBy('d.departure_date', 'asc');
      const earliest = activeDeps[0]?.departure_date;
      if (earliest) {
        const departureDate = toISODate(earliest);
        if (!isPassportValid(input.passportExpiry, departureDate)) {
          const limit = passportValidUntilLimit(departureDate).toISOString().slice(0, 10);
          throw errors.badRequest(
            `Paspor tidak memenuhi syarat untuk keberangkatan ${departureDate}: harus berlaku hingga minimal ${limit} (≥ 7 bulan setelah keberangkatan)`
          );
        }
      }
    }
    // DOM-06: paspor tidak boleh dipakai jamaah lain (NIK berbeda).
    if (input.passportNo) {
      const dupPassport = await db('jamaah')
        .whereRaw('upper(passport_no) = upper(?)', [input.passportNo])
        .whereNot('id', jamaahId)
        .first();
      if (dupPassport) throw errors.conflict('Nomor paspor ini sudah terdaftar untuk jamaah lain');
    }

    const colByField: Record<keyof UpdateJamaahInput, string> = {
      fullName: 'full_name',
      gender: 'gender',
      phone: 'phone',
      email: 'email',
      address: 'address',
      emergencyContactName: 'emergency_contact_name',
      emergencyContactPhone: 'emergency_contact_phone',
      mahramName: 'mahram_name',
      mahramRelation: 'mahram_relation',
      passportNo: 'passport_no',
      passportIssuedAt: 'passport_issued_at',
      passportExpiry: 'passport_expiry'
    };
    const changes: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};
    for (const [field, col] of Object.entries(colByField) as [keyof UpdateJamaahInput, string][]) {
      const value = input[field];
      if (value === undefined || value === before[col]) continue;
      changes[col] = value;
      oldValues[col] = before[col];
    }
    if (!Object.keys(changes).length) return before;

    const [updated] = await db('jamaah')
      .where({ id: jamaahId })
      .update({ ...changes, updated_at: db.fn.now() })
      .returning('*');
    await audit(req, {
      action: 'jamaah.update',
      entity: 'jamaah',
      entityId: jamaahId,
      oldValues,
      newValues: changes
    });
    return updated;
  },

  async detail(jamaahId: string) {
    const found = await jamaahRepository.detail(jamaahId);
    if (!found) throw errors.notFound('Jamaah tidak ditemukan');
    const { jamaah, registrations, documents } = found;
    const mapped = await Promise.all(registrations.map(async (r) => {
      const upcharge =
        r.room_type === 'triple' ? Number(r.triple_upcharge) : r.room_type === 'double' ? Number(r.double_upcharge) : 0;
      // DOM-03: pakai total invoice yang sudah terbit (dibekukan saat registrasi) —
      // harga paket terkini bisa sudah berubah dan tidak mencerminkan tagihan sebenarnya.
      const totalPrice =
        r.invoice_total_amount != null ? Number(r.invoice_total_amount) : Number(r.base_price) + upcharge;
      // Langkah 9 (kontrak butir 5): registrasi cancelled memuat alasan/refund.
      const refund = r.status === 'cancelled' ? await paymentsService.refundByRegistration(r.id) : null;
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
        totalPrice,
        // NEW-BE-01 (putaran 2): frontend bisa menampilkan tombol "Konfirmasi identitas".
        identityConfirmationRequired: Boolean(r.identity_confirmation_required),
        cancelledAt: r.cancelled_at ?? null,
        cancelReason: r.cancel_reason ?? null,
        refund
      };
    }));
    return {
      ...jamaah,
      registrations: mapped,
      documents
    };
  },

  /**
   * Konfirmasi identitas registrasi yang ditahan (reuse NIK via wizard publik) —
   * NEW-BE-01 putaran 2. Membuka kembali akses login Portal Jamaah utk registrasi
   * ini. Idempoten: memanggil ulang pada registrasi yang sudah dikonfirmasi aman.
   */
  async confirmIdentity(req: Request, registrationId: string) {
    const before = await db('registrations').where({ id: registrationId }).first();
    if (!before) throw errors.notFound('Registrasi tidak ditemukan');
    const [updated] = await db('registrations')
      .where({ id: registrationId })
      .update({
        identity_confirmation_required: false,
        identity_confirmed_by: req.user?.id ?? null,
        identity_confirmed_at: db.fn.now(),
        updated_at: db.fn.now()
      })
      .returning('*');
    await audit(req, {
      action: 'registrations.confirm_identity',
      entity: 'registrations',
      entityId: registrationId,
      oldValues: { identityConfirmationRequired: before.identity_confirmation_required },
      newValues: { identityConfirmationRequired: false }
    });
    return updated;
  },

  /**
   * Pembatalan registrasi (langkah 9, kontrak plan.md) — role operasional/admin.
   * Satu transaksi, lock departure: lepas kursi, batalkan termin belum bayar, tolak
   * pembayaran pending, batalkan/tandai-clawback komisi, dan buat refund `pending`
   * bila ada pembayaran terverifikasi. TANPA jurnal (jurnal refund baru terjadi saat
   * keuangan membayar via POST /refunds/:id/pay).
   */
  async cancelRegistration(req: Request, registrationId: string, reason: string) {
    return withTransaction(async (trx) => {
      const reg = await trx('registrations').where({ id: registrationId }).forUpdate().first();
      if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
      if (reg.status === 'cancelled') throw errors.conflict('Registrasi ini sudah dibatalkan');
      if (reg.status === 'completed') throw errors.conflict('Registrasi sudah selesai — tidak bisa dibatalkan');

      const dep = await trx('departures').where({ id: reg.departure_id }).forUpdate().first();
      if (!dep) throw errors.notFound('Keberangkatan tidak ditemukan');
      if (dep.status === 'departed' || dep.status === 'completed') {
        throw errors.conflict('Keberangkatan sudah berlangsung — registrasi tidak bisa dibatalkan');
      }

      const cc = await trx('cost_centers').where({ departure_id: dep.id }).first();
      if (cc) {
        // PSAK 72: pendapatan sudah diakui untuk cost center ini → tidak bisa dibatalkan lagi.
        const revenueJournal = await trx('journals').where({ source: 'revenue', cost_center_id: cc.id }).first();
        if (revenueJournal) {
          throw errors.conflict('Pendapatan keberangkatan ini sudah diakui — registrasi tidak bisa dibatalkan');
        }
      }

      await trx('registrations')
        .where({ id: registrationId })
        .update({
          status: 'cancelled',
          cancelled_at: trx.fn.now(),
          cancelled_by: req.user?.id ?? null,
          cancel_reason: reason,
          updated_at: trx.fn.now()
        });

      await trx('departures')
        .where({ id: dep.id })
        .update({ seats_taken: trx.raw('GREATEST(seats_taken - 1, 0)'), updated_at: trx.fn.now() });

      await trx('payment_schedules')
        .where({ registration_id: registrationId, status: 'unpaid' })
        .update({ status: 'cancelled', updated_at: trx.fn.now() });

      const invoice = await trx('invoices').where({ registration_id: registrationId }).forUpdate().first();
      let paidTotal = 0;
      if (invoice) {
        const pendingPayments = await trx('payments').where({ invoice_id: invoice.id, status: 'pending' }).forUpdate();
        for (const p of pendingPayments) {
          await trx('payments')
            .where({ id: p.id })
            .update({
              status: 'rejected',
              reject_reason: 'registrasi dibatalkan',
              rejected_by: req.user?.id ?? null,
              rejected_at: trx.fn.now(),
              updated_at: trx.fn.now()
            });
        }
        const [{ paid }] = await trx('payments').where({ invoice_id: invoice.id, status: 'verified' }).sum({ paid: 'amount' });
        paidTotal = Number(paid ?? 0);
      }

      // Komisi: pending/approved dibatalkan (jurnal dibalik bila approved & sudah
      // dijurnal, mekanisme sama dengan POST /commissions/:id/reverse); paid ditandai
      // perlu ditagih ke agen (tidak bisa dibalik otomatis — uang sudah cair).
      const commission = await trx('commissions').where({ registration_id: registrationId }).forUpdate().first();
      if (commission) {
        if (commission.status === 'approved' && commission.journal_id) {
          const reversal = await reverseJournal(trx, commission.journal_id, {
            date: todayWib(),
            description: `Pembatalan komisi agen — registrasi dibatalkan (${reg.reg_number})`,
            createdBy: req.user?.id ?? null
          });
          await trx('commissions')
            .where({ id: commission.id })
            .update({
              status: 'pending',
              reversal_journal_id: reversal.id,
              reversed_by: req.user?.id ?? null,
              reversed_at: trx.fn.now(),
              journal_id: null,
              approved_by: null,
              approved_at: null,
              updated_at: trx.fn.now()
            });
        } else if (commission.status === 'paid') {
          await trx('commissions')
            .where({ id: commission.id })
            .update({ clawback_required: true, clawback_marked_at: trx.fn.now(), updated_at: trx.fn.now() });
        }
        // status 'pending' tanpa journal_id: tidak ada apa pun untuk dibalik — sudah
        // tak bisa disetujui lagi karena guard approve mensyaratkan registrasi active/completed.
      }

      let refund = null;
      if (paidTotal > 0) {
        if (!cc) throw errors.badRequest('Cost center keberangkatan tidak ditemukan — refund tidak dapat dibuat');
        const [refundRow] = await trx('refunds')
          .insert({
            registration_id: registrationId,
            cost_center_id: cc.id,
            paid_total: paidTotal,
            deduction: 0,
            refund_amount: paidTotal,
            status: 'pending',
            created_by: req.user?.id ?? null
          })
          .returning('*');
        refund = await paymentsService.refundDetail(trx, refundRow.id);
      }

      await audit(req, {
        action: 'registrations.cancel',
        entity: 'registrations',
        entityId: registrationId,
        oldValues: { status: reg.status },
        newValues: { status: 'cancelled', reason, paidTotal, refundId: refund?.id ?? null }
      }, trx);

      return { registrationId, status: 'cancelled' as const, refund };
    }, { retries: 2 });
  },

  /**
   * Pendaftaran jamaah (wizard publik). Seluruh aturan PLAN.md §4.7 dijaga di sini:
   * kuota real-time (lock baris departure), paspor ≥ 7 bulan, mahram P<45, nomor UMR/HAJ.
   */
  async register(req: Request, input: CreateRegistrationInput) {
    return withTransaction(async (trx) => {
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

      // NEW-BE-01: cek duplikat NIK+keberangkatan SEBELUM menyentuh profil jamaah
      // existing — dulu update profil terjadi dulu (bisa menimpa data), dan pesan
      // 409 membocorkan nomor registrasi (bisa dipakai untuk login Portal Jamaah
      // memakai NIK korban saja). Pesan sekarang generik, tanpa nomor registrasi.
      let jamaahRow = await trx('jamaah').where({ nik: j.nik }).first();
      // NEW-BE-01 (putaran 2): dicatat SEBELUM jamaahRow mungkin di-reassign di bawah —
      // menentukan apakah registrasi ini "reuse NIK via jalur publik" (lihat identity_confirmation_required).
      const wasExistingJamaah = Boolean(jamaahRow);
      if (jamaahRow) {
        const dup = await trx('registrations').where({ jamaah_id: jamaahRow.id, departure_id: dep.id }).first();
        if (dup) {
          throw errors.conflict('NIK ini sudah terdaftar pada keberangkatan tersebut — silakan masuk Portal Jamaah atau hubungi CS');
        }
      }

      // Data efektif utk validasi: profil TERSIMPAN bila jamaah sudah ada (tidak akan
      // ditimpa di bawah), jika tidak baru pakai input baru. Mencegah N-1 (validasi
      // lolos memakai paspor input yang justru tidak akan pernah disimpan).
      const effectivePassportExpiry = jamaahRow?.passport_expiry ? toISODate(jamaahRow.passport_expiry) : j.passportExpiry;
      const effectiveGender = (jamaahRow?.gender as 'L' | 'P' | undefined) ?? j.gender;
      const effectiveBirthDate = jamaahRow?.birth_date ? toISODate(jamaahRow.birth_date) : j.birthDate;
      const effectiveMahramName = jamaahRow?.mahram_name ?? j.mahramName;

      if (!isPassportValid(effectivePassportExpiry, departureDate)) {
        const limit = passportValidUntilLimit(departureDate).toISOString().slice(0, 10);
        throw errors.badRequest(
          `Paspor tidak memenuhi syarat: harus berlaku hingga minimal ${limit} (≥ 7 bulan setelah keberangkatan)`
        );
      }
      if (needsMahram(effectiveGender, effectiveBirthDate, departureDate) && !effectiveMahramName) {
        throw errors.badRequest('Jamaah perempuan di bawah 45 tahun wajib mencantumkan mahram/pendamping');
      }

      // DOM-06: paspor tidak boleh dipakai jamaah lain (NIK berbeda) — hanya relevan
      // utk paspor yang BENAR-BENAR akan ditulis (baru, atau mengisi kolom kosong).
      const passportToWrite = jamaahRow?.passport_no ? null : j.passportNo;
      if (passportToWrite) {
        const dupPassport = await trx('jamaah')
          .whereRaw('upper(passport_no) = upper(?)', [passportToWrite])
          .whereNot('nik', j.nik)
          .first();
        if (dupPassport) throw errors.conflict('Nomor paspor ini sudah terdaftar untuk jamaah lain');
      }

      if (jamaahRow) {
        // NEW-BE-01: JANGAN menimpa profil jamaah existing dari endpoint publik —
        // hanya lengkapi kolom yang masih kosong (mis. paspor belum pernah diisi).
        const fillIfEmpty: Record<string, unknown> = {};
        const setIfEmpty = (col: string, val: unknown) => {
          if (val !== null && val !== undefined && (jamaahRow![col] === null || jamaahRow![col] === undefined)) {
            fillIfEmpty[col] = val;
          }
        };
        setIfEmpty('email', j.email ?? null);
        setIfEmpty('passport_no', j.passportNo ?? null);
        setIfEmpty('passport_issued_at', j.passportIssuedAt ?? null);
        setIfEmpty('passport_expiry', j.passportExpiry ?? null);
        setIfEmpty('mahram_name', j.mahramName ?? null);
        setIfEmpty('mahram_relation', j.mahramRelation ?? null);
        if (Object.keys(fillIfEmpty).length) {
          [jamaahRow] = await trx('jamaah').where({ id: jamaahRow.id }).update({ ...fillIfEmpty, updated_at: trx.fn.now() }).returning('*');
        }
      } else {
        [jamaahRow] = await trx('jamaah')
          .insert({
            nik: j.nik,
            full_name: j.fullName,
            gender: j.gender,
            birth_place: j.birthPlace,
            birth_date: j.birthDate,
            phone: j.phone,
            email: j.email ?? null,
            address: j.address,
            emergency_contact_name: j.emergencyContactName,
            emergency_contact_phone: j.emergencyContactPhone,
            passport_no: j.passportNo,
            passport_issued_at: j.passportIssuedAt ?? null,
            passport_expiry: j.passportExpiry,
            mahram_name: j.mahramName ?? null,
            mahram_relation: j.mahramRelation ?? null
          })
          .returning('*');
      }

      const regNumber = await nextNumber(trx, regNumberKey(dep.package_type, departureDate));
      // NEW-BE-01 (putaran 2): registrasi baru via jalur PUBLIK (tanpa staf) yang reuse
      // NIK sudah terdaftar ditahan dari login Portal Jamaah sampai dikonfirmasi petugas.
      // Registrasi dengan NIK baru, atau dibuat staf/sistem (req.user terisi), tidak ditahan.
      const identityConfirmationRequired = wasExistingJamaah && !req.user;
      const [registration] = await trx('registrations')
        .insert({
          reg_number: regNumber,
          jamaah_id: jamaahRow.id,
          departure_id: dep.id,
          room_type: input.roomType,
          payment_scheme: input.paymentScheme,
          source: input.source,
          status: 'pending_documents',
          identity_confirmation_required: identityConfirmationRequired
        })
        .returning('*');

      await trx('departures').where({ id: dep.id }).increment('seats_taken', 1);

      // Fase 3: invoice + jadwal termin terbit otomatis bersama registrasi
      const invoice = await issueInvoice(trx, registration.id);

      const upcharge =
        input.roomType === 'triple' ? Number(dep.triple_upcharge) : input.roomType === 'double' ? Number(dep.double_upcharge) : 0;

      // Fase 7: sumber "agent:<kode-referral>" → atribusi agen + lead terkonversi + komisi pending.
      // Kode di-trim (klien API/portal lain tak selalu trim); hanya agen AKTIF yang menerima
      // komisi; bila kode disebut tapi agen tak ditemukan → dicatat audit (tak hilang senyap).
      const referral = /^agent:(.+)$/i.exec(input.source ?? '');
      if (referral) {
        const code = referral[1].trim().toUpperCase();
        const agent = code
          ? await trx('agents').whereRaw('upper(referral_code) = ?', [code]).andWhere('is_active', true).first()
          : null;
        if (agent) {
          // Atribusi ternormalisasi (sumber kebenaran) — bukan lagi hanya string source
          await trx('registrations').where({ id: registration.id }).update({ agent_id: agent.id });
          await trx('leads').insert({
            agent_id: agent.id,
            jamaah_id: jamaahRow.id,
            name: jamaahRow.full_name,
            phone: jamaahRow.phone,
            source: 'referral',
            status: 'converted'
          });
          // M6: dasar komisi = total invoice aktual (satu sumber kebenaran), bukan hitung ulang harga paket
          const base = Number(invoice.total_amount);
          await trx('commissions').insert({
            agent_id: agent.id,
            registration_id: registration.id,
            base_amount: base,
            pct: agent.commission_pct,
            amount: Math.round((base * Number(agent.commission_pct)) / 100)
          });
          await notifyAgent(trx, {
            agentId: agent.id, type: 'referral_registered', title: 'Jamaah referral baru',
            body: `${jamaahRow.full_name} mendaftar via kode referral Anda (${regNumber}).`,
            refType: 'registrations', refId: registration.id
          });
        } else {
          // Kode referral disebut tapi tak cocok agen aktif → jejak audit agar bisa ditindaklanjuti
          await audit(req, {
            action: 'registrations.referral_unmatched',
            entity: 'registrations',
            entityId: registration.id,
            newValues: { referralCode: code }
          }, trx);
        }
      }

      await audit(req, {
        action: 'registrations.create',
        entity: 'registrations',
        entityId: registration.id,
        newValues: { regNumber, jamaahId: jamaahRow.id, departureId: dep.id, roomType: input.roomType, paymentScheme: input.paymentScheme }
      }, trx);

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
    }, { retries: 2 });
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
    // DOM-04/SEC-05: jalur unggah ini publik (dipakai wizard & Portal Jamaah tanpa
    // login staf). Dokumen yang SUDAH terverifikasi hanya boleh diganti oleh staf
    // (operasional/admin) — jalur anonim tidak boleh menimpa file yang sudah diperiksa.
    const existing = await db('documents').where({ jamaah_id: jamaahId, doc_type: docType }).first();
    const isStaff = Boolean(req.user && ['operasional', 'admin'].includes(req.user.role));
    if (existing?.status === 'verified' && !isStaff) {
      throw errors.conflict('Dokumen sudah terverifikasi — hubungi petugas untuk mengganti');
    }
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
        const activated = await db('registrations')
          .where({ jamaah_id: doc.jamaah_id, status: 'pending_documents' })
          .update({ status: 'active', updated_at: db.fn.now() })
          .returning('*');
        // Notifikasi ke agen referral: dokumen jamaahnya lengkap
        const jm = await db('jamaah').where({ id: doc.jamaah_id }).first();
        for (const r of activated) {
          if (r.agent_id) {
            await notifyAgent(db, {
              agentId: r.agent_id, type: 'registration_active', title: 'Dokumen jamaah lengkap',
              body: `${jm?.full_name ?? 'Jamaah'} (${r.reg_number}) dokumennya lengkap — registrasi aktif.`,
              refType: 'registrations', refId: r.id
            });
          }
        }
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
