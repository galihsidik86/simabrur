import type { Request } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { nextNumber } from '../../utils/numbering.js';
import { terbilang } from '../../utils/terbilang.js';
import { agingBucket, buildSchedules, invoiceNumber, receivableStatus, vaNumber } from './payments.rules.js';
import type { createPaymentSchema, upsertBankAccountSchema } from './payments.validation.js';
import { postJournal, receiptLines } from '../accounting/journal.engine.js';

type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Terbitkan invoice + jadwal termin utk sebuah registrasi.
 * Dipanggil otomatis saat pendaftaran (jamaah.service) — bisa juga manual via POST /invoices.
 */
export async function issueInvoice(trx: Knex.Transaction, registrationId: string) {
  const reg = await trx('registrations as r')
    .join('departures as d', 'd.id', 'r.departure_id')
    .join('packages as p', 'p.id', 'd.package_id')
    .select('r.*', 'd.departure_date', 'p.base_price', 'p.triple_upcharge', 'p.double_upcharge')
    .where('r.id', registrationId)
    .first();
  if (!reg) throw errors.notFound('Registrasi tidak ditemukan');

  const existing = await trx('invoices').where({ registration_id: registrationId }).first();
  if (existing) return existing;

  const upcharge = reg.room_type === 'triple' ? Number(reg.triple_upcharge) : reg.room_type === 'double' ? Number(reg.double_upcharge) : 0;
  const total = Number(reg.base_price) + upcharge;
  const issueDate = today();
  const schedules = buildSchedules(reg.payment_scheme, total, issueDate, reg.departure_date);

  const [invoice] = await trx('invoices')
    .insert({
      registration_id: registrationId,
      number: invoiceNumber(reg.reg_number, issueDate),
      issued_date: issueDate,
      due_date: schedules[schedules.length - 1].dueDate,
      total_amount: total,
      va_number: vaNumber(reg.reg_number)
    })
    .returning('*');

  await trx('payment_schedules').insert(
    schedules.map((s) => ({
      registration_id: registrationId,
      term_no: s.termNo,
      label: s.label,
      amount: s.amount,
      due_date: s.dueDate
    }))
  );
  return invoice;
}

async function recalcInvoiceStatus(trx: Knex.Transaction, invoiceId: string) {
  const inv = await trx('invoices').where({ id: invoiceId }).first();
  const [{ paid }] = await trx('payments')
    .where({ invoice_id: invoiceId, status: 'verified' })
    .sum({ paid: 'amount' });
  const paidNum = Number(paid ?? 0);
  const status = paidNum >= Number(inv.total_amount) ? 'paid' : paidNum > 0 ? 'partial' : 'unpaid';
  await trx('invoices').where({ id: invoiceId }).update({ status, updated_at: trx.fn.now() });
  return { paid: paidNum, status };
}

