import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { CLASS_NAMES } from './coa.js';
import {
  commissionLines, expenseLines, hppRecognitionLines, postJournal,
  revenueRecognitionLines, type JournalInput, type JournalLineInput
} from './journal.engine.js';

const today = () => new Date().toISOString().slice(0, 10);
const roundRp = (n: number) => Math.round(n);
const daysBetween = (a: string | Date, b: string | Date) =>
  Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000);

/** COA penyesuaian rekonsiliasi (item bank-only): jasa giro → pendapatan lain-lain,
 *  biaya/pajak → beban bunga & adm bank. */
function adjustmentJournalLines(bankCode: string, lineType: string, amount: number): JournalLineInput[] {
  const abs = Math.abs(amount);
  if (lineType === 'jasa_giro') {
    return [{ accountCode: bankCode, debit: abs }, { accountCode: '4-9000', credit: abs }];
  }
  // biaya_adm / pajak_giro → beban
  return [{ accountCode: '7-2000', debit: abs }, { accountCode: bankCode, credit: abs }];
}
const ADJUSTABLE = ['jasa_giro', 'biaya_adm', 'pajak_giro'];

async function loadDraftSession(sessionId: string) {
  const s = await db('bank_reconciliations').where({ id: sessionId }).first();
  if (!s) throw errors.notFound('Sesi rekonsiliasi tidak ditemukan');
  if (s.status === 'completed') throw errors.badRequest('Rekonsiliasi periode ini sudah diselesaikan & terkunci');
  return s;
}

async function sessionWithUser(sessionId: string) {
  return db('bank_reconciliations as r')
    .leftJoin('users as u', 'u.id', 'r.reconciled_by')
    .select('r.*', 'u.name as reconciled_by_name')
    .where('r.id', sessionId)
    .first();
}

/**
 * Hitung status rekonsiliasi. Membandingkan DUA angka independen:
 *  - saldo buku besar akun bank (Σ journal_lines, cutoff tanggal koran) dan
 *  - saldo akhir rekening koran yang DIINPUT admin (session.closing_balance).
 * Selisih dijelaskan oleh item bank-only (di koran belum di buku) & book-only
 * (di buku belum di koran). `unexplained` ≠ 0 = ada selisih nyata yang harus
 * ditindaklanjuti — bukan lagi tautologi "selalu seimbang".
 */
