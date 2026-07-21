import type { Request } from 'express';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { CLASS_NAMES } from './coa.js';
import {
  commissionLines, expenseLines, hppRecognitionLines, postJournal,
  revenueRecognitionLines, type JournalInput
} from './journal.engine.js';

const today = () => new Date().toISOString().slice(0, 10);

async function journalWithLines(journalIds: string[]) {
  if (journalIds.length === 0) return [];
  const journals = await db('journals as j')
    .leftJoin('cost_centers as cc', 'cc.id', 'j.cost_center_id')
    .select('j.*', 'cc.code as cost_center_code', 'cc.name as cost_center_name')
    .whereIn('j.id', journalIds)
    .orderBy('j.date', 'desc')
    .orderBy('j.journal_no', 'desc');
  const lines = await db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .select('l.*', 'a.code as account_code', 'a.name as account_name', 'a.class as account_class')
    .whereIn('l.journal_id', journalIds)
    .orderBy('l.position');
  return journals.map((j) => ({
    id: j.id,
    journalNo: j.journal_no,
    date: j.date,
    description: j.description,
    source: j.source,
    costCenter: j.cost_center_code ?? null,
    currency: j.currency,
    exchangeRate: Number(j.exchange_rate),
    lines: lines
      .filter((l) => l.journal_id === j.id)
      .map((l) => ({
        accountCode: l.account_code,
        accountName: l.account_name,
        accountClass: l.account_class,
        debit: Number(l.debit),
        credit: Number(l.credit),
        amountForeign: l.amount_foreign != null ? Number(l.amount_foreign) : null
      })),
    total: lines.filter((l) => l.journal_id === j.id).reduce((s, l) => s + Number(l.debit), 0)
  }));
}

