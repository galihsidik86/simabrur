import type { Request } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { nextNumber } from '../../utils/numbering.js';
import { terbilang } from '../../utils/terbilang.js';
import { todayWib } from '../../utils/date.js';
import { withTransaction } from '../../utils/tx.js';
import type { payRefundSchema } from './payments.validation.js';
import { postJournal } from '../accounting/journal.engine.js';

type PayRefundInput = z.infer<typeof payRefundSchema>;

const today = todayWib;

/** Query dasar RefundDto (kontrak langkah 9) — dipakai list/detail/by-registration. */
function refundQuery(exec: Knex | Knex.Transaction) {
  return exec('refunds as rf')
    .join('registrations as r', 'r.id', 'rf.registration_id')
    .join('jamaah as j', 'j.id', 'r.jamaah_id')
    .join('departures as d', 'd.id', 'r.departure_id')
    .join('packages as p', 'p.id', 'd.package_id')
    .join('cost_centers as cc', 'cc.id', 'rf.cost_center_id')
    .leftJoin('bank_accounts as ba', 'ba.id', 'rf.bank_account_id')
    .leftJoin('journals as jr', 'jr.id', 'rf.journal_id')
    .select(
      'rf.id', 'rf.registration_id', 'r.reg_number', 'j.full_name as jamaah_name',
      'p.name as package_name', 'd.departure_date', 'cc.code as cost_center_code',
      'rf.paid_total', 'rf.deduction', 'rf.refund_amount', 'rf.deduction_reason',
      'rf.status', 'r.cancel_reason', 'r.cancelled_at', 'rf.paid_at',
      'ba.account_code as bank_account_code', 'jr.journal_no as journal_number',
      'rf.receipt_number'
    );
}

function mapRefundRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    registrationId: row.registration_id,
    regNumber: row.reg_number,
    jamaahName: row.jamaah_name,
    packageName: row.package_name,
    departureDate: row.departure_date,
    costCenterCode: row.cost_center_code,
    paidTotal: Number(row.paid_total),
    deduction: Number(row.deduction),
    refundAmount: Number(row.refund_amount),
    deductionReason: row.deduction_reason ?? null,
    status: row.status,
    cancelReason: row.cancel_reason ?? null,
    cancelledAt: row.cancelled_at ?? null,
    paidAt: row.paid_at ?? null,
    bankAccountCode: row.bank_account_code ?? null,
    journalNumber: row.journal_number ?? null,
    // A (putaran 3): nomor kwitansi refund KWR/YYYY/MM/NNNN, terbit saat dibayar.
    receiptNumber: row.receipt_number ?? null
  };
}

async function buildRefundDetail(exec: Knex | Knex.Transaction, id: string) {
  const row = await refundQuery(exec).where('rf.id', id).first();
  return row ? mapRefundRow(row) : null;
}