async function computeReconciliation(bank: Record<string, any>, session: Record<string, any> | null, month: string) {
  const glQuery = db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .where('a.code', bank.account_code);
  if (session) glQuery.where('j.date', '<=', session.statement_date);
  else glQuery.whereRaw(`to_char(j.date, 'YYYY-MM') <= ?`, [month]);
  const [gl] = await glQuery.sum({ debit: 'l.debit', credit: 'l.credit' });
  const ledgerBalance = roundRp(Number(gl.debit ?? 0) - Number(gl.credit ?? 0));

  const lines: Record<string, any>[] = await db('bank_statement_lines as s')
    .leftJoin('journal_lines as ml', 'ml.id', 's.matched_journal_line_id')
    .leftJoin('journals as mj', 'mj.id', 'ml.journal_id')
    .select('s.*', 'mj.journal_no as matched_journal_no')
    .where('s.bank_account_id', bank.id)
    .modify((q) =>
      session
        ? q.where('s.reconciliation_id', session.id)
        : q.whereNull('s.reconciliation_id').whereRaw(`to_char(s.line_date, 'YYYY-MM') = ?`, [month])
    )
    .orderBy('s.line_date');

  // Baris jurnal akun bank dalam periode (untuk deteksi book-only & saran cocok)
  const periodStart = `${month}-01`;
  const blQuery = db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .select('l.id', 'l.debit', 'l.credit', 'j.date', 'j.journal_no', 'j.description')
    .where('a.code', bank.account_code)
    .andWhere('j.date', '>=', periodStart);
  if (session) blQuery.andWhere('j.date', '<=', session.statement_date);
  else blQuery.whereRaw(`to_char(j.date, 'YYYY-MM') = ?`, [month]);
  const bookLines = (await blQuery.orderBy('j.date')).map((bl: Record<string, any>) => ({
    id: bl.id, date: bl.date, journalNo: bl.journal_no, description: bl.description,
    amount: roundRp(Number(bl.debit) - Number(bl.credit))
  }));

  const matchedLineIds = new Set(lines.map((l) => l.matched_journal_line_id).filter(Boolean));
  const bookOnly = bookLines.filter((bl) => !matchedLineIds.has(bl.id));
  const bookOnlyTotal = bookOnly.reduce((s, l) => s + l.amount, 0);

  const bankOnly = lines.filter((l) => !l.matched_journal_line_id);
  const bankOnlyTotal = bankOnly.reduce((s, l) => s + Number(l.amount), 0);

  const statementBalance = session ? roundRp(Number(session.closing_balance)) : null;
  const difference = statementBalance != null ? roundRp(statementBalance - ledgerBalance) : null;
  const expectedDiff = roundRp(bankOnlyTotal - bookOnlyTotal);
  const unexplained = difference != null ? roundRp(difference - expectedDiff) : null;
  const balanced = unexplained != null && unexplained === 0;

  // Saran pencocokan: baris koran unmatched ↔ book-only nominal sama, ±3 hari
  const usedSuggest = new Set<string>();
  const suggestionFor = (l: Record<string, any>) => {
    const cand = bookOnly.find(
      (b) => b.amount === roundRp(Number(l.amount)) && Math.abs(daysBetween(b.date, l.line_date)) <= 3 && !usedSuggest.has(b.id)
    );
    if (cand) { usedSuggest.add(cand.id); return { journalLineId: cand.id, journalNo: cand.journalNo }; }
    return null;
  };

  const bankOnlyIncome = bankOnly.filter((l) => Number(l.amount) > 0);
  const bankOnlyCharges = bankOnly.filter((l) => Number(l.amount) < 0);
  const depositsInTransit = bookOnly.filter((l) => l.amount > 0);
  const outstanding = bookOnly.filter((l) => l.amount < 0);
  const mapBankOnly = (l: Record<string, any>) => ({
    id: l.id, description: l.description, amount: Number(l.amount),
    lineType: l.line_type, postable: ADJUSTABLE.includes(l.line_type)
  });

  const matchedCount = lines.filter((l) => l.matched_journal_line_id).length;
  const canFinalize = !!session && session.status === 'draft' && balanced && bankOnly.length === 0;

  return {
    bank: { code: bank.account_code, name: bank.name, bank: bank.bank, accountNo: bank.account_no, currency: bank.currency },
    month,
    session: session
      ? {
          id: session.id, period: session.period, statementDate: session.statement_date,
          openingBalance: Number(session.opening_balance), closingBalance: Number(session.closing_balance),
          status: session.status, reconciledAt: session.reconciled_at ?? null,
          reconciledBy: session.reconciled_by_name ?? null,
          reconciledDiff: session.reconciled_diff != null ? Number(session.reconciled_diff) : null
        }
      : null,
    ledgerBalance,
    statementBalance,
    difference,
    expectedDiff,
    unexplained,
    balanced,
    canFinalize,
    adjusted: { ledger: roundRp(ledgerBalance + bankOnlyTotal), statement: roundRp((statementBalance ?? ledgerBalance) + bookOnlyTotal) },
    adjustments: {
      bankOnlyIncome: bankOnlyIncome.map(mapBankOnly),
      bankOnlyCharges: bankOnlyCharges.map(mapBankOnly),
      depositsInTransit: depositsInTransit.map((l) => ({ id: l.id, description: l.description, amount: l.amount, journalNo: l.journalNo })),
      outstanding: outstanding.map((l) => ({ id: l.id, description: l.description, amount: l.amount, journalNo: l.journalNo }))
    },
    lines: lines.map((l) => ({
      id: l.id, date: l.line_date, description: l.description, amount: Number(l.amount),
      lineType: l.line_type,
      source: l.matched_journal_no ? `Jurnal ${l.matched_journal_no}` : 'Rek. koran',
      status: l.matched_journal_line_id ? 'matched' : 'unmatched',
      suggestion: l.matched_journal_line_id ? null : suggestionFor(l)
    })),
    bookOnly: bookOnly.map((l) => ({ id: l.id, date: l.date, description: l.description, amount: l.amount, journalNo: l.journalNo })),
    matchedCount,
    totalCount: lines.length,
    unmatchedCount: lines.length - matchedCount
  };
}

