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
  source: 'payment' | 'expense' | 'revenue' | 'commission' | 'manual' | 'reconciliation' | 'refund';
  refType?: string;
  refId?: string;
  costCenterId?: string | null;
  currency?: string;
  exchangeRate?: number;
  createdBy?: string | null;
  lines: JournalLineInput[];
}

const round = (n: number) => Math.round(n); // rupiah bulat — hindari selisih floating point

/**
 * AK-03 — rekonsiliasi bank yang sudah `completed` MENGUNCI periodenya.
 *
 * Finalisasi menyatakan "saldo buku akun bank ini per tanggal koran sudah cocok dan
 * ditandatangani" (snapshot `reconciled_diff`). Tanpa penguncian, jurnal baru bertanggal
 * MUNDUR ke dalam periode itu diam-diam menggeser saldo buku sesudah fakta, sehingga
 * pernyataan yang sudah ditandatangani jadi tidak benar dan tidak ada yang tahu.
 *
 * Bentuk paling minimal yang aman: tolak posting yang MENYENTUH akun bank terkunci pada
 * tanggal ≤ statement_date sesi completed-nya. Diletakkan di `postJournal` karena ini
 * satu-satunya gerbang posting — semua jalur (manual, pembayaran, biaya, penyesuaian,
 * pembalikan) ikut terlindungi tanpa perubahan di pemanggil.
 *
 * Batas yang disadari (sengaja TIDAK diperluas):
 *  - Penguncian hanya per AKUN BANK, bukan per periode akuntansi menyeluruh. Jurnal
 *    yang tidak menyentuh akun bank terkunci tetap bisa mundur ke periode itu — untuk
 *    itu dibutuhkan penutupan periode (period close) yang belum ada di skema ini.
 *  - Tidak ada jalur "buka kembali" rekonsiliasi; `openReconciliation` memang sudah
 *    menolak sesi completed (409), jadi kunci ini bersifat tetap. Koreksi dilakukan
 *    dengan jurnal bertanggal SETELAH statement_date — praktik akuntansi yang lazim.
 */
async function assertReconciliationNotLocked(trx: Knex, date: string, accountCodes: string[]) {
  const locked = await trx('bank_reconciliations as r')
    .join('bank_accounts as b', 'b.id', 'r.bank_account_id')
    .select('b.account_code', 'r.period', 'r.statement_date')
    .where('r.status', 'completed')
    .whereIn('b.account_code', accountCodes)
    .andWhere('r.statement_date', '>=', date)
    .orderBy('r.statement_date', 'desc')
    .first();
  if (locked) {
    throw errors.conflict(
      `Rekonsiliasi rekening ${locked.account_code} periode ${locked.period} sudah diselesaikan & terkunci — jurnal bertanggal ${date} tidak bisa diposting. Gunakan tanggal setelah ${new Date(locked.statement_date).toISOString().slice(0, 10)}.`
    );
  }
}

