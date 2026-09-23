import type { Request } from 'express';
import type { Knex } from 'knex';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { todayWib } from '../../utils/date.js';
import { withTransaction } from '../../utils/tx.js';
import {
  allocateVendorAdvance, commissionLines, expenseLines, hppRecognitionLinesAllocated,
  postJournal, revenueRecognitionLines, type HppAllocationInput, type HppAllocationResult
} from './journal.engine.js';
import {
  applyVendorBillPayments, lockVendorBillsForSettlement, type ExpenseBillLine
} from './vendor-bills.service.js';

/**
 * R3TS-02 — modul "4 tipe transaksi" (Input Transaksi), dipecah dari
 * `accounting.service.ts` yang sudah menembus batas lunak 800 baris.
 * R3TS-03 — `transactionExpense` & `transactionRevenueRecognition` yang sebelumnya
 * 77/116 baris kini memanggil langkah-langkah bernama di bawah ini.
 */

const today = todayWib;

/** Komponen HPP yang dikirim UI (akun 5-xxxx, nominal, vendor & jatuh tempo opsional). */
export type HppComponentInput = HppAllocationInput;

export interface VendorBillSummary {
  id: string;
  vendorId: string;
  vendorName: string;
  accountCode: string;
  amount: number;
  dueDate: string | null;
}

/* ===== Langkah-langkah Pembayaran Biaya (R3TS-03) ===== */

/** Rekening sumber + kurs efektif; rekening valas wajib menyertakan kurs. */
async function resolveSourceBank(trx: Knex, sourceBankCode: string, exchangeRate?: number | null) {
  const bank = await trx('bank_accounts').where({ account_code: sourceBankCode }).first();
  if (!bank) throw errors.badRequest(`Rekening sumber ${sourceBankCode} tidak ditemukan`);
  const rate = bank.currency === 'IDR' ? 1 : (exchangeRate ?? 0);
  if (bank.currency !== 'IDR' && rate <= 0) throw errors.badRequest('Kurs wajib diisi untuk rekening valas');
  return { bank, rate };
}

async function resolveVendorName(trx: Knex, vendorName?: string | null, vendorId?: string | null) {
  if (vendorName) return vendorName;
  if (!vendorId) return null;
  return (await trx('vendors').where({ id: vendorId }).first())?.name ?? null;
}

/* ===== Langkah-langkah Pengakuan Pendapatan (R3TS-03) ===== */

/**
 * PSAK 72 — pengaman pengakuan pendapatan:
 * (1) tidak boleh dobel utk cost center yang sama (retry jaringan / klik ganda)
 * (2) tidak boleh membuat liabilitas Uang Muka Jamaah (2-1100) jadi negatif — reclass
 *     men-Dr 2-1100 sebesar amount; hanya boleh sebesar saldo liabilitas yang benar-benar
 *     ada (dana jamaah yang sudah diterima). Saldo dihitung PER COST CENTER keberangkatan
 *     ini (join ke journals): tiap keberangkatan adalah cost center tersendiri, sehingga
 *     pendapatan satu keberangkatan tidak boleh diakui memakai uang muka keberangkatan lain.
 */
async function assertRevenueRecognizable(trx: Knex, cc: Record<string, any>, amount: number) {
  const existing = await trx('journals').where({ source: 'revenue', cost_center_id: cc.id }).first();
  if (existing) {
    throw errors.conflict(`Pendapatan cost center "${cc.name}" sudah pernah diakui (${existing.journal_no})`);
  }
  const liability2100 = await ccAccountBalance(trx, cc.id, '2-1100', 'credit');
  if (amount > liability2100) {
    throw errors.badRequest(
      `Pendapatan yang diakui (Rp ${amount.toLocaleString('id-ID')}) melebihi saldo Uang Muka Jamaah 2-1100 keberangkatan ini (Rp ${liability2100.toLocaleString('id-ID')}) — dana jamaah belum cukup diterima`
    );
  }
}

/** Saldo satu akun pada satu cost center, dalam arah saldo normalnya. */
async function ccAccountBalance(trx: Knex, costCenterId: string, code: string, normal: 'debit' | 'credit') {
  const expr = normal === 'debit' ? 'jl.debit - jl.credit' : 'jl.credit - jl.debit';
  const [{ bal }] = await trx('journal_lines as jl')
    .join('accounts as a', 'a.id', 'jl.account_id')
    .join('journals as j', 'j.id', 'jl.journal_id')
    .where('a.code', code)
    .andWhere('j.cost_center_id', costCenterId)
    .select(trx.raw(`COALESCE(SUM(${expr}), 0) AS bal`));
  return Number(bal ?? 0);
}

/**
 * B (putaran 3) — saldo 1-1400 Uang Muka Vendor per cost center dialokasikan PRO-RATA
 * ke komponen HPP menurut nominal (sisa pembulatan ke komponen terakhir). Kelebihan per
 * komponen (di atas alokasinya) WAJIB vendorId valid → dicatat sbg hutang vendor 2-1300 +
 * baris `vendor_bills` unpaid. Bila total HPP ≤ saldo → perilaku lama persis (semua
 * teralokasi, tanpa hutang).
 */