export const refundsService = {
  /** Detail refund by id (RefundDto), executable di dalam transaksi (`exec`). */
  async refundDetail(exec: Knex | Knex.Transaction, id: string) {
    return buildRefundDetail(exec, id);
  },

  /** Refund milik sebuah registrasi (dipakai GET /jamaah/:id). */
  async refundByRegistration(registrationId: string) {
    const row = await refundQuery(db).where('rf.registration_id', registrationId).first();
    return row ? mapRefundRow(row) : null;
  },

  /** GET /v1/refunds?status=pending|paid — role keuangan/pimpinan/admin. */
  async listRefunds(status?: 'pending' | 'paid') {
    const rows = await refundQuery(db)
      .modify((q) => { if (status) q.where('rf.status', status); })
      .orderBy('r.reg_number');
    return rows.map(mapRefundRow);
  },

  /**
   * POST /v1/refunds/:id/pay — bayar refund pembatalan (role keuangan/admin).
   * Jurnal (cost center keberangkatan): Dr 2-1100 paidTotal · Cr Bank (paidTotal −
   * deduction) · Cr 4-9000 (deduction) — baris nol dihilangkan.
   */
  async payRefund(req: Request, refundId: string, input: PayRefundInput, idempotencyKey?: string) {
    if (idempotencyKey) {
      const existing = await db('refunds').where({ idempotency_key: idempotencyKey }).first();
      if (existing) {
        if (existing.id !== refundId) throw errors.conflict('Idempotency-Key sudah dipakai untuk refund lain');
        return buildRefundDetail(db, existing.id);
      }
    }
    return withTransaction(async (trx) => {
      const refund = await trx('refunds').where({ id: refundId }).forUpdate().first();
      if (!refund) throw errors.notFound('Refund tidak ditemukan');
      if (refund.status === 'paid') {
        // R3-01: pemeriksaan idempotency di atas berjalan DI LUAR transaksi, jadi dua
        // request dengan kunci sama bisa sama-sama lolos dan sama-sama masuk ke sini.
        // Yang kalah mendapati refund sudah `paid` dan dulu dijawab 409 — padahal itu
        // percobaan ulang yang SAH (mis. klien kehilangan respons lalu mengirim lagi),
        // dan justru inilah yang seharusnya dilindungi Idempotency-Key.
        // Diperiksa ulang DI DALAM lock: kalau kuncinya memang milik baris ini,
        // kembalikan hasil yang sama seperti request pertama, bukan galat.
        if (idempotencyKey && refund.idempotency_key === idempotencyKey) {
          return buildRefundDetail(trx, refund.id);
        }
        throw errors.conflict('Refund ini sudah dibayar');
      }

      const paidTotal = Number(refund.paid_total);
      const deduction = Math.round(input.deduction);
      if (deduction > paidTotal + 0.001) {
        throw errors.badRequest(
          `Potongan (Rp ${deduction.toLocaleString('id-ID')}) melebihi total pembayaran terverifikasi (Rp ${paidTotal.toLocaleString('id-ID')})`
        );
      }
      if (deduction > 0 && !input.deductionReason) {
        throw errors.badRequest('Alasan potongan wajib diisi bila potongan lebih dari 0');
      }
      const bank = await trx('bank_accounts').where({ account_code: input.bankAccountCode }).first();
      if (!bank) throw errors.badRequest(`Rekening ${input.bankAccountCode} tidak ditemukan`);
      if (bank.currency !== 'IDR') throw errors.badRequest('Refund harus melalui rekening IDR');

      const refundAmount = paidTotal - deduction;
      const date = input.date ?? today();
      const lines = [{ accountCode: '2-1100', debit: paidTotal }] as { accountCode: string; debit?: number; credit?: number }[];
      if (refundAmount > 0) lines.push({ accountCode: input.bankAccountCode, credit: refundAmount });
      if (deduction > 0) lines.push({ accountCode: '4-9000', credit: deduction });

      const reg = await trx('registrations').where({ id: refund.registration_id }).first();
      const journal = await postJournal(trx, {
        date,
        description: `Refund pembatalan — ${reg.reg_number}`,
        source: 'refund',
        refType: 'refunds',
        refId: refund.id,
        costCenterId: refund.cost_center_id,
        createdBy: req.user?.id ?? null,
        lines
      });

      // A (putaran 3): nomor kwitansi refund KWR/YYYY/MM/NNNN — bulan/tahun dari
      // tanggal refund (WIB), pola sama dengan KWT/YYYY/MM kwitansi pembayaran.
      const [ry, rm] = date.split('-');
      const receiptNumber = await nextNumber(trx, `KWR/${ry}/${rm}`, 4, '/');

      await trx('refunds')
        .where({ id: refund.id })
        .update({
          deduction,
          refund_amount: refundAmount,
          deduction_reason: deduction > 0 ? (input.deductionReason ?? null) : null,
          status: 'paid',
          bank_account_id: bank.id,
          journal_id: journal.id,
          reference: input.reference ?? null,
          idempotency_key: idempotencyKey ?? null,
          receipt_number: receiptNumber,
          receipt_issued_date: date,
          paid_by: req.user?.id ?? null,
          paid_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });

      await audit(req, {
        action: 'refunds.pay', entity: 'refunds', entityId: refund.id,
        newValues: { deduction, refundAmount, journalNo: journal.journal_no }
      }, trx);
      return buildRefundDetail(trx, refund.id);
    }, { retries: 2 });
  },

  /**
   * A (putaran 3) — GET /v1/refunds/:id/receipt: dokumen kwitansi refund (meniru
   * bentuk `receiptDocument` kwitansi pembayaran). 404 bila refund tidak ada ATAU
   * belum berstatus `paid` (kwitansi hanya ada setelah pembayaran refund terjadi).
   */
  async refundReceipt(refundId: string) {
    const row = await db('refunds as rf')
      .join('registrations as r', 'r.id', 'rf.registration_id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin('bank_accounts as ba', 'ba.id', 'rf.bank_account_id')
      .leftJoin('journals as jr', 'jr.id', 'rf.journal_id')
      .leftJoin('users as u', 'u.id', 'rf.paid_by')
      .select(
        'rf.*', 'r.reg_number', 'j.full_name as jamaah_name',
        'p.name as package_name', 'd.departure_date', 'r.cancel_reason', 'r.cancelled_at',
        'ba.account_code as bank_code', 'ba.name as bank_name', 'ba.bank as bank_bank', 'ba.account_no as bank_account_no',
        'jr.journal_no as journal_number', 'u.name as paid_by_name'
      )
      .where('rf.id', refundId)
      .first();
    if (!row || row.status !== 'paid') throw errors.notFound('Kwitansi refund tidak ditemukan / belum dibayar');
    return {
      refundId: row.id,
      receiptNumber: row.receipt_number,
      issuedDate: row.receipt_issued_date,
      regNumber: row.reg_number,
      jamaahName: row.jamaah_name,
      packageName: row.package_name,
      departureDate: row.departure_date,
      cancelReason: row.cancel_reason ?? null,
      cancelledAt: row.cancelled_at ?? null,
      paidTotal: Number(row.paid_total),
      deduction: Number(row.deduction),
      deductionReason: row.deduction_reason ?? null,
      refundAmount: Number(row.refund_amount),
      amountInWords: terbilang(Number(row.refund_amount)),
      bankAccount: row.bank_code
        ? { code: row.bank_code, name: row.bank_name, bank: row.bank_bank, accountNo: row.bank_account_no }
        : null,
      reference: row.reference ?? null,
      journalNumber: row.journal_number ?? null,
      paidByName: row.paid_by_name ?? null
    };
  },
};