export const accountingService = {
  /** Bagan akun + saldo berjalan per akun. */
  async accounts() {
    const accounts = await db('accounts').orderBy('code');
    const balances: any[] = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code')
      .sum({ debit: 'l.debit', credit: 'l.credit' })
      .groupBy('a.code');
    const balMap = new Map(balances.map((b) => [b.code, { debit: Number(b.debit), credit: Number(b.credit) }]));
    return accounts.map((a) => {
      const b = balMap.get(a.code) ?? { debit: 0, credit: 0 };
      const balance = a.normal_balance === 'debit' ? b.debit - b.credit : b.credit - b.debit;
      return {
        id: a.id, code: a.code, name: a.name, class: a.class, className: CLASS_NAMES[a.class],
        normalBalance: a.normal_balance, level: a.is_postable ? 1 : 0,
        isPostable: a.is_postable, highlighted: a.is_highlighted, note: a.note, balance
      };
    });
  },

  /** Jurnal umum: filter sumber + periode (YYYY-MM), plus KPI. */
  async journals(filter: { source?: string; month?: string }) {
    const q = db('journals').select('id');
    if (filter.source) q.where('source', filter.source);
    if (filter.month) q.whereRaw(`to_char(date, 'YYYY-MM') = ?`, [filter.month]);
    const ids = (await q.orderBy('date', 'desc').limit(200)).map((r) => r.id);
    const entries = await journalWithLines(ids);

    const kpiQ = db('journal_lines as l').join('journals as j', 'j.id', 'l.journal_id');
    if (filter.month) kpiQ.whereRaw(`to_char(j.date, 'YYYY-MM') = ?`, [filter.month]);
    const [kpi] = await kpiQ.sum({ debit: 'l.debit', credit: 'l.credit' });
    const countQ = db('journals');
    if (filter.month) countQ.whereRaw(`to_char(date, 'YYYY-MM') = ?`, [filter.month]);
    const [{ n }] = await countQ.count({ n: '*' });

    return {
      entries,
      kpi: {
        totalDebit: Number(kpi.debit ?? 0),
        totalCredit: Number(kpi.credit ?? 0),
        balanced: Number(kpi.debit ?? 0) === Number(kpi.credit ?? 0),
        count: Number(n)
      }
    };
  },

  /** Jurnal manual (POST /journals). */
  async createManualJournal(req: Request, input: Omit<JournalInput, 'source' | 'createdBy'>) {
    return db.transaction(async (trx) => {
      const journal = await postJournal(trx, { ...input, source: 'manual', createdBy: req.user?.id ?? null });
      await audit(req, { action: 'journals.manual', entity: 'journals', entityId: journal.id, newValues: input });
      return journal;
    });
  },

  /** Buku besar per akun: baris + saldo berjalan. */
  async ledger(code: string, filter: { from?: string; to?: string }) {
    const account = await db('accounts').where({ code }).first();
    if (!account) throw errors.notFound(`Akun ${code} tidak ditemukan`);
    const rows = await db('journal_lines as l')
      .join('journals as j', 'j.id', 'l.journal_id')
      .join('accounts as a', 'a.id', 'l.account_id')
      .select('j.date', 'j.journal_no', 'j.description', 'j.source', 'l.debit', 'l.credit')
      .where('a.code', code)
      .modify((q) => {
        if (filter.from) q.where('j.date', '>=', filter.from);
        if (filter.to) q.where('j.date', '<=', filter.to);
      })
      .orderBy('j.date')
      .orderBy('j.journal_no');
    let balance = 0;
    const sign = account.normal_balance === 'debit' ? 1 : -1;
    const lines = rows.map((r: Record<string, unknown>) => {
      balance += sign * (Number(r.debit) - Number(r.credit));
      return {
        date: r.date, journalNo: r.journal_no, description: r.description, source: r.source,
        debit: Number(r.debit), credit: Number(r.credit), balance
      };
    });
    return { account: { code: account.code, name: account.name, normalBalance: account.normal_balance }, lines, endingBalance: balance };
  },

  async costCenters() {
    return db('cost_centers as cc')
      .leftJoin('departures as d', 'd.id', 'cc.departure_id')
      .leftJoin('packages as p', 'p.id', 'd.package_id')
      .select('cc.*', 'd.departure_date', 'p.name as package_name')
      .orderBy('cc.code');
  },

  /* ===== 4 tipe transaksi (Input Transaksi mockup) ===== */

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
    if (idempotent) return { payment, idempotent: true };
    const result = await paymentsService.verifyPayment(req, payment.id);
    return { payment, ...result, idempotent: false };
  },

  /** Pembayaran Biaya — multi-akun, valas + realisasi selisih kurs 7-1000. */
  async transactionExpense(req: Request, input: {
    vendorId?: string | null; vendorName?: string | null; costCenterId?: string | null;
    sourceBankCode: string; exchangeRate?: number | null; settleDebt?: boolean; exchangeRateAtRecognition?: number | null;
    date?: string | null; description?: string | null;
    lines: { accountCode: string; amount: number }[];
  }) {
    return db.transaction(async (trx) => {
      const bank = await trx('bank_accounts').where({ account_code: input.sourceBankCode }).first();
      if (!bank) throw errors.badRequest(`Rekening sumber ${input.sourceBankCode} tidak ditemukan`);
      const rate = bank.currency === 'IDR' ? 1 : (input.exchangeRate ?? 0);
      if (bank.currency !== 'IDR' && rate <= 0) throw errors.badRequest('Kurs wajib diisi untuk rekening valas');

      const vendorName = input.vendorName ?? (input.vendorId ? (await trx('vendors').where({ id: input.vendorId }).first())?.name : null);
      const lines = expenseLines({
        sourceBankCode: input.sourceBankCode,
        lines: input.lines,
        exchangeRate: rate,
        settleDebt: input.settleDebt,
        exchangeRateAtRecognition: input.exchangeRateAtRecognition ?? undefined
      });
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
        lines
      });
      await audit(req, { action: 'transactions.expense', entity: 'journals', entityId: journal.id, newValues: input });
      return journal;
    });
  },

  /** Pengakuan Pendapatan (PSAK 72) + opsional pengakuan HPP sekaligus. */
  async transactionRevenueRecognition(req: Request, input: {
    costCenterId: string; revenueAccountCode: '4-1000' | '4-2000' | '4-3000'; amount: number; date?: string | null;
    hpp?: { accountCode: string; amount: number }[] | null;
  }) {
    return db.transaction(async (trx) => {
      const cc = await trx('cost_centers').where({ id: input.costCenterId }).first();
      if (!cc) throw errors.notFound('Cost center tidak ditemukan');
      const date = input.date ?? today();

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
      if (input.hpp && input.hpp.length > 0) {
        hpp = await postJournal(trx, {
          date,
          description: `Pengakuan HPP — ${cc.name}`,
          source: 'expense',
          refType: 'cost_centers',
          refId: cc.id,
          costCenterId: cc.id,
          createdBy: req.user?.id ?? null,
          lines: hppRecognitionLines(input.hpp)
        });
      }
      await audit(req, { action: 'transactions.revenue', entity: 'journals', entityId: revenue.id, newValues: input });
      return { revenue, hpp };
    });
  },

  /** Pengakuan Komisi agen (base × pct). */
  async transactionCommission(req: Request, input: {
    agentName: string; costCenterId?: string | null; base: number; pct: number; date?: string | null;
  }) {
    return db.transaction(async (trx) => {
      const amount = Math.round((input.base * input.pct) / 100);
      const journal = await postJournal(trx, {
        date: input.date ?? today(),
        description: `Komisi agen — ${input.agentName} (${input.pct}% × Rp ${input.base.toLocaleString('id-ID')})`,
        source: 'commission',
        costCenterId: input.costCenterId ?? null,
        createdBy: req.user?.id ?? null,
        lines: commissionLines(amount)
      });
      await audit(req, { action: 'transactions.commission', entity: 'journals', entityId: journal.id, newValues: input });
      return journal;
    });
  },

  /* ===== Rekonsiliasi bank ===== */
  async reconciliation(bankAccountCode: string, month: string) {
    const bank = await db('bank_accounts').where({ account_code: bankAccountCode }).first();
    if (!bank) throw errors.notFound(`Rekening ${bankAccountCode} tidak ditemukan`);

    const lines = await db('bank_statement_lines as s')
      .leftJoin('journals as j', 'j.id', 's.matched_journal_id')
      .select('s.*', 'j.journal_no')
      .where('s.bank_account_id', bank.id)
      .whereRaw(`to_char(s.line_date, 'YYYY-MM') = ?`, [month])
      .orderBy('s.line_date');

    // Saldo buku besar akun bank
    const [gl] = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .where('a.code', bankAccountCode)
      .sum({ debit: 'l.debit', credit: 'l.credit' });
    const ledgerBalance = Number(gl.debit ?? 0) - Number(gl.credit ?? 0);

    const unmatched = lines.filter((l) => l.status === 'unmatched');
    // Mutasi koran yang belum tercatat di buku (jasa giro, adm bank) & setoran dalam proses
    const statementOnly = unmatched.filter((l) => !l.journal_no);
    const statementBalance = ledgerBalance + statementOnly.reduce((s, l) => s + Number(l.amount), 0);

    const depositsInTransit = statementOnly.filter((l) => Number(l.amount) > 0 && /proses/i.test(l.description));
    const bankOnlyIncome = statementOnly.filter((l) => Number(l.amount) > 0 && !/proses/i.test(l.description));
    const bankOnlyCharges = statementOnly.filter((l) => Number(l.amount) < 0);

    const adjStatement = statementBalance - depositsInTransit.reduce((s, l) => s + Number(l.amount), 0);
    const adjLedger = ledgerBalance
      + bankOnlyIncome.reduce((s, l) => s + Number(l.amount), 0)
      + bankOnlyCharges.reduce((s, l) => s + Number(l.amount), 0);

    return {
      bank: { code: bank.account_code, name: bank.name, bank: bank.bank, accountNo: bank.account_no, currency: bank.currency },
      month,
      ledgerBalance,
      statementBalance,
      difference: statementBalance - ledgerBalance,
      adjusted: { statement: adjStatement, ledger: adjLedger, balanced: adjStatement === adjLedger },
      adjustments: {
        depositsInTransit: depositsInTransit.map((l) => ({ description: l.description, amount: Number(l.amount) })),
        bankOnlyIncome: bankOnlyIncome.map((l) => ({ description: l.description, amount: Number(l.amount) })),
        bankOnlyCharges: bankOnlyCharges.map((l) => ({ description: l.description, amount: Number(l.amount) }))
      },
      lines: lines.map((l) => ({
        id: l.id, date: l.line_date, description: l.description, amount: Number(l.amount),
        source: l.journal_no ? `Jurnal ${l.journal_no}` : 'Rek. koran',
        status: l.status
      })),
      matchedCount: lines.filter((l) => l.status === 'matched').length,
      totalCount: lines.length
    };
  },

  async matchStatementLine(req: Request, statementLineId: string) {
    const line = await db('bank_statement_lines').where({ id: statementLineId }).first();
    if (!line) throw errors.notFound('Mutasi tidak ditemukan');
    const [updated] = await db('bank_statement_lines')
      .where({ id: statementLineId })
      .update({ status: line.status === 'matched' ? 'unmatched' : 'matched', updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'reconciliation.match', entity: 'bank_statement_lines', entityId: statementLineId, newValues: { status: updated.status } });
    return updated;
  },

  /** Ringkasan view Keuangan (shell): 3 KPI + laba per cost center + feed jurnal. */
  async summary() {
    const accounts = await this.accounts();
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    const liabilitasJamaah = byCode.get('2-1100')?.balance ?? 0;
    const revenue = accounts.filter((a) => a.class === 4).reduce((s, a) => s + a.balance, 0);
    const cogs = accounts.filter((a) => a.class === 5).reduce((s, a) => s + a.balance, 0);

    // Laba per cost center (pendapatan & HPP per CC dari jurnal)
    const ccRows: any[] = await db('journal_lines as l')
      .join('journals as j', 'j.id', 'l.journal_id')
      .join('accounts as a', 'a.id', 'l.account_id')
      .join('cost_centers as cc', 'cc.id', 'j.cost_center_id')
      .select('cc.id', 'cc.name', 'a.class')
      .sum({ debit: 'l.debit', credit: 'l.credit' })
      .whereIn('a.class', [4, 5])
      .groupBy('cc.id', 'cc.name', 'a.class');
    const ccMap = new Map<string, { name: string; revenue: number; cogs: number }>();
    for (const r of ccRows) {
      const e = ccMap.get(r.id) ?? { name: r.name, revenue: 0, cogs: 0 };
      if (r.class === 4) e.revenue += Number(r.credit) - Number(r.debit);
      if (r.class === 5) e.cogs += Number(r.debit) - Number(r.credit);
      ccMap.set(r.id, e);
    }
    const ccProfit = [...ccMap.entries()]
      .map(([id, e]) => ({
        costCenterId: id, name: e.name, revenue: e.revenue, cogs: e.cogs,
        grossProfit: e.revenue - e.cogs,
        margin: e.revenue ? Math.round(((e.revenue - e.cogs) / e.revenue) * 100) : 0
      }))
      .filter((c) => c.revenue > 0 || c.cogs > 0)
      .sort((a, b) => b.revenue - a.revenue);

    const recentIds = (await db('journals').select('id').orderBy('created_at', 'desc').limit(6)).map((r) => r.id);
    const feed = await journalWithLines(recentIds);

    return {
      kpi: { liabilitasJamaah, revenueYtd: revenue, grossProfitYtd: revenue - cogs },
      ccProfit,
      journalFeed: feed
    };
  },

  // ===== Master data: vendor =====
  vendors() {
    return db('vendors').select('id', 'name', 'type').orderBy('name');
  },

  async createVendor(req: Request, input: { name: string; type: string }) {
    const [row] = await db('vendors').insert(input).returning('*');
    await audit(req, { action: 'master.vendor.create', entity: 'vendors', entityId: row.id, newValues: input });
    return row;
  },

  async updateVendor(req: Request, id: string, input: { name: string; type: string }) {
    const before = await db('vendors').where({ id }).first();
    if (!before) throw errors.notFound('Vendor tidak ditemukan');
    const [row] = await db('vendors').where({ id }).update({ ...input, updated_at: db.fn.now() }).returning('*');
    await audit(req, { action: 'master.vendor.update', entity: 'vendors', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteVendor(req: Request, id: string) {
    const before = await db('vendors').where({ id }).first();
    if (!before) throw errors.notFound('Vendor tidak ditemukan');
    const bills = await db('vendor_bills').where({ vendor_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(bills?.count)) throw errors.conflict(`Vendor punya ${bills?.count} tagihan tercatat — tidak bisa dihapus`);
    const journals = await db('journals').where({ ref_type: 'vendors', ref_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(journals?.count)) throw errors.conflict(`Vendor dirujuk ${journals?.count} jurnal — tidak bisa dihapus`);
    await db('vendors').where({ id }).del();
    await audit(req, { action: 'master.vendor.delete', entity: 'vendors', entityId: id, oldValues: before });
    return { deleted: true };
  }
};