async function resolveHppAllocation(trx: Knex, costCenterId: string, components: HppComponentInput[]) {
  const advance1400 = await ccAccountBalance(trx, costCenterId, '1-1400', 'debit');
  const allocation = allocateVendorAdvance(components, advance1400);
  const overComponents = allocation.filter((c) => c.excess > 0);
  const vendorMap = new Map<string, { id: string; name: string }>();
  if (overComponents.length === 0) return { allocation, overComponents, vendorMap };

  const missingVendorId = overComponents.find((c) => !c.vendorId);
  if (missingVendorId) {
    throw errors.badRequest(
      `Komponen HPP ${missingVendorId.accountCode} kelebihan Rp ${missingVendorId.excess.toLocaleString('id-ID')} dari saldo Uang Muka Vendor 1-1400 keberangkatan ini (Rp ${advance1400.toLocaleString('id-ID')}) — wajib pilih vendor untuk sisa kelebihan (dicatat sbg hutang vendor 2-1300)`
    );
  }
  const vendorIds = [...new Set(overComponents.map((c) => c.vendorId as string))];
  for (const v of await trx('vendors').whereIn('id', vendorIds)) vendorMap.set(v.id, { id: v.id, name: v.name });
  const missingVendorRow = overComponents.find((c) => !vendorMap.has(c.vendorId as string));
  if (missingVendorRow) {
    throw errors.badRequest(`Vendor untuk komponen HPP ${missingVendorRow.accountCode} tidak ditemukan`);
  }
  return { allocation, overComponents, vendorMap };
}

/** Terbitkan baris `vendor_bills` unpaid untuk tiap komponen HPP yang berkelebihan. */
async function issueVendorBills(
  trx: Knex,
  opts: {
    costCenterId: string;
    hppJournalId: string;
    overComponents: HppAllocationResult[];
    vendorMap: Map<string, { id: string; name: string }>;
    fallbackDueDate?: string | null;
  }
): Promise<VendorBillSummary[]> {
  const bills: VendorBillSummary[] = [];
  for (const c of opts.overComponents) {
    const vendor = opts.vendorMap.get(c.vendorId as string)!;
    const [bill] = await trx('vendor_bills')
      .insert({
        vendor_id: vendor.id,
        cost_center_id: opts.costCenterId,
        amount: c.excess,
        currency: 'IDR',
        status: 'unpaid',
        due_date: c.dueDate ?? opts.fallbackDueDate ?? null,
        journal_id: opts.hppJournalId,
        account_code: c.accountCode
      })
      .returning('*');
    bills.push({
      id: bill.id, vendorId: vendor.id, vendorName: vendor.name,
      accountCode: c.accountCode, amount: c.excess, dueDate: bill.due_date ?? null
    });
  }
  return bills;
}

