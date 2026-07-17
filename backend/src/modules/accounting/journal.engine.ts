import type { Knex } from 'knex';
import { errors } from '../../utils/http.js';
import { nextNumber } from '../../utils/numbering.js';

/**
 * Journal engine — SATU-SATUNYA jalur pembuatan jurnal.
 * Menjaga aturan kritis PLAN.md §4.6: setiap jurnal HARUS balance (Σdebit = Σkredit).
 */

export interface JournalLineInput {
  accountCode: string;
  debit?: number; // IDR fungsional
  credit?: number; // IDR fungsional
  amountForeign?: number | null;
}

export interface JournalInput {
  date: string; // YYYY-MM-DD
  description: string;
  source: 'payment' | 'expense' | 'revenue' | 'commission' | 'manual' | 'reconciliation';
  refType?: string;
  refId?: string;
  costCenterId?: string | null;
  currency?: string;
  exchangeRate?: number;
  createdBy?: string | null;
  lines: JournalLineInput[];
}

const round = (n: number) => Math.round(n); // rupiah bulat — hindari selisih floating point

export async function postJournal(trx: Knex, input: JournalInput) {
  if (input.lines.length < 2) throw errors.badRequest('Jurnal minimal 2 baris');

  const totalDebit = round(input.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const totalCredit = round(input.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  if (totalDebit !== totalCredit) {
    throw errors.badRequest(
      `Jurnal tidak balance: total debit Rp ${totalDebit.toLocaleString('id-ID')} ≠ total kredit Rp ${totalCredit.toLocaleString('id-ID')}`
    );
  }
  if (totalDebit <= 0) throw errors.badRequest('Nilai jurnal harus lebih dari 0');
  for (const l of input.lines) {
    if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0) throw errors.badRequest('Debit/kredit tidak boleh negatif');
    if ((l.debit ?? 0) > 0 && (l.credit ?? 0) > 0) throw errors.badRequest('Satu baris tidak boleh debit sekaligus kredit');
  }

  // Resolusi akun + validasi postable
  const codes = [...new Set(input.lines.map((l) => l.accountCode))];
  const accounts = await trx('accounts').whereIn('code', codes);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const code of codes) {
    const acc = byCode.get(code);
    if (!acc) throw errors.badRequest(`Akun ${code} tidak ada di bagan akun`);
    if (!acc.is_postable) throw errors.badRequest(`Akun ${code} (${acc.name}) adalah akun induk — tidak bisa diposting`);
  }

  const year = input.date.slice(0, 4);
  const journalNo = await nextNumber(trx as Knex.Transaction, `JV-${year}`);

  const [journal] = await trx('journals')
    .insert({
      journal_no: journalNo,
      date: input.date,
      description: input.description,
      source: input.source,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
      cost_center_id: input.costCenterId ?? null,
      currency: input.currency ?? 'IDR',
      exchange_rate: input.exchangeRate ?? 1,
      created_by: input.createdBy ?? null
    })
    .returning('*');

  const lines = input.lines.map((l, i) => ({
    journal_id: journal.id,
    account_id: byCode.get(l.accountCode)!.id,
    debit: round(l.debit ?? 0),
    credit: round(l.credit ?? 0),
    amount_foreign: l.amountForeign ?? null,
    position: i
  }));
  await trx('journal_lines').insert(lines);

  // Sinkron saldo kas/bank (akun 1-11xx/1-12xx yang terdaftar di bank_accounts)
  for (const l of input.lines) {
    const delta = round(l.debit ?? 0) - round(l.credit ?? 0);
    if (delta !== 0) {
      await trx('bank_accounts').where({ account_code: l.accountCode }).increment('balance', delta);
    }
  }

  return { ...journal, totalDebit, totalCredit, lines: input.lines };
}

/* ===== Template ayat jurnal kunci (Chart of Accounts.dc.html, alur A–F) ===== */

/** A/B — Penerimaan DP/pelunasan jamaah: Dr Bank/Kas · Cr 2-1100 Uang Muka Jamaah. */
export function receiptLines(bankCode: string, amount: number): JournalLineInput[] {
  return [
    { accountCode: bankCode, debit: amount },
    { accountCode: '2-1100', credit: amount }
  ];
}

/** D — Pengakuan pendapatan saat keberangkatan (PSAK 72): Dr 2-1100 · Cr 4-xxxx. */
export function revenueRecognitionLines(revenueCode: string, amount: number): JournalLineInput[] {
  return [
    { accountCode: '2-1100', debit: amount },
    { accountCode: revenueCode, credit: amount }
  ];
}

/** E — Pengakuan HPP saat keberangkatan: Dr 5-xxxx per komponen · Cr 1-1400 Uang Muka Vendor. */
export function hppRecognitionLines(components: { accountCode: string; amount: number }[]): JournalLineInput[] {
  const total = components.reduce((s, c) => s + c.amount, 0);
  return [
    ...components.map((c) => ({ accountCode: c.accountCode, debit: c.amount })),
    { accountCode: '1-1400', credit: total }
  ];
}

/** F — Komisi agen: Dr 6-2000 · Cr 2-1400 Hutang Komisi Agen. */
export function commissionLines(amount: number): JournalLineInput[] {
  return [
    { accountCode: '6-2000', debit: amount },
    { accountCode: '2-1400', credit: amount }
  ];
}

/**
 * C — Pembayaran biaya (multi-akun, opsional valas).
 * Baris biaya dicatat IDR = amount(valas) × kurs; kredit bank sumber.
 * Bila pelunasan hutang vendor valas: Dr 2-1300 memakai kursHutang, selisih kurs → 7-1000.
 */
export function expenseLines(opts: {
  sourceBankCode: string;
  lines: { accountCode: string; amount: number }[]; // amount dalam mata uang transaksi
  exchangeRate: number; // 1 utk IDR
  settleDebt?: boolean;
  exchangeRateAtRecognition?: number;
}): JournalLineInput[] {
  const rate = opts.exchangeRate || 1;
  const totalForeign = opts.lines.reduce((s, l) => s + l.amount, 0);
  const totalIdr = Math.round(totalForeign * rate);

  if (opts.settleDebt && opts.exchangeRateAtRecognition && opts.exchangeRateAtRecognition !== rate) {
    // Realisasi selisih kurs: hutang diakui pada kurs lama, dibayar pada kurs sekarang
    const debtIdr = Math.round(totalForeign * opts.exchangeRateAtRecognition);
    const diff = totalIdr - debtIdr; // >0 = rugi kurs (bayar lebih mahal), <0 = laba
    const result: JournalLineInput[] = [{ accountCode: '2-1300', debit: debtIdr, amountForeign: totalForeign }];
    if (diff > 0) result.push({ accountCode: '7-1000', debit: diff });
    if (diff < 0) result.push({ accountCode: '7-1000', credit: -diff });
    result.push({ accountCode: opts.sourceBankCode, credit: totalIdr, amountForeign: totalForeign });
    return result;
  }

  return [
    ...opts.lines.map((l) => ({
      accountCode: l.accountCode,
      debit: Math.round(l.amount * rate),
      amountForeign: rate !== 1 ? l.amount : null
    })),
    { accountCode: opts.sourceBankCode, credit: totalIdr, amountForeign: rate !== 1 ? totalForeign : null }
  ];
}