export async function postJournal(trx: Knex, input: JournalInput) {
  if (input.lines.length < 2) throw errors.badRequest('Jurnal minimal 2 baris');

  // Bulatkan ke rupiah SEKALI — validasi balance, penyimpanan, dan sinkron saldo
  // memakai nilai yang sama persis. (Bila validasi memakai round(total) tapi
  // simpan round(per-baris), jurnal tak-balance bisa lolos & tersimpan.)
  const norm = input.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: round(l.debit ?? 0),
    credit: round(l.credit ?? 0),
    amountForeign: l.amountForeign ?? null
  }));

  const totalDebit = norm.reduce((s, l) => s + l.debit, 0);
  const totalCredit = norm.reduce((s, l) => s + l.credit, 0);
  if (totalDebit !== totalCredit) {
    throw errors.badRequest(
      `Jurnal tidak balance: total debit Rp ${totalDebit.toLocaleString('id-ID')} ≠ total kredit Rp ${totalCredit.toLocaleString('id-ID')}`
    );
  }
  if (totalDebit <= 0) throw errors.badRequest('Nilai jurnal harus lebih dari 0');
  for (const l of norm) {
    if (l.debit < 0 || l.credit < 0) throw errors.badRequest('Debit/kredit tidak boleh negatif');
    if (l.debit > 0 && l.credit > 0) throw errors.badRequest('Satu baris tidak boleh debit sekaligus kredit');
  }

  // Resolusi akun + validasi postable
  const codes = [...new Set(norm.map((l) => l.accountCode))];
  const accounts = await trx('accounts').whereIn('code', codes);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const code of codes) {
    const acc = byCode.get(code);
    if (!acc) throw errors.badRequest(`Akun ${code} tidak ada di bagan akun`);
    if (!acc.is_postable) throw errors.badRequest(`Akun ${code} (${acc.name}) adalah akun induk — tidak bisa diposting`);
  }

  // N-3: 2-1100 Uang Muka Jamaah per cost center TIDAK BOLEH negatif. Ini generik
  // (berlaku utk SEMUA sumber jurnal, bukan hanya manual) karena postJournal adalah
  // satu-satunya gerbang posting. Jalur sah yang sudah ada tetap lolos: penerimaan
  // pembayaran hanya MENGKREDIT (menaikkan) 2-1100, dan pengakuan pendapatan sudah
  // divalidasi di accounting.service SEBELUM memanggil fungsi ini (nilainya sama,
  // jadi guard ini hanya menutup celah jurnal manual/lain — bukan mengubah hasil).
  const liab2100Lines = norm.filter((l) => l.accountCode === '2-1100');
  if (liab2100Lines.length > 0) {
    if (!input.costCenterId) {
      throw errors.badRequest('Baris 2-1100 Uang Muka Jamaah wajib menyertakan cost center keberangkatan');
    }
    // R3SEC-01: KUNCI baris cost center SEBELUM membaca saldo. Tanpa lock, dua
    // transaksi konkuren pada CC yang sama (isolasi default READ COMMITTED) sama-sama
    // membaca saldo LAMA, sama-sama lolos guard, lalu commit → 2-1100 per CC negatif.
    // Lock diletakkan di sini (bukan di tiap pemanggil) supaya SEMUA jalur posting ikut
    // terlindungi: jurnal manual, reverseManualJournal, payRefund, dan pemanggil baru
    // di masa depan. transactionRevenueRecognition sudah mengunci baris yang sama di
    // transaksi yang sama — mengunci ulang dalam satu transaksi tidak berefek (no-op).
    // Konsekuensi: posting yang menyentuh 2-1100 pada SATU cost center berjalan seri;
    // cost center berbeda tetap paralel.
    await trx('cost_centers').where({ id: input.costCenterId }).forUpdate().first();
    const netChange = liab2100Lines.reduce((s, l) => s + (l.credit - l.debit), 0);
    const [{ liab }] = await trx('journal_lines as jl')
      .join('accounts as a', 'a.id', 'jl.account_id')
      .join('journals as j', 'j.id', 'jl.journal_id')
      .where('a.code', '2-1100')
      .andWhere('j.cost_center_id', input.costCenterId)
      .select(trx.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS liab'));
    const currentLiab = Number(liab ?? 0);
    if (currentLiab + netChange < 0) {
      throw errors.badRequest(
        `Jurnal ini membuat saldo Uang Muka Jamaah 2-1100 keberangkatan ini negatif (saldo saat ini Rp ${currentLiab.toLocaleString('id-ID')})`
      );
    }
  }

  await assertReconciliationNotLocked(trx, input.date, codes);

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

  const lines = norm.map((l, i) => ({
    journal_id: journal.id,
    account_id: byCode.get(l.accountCode)!.id,
    debit: l.debit,
    credit: l.credit,
    amount_foreign: l.amountForeign,
    position: i
  }));
  await trx('journal_lines').insert(lines);

  // Sinkron saldo kas/bank (akun 1-11xx/1-12xx yang terdaftar di bank_accounts)
  for (const l of norm) {
    const delta = l.debit - l.credit;
    if (delta !== 0) {
      await trx('bank_accounts').where({ account_code: l.accountCode }).increment('balance', delta);
    }
  }

  return { ...journal, totalDebit, totalCredit, lines: norm };
}