export const transactionsService = {
  /** Terima Pembayaran — delegasi ke alur payments (payment verified + kwitansi + jurnal). */
  async transactionReceipt(req: Request, input: {
    invoiceId: string; scheduleId?: string | null; bankAccountCode: string; amount: number; date?: string | null; method?: string | null;
  }, idempotencyKey?: string) {
    const { paymentsService } = await import('../payments/payments.service.js');
    const { payment, idempotent } = await paymentsService.createPayment(req, {
      invoiceId: input.invoiceId,
      scheduleId: input.scheduleId ?? null,
      bankAccountCode: input.bankAccountCode,
      amount: input.amount,
      method: (input.method ?? 'va') as 'va' | 'transfer' | 'cash' | 'card',
      paidAt: input.date ?? null,
      reference: null,
      note: null
    }, idempotencyKey);
    // Bila retry ber-key sama menemukan payment yang SUDAH terverifikasi → tuntas,
    // kembalikan apa adanya. Bila masih 'pending' (verify sebelumnya gagal setelah
    // createPayment commit), LANJUTKAN verifikasi — jangan no-op permanen.
    if (idempotent && payment.status === 'verified') return { payment, idempotent: true };
    const result = await paymentsService.verifyPayment(req, payment.id);
    return { payment, ...result, idempotent };
  },

  /** Pembayaran Biaya — multi-akun, valas + realisasi selisih kurs 7-1000. */
  async transactionExpense(req: Request, input: {
    vendorId?: string | null; vendorName?: string | null; costCenterId?: string | null;
    sourceBankCode: string; exchangeRate?: number | null; settleDebt?: boolean; exchangeRateAtRecognition?: number | null;
    date?: string | null; description?: string | null;
    lines: ExpenseBillLine[];
  }) {
    return withTransaction(async (trx) => {
      const { bank, rate } = await resolveSourceBank(trx, input.sourceBankCode, input.exchangeRate);
      const lockedBills = await lockVendorBillsForSettlement(trx, {
        lines: input.lines,
        bankCurrency: bank.currency,
        vendorId: input.vendorId,
        costCenterId: input.costCenterId
      });

      const vendorName = await resolveVendorName(trx, input.vendorName, input.vendorId);
      const journal = await postJournal(trx, {
        date: input.date ?? today(),
        description: input.description ?? `Pembayaran biaya${vendorName ? ` — ${vendorName}` : ''}`,
        source: 'expense',
        refType: input.vendorId ? 'vendors' : undefined,
        refId: input.vendorId ?? undefined,
        costCenterId: input.costCenterId ?? null,
        currency: bank.currency,
        exchangeRate: rate,
        createdBy: req.user?.id ?? null,
        lines: expenseLines({
          sourceBankCode: input.sourceBankCode,
          lines: input.lines,
          exchangeRate: rate,
          settleDebt: input.settleDebt,
          exchangeRateAtRecognition: input.exchangeRateAtRecognition ?? undefined
        })
      });

      await applyVendorBillPayments(trx, input.lines, lockedBills);
      await audit(req, { action: 'transactions.expense', entity: 'journals', entityId: journal.id, newValues: input }, trx);
      return journal;
    }, { retries: 2 });
  },

  /** Pengakuan Pendapatan (PSAK 72) + opsional pengakuan HPP sekaligus. */
  async transactionRevenueRecognition(req: Request, input: {
    costCenterId: string; revenueAccountCode: '4-1000' | '4-2000' | '4-3000'; amount: number; date?: string | null;
    hpp?: HppComponentInput[] | null;
    dueDate?: string | null;
  }) {
    return withTransaction(async (trx) => {
      const cc = await trx('cost_centers').where({ id: input.costCenterId }).forUpdate().first();
      if (!cc) throw errors.notFound('Cost center tidak ditemukan');
      const date = input.date ?? today();
      await assertRevenueRecognizable(trx, cc, input.amount);

      const revenue = await postJournal(trx, {
        date,
        description: `Pengakuan pendapatan — ${cc.name}`,
        source: 'revenue',
        refType: 'cost_centers',
        refId: cc.id,
        costCenterId: cc.id,
        createdBy: req.user?.id ?? null,
        lines: revenueRecognitionLines(input.revenueAccountCode, input.amount)
      });

      let hpp = null;
      let vendorBills: VendorBillSummary[] = [];
      if (input.hpp && input.hpp.length > 0) {
        const { allocation, overComponents, vendorMap } = await resolveHppAllocation(trx, cc.id, input.hpp);
        hpp = await postJournal(trx, {
          date,
          description: `Pengakuan HPP — ${cc.name}`,
          source: 'expense',
          refType: 'cost_centers',
          refId: cc.id,
          costCenterId: cc.id,
          createdBy: req.user?.id ?? null,
          lines: hppRecognitionLinesAllocated(allocation)
        });
        vendorBills = await issueVendorBills(trx, {
          costCenterId: cc.id, hppJournalId: hpp.id, overComponents, vendorMap, fallbackDueDate: input.dueDate
        });
      }
      await audit(req, { action: 'transactions.revenue', entity: 'journals', entityId: revenue.id, newValues: input }, trx);
      return { revenue, hpp, vendorBills };
    }, { retries: 2 });
  },

  /** Pengakuan Komisi agen manual (ad-hoc, tanpa registrasi) — dibukukan sebagai baris
   *  `commissions` terlacak (bukan jurnal lepas), tertaut agen (FK), langsung approved. */
  async transactionCommission(req: Request, input: {
    agentId: string; costCenterId?: string | null; base: number; pct: number; date?: string | null;
  }) {
    return withTransaction(async (trx) => {
      const agent = await trx('agents').where({ id: input.agentId }).first();
      if (!agent) throw errors.badRequest('Agen tidak ditemukan');
      if (!agent.is_active) throw errors.badRequest('Agen tidak aktif');
      const amount = Math.round((input.base * input.pct) / 100);
      const journal = await postJournal(trx, {
        date: input.date ?? today(),
        description: `Komisi agen — ${agent.name} (${input.pct}% × Rp ${input.base.toLocaleString('id-ID')})`,
        source: 'commission',
        refType: 'commissions',
        costCenterId: input.costCenterId ?? null,
        createdBy: req.user?.id ?? null,
        lines: commissionLines(amount)
      });
      const [commission] = await trx('commissions')
        .insert({
          agent_id: agent.id,
          registration_id: null,
          base_amount: input.base,
          pct: input.pct,
          amount,
          status: 'approved',
          journal_id: journal.id,
          approved_by: req.user?.id ?? null,
          approved_at: trx.fn.now()
        })
        .returning('*');
      await trx('journals').where({ id: journal.id }).update({ ref_id: commission.id });
      await audit(req, { action: 'transactions.commission', entity: 'commissions', entityId: commission.id, newValues: { agentId: agent.id, amount } }, trx);
      return { ...journal, commissionId: commission.id };
    }, { retries: 2 });
  }
};