export const paymentsService = {
  async createInvoice(req: Request, registrationId: string) {
    return db.transaction(async (trx) => {
      const invoice = await issueInvoice(trx, registrationId);
      await audit(req, { action: 'invoices.create', entity: 'invoices', entityId: invoice.id, newValues: { registrationId } });
      return invoice;
    });
  },

  /** Catat pembayaran (pending). Idempotency-Key: kiriman ulang mengembalikan payment yang sama. */
  async createPayment(req: Request, input: CreatePaymentInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await db('payments').where({ idempotency_key: idempotencyKey }).first();
      if (existing) return { payment: existing, idempotent: true };
    }
    return db.transaction(async (trx) => {
      const invoice = await trx('invoices').where({ id: input.invoiceId }).first();
      if (!invoice) throw errors.notFound('Invoice tidak ditemukan');
      if (input.scheduleId) {
        const sch = await trx('payment_schedules').where({ id: input.scheduleId }).first();
        if (!sch || sch.registration_id !== invoice.registration_id) throw errors.badRequest('Termin tidak sesuai invoice');
        if (sch.status === 'paid') throw errors.conflict('Termin ini sudah lunas');
      }
      const bank = await trx('bank_accounts').where({ account_code: input.bankAccountCode }).first();
      if (!bank) throw errors.badRequest(`Rekening ${input.bankAccountCode} tidak ditemukan`);

      const [payment] = await trx('payments')
        .insert({
          invoice_id: input.invoiceId,
          schedule_id: input.scheduleId ?? null,
          bank_account_id: bank.id,
          amount: input.amount,
          currency: bank.currency,
          method: input.method,
          paid_at: input.paidAt ?? trx.fn.now(),
          reference: input.reference ?? null,
          note: input.note ?? null,
          idempotency_key: idempotencyKey ?? null,
          created_by: req.user?.id ?? null
        })
        .returning('*');
      await audit(req, { action: 'payments.create', entity: 'payments', entityId: payment.id, newValues: input });
      return { payment, idempotent: false };
    });
  },

  /**
   * Verifikasi pembayaran (role keuangan): tandai termin lunas, hitung ulang status invoice,
   * terbitkan kwitansi bernomor + terbilang. (Posting jurnal otomatis menyusul Fase 5 —
   * jurnalnya: Dr Bank/Kas · Cr 2-1100 Uang Muka Jamaah.)
   */
  async verifyPayment(req: Request, paymentId: string) {
    return db.transaction(async (trx) => {
      const payment = await trx('payments').where({ id: paymentId }).forUpdate().first();
      if (!payment) throw errors.notFound('Pembayaran tidak ditemukan');
      if (payment.status === 'verified') throw errors.conflict('Pembayaran sudah diverifikasi');

      await trx('payments').where({ id: paymentId }).update({
        status: 'verified',
        verified_by: req.user?.id ?? null,
        verified_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
      if (payment.schedule_id) {
        await trx('payment_schedules').where({ id: payment.schedule_id }).update({ status: 'paid', updated_at: trx.fn.now() });
      }
      const { status } = await recalcInvoiceStatus(trx, payment.invoice_id);

      // Kwitansi
      const inv = await trx('invoices as i')
        .join('registrations as r', 'r.id', 'i.registration_id')
        .join('jamaah as j', 'j.id', 'r.jamaah_id')
        .join('departures as d', 'd.id', 'r.departure_id')
        .join('packages as p', 'p.id', 'd.package_id')
        .select('i.*', 'r.reg_number', 'j.full_name', 'p.name as package_name', 'd.departure_date')
        .where('i.id', payment.invoice_id)
        .first();
      const sch = payment.schedule_id ? await trx('payment_schedules').where({ id: payment.schedule_id }).first() : null;
      const issued = today();
      const [y, m] = issued.split('-');
      const number = await nextNumber(trx, `KWT/${y}/${m}`, 4, '/');
      const desc = `${sch ? sch.label : 'Pembayaran'} paket ${inv.package_name} (No. Reg ${inv.reg_number}) · keberangkatan ${inv.departure_date}`;
      const [receipt] = await trx('receipts')
        .insert({
          payment_id: paymentId,
          number,
          issued_date: issued,
          amount: payment.amount,
          terbilang: terbilang(Number(payment.amount)),
          description: desc
        })
        .returning('*');

      // Jurnal otomatis (template A/B Chart of Accounts): Dr Bank/Kas · Cr 2-1100 Uang Muka Jamaah
      const bank = payment.bank_account_id ? await trx('bank_accounts').where({ id: payment.bank_account_id }).first() : null;
      const reg = await trx('registrations').where({ id: inv.registration_id }).first();
      const cc = reg ? await trx('cost_centers').where({ departure_id: reg.departure_id }).first() : null;
      const journal = await postJournal(trx, {
        date: issued,
        description: `Penerimaan ${sch ? sch.label.toLowerCase() : 'pembayaran'} — ${inv.full_name}`,
        source: 'payment',
        refType: 'payments',
        refId: paymentId,
        costCenterId: cc?.id ?? null,
        createdBy: req.user?.id ?? null,
        lines: receiptLines(bank?.account_code ?? '1-1200', Number(payment.amount))
      });

      await audit(req, {
        action: 'payments.verify',
        entity: 'payments',
        entityId: paymentId,
        oldValues: { status: 'pending' },
        newValues: { status: 'verified', invoiceStatus: status, receipt: receipt.number, journalNo: journal.journal_no }
      });
      return { paymentId, invoiceStatus: status, receipt, journal: { journalNo: journal.journal_no, id: journal.id } };
    });
  },

  /** Kartu piutang + KPI (view Pembayaran mockup). */
  async receivables() {
    const rows = await db('invoices as i')
      .join('registrations as r', 'r.id', 'i.registration_id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin(
        db('payments').select('invoice_id').sum('amount as paid').where('status', 'verified').groupBy('invoice_id').as('pp'),
        'pp.invoice_id',
        'i.id'
      )
      .leftJoin(
        db('payment_schedules').select('registration_id').min('due_date as next_due').where('status', 'unpaid').groupBy('registration_id').as('ns'),
        'ns.registration_id',
        'r.id'
      )
      .select(
        'i.id as invoice_id', 'i.number', 'i.total_amount', 'i.status as invoice_status',
        'r.id as registration_id', 'r.reg_number',
        'j.id as jamaah_id', 'j.full_name',
        'p.name as package_name', 'd.departure_date',
        'pp.paid', 'ns.next_due'
      )
      .orderBy('r.reg_number');

    const t = today();
    const data = rows.map((row: Record<string, unknown>) => {
      const total = Number(row.total_amount);
      const paid = Number(row.paid ?? 0);
      const remaining = total - paid;
      const nextDue = (row.next_due as string) ?? null;
      return {
        invoiceId: row.invoice_id,
        invoiceNumber: row.number,
        registrationId: row.registration_id,
        regNumber: row.reg_number,
        jamaahId: row.jamaah_id,
        name: row.full_name,
        packageName: row.package_name,
        departureDate: row.departure_date,
        total, paid, remaining,
        nextDueDate: nextDue,
        status: receivableStatus(remaining, nextDue, t),
        agingBucket: remaining > 0 ? agingBucket(nextDue, t) : 'belum'
      };
    });

    // KPI tiles
    const active = data.filter((r) => r.remaining > 0);
    const weekAhead = new Date(t + 'T00:00:00Z');
    weekAhead.setUTCDate(weekAhead.getUTCDate() + 7);
    const dueThisWeek = await db('payment_schedules')
      .where('status', 'unpaid')
      .andWhere('due_date', '<=', weekAhead.toISOString().slice(0, 10))
      .sum({ total: 'amount' })
      .count({ n: '*' })
      .first();
    const monthStart = t.slice(0, 7) + '-01';
    const collected = await db('payments')
      .where('status', 'verified')
      .andWhere('paid_at', '>=', monthStart)
      .sum({ total: 'amount' })
      .count({ n: '*' })
      .first();

    return {
      data,
      kpi: {
        totalReceivable: active.reduce((s, r) => s + r.remaining, 0),
        activeCount: active.length,
        dueThisWeek: Number(dueThisWeek?.total ?? 0),
        dueThisWeekCount: Number(dueThisWeek?.n ?? 0),
        collectedThisMonth: Number(collected?.total ?? 0),
        collectedThisMonthCount: Number(collected?.n ?? 0)
      }
    };
  },

  /** Piutang per umur tunggakan (GET /receivables/aging). */
  async aging() {
    const { data } = await this.receivables();
    const buckets = { belum: { label: 'Belum jatuh tempo', amount: 0, count: 0 }, d30: { label: '1–30 hari', amount: 0, count: 0 }, d60: { label: '31–60 hari', amount: 0, count: 0 }, d90: { label: '> 60 hari', amount: 0, count: 0 } };
    for (const r of data) {
      if (r.remaining <= 0) continue;
      buckets[r.agingBucket as keyof typeof buckets].amount += r.remaining;
      buckets[r.agingBucket as keyof typeof buckets].count += 1;
    }
    return { buckets, rows: data.filter((r) => r.remaining > 0) };
  },

  /** Data lengkap dokumen invoice A4 (replika mockup Invoice Kwitansi hal. 1). */
  async invoiceDocument(invoiceId: string) {
    const inv = await db('invoices as i')
      .join('registrations as r', 'r.id', 'i.registration_id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin('groups as g', 'g.id', 'r.group_id')
      .select(
        'i.*', 'r.reg_number', 'r.room_type', 'r.room_number', 'r.payment_scheme',
        'j.full_name', 'j.address', 'j.phone',
        'p.name as package_name', 'p.duration_days', 'p.base_price', 'p.triple_upcharge', 'p.double_upcharge',
        'd.departure_date', 'g.name as group_name'
      )
      .where('i.id', invoiceId)
      .first();
    if (!inv) throw errors.notFound('Invoice tidak ditemukan');

    const schedules = await db('payment_schedules').where({ registration_id: inv.registration_id }).orderBy('term_no');
    const payments = await db('payments').where({ invoice_id: invoiceId, status: 'verified' }).orderBy('paid_at');
    const paid = payments.reduce((s, p) => s + Number(p.amount), 0);

    const upcharge = inv.room_type === 'triple' ? Number(inv.triple_upcharge) : inv.room_type === 'double' ? Number(inv.double_upcharge) : 0;
    const items = [
      { description: `Paket ${inv.package_name}`, detail: `${inv.duration_days} hari · keberangkatan ${inv.departure_date}`, qty: 1, price: Number(inv.total_amount) - upcharge }
    ];
    if (upcharge > 0) {
      const roomLabel = inv.room_type === 'triple' ? 'Triple (3 orang/kamar)' : 'Double (2 orang/kamar)';
      items.push({ description: `Upgrade Kamar ${inv.room_type === 'triple' ? 'Triple' : 'Double'}`, detail: `${roomLabel} · selisih dari kuota Quad`, qty: 1, price: upcharge });
    }

    return {
      number: inv.number,
      issuedDate: inv.issued_date,
      dueDate: inv.due_date,
      status: inv.status,
      vaNumber: inv.va_number,
      billTo: { name: inv.full_name, regNumber: inv.reg_number, address: inv.address, phone: inv.phone },
      trip: {
        packageName: inv.package_name, durationDays: inv.duration_days, departureDate: inv.departure_date,
        groupName: inv.group_name, roomType: inv.room_type, roomNumber: inv.room_number
      },
      items: items.map((it) => ({ ...it, amount: it.qty * it.price })),
      schedules: schedules.map((s) => ({ id: s.id, termNo: s.term_no, label: s.label, amount: Number(s.amount), dueDate: s.due_date, status: s.status })),
      subtotal: Number(inv.total_amount),
      paid,
      remaining: Number(inv.total_amount) - paid
    };
  },

  /** Data dokumen kwitansi A4 (replika mockup hal. 2). */
  async receiptDocument(receiptId: string) {
    const rc = await db('receipts as rc')
      .join('payments as pm', 'pm.id', 'rc.payment_id')
      .join('invoices as i', 'i.id', 'pm.invoice_id')
      .join('registrations as r', 'r.id', 'i.registration_id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .leftJoin('bank_accounts as b', 'b.id', 'pm.bank_account_id')
      .select(
        'rc.*', 'pm.method', 'pm.paid_at', 'i.total_amount', 'i.id as invoice_id',
        'j.full_name', 'r.reg_number', 'b.name as bank_name'
      )
      .where('rc.id', receiptId)
      .first();
    if (!rc) throw errors.notFound('Kwitansi tidak ditemukan');
    const [{ paid }] = await db('payments').where({ invoice_id: rc.invoice_id, status: 'verified' }).sum({ paid: 'amount' });

    const methodLabel: Record<string, string> = { va: 'Transfer BSI Virtual Account', transfer: 'Transfer Bank', cash: 'Setor Tunai', card: 'Kartu Kredit' };
    return {
      number: rc.number,
      issuedDate: rc.issued_date,
      receivedFrom: rc.full_name,
      amount: Number(rc.amount),
      terbilang: rc.terbilang,
      description: rc.description,
      method: `${methodLabel[rc.method] ?? rc.method}${rc.bank_name ? '' : ''} · diterima ${new Date(rc.paid_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      summary: { total: Number(rc.total_amount), paid: Number(paid ?? 0), remaining: Number(rc.total_amount) - Number(paid ?? 0) }
    };
  },

  /** Daftar pembayaran sebuah invoice (utk panel verifikasi). */
  async invoicePayments(invoiceId: string) {
    const rows = await db('payments as pm')
      .leftJoin('payment_schedules as s', 's.id', 'pm.schedule_id')
      .leftJoin('receipts as rc', 'rc.payment_id', 'pm.id')
      .leftJoin('bank_accounts as b', 'b.id', 'pm.bank_account_id')
      .select('pm.*', 's.label as schedule_label', 'rc.id as receipt_id', 'rc.number as receipt_number', 'b.name as bank_name')
      .where('pm.invoice_id', invoiceId)
      .orderBy('pm.paid_at');
    return rows.map((p) => ({
      id: p.id, amount: Number(p.amount), method: p.method, status: p.status, paidAt: p.paid_at,
      reference: p.reference, scheduleLabel: p.schedule_label, bank: p.bank_name,
      receiptId: p.receipt_id, receiptNumber: p.receipt_number
    }));
  },

  async bankAccounts() {
    return db('bank_accounts').orderBy('account_code');
  },

  // ===== Master data: rekening bank =====
  // Saldo TIDAK bisa diubah dari sini — hanya bergerak lewat jurnal (aturan §4 PLAN.md)
  async createBankAccount(req: Request, input: BankAccountInput) {
    await assertBankAccountCode(input.accountCode);
    const dup = await db('bank_accounts').where({ account_code: input.accountCode }).first();
    if (dup) throw errors.conflict(`Rekening dengan kode akun ${input.accountCode} sudah ada`);
    const [row] = await db('bank_accounts')
      .insert({
        account_code: input.accountCode,
        name: input.name,
        bank: input.bank ?? null,
        account_no: input.accountNo ?? null,
        currency: input.currency,
        balance: 0
      })
      .returning('*');
    await audit(req, { action: 'master.bank.create', entity: 'bank_accounts', entityId: row.id, newValues: input });
    return row;
  },

  async updateBankAccount(req: Request, id: string, input: BankAccountInput) {
    const before = await db('bank_accounts').where({ id }).first();
    if (!before) throw errors.notFound('Rekening bank tidak ditemukan');
    if (input.accountCode !== before.account_code) {
      await assertBankAccountCode(input.accountCode);
      const dup = await db('bank_accounts').where({ account_code: input.accountCode }).whereNot({ id }).first();
      if (dup) throw errors.conflict(`Kode akun ${input.accountCode} sudah dipakai rekening lain`);
      if (Number(before.balance) !== 0)
        throw errors.badRequest('Kode akun rekening bersaldo tidak boleh diganti — saldo terikat ke akun COA');
    }
    const [row] = await db('bank_accounts')
      .where({ id })
      .update({
        account_code: input.accountCode,
        name: input.name,
        bank: input.bank ?? null,
        account_no: input.accountNo ?? null,
        currency: input.currency,
        updated_at: db.fn.now()
      })
      .returning('*');
    await audit(req, { action: 'master.bank.update', entity: 'bank_accounts', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteBankAccount(req: Request, id: string) {
    const before = await db('bank_accounts').where({ id }).first();
    if (!before) throw errors.notFound('Rekening bank tidak ditemukan');
    if (Number(before.balance) !== 0)
      throw errors.conflict('Rekening masih bersaldo — tidak bisa dihapus (saldo hanya bergerak lewat jurnal)');
    const used = await db('payments').where({ bank_account_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(used?.count)) throw errors.conflict(`Rekening dipakai ${used?.count} pembayaran — tidak bisa dihapus`);
    await db('bank_accounts').where({ id }).del();
    await audit(req, { action: 'master.bank.delete', entity: 'bank_accounts', entityId: id, oldValues: before });
    return { deleted: true };
  }
};

type BankAccountInput = z.infer<typeof upsertBankAccountSchema>;

/** Kode akun rekening wajib terdaftar di COA sebagai akun kelas 1 yang bisa diposting. */
async function assertBankAccountCode(code: string) {
  const acc = await db('accounts').where({ code }).first();
  if (!acc) throw errors.badRequest(`Akun ${code} tidak ada di Bagan Akun — tambahkan dulu di COA`);
  if (acc.class !== 1 || !acc.is_postable) throw errors.badRequest(`Akun ${code} bukan akun aset yang bisa diposting`);
}