/** Storno — balik sebuah jurnal (tukar debit↔kredit). Dipakai mis. pembatalan komisi. */
export async function reverseJournal(
  trx: Knex,
  sourceJournalId: string,
  opts: { date: string; description: string; createdBy?: string | null }
) {
  const src = await trx('journals').where({ id: sourceJournalId }).first();
  if (!src) throw errors.badRequest('Jurnal yang akan dibalik tidak ditemukan');
  const srcLines = await trx('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .select('a.code', 'l.debit', 'l.credit', 'l.amount_foreign')
    .where('l.journal_id', sourceJournalId);
  const lines: JournalLineInput[] = srcLines.map((l) => ({
    accountCode: l.code,
    debit: Number(l.credit),
    credit: Number(l.debit),
    amountForeign: l.amount_foreign != null ? Number(l.amount_foreign) : null
  }));
  return postJournal(trx, {
    date: opts.date,
    description: opts.description,
    source: src.source,
    refType: src.ref_type ?? undefined,
    refId: src.ref_id ?? undefined,
    costCenterId: src.cost_center_id ?? null,
    currency: src.currency,
    exchangeRate: Number(src.exchange_rate),
    createdBy: opts.createdBy ?? null,
    lines
  });
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

/* ===== B (putaran 3) — Alokasi HPP > saldo 1-1400 → hutang vendor per komponen ===== */

export interface HppAllocationInput {
  accountCode: string;
  amount: number;
  vendorId?: string | null;
  dueDate?: string | null;
}

export interface HppAllocationResult extends HppAllocationInput {
  /** Bagian komponen ini yang dilunasi via reklas saldo 1-1400 (Uang Muka Vendor). */
  allocated: number;
  /** Kelebihan komponen ini di atas saldo 1-1400 yang tersedia — jadi hutang vendor (2-1300). */
  excess: number;
}

/**
 * Alokasikan saldo 1-1400 (Uang Muka Vendor) yang tersedia ke komponen HPP
 * PRO-RATA menurut nominal masing-masing komponen (bulat rupiah); sisa pembulatan
 * ditaruh di komponen TERAKHIR agar Σ allocated persis sama dengan
 * `min(available, totalHpp)`. Bila total HPP ≤ saldo tersedia, setiap komponen
 * teralokasi penuh (excess = 0 semua) — identik perilaku lama (tanpa hutang vendor).
 */
export function allocateVendorAdvance(components: HppAllocationInput[], available: number): HppAllocationResult[] {
  if (components.length === 0) return [];
  const amounts = components.map((c) => Math.round(c.amount));
  const total = amounts.reduce((s, a) => s + a, 0);
  const capped = Math.max(0, Math.min(Math.round(available), total));

  const results: HppAllocationResult[] = [];
  let allocatedSum = 0;
  for (let i = 0; i < components.length - 1; i++) {
    const alloc = total > 0 ? Math.round((capped * amounts[i]) / total) : 0;
    allocatedSum += alloc;
    results.push({ ...components[i], amount: amounts[i], allocated: alloc, excess: amounts[i] - alloc });
  }
  const lastIdx = components.length - 1;
  // Sisa pembulatan ke komponen terakhir — clamp agar tidak negatif/lebih dari nominalnya
  // sendiri (kasus tepi bila pembulatan komponen sebelumnya kebetulan melampaui capped).
  const lastAlloc = Math.max(0, Math.min(amounts[lastIdx], capped - allocatedSum));
  results.push({ ...components[lastIdx], amount: amounts[lastIdx], allocated: lastAlloc, excess: amounts[lastIdx] - lastAlloc });
  return results;
}

/** E, versi teralokasi — Dr 5-xxxx per komponen (nominal PENUH) · Cr 1-1400 (total
 *  alokasi) · Cr 2-1300 per komponen berkelebihan (hutang vendor). */
export function hppRecognitionLinesAllocated(components: HppAllocationResult[]): JournalLineInput[] {
  const totalAllocated = components.reduce((s, c) => s + c.allocated, 0);
  const lines: JournalLineInput[] = components.map((c) => ({ accountCode: c.accountCode, debit: c.amount }));
  if (totalAllocated > 0) lines.push({ accountCode: '1-1400', credit: totalAllocated });
  for (const c of components) {
    if (c.excess > 0) lines.push({ accountCode: '2-1300', credit: c.excess });
  }
  return lines;
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
  const paidIdr = Math.round(totalForeign * rate);

  if (opts.settleDebt) {
    // Pelunasan hutang vendor valas: hutang selalu di-Dr ke 2-1300 (bukan beban lagi —
    // beban sudah diakui saat hutang dibuat). Selisih kurs realisasi → 7-1000.
    // Berlaku juga saat kurs sama (selisih 0): hutang tetap wajib dilunasi.
    const recogRate = opts.exchangeRateAtRecognition || rate;
    const debtIdr = Math.round(totalForeign * recogRate);
    const diff = paidIdr - debtIdr; // >0 = rugi kurs (bayar lebih mahal), <0 = laba
    const result: JournalLineInput[] = [{ accountCode: '2-1300', debit: debtIdr, amountForeign: totalForeign }];
    if (diff > 0) result.push({ accountCode: '7-1000', debit: diff });
    if (diff < 0) result.push({ accountCode: '7-1000', credit: -diff });
    result.push({ accountCode: opts.sourceBankCode, credit: paidIdr, amountForeign: totalForeign });
    return result;
  }

  // Biaya biasa: debit per baris (bulat per baris); kredit bank = JUMLAH debit terbulat
  // agar selalu balance (bukan round(total×kurs) yang bisa selisih 1 rupiah dari Σ round).
  const debits = opts.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: Math.round(l.amount * rate),
    amountForeign: rate !== 1 ? l.amount : null
  }));
  const bankIdr = debits.reduce((s, d) => s + d.debit, 0);
  return [...debits, { accountCode: opts.sourceBankCode, credit: bankIdr, amountForeign: rate !== 1 ? totalForeign : null }];
}
