import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';

export interface PortalClaims {
  kind: 'portal';
  jamaahId: string;
  registrationId: string;
  regNumber: string;
}

export function verifyPortalToken(token: string): PortalClaims {
  try {
    const claims = jwt.verify(token, env.jwt.accessSecret) as PortalClaims & jwt.JwtPayload;
    if (claims.kind !== 'portal') throw new Error('bukan token portal');
    return claims;
  } catch {
    throw errors.unauthorized('Sesi portal tidak valid');
  }
}

const REQUIRED_DOCS = ['KTP', 'KK', 'PPR', 'FTO', 'VKS'];
const DOC_NAMES: Record<string, string> = {
  KTP: 'KTP', KK: 'Kartu Keluarga', PPR: 'Paspor', FTO: 'Pas Foto 4×6', VKS: 'Kartu Vaksin Meningitis', NKH: 'Buku Nikah'
};

export const portalService = {
  /** Login portal: nomor registrasi + NIK (identitas yang dipegang jamaah). */
  async login(req: Request, regNumber: string, nik: string) {
    const reg = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .select('r.id as registration_id', 'r.reg_number', 'j.id as jamaah_id', 'j.nik', 'j.full_name')
      .where('r.reg_number', regNumber.trim().toUpperCase())
      .first();
    if (!reg || reg.nik !== nik.trim()) {
      throw errors.unauthorized('Nomor registrasi atau NIK tidak cocok');
    }
    const claims: PortalClaims = { kind: 'portal', jamaahId: reg.jamaah_id, registrationId: reg.registration_id, regNumber: reg.reg_number };
    const token = jwt.sign(claims, env.jwt.accessSecret, { expiresIn: '12h' });
    await audit(req, { action: 'portal.login', entity: 'registrations', entityId: reg.registration_id });
    return { token, name: reg.full_name, regNumber: reg.reg_number };
  },

  /** Seluruh data portal dalam satu panggilan (5 tab mockup Portal Jamaah). */
  async me(claims: PortalClaims) {
    const reg = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin('hotels as h', 'h.id', 'p.hotel_id')
      .leftJoin('airlines as a', 'a.id', 'p.airline_id')
      .leftJoin('groups as g', 'g.id', 'r.group_id')
      .select(
        'r.*', 'j.full_name', 'j.nik', 'j.passport_no', 'j.passport_expiry', 'j.mahram_name', 'j.mahram_relation',
        'p.name as package_name', 'p.duration_days', 'h.name as hotel_name', 'h.star as hotel_star', 'h.city as hotel_city',
        'a.name as airline_name', 'a.iata_code',
        'd.departure_date', 'd.return_date', 'g.name as group_name', 'g.id as group_id'
      )
      .where('r.id', claims.registrationId)
      .first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');

    const [documents, invoice, staff, checklist] = await Promise.all([
      db('documents').where({ jamaah_id: claims.jamaahId }).orderBy('doc_type'),
      db('invoices').where({ registration_id: claims.registrationId }).first(),
      reg.group_id ? db('group_staff').where({ group_id: reg.group_id }) : Promise.resolve([]),
      db('checklists').where({ registration_id: claims.registrationId }).orderBy('created_at')
    ]);
    const schedules = await db('payment_schedules').where({ registration_id: claims.registrationId }).orderBy('term_no');
    const receipts = invoice
      ? await db('receipts as rc')
          .join('payments as pm', 'pm.id', 'rc.payment_id')
          .select('rc.id', 'rc.number', 'rc.amount', 'rc.issued_date')
          .where('pm.invoice_id', invoice.id)
          .orderBy('rc.issued_date')
      : [];

    const total = Number(invoice?.total_amount ?? 0);
    const paidRows = invoice
      ? await db('payments').where({ invoice_id: invoice.id, status: 'verified' }).sum({ paid: 'amount' }).first()
      : null;
    const paid = Number(paidRows?.paid ?? 0);

    const docStatus = (type: string) => {
      const d = documents.find((x) => x.doc_type === type);
      if (!d) return { status: 'missing' as const, note: 'Ketuk untuk mengunggah' };
      if (d.status === 'verified') return { status: 'verified' as const, note: `Diverifikasi ${new Date(d.verified_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}` };
      if (d.status === 'rejected') return { status: 'rejected' as const, note: d.note ?? 'Perlu unggah ulang' };
      return { status: 'pending' as const, note: 'Menunggu verifikasi' };
    };
    const verifiedCount = REQUIRED_DOCS.filter((t) => docStatus(t).status === 'verified').length;

    const today = new Date();
    const departure = new Date(reg.departure_date + 'T00:00:00');
    const daysLeft = Math.max(0, Math.ceil((departure.getTime() - today.getTime()) / 86_400_000));

    const nextDue = schedules.find((s) => s.status === 'unpaid');
    const actions: { type: string; title: string; detail: string; level: 'red' | 'amber'; target: string }[] = [];
    if (nextDue) {
      const overdue = nextDue.due_date < today.toISOString().slice(0, 10);
      actions.push({
        type: 'payment',
        title: `${nextDue.label} ${overdue ? 'jatuh tempo' : 'menunggu pembayaran'}`,
        detail: `Rp ${Number(nextDue.amount).toLocaleString('id-ID')} · tempo ${new Date(nextDue.due_date + 'T00:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        level: overdue ? 'red' : 'amber',
        target: 'bayar'
      });
    }
    for (const t of REQUIRED_DOCS) {
      const st = docStatus(t);
      if (st.status === 'missing' || st.status === 'rejected') {
        actions.push({ type: 'document', title: `Unggah ${DOC_NAMES[t]}`, detail: st.status === 'rejected' ? st.note : 'Dokumen belum lengkap', level: 'amber', target: 'dokumen' });
      }
    }

    // Kredensial aplikasi lapangan Mabrur (bila rombongan sudah disinkron)
    const { mabrurService } = await import('../mabrur/mabrur.service.js');
    const mabrur = await mabrurService.credentialForJamaah(claims.jamaahId).catch(() => null);

    return {
      mabrur,
      profile: {
        name: reg.full_name,
        regNumber: reg.reg_number,
        nik: reg.nik.slice(0, 4) + 'xxxxxxxx' + reg.nik.slice(-4),
        passportNo: reg.passport_no,
        passportExpiry: reg.passport_expiry,
        mahram: reg.mahram_name ? `${reg.mahram_name} (${reg.mahram_relation ?? '—'})` : null,
        branch: 'Safar Jakarta'
      },
      trip: {
        packageName: reg.package_name,
        durationDays: reg.duration_days,
        departureDate: reg.departure_date,
        returnDate: reg.return_date,
        daysLeft,
        groupName: reg.group_name,
        roomType: reg.room_type,
        roomNumber: reg.room_number,
        muthawwif: staff.filter((s) => s.role === 'muthawwif').map((s) => s.staff_name).join(', ') || null,
        tourLeader: staff.filter((s) => s.role === 'tour_leader').map((s) => s.staff_name).join(', ') || null,
        airline: reg.airline_name,
        airlineCode: reg.iata_code,
        hotel: reg.hotel_name ? `${reg.hotel_name} ⭐${reg.hotel_star} (${reg.hotel_city})` : null
      },
      progress: {
        documents: { verified: verifiedCount, required: REQUIRED_DOCS.length, pct: Math.round((verifiedCount / REQUIRED_DOCS.length) * 100) },
        payment: { paid, total, pct: total ? Math.min(100, Math.round((paid / total) * 100)) : 0 }
      },
      actions,
      payment: {
        invoiceId: invoice?.id ?? null,
        invoiceNumber: invoice?.number ?? null,
        vaNumber: invoice?.va_number ?? null,
        total, paid, remaining: total - paid,
        schedules: schedules.map((s) => ({
          termNo: s.term_no, label: s.label, amount: Number(s.amount), dueDate: s.due_date, status: s.status
        })),
        receipts
      },
      documents: [...REQUIRED_DOCS, 'NKH'].map((t) => ({ type: t, name: DOC_NAMES[t], ...docStatus(t), optional: t === 'NKH' })),
      checklist: checklist.map((c) => ({ id: c.id, item: c.item, isDone: c.is_done })),
      jamaahId: claims.jamaahId
    };
  },

  /** Dokumen invoice utk portal — hanya milik registrasi token. */
  async invoiceDocument(claims: PortalClaims) {
    const invoice = await db('invoices').where({ registration_id: claims.registrationId }).first();
    if (!invoice) throw errors.notFound('Invoice belum terbit');
    const { paymentsService } = await import('../payments/payments.service.js');
    return paymentsService.invoiceDocument(invoice.id);
  },

  async receiptDocument(claims: PortalClaims, receiptId: string) {
    const owned = await db('receipts as rc')
      .join('payments as pm', 'pm.id', 'rc.payment_id')
      .join('invoices as i', 'i.id', 'pm.invoice_id')
      .where('rc.id', receiptId)
      .where('i.registration_id', claims.registrationId)
      .first();
    if (!owned) throw errors.notFound('Kwitansi tidak ditemukan');
    const { paymentsService } = await import('../payments/payments.service.js');
    return paymentsService.receiptDocument(receiptId);
  },

  /** Departure_id keberangkatan token (untuk scoping galeri ke rombongan sendiri). */
  async departureIdFor(claims: PortalClaims): Promise<string> {
    const reg = await db('registrations').where({ id: claims.registrationId }).first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
    return String(reg.departure_id);
  }
};