async function recomputeForLine(line: Record<string, any>) {
  const bank = await db('bank_accounts').where({ id: line.bank_account_id }).first();
  if (line.reconciliation_id) {
    const s = await sessionWithUser(line.reconciliation_id);
    return computeReconciliation(bank, s, s.period);
  }
  return computeReconciliation(bank, null, new Date(line.line_date).toISOString().slice(0, 7));
}

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
      await audit(req, { action: 'journals.manual', entity: 'journals', entityId: journal.id, newValues: input }, trx);
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
      await audit(req, { action: 'transactions.expense', entity: 'journals', entityId: journal.id, newValues: input }, trx);
      return journal;
    });
  },

  /** Pengakuan Pendapatan (PSAK 72) + opsional pengakuan HPP sekaligus. */
  async transactionRevenueRecognition(req: Request, input: {
    costCenterId: string; revenueAccountCode: '4-1000' | '4-2000' | '4-3000'; amount: number; date?: string | null;
    hpp?: { accountCode: string; amount: number }[] | null;
  }) {
    return db.transaction(async (trx) => {
      const cc = await trx('cost_centers').where({ id: input.costCenterId }).forUpdate().first();
      if (!cc) throw errors.notFound('Cost center tidak ditemukan');
      const date = input.date ?? today();

      // PSAK 72 — pengaman pengakuan pendapatan:
      // (1) tidak boleh dobel utk cost center yang sama (retry jaringan / klik ganda)
      const existing = await trx('journals').where({ source: 'revenue', cost_center_id: cc.id }).first();
      if (existing) {
        throw errors.conflict(`Pendapatan cost center "${cc.name}" sudah pernah diakui (${existing.journal_no})`);
      }
      // (2) tidak boleh membuat liabilitas Uang Muka Jamaah (2-1100) jadi negatif —
      // reclass men-Dr 2-1100 sebesar amount; hanya boleh sebesar saldo liabilitas
      // yang benar-benar ada (dana jamaah yang sudah diterima).
      // Saldo dihitung PER COST CENTER keberangkatan ini (join ke journals): tiap
      // keberangkatan adalah cost center tersendiri, sehingga pendapatan satu
      // keberangkatan tidak boleh diakui memakai uang muka keberangkatan lain (PSAK 72).
      const [{ liab }] = await trx('journal_lines as jl')
        .join('accounts as a', 'a.id', 'jl.account_id')
        .join('journals as j', 'j.id', 'jl.journal_id')
        .where('a.code', '2-1100')
        .andWhere('j.cost_center_id', cc.id)
        .select(trx.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS liab'));
      const liability2100 = Number(liab ?? 0);
      if (input.amount > liability2100) {
        throw errors.badRequest(
          `Pendapatan yang diakui (Rp ${input.amount.toLocaleString('id-ID')}) melebihi saldo Uang Muka Jamaah 2-1100 keberangkatan ini (Rp ${liability2100.toLocaleString('id-ID')}) — dana jamaah belum cukup diterima`
        );
      }

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
      await audit(req, { action: 'transactions.revenue', entity: 'journals', entityId: revenue.id, newValues: input }, trx);
      return { revenue, hpp };
    });
  },

  /** Pengakuan Komisi agen manual (ad-hoc, tanpa registrasi) — dibukukan sebagai baris
   *  `commissions` terlacak (bukan jurnal lepas), tertaut agen (FK), langsung approved. */
  async transactionCommission(req: Request, input: {
    agentId: string; costCenterId?: string | null; base: number; pct: number; date?: string | null;
  }) {
    return db.transaction(async (trx) => {
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
    });
  },

  /* ===== Rekonsiliasi bank ===== */

  /** Status rekonsiliasi (rekening, periode). Bila belum ada sesi → session:null. */
  async reconciliation(bankAccountCode: string, month: string) {
    const bank = await db('bank_accounts').where({ account_code: bankAccountCode }).first();
    if (!bank) throw errors.notFound(`Rekening ${bankAccountCode} tidak ditemukan`);
    const session = await db('bank_reconciliations as r')
      .leftJoin('users as u', 'u.id', 'r.reconciled_by')
      .select('r.*', 'u.name as reconciled_by_name')
      .where({ 'r.bank_account_id': bank.id, 'r.period': month })
      .first();
    return computeReconciliation(bank, session ?? null, month);
  },

  /** Buka/perbarui sesi rekonsiliasi — admin memasukkan saldo akhir koran (angka eksternal). */
  async openReconciliation(
    req: Request,
    input: { bankAccountCode: string; period: string; statementDate: string; openingBalance?: number | null; closingBalance: number }
  ) {
    const bank = await db('bank_accounts').where({ account_code: input.bankAccountCode }).first();
    if (!bank) throw errors.notFound(`Rekening ${input.bankAccountCode} tidak ditemukan`);
    const existing = await db('bank_reconciliations').where({ bank_account_id: bank.id, period: input.period }).first();
    if (existing && existing.status === 'completed') {
      throw errors.conflict('Rekonsiliasi periode ini sudah diselesaikan & terkunci');
    }
    const payload = {
      bank_account_id: bank.id,
      period: input.period,
      statement_date: input.statementDate,
      opening_balance: input.openingBalance ?? 0,
      closing_balance: input.closingBalance,
      updated_at: db.fn.now()
    };
    let session;
    if (existing) {
      [session] = await db('bank_reconciliations').where({ id: existing.id }).update(payload).returning('*');
    } else {
      [session] = await db('bank_reconciliations').insert({ ...payload, created_by: req.user?.id ?? null }).returning('*');
    }
    await audit(req, {
      action: 'reconciliation.open', entity: 'bank_reconciliations', entityId: session.id,
      newValues: { period: input.period, closingBalance: input.closingBalance, statementDate: input.statementDate }
    });
    return computeReconciliation(bank, session, input.period);
  },

  /** Entri manual satu mutasi rekening koran ke dalam sesi. */
  async addStatementLine(
    req: Request,
    sessionId: string,
    input: { lineDate: string; description: string; amount: number; lineType?: string; externalRef?: string | null }
  ) {
    const session = await loadDraftSession(sessionId);
    const [line] = await db('bank_statement_lines')
      .insert({
        bank_account_id: session.bank_account_id,
        reconciliation_id: session.id,
        line_date: input.lineDate,
        description: input.description,
        amount: input.amount,
        line_type: input.lineType ?? 'lain',
        external_ref: input.externalRef ?? null,
        created_by: req.user?.id ?? null,
        status: 'unmatched'
      })
      .returning('*');
    await audit(req, { action: 'reconciliation.line.add', entity: 'bank_statement_lines', entityId: line.id, newValues: { amount: input.amount } });
    return recomputeForLine(line);
  },

  /** Impor mutasi koran (mis. dari CSV) dengan guard duplikasi via externalRef. */
  async importStatementLines(
    req: Request,
    sessionId: string,
    rows: { lineDate: string; description: string; amount: number; lineType?: string; externalRef?: string | null }[]
  ) {
    const session = await loadDraftSession(sessionId);
    const batch = randomUUID();
    let inserted = 0;
    let skipped = 0;
    for (const r of rows) {
      const dupe = r.externalRef
        ? await db('bank_statement_lines')
            .where({ bank_account_id: session.bank_account_id, line_date: r.lineDate, external_ref: r.externalRef })
            .first()
        : null;
      if (dupe) { skipped++; continue; }
      await db('bank_statement_lines').insert({
        bank_account_id: session.bank_account_id,
        reconciliation_id: session.id,
        line_date: r.lineDate,
        description: r.description,
        amount: r.amount,
        line_type: r.lineType ?? 'lain',
        external_ref: r.externalRef ?? null,
        import_batch_id: batch,
        created_by: req.user?.id ?? null,
        status: 'unmatched'
      });
      inserted++;
    }
    await audit(req, { action: 'reconciliation.import', entity: 'bank_reconciliations', entityId: session.id, newValues: { inserted, skipped } });
    const view = await computeReconciliation(await db('bank_accounts').where({ id: session.bank_account_id }).first(), await sessionWithUser(session.id), session.period);
    return { inserted, skipped, ...view };
  },

  /** Cocokkan baris koran ke BARIS jurnal tertentu (validasi nominal), atau batalkan. */
  async matchStatementLine(req: Request, statementLineId: string, journalLineId?: string | null) {
    const line = await db('bank_statement_lines').where({ id: statementLineId }).first();
    if (!line) throw errors.notFound('Mutasi tidak ditemukan');
    if (line.reconciliation_id) {
      const s = await db('bank_reconciliations').where({ id: line.reconciliation_id }).first();
      if (s?.status === 'completed') throw errors.conflict('Rekonsiliasi terkunci — pencocokan tidak bisa diubah');
    }

    let update: Record<string, unknown>;
    if (line.matched_journal_line_id) {
      // Sudah tercocok → batalkan (unmatch)
      update = { matched_journal_line_id: null, status: 'unmatched', updated_at: db.fn.now() };
    } else {
      if (!journalLineId) throw errors.badRequest('journalLineId wajib untuk mencocokkan baris ini');
      const jl = await db('journal_lines as l')
        .join('accounts as a', 'a.id', 'l.account_id')
        .select('l.id', 'l.debit', 'l.credit', 'a.code as account_code')
        .where('l.id', journalLineId)
        .first();
      if (!jl) throw errors.badRequest('Baris jurnal tidak ditemukan');
      const bank = await db('bank_accounts').where({ id: line.bank_account_id }).first();
      if (jl.account_code !== bank.account_code) throw errors.badRequest('Baris jurnal bukan milik akun bank ini');
      const jlAmount = roundRp(Number(jl.debit) - Number(jl.credit));
      if (jlAmount !== roundRp(Number(line.amount))) {
        throw errors.badRequest(`Nominal tidak cocok: mutasi Rp ${Number(line.amount).toLocaleString('id-ID')} ≠ jurnal Rp ${jlAmount.toLocaleString('id-ID')}`);
      }
      update = { matched_journal_line_id: journalLineId, status: 'matched', updated_at: db.fn.now() };
    }
    const [updated] = await db('bank_statement_lines').where({ id: statementLineId }).update(update).returning('*');
    await audit(req, { action: 'reconciliation.match', entity: 'bank_statement_lines', entityId: statementLineId, newValues: { matched: !!update.matched_journal_line_id } });
    return recomputeForLine(updated);
  },

  /** Posting jurnal penyesuaian untuk item bank-only (jasa giro / biaya adm / pajak giro). */
  async postAdjustment(req: Request, statementLineId: string) {
    const line = await db('bank_statement_lines').where({ id: statementLineId }).first();
    if (!line) throw errors.notFound('Mutasi tidak ditemukan');
    if (line.matched_journal_line_id) throw errors.badRequest('Baris sudah dibukukan/tercocok');
    if (!ADJUSTABLE.includes(line.line_type)) {
      throw errors.badRequest(
        'Hanya jasa giro / biaya administrasi / pajak giro yang bisa diposting otomatis. Baris lain: cocokkan ke jurnal yang ada, atau catat lewat Input Transaksi.'
      );
    }
    const session = line.reconciliation_id ? await db('bank_reconciliations').where({ id: line.reconciliation_id }).first() : null;
    if (session?.status === 'completed') throw errors.conflict('Rekonsiliasi terkunci');
    const bank = await db('bank_accounts').where({ id: line.bank_account_id }).first();

    const journal = await db.transaction(async (trx) => {
      const j = await postJournal(trx, {
        date: new Date(line.line_date).toISOString().slice(0, 10),
        description: `Penyesuaian rekonsiliasi — ${line.description}`,
        source: 'reconciliation',
        refType: 'bank_reconciliations',
        refId: session?.id ?? null,
        createdBy: req.user?.id ?? null,
        lines: adjustmentJournalLines(bank.account_code, line.line_type, Number(line.amount))
      });
      const bankLine = await trx('journal_lines as l')
        .join('accounts as a', 'a.id', 'l.account_id')
        .select('l.id')
        .where('l.journal_id', j.id)
        .andWhere('a.code', bank.account_code)
        .first();
      await trx('bank_statement_lines').where({ id: statementLineId })
        .update({ matched_journal_line_id: bankLine.id, status: 'matched', updated_at: trx.fn.now() });
      return j;
    });
    await audit(req, { action: 'reconciliation.adjust', entity: 'bank_statement_lines', entityId: statementLineId, newValues: { journalNo: journal.journal_no } });
    return recomputeForLine(await db('bank_statement_lines').where({ id: statementLineId }).first());
  },

  /** Selesaikan & kunci rekonsiliasi: hanya bila selisih terjelaskan penuh & tak ada item bank-only tersisa. */
  async finalizeReconciliation(req: Request, sessionId: string) {
    const session = await loadDraftSession(sessionId);
    const bank = await db('bank_accounts').where({ id: session.bank_account_id }).first();
    const view = await computeReconciliation(bank, session, session.period);
    if (!view.balanced) {
      throw errors.badRequest(`Masih ada selisih tak terjelaskan Rp ${Math.abs(view.unexplained ?? 0).toLocaleString('id-ID')}. Cocokkan mutasi & posting penyesuaian dulu.`);
    }
    const pending = view.adjustments.bankOnlyIncome.length + view.adjustments.bankOnlyCharges.length;
    if (pending > 0) {
      throw errors.badRequest(`Masih ada ${pending} mutasi bank yang belum dibukukan (posting penyesuaian atau cocokkan ke jurnal).`);
    }
    await db('bank_reconciliations').where({ id: sessionId }).update({
      status: 'completed',
      reconciled_by: req.user?.id ?? null,
      reconciled_at: db.fn.now(),
      reconciled_diff: view.difference,
      updated_at: db.fn.now()
    });
    await audit(req, { action: 'reconciliation.finalize', entity: 'bank_reconciliations', entityId: sessionId, newValues: { difference: view.difference } });
    return computeReconciliation(bank, await sessionWithUser(sessionId), session.period);
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
