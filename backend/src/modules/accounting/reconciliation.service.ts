import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { withTransaction } from '../../utils/tx.js';
import { postJournal, type JournalLineInput } from './journal.engine.js';

/**
 * R3TS-02 — modul rekonsiliasi bank, dipecah dari `accounting.service.ts` yang sudah
 * menembus batas lunak 800 baris. Murni pemindahan: API publik tetap dipakai lewat
 * `accountingService` (lihat komposisi di accounting.service.ts).
 */

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

/** Saldo buku besar akun bank sampai cutoff (tanggal koran bila ada sesi, akhir bulan bila belum). */
async function bankLedgerBalance(bank: Record<string, any>, session: Record<string, any> | null, month: string) {
  const q = db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .where('a.code', bank.account_code);
  if (session) q.where('j.date', '<=', session.statement_date);
  else q.whereRaw(`to_char(j.date, 'YYYY-MM') <= ?`, [month]);
  const [gl] = await q.sum({ debit: 'l.debit', credit: 'l.credit' });
  return roundRp(Number(gl.debit ?? 0) - Number(gl.credit ?? 0));
}

/** Baris rekening koran milik sesi ini (atau yang belum bersesi pada bulan tsb). */
async function loadStatementLines(bank: Record<string, any>, session: Record<string, any> | null, month: string) {
  return db('bank_statement_lines as s')
    .leftJoin('journal_lines as ml', 'ml.id', 's.matched_journal_line_id')
    .leftJoin('journals as mj', 'mj.id', 'ml.journal_id')
    .select('s.*', 'mj.journal_no as matched_journal_no')
    .where('s.bank_account_id', bank.id)
    .modify((q) =>
      session
        ? q.where('s.reconciliation_id', session.id)
        : q.whereNull('s.reconciliation_id').whereRaw(`to_char(s.line_date, 'YYYY-MM') = ?`, [month])
    )
    .orderBy('s.line_date') as Promise<Record<string, any>[]>;
}

/** Baris jurnal akun bank dalam periode — untuk deteksi book-only & saran pencocokan. */
async function loadBookLines(bank: Record<string, any>, session: Record<string, any> | null, month: string) {
  const q = db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .select('l.id', 'l.debit', 'l.credit', 'j.date', 'j.journal_no', 'j.description')
    .where('a.code', bank.account_code)
    .andWhere('j.date', '>=', `${month}-01`);
  if (session) q.andWhere('j.date', '<=', session.statement_date);
  else q.whereRaw(`to_char(j.date, 'YYYY-MM') = ?`, [month]);
  return (await q.orderBy('j.date')).map((bl: Record<string, any>) => ({
    id: bl.id, date: bl.date, journalNo: bl.journal_no, description: bl.description,
    amount: roundRp(Number(bl.debit) - Number(bl.credit))
  }));
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
  const ledgerBalance = await bankLedgerBalance(bank, session, month);
  const lines = await loadStatementLines(bank, session, month);
  const bookLines = await loadBookLines(bank, session, month);

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

export const reconciliationService = {
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

    const journal = await withTransaction(async (trx) => {
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
    }, { retries: 2 });
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
  }
};
