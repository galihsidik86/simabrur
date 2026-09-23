import type { Request } from 'express';
import type { Knex } from 'knex';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { todayWib } from '../../utils/date.js';
import { withTransaction } from '../../utils/tx.js';
import { postJournal } from './journal.engine.js';

/**
 * R3TS-02 — modul tagihan vendor, dipecah dari `accounting.service.ts` (sudah di atas
 * batas lunak 800 baris). Berisi daftar & pembatalan tagihan, plus helper pelunasan
 * yang dipakai `transactionExpense` (Pembayaran Biaya).
 */

const today = todayWib;

/** Baris Pembayaran Biaya; `vendorBillId` menandai baris pelunasan tagihan tercatat. */
export interface ExpenseBillLine {
  accountCode: string;
  amount: number;
  vendorBillId?: string | null;
}

export type LockedBills = Map<string, Record<string, any>>;

/**
 * Validasi & KUNCI (forUpdate) seluruh tagihan vendor yang dilunasi dalam satu
 * Pembayaran Biaya, SEBELUM jurnal diposting, agar transaksi gagal bersih (rollback
 * utuh) bila ada tagihan yang tidak valid.
 *
 * Tagihan vendor (`vendor_bills`) lahir dari alokasi HPP > saldo 1-1400: baris dengan
 * vendorBillId WAJIB akun 2-1300 & rekening IDR (vendor_bills selalu dalam rupiah —
 * tidak ada realisasi kurs untuk pelunasan ini).
 */
export async function lockVendorBillsForSettlement(
  trx: Knex,
  opts: { lines: ExpenseBillLine[]; bankCurrency: string; vendorId?: string | null; costCenterId?: string | null }
): Promise<LockedBills> {
  const locked: LockedBills = new Map();
  const billLines = opts.lines.filter((l) => l.vendorBillId);
  if (billLines.length === 0) return locked;

  if (opts.bankCurrency !== 'IDR') {
    throw errors.badRequest('Pelunasan tagihan vendor tercatat hanya didukung via rekening IDR');
  }
  for (const l of billLines) {
    if (l.accountCode !== '2-1300') {
      throw errors.badRequest('vendorBillId hanya berlaku untuk baris akun 2-1300 (Hutang Vendor)');
    }
    const bill = await trx('vendor_bills').where({ id: l.vendorBillId as string }).forUpdate().first();
    if (!bill) throw errors.notFound(`Tagihan vendor ${l.vendorBillId} tidak ditemukan`);
    if (bill.status === 'paid') throw errors.conflict('Tagihan vendor ini sudah lunas');
    if (bill.status === 'void') throw errors.conflict('Tagihan vendor ini sudah dibatalkan — tidak bisa dilunasi');
    if (opts.vendorId && bill.vendor_id !== opts.vendorId) {
      throw errors.badRequest('Tagihan vendor tidak sesuai dengan vendorId yang dipilih');
    }
    // R3SEC-02: cost center input WAJIB sama dengan cost center tagihannya. Tanpa
    // pemeriksaan ini jurnal pelunasan mendarat di keberangkatan LAIN — beban
    // keberangkatan A terbaca sebagai beban keberangkatan B, dan laba per cost center
    // (lihat `summary`) ikut keliru tanpa jejak apa pun.
    // Dipilih MENOLAK (400) alih-alih menimpa input dengan `bill.cost_center_id`, agar
    // sebangun dengan guard vendorId tepat di atas: input yang BERTENTANGAN dengan
    // tagihan selalu ditolak, tidak pernah ditulis ulang diam-diam. Menimpa juga tidak
    // aman di sini karena satu jurnal Pembayaran Biaya boleh memuat baris NON-tagihan
    // milik cost center yang dipilih pengguna — memindah CC akan ikut menyeret baris itu.
    // Batas yang disadari: bila costCenterId tidak diisi (sama seperti guard vendorId),
    // pelunasan tetap diterima tanpa cost center — tidak salah keberangkatan, hanya
    // tidak teratribusi; pilihan itu tetap di tangan pengguna.
    if (opts.costCenterId && bill.cost_center_id && bill.cost_center_id !== opts.costCenterId) {
      throw errors.badRequest('Cost center tidak sesuai dengan cost center tagihan vendor yang dilunasi');
    }
    const remaining = Number(bill.amount) - Number(bill.paid_amount);
    const payNow = Math.round(l.amount);
    if (payNow > remaining + 0.001) {
      throw errors.badRequest(
        `Nominal pelunasan (Rp ${payNow.toLocaleString('id-ID')}) melebihi sisa tagihan vendor (Rp ${remaining.toLocaleString('id-ID')})`
      );
    }
    locked.set(l.vendorBillId as string, bill);
  }
  return locked;
}

