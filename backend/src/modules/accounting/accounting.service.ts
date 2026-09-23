import type { Request } from 'express';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { todayWib } from '../../utils/date.js';
import { CLASS_NAMES } from './coa.js';
import { withTransaction } from '../../utils/tx.js';
import { postJournal, reverseJournal, type JournalInput } from './journal.engine.js';
import { reconciliationService } from './reconciliation.service.js';
import { transactionsService } from './transactions.service.js';
import { vendorBillsService } from './vendor-bills.service.js';
import { vendorsService } from './vendors.service.js';

/**
 * R3TS-02 — berkas ini pernah 989 baris (di atas batas lunak 800). Isinya dipecah ke
 * modul-modul kohesif di folder yang sama; yang tersisa di sini adalah bagian "buku"
 * (bagan akun, jurnal umum, buku besar, cost center, ringkasan) plus KOMPOSISI
 * `accountingService`. API publik sengaja TIDAK berubah: controller & tes tetap
 * memanggil `accountingService.<method>` yang sama persis seperti sebelumnya.
 */

const today = todayWib;

/** Bagan akun + saldo berjalan per akun. */
async function chartOfAccounts() {
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
}

async function journalWithLines(journalIds: string[]) {
  if (journalIds.length === 0) return [];
  const journals = await db('journals as j')
    .leftJoin('cost_centers as cc', 'cc.id', 'j.cost_center_id')
    // C — relasi pembalikan (rekomendasi N-3): sisi jurnal ASAL (kalau ini adalah
    // pembalik jurnal lain) & sisi jurnal PEMBALIK (kalau jurnal ini sudah dibalik).
    .leftJoin('journals as rsrc', 'rsrc.id', 'j.reversal_of_journal_id')
    .leftJoin('journals as rby', 'rby.reversal_of_journal_id', 'j.id')
    .select(
      'j.*', 'cc.code as cost_center_code', 'cc.name as cost_center_name',
      'rsrc.journal_no as reversal_of_journal_no', 'rby.journal_no as reversed_by_journal_no'
    )
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
    reversalOfJournalNo: j.reversal_of_journal_no ?? null,
    reversedByJournalNo: j.reversed_by_journal_no ?? null,
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

const ledgerService = {
  accounts: chartOfAccounts,

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
    return withTransaction(async (trx) => {
      const journal = await postJournal(trx, { ...input, source: 'manual', createdBy: req.user?.id ?? null });
      await audit(req, { action: 'journals.manual', entity: 'journals', entityId: journal.id, newValues: input }, trx);
      return journal;
    }, { retries: 2 });
  },

  /**
   * C (rekomendasi N-3) — balik jurnal MANUAL (role keuangan, alasan wajib).
   * Memakai `reverseJournal` (journal.engine.ts) sehingga guard `postJournal` (2-1100
   * per CC tidak boleh negatif, dst.) berlaku penuh pada jurnal pembalik.
   */
  async reverseManualJournal(req: Request, journalId: string, reason: string, date?: string | null) {
    return withTransaction(async (trx) => {
      const src = await trx('journals').where({ id: journalId }).first();
      if (!src) throw errors.notFound('Jurnal tidak ditemukan');
      if (src.source !== 'manual') {
        throw errors.conflict('Hanya jurnal bersumber manual yang bisa dibalik lewat menu ini');
      }
      const already = await trx('journals').where({ reversal_of_journal_id: journalId }).first();
      if (already) {
        throw errors.conflict(`Jurnal ini sudah pernah dibalik (${already.journal_no})`);
      }
      const reversal = await reverseJournal(trx, journalId, {
        date: date ?? today(),
        description: `Pembalikan jurnal ${src.journal_no} — ${reason}`,
        createdBy: req.user?.id ?? null
      });
      await trx('journals').where({ id: reversal.id }).update({ reversal_of_journal_id: journalId });
      await audit(req, {
        action: 'journals.reverse', entity: 'journals', entityId: reversal.id,
        oldValues: { reversalOfJournalId: journalId, reversalOfJournalNo: src.journal_no },
        newValues: { reason }
      }, trx);
      return { ...reversal, reversalOfJournalNo: src.journal_no };
    }, { retries: 2 });
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

  /** B (putaran 3) — saldo 1-1400 (Uang Muka Vendor) & 2-1100 (Uang Muka Jamaah) per
   *  cost center, dipakai UI utk menampilkan sisa saldo sebelum mengisi form HPP. */
  async costCenterBalances(costCenterId: string) {
    const cc = await db('cost_centers').where({ id: costCenterId }).first();
    if (!cc) throw errors.notFound('Cost center tidak ditemukan');
    const debitNormalBalance = async (code: string) => {
      const [{ bal }] = await db('journal_lines as jl')
        .join('accounts as a', 'a.id', 'jl.account_id')
        .join('journals as j', 'j.id', 'jl.journal_id')
        .where('a.code', code)
        .andWhere('j.cost_center_id', costCenterId)
        .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS bal'));
      return Number(bal ?? 0);
    };
    const creditNormalBalance = async (code: string) => {
      const [{ bal }] = await db('journal_lines as jl')
        .join('accounts as a', 'a.id', 'jl.account_id')
        .join('journals as j', 'j.id', 'jl.journal_id')
        .where('a.code', code)
        .andWhere('j.cost_center_id', costCenterId)
        .select(db.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS bal'));
      return Number(bal ?? 0);
    };
    const [vendorAdvance1400, liability2100] = await Promise.all([debitNormalBalance('1-1400'), creditNormalBalance('2-1100')]);
    return { costCenterId, vendorAdvance1400, liability2100 };
  },

  /** Ringkasan view Keuangan (shell): 3 KPI + laba per cost center + feed jurnal. */
  async summary() {
    const accounts = await chartOfAccounts();
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
  }
};

/**
 * Permukaan publik modul akuntansi — SATU objek, persis seperti sebelum pemecahan
 * berkas (R3TS-02). Nama method antar-modul tidak tumpang tindih, jadi komposisi ini
 * tidak pernah menimpa apa pun.
 */
export const accountingService = {
  ...ledgerService,
  ...vendorBillsService,
  ...transactionsService,
  ...reconciliationService,
  ...vendorsService
};