/** Catat pelunasan pada tagihan yang sudah dikunci: naikkan paid_amount, tandai lunas. */
export async function applyVendorBillPayments(trx: Knex, lines: ExpenseBillLine[], locked: LockedBills) {
  for (const l of lines) {
    if (!l.vendorBillId) continue;
    const bill = locked.get(l.vendorBillId)!;
    const newPaid = Number(bill.paid_amount) + Math.round(l.amount);
    const status = newPaid >= Number(bill.amount) - 0.001 ? 'paid' : 'unpaid';
    await trx('vendor_bills').where({ id: bill.id as string }).update({ paid_amount: newPaid, status, updated_at: trx.fn.now() });
  }
}

export const vendorBillsService = {
  /** B (putaran 3) — daftar tagihan vendor (dari alokasi HPP > saldo 1-1400). */
  async vendorBills(filter: { status?: 'unpaid' | 'paid' | 'void'; costCenterId?: string }) {
    const rows = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .leftJoin('cost_centers as cc', 'cc.id', 'vb.cost_center_id')
      .select(
        'vb.id', 'vb.vendor_id', 'v.name as vendor_name', 'vb.cost_center_id', 'cc.code as cost_center_code',
        'vb.account_code', 'vb.amount', 'vb.paid_amount', 'vb.currency', 'vb.due_date', 'vb.status', 'vb.created_at'
      )
      .modify((q) => {
        if (filter.status) q.where('vb.status', filter.status);
        if (filter.costCenterId) q.where('vb.cost_center_id', filter.costCenterId);
      })
      .orderBy('vb.created_at', 'desc');
    return rows.map((r: Record<string, unknown>) => ({
      id: r.id, vendorId: r.vendor_id, vendorName: r.vendor_name,
      costCenterId: r.cost_center_id, costCenterCode: r.cost_center_code ?? null,
      accountCode: r.account_code ?? null, amount: Number(r.amount), paidAmount: Number(r.paid_amount),
      remaining: Number(r.amount) - Number(r.paid_amount), currency: r.currency,
      dueDate: r.due_date ?? null, status: r.status
    }));
  },

  /**
   * Tugas lanjutan putaran 3 — PATCH /v1/vendor-bills/:id/void (role keuangan).
   * Tagihan vendor lahir dari kelebihan komponen HPP di atas saldo 1-1400 (Dr 5-xxxx
   * penuh · Cr 1-1400 alokasi · Cr 2-1300 kelebihan — lihat `transactionRevenueRecognition`).
   * Membatalkannya berarti membalik SLICE 2-1300/5-xxxx milik tagihan ini SAJA (bukan
   * seluruh jurnal HPP, yang mungkin berisi komponen lain yang TIDAK dibatalkan):
   * Dr 2-1300 (nominal tagihan) · Cr akun HPP (`vendor_bills.account_code`).
   * Prasyarat: `status='unpaid'` DAN `paid_amount=0` (sudah dibayar sebagian/lunas
   * → 409, tidak bisa dibatalkan); belum pernah di-void (409).
   */
  async voidVendorBill(req: Request, id: string, reason: string) {
    return withTransaction(async (trx) => {
      const bill = await trx('vendor_bills').where({ id }).forUpdate().first();
      if (!bill) throw errors.notFound('Tagihan vendor tidak ditemukan');
      if (bill.status === 'void') throw errors.conflict('Tagihan vendor ini sudah dibatalkan');
      if (bill.status === 'paid') throw errors.conflict('Tagihan vendor ini sudah lunas — tidak bisa dibatalkan');
      if (Number(bill.paid_amount) > 0) {
        throw errors.conflict('Tagihan vendor ini sudah memiliki pelunasan sebagian — tidak bisa dibatalkan');
      }
      // Defensif: seluruh vendor_bills yang ada saat ini SELALU dibuat dengan
      // account_code terisi (lihat transactionRevenueRecognition) — tidak ada baris
      // lama tanpa account_code di skema ini (fitur & kolom sama-sama baru putaran 3).
      // Guard ini menutup kemungkinan masa depan (mis. baris dibuat via jalur lain).
      if (!bill.account_code) {
        throw errors.badRequest('Tagihan vendor ini tidak memiliki akun HPP tertaut — tidak bisa dibatalkan otomatis');
      }

      const amount = Number(bill.amount);
      const journal = await postJournal(trx, {
        date: today(),
        description: `Pembatalan tagihan vendor — ${reason}`,
        source: 'expense',
        refType: 'vendor_bills',
        refId: bill.id,
        costCenterId: bill.cost_center_id,
        createdBy: req.user?.id ?? null,
        lines: [
          { accountCode: '2-1300', debit: amount },
          { accountCode: bill.account_code, credit: amount }
        ]
      });

      await trx('vendor_bills')
        .where({ id: bill.id })
        .update({
          status: 'void',
          void_reason: reason,
          voided_by: req.user?.id ?? null,
          voided_at: trx.fn.now(),
          reversal_journal_id: journal.id,
          updated_at: trx.fn.now()
        });

      await audit(req, {
        action: 'vendor_bills.void', entity: 'vendor_bills', entityId: bill.id,
        oldValues: { status: bill.status }, newValues: { status: 'void', reason, journalNo: journal.journal_no }
      }, trx);

      return { id: bill.id, status: 'void' as const, journalNo: journal.journal_no };
    }, { retries: 2 });
  }
};
