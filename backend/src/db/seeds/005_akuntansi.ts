import type { Knex } from 'knex';
// Tanpa ekstensi .js — dimuat dinamis oleh Knex (lihat catatan seed 003)
import { COA, accountClass, normalBalance } from '../../modules/accounting/coa';
import { postJournal, receiptLines, commissionLines } from '../../modules/accounting/journal.engine';

/**
 * Seed M6 — akuntansi:
 * - COA lengkap 7 kelas (Chart of Accounts.dc.html)
 * - Cost center per keberangkatan + MKT-KOMISI/UMUM
 * - Jurnal retroaktif seluruh pembayaran terverifikasi (Dr Bank · Cr 2-1100)
 * - Contoh jurnal biaya/komisi/manual + mutasi rekening koran Juni (mockup Rekonsiliasi)
 */
export async function seed(knex: Knex): Promise<void> {
  // ---- COA ----
  const parentIds = new Map<string, string>();
  for (const def of COA) {
    const [row] = await knex('accounts')
      .insert({
        code: def.code,
        name: def.name,
        class: accountClass(def.code),
        normal_balance: normalBalance(def.code),
        parent_id: def.level === 1 ? (parentIds.get(def.code.slice(0, 3) + '000') ?? null) : null,
        is_postable: def.level === 1 || accountClass(def.code) >= 3, // induk kelas 1-2 tidak postable
        is_highlighted: def.highlighted ?? false,
        note: def.note ?? null
      })
      .returning('*');
    if (def.level === 0) parentIds.set(def.code, row.id);
  }
  // 1-1000/1-2000/2-1000 induk → non-postable (sudah); kelas 3-7 induk = postable (akun tunggal)

  // ---- Kurs ----
  await knex('exchange_rates').insert([
    { currency: 'SAR', rate: 4150, rate_date: '2026-06-14' },
    { currency: 'SAR', rate: 4180, rate_date: '2026-07-15' },
    { currency: 'USD', rate: 15850, rate_date: '2026-06-14' },
    { currency: 'USD', rate: 15900, rate_date: '2026-07-15' }
  ]);

  // ---- Cost center per keberangkatan + non-keberangkatan ----
  const departures = await knex('departures as d')
    .join('packages as p', 'p.id', 'd.package_id')
    .select('d.id', 'd.departure_date', 'p.code', 'p.name');
  const ccByDeparture = new Map<string, string>();
  for (const d of departures) {
    const month = new Date(d.departure_date).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
    const [cc] = await knex('cost_centers')
      .insert({ departure_id: d.id, code: `CC-${d.code}`, name: `${d.name} — ${month}` })
      .returning('*');
    ccByDeparture.set(d.id, cc.id);
  }
  const [ccMkt] = await knex('cost_centers').insert({ code: 'MKT-KOMISI', name: 'Marketing — Komisi Agen' }).returning('*');
  await knex('cost_centers').insert({ code: 'UMUM', name: 'Umum (non cost center)' });

  // ---- Vendor ----
  const [vHotel] = await knex('vendors').insert({ name: 'Grand Al Massa Hotel', type: 'hotel' }).returning('*');
  await knex('vendors').insert([
    { name: 'Turkish Airlines', type: 'airline' },
    { name: 'Kedutaan — Visa Agent', type: 'visa' },
    { name: 'Katering Al Baik', type: 'catering' }
  ]);

  // ---- Penomoran JV menyerupai mockup (JV-2026-06xx) ----
  await knex('numbering_sequences').insert({ key: 'JV-2026', next_value: 601 }).onConflict('key').merge();

  // ---- Jurnal retroaktif: seluruh pembayaran terverifikasi ----
  const payments = await knex('payments as pm')
    .join('invoices as i', 'i.id', 'pm.invoice_id')
    .join('registrations as r', 'r.id', 'i.registration_id')
    .join('jamaah as j', 'j.id', 'r.jamaah_id')
    .leftJoin('payment_schedules as s', 's.id', 'pm.schedule_id')
    .leftJoin('bank_accounts as b', 'b.id', 'pm.bank_account_id')
    .select('pm.id', 'pm.amount', 'pm.paid_at', 'r.departure_id', 'j.full_name', 's.label', 'b.account_code')
    .where('pm.status', 'verified')
    .orderBy('pm.paid_at');
  for (const p of payments) {
    await postJournal(knex, {
      date: new Date(p.paid_at).toISOString().slice(0, 10),
      description: `Penerimaan ${(p.label ?? 'pembayaran').toLowerCase()} — ${p.full_name}`,
      source: 'payment',
      refType: 'payments',
      refId: p.id,
      costCenterId: ccByDeparture.get(p.departure_id) ?? null,
      lines: receiptLines(p.account_code ?? '1-1200', Number(p.amount))
    });
  }

  // ---- Contoh jurnal lain (menyerupai feed mockup) ----
  const plusTurkiDep = departures.find((d) => d.code === 'UMR-PLUS-TR')!;
  const ccPlusTurki = ccByDeparture.get(plusTurkiDep.id)!;

  // DP vendor hotel (JV-0612 mockup): Dr 1-1400 · Cr 1-1200
  await postJournal(knex, {
    date: '2026-06-12',
    description: 'Pembayaran DP hotel — Grand Al Massa (Grup Plus Turki Agustus)',
    source: 'expense',
    refType: 'vendors',
    refId: vHotel.id,
    costCenterId: ccPlusTurki,
    lines: [
      { accountCode: '1-1400', debit: 210_000_000 },
      { accountCode: '1-1200', credit: 210_000_000 }
    ]
  });

  // Penempatan dana valas SAR (manual): Dr 1-1220 · Cr 1-1200 (60.000 SAR × 4.150)
  await postJournal(knex, {
    date: '2026-06-14',
    description: 'Penempatan dana SAR — persiapan biaya darat (60.000 SAR @ 4.150)',
    source: 'manual',
    currency: 'SAR',
    exchangeRate: 4150,
    lines: [
      { accountCode: '1-1220', debit: 249_000_000, amountForeign: 60_000 },
      { accountCode: '1-1200', credit: 249_000_000, amountForeign: 60_000 }
    ]
  });

  // Komisi agen (JV-0615 mockup): Dr 6-2000 · Cr 2-1400
  await postJournal(knex, {
    date: '2026-06-20',
    description: 'Komisi agen — Barokah Tour (Juni)',
    source: 'commission',
    costCenterId: ccMkt.id,
    lines: commissionLines(4_230_000)
  });

  // ---- Sesi rekonsiliasi bank Juni — BSI IDR (mockup Rekonsiliasi Bank) ----
  // Rekening koran = cerminan mutasi buku besar 1-1200 s/d 30 Jun (semua matched),
  // + 2 item bank-only yang belum dibukukan (jasa giro, biaya adm) untuk diposting,
  // + 1 setoran "dalam perjalanan" (book-only) sebagai item pendamai murni.
  const bankIdr = await knex('bank_accounts').where({ account_code: '1-1200' }).first();
  const glLines = await knex('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .select('l.id', 'l.debit', 'l.credit', 'j.date', 'j.description')
    .where('a.code', '1-1200')
    .andWhere('j.date', '<=', '2026-06-30')
    .orderBy('j.date');
  const glTotal = glLines.reduce((s, l) => s + (Number(l.debit) - Number(l.credit)), 0);

  // Sisakan satu setoran Juni terakhir sebagai setoran dalam perjalanan (book-only).
  const dit = [...glLines].reverse().find(
    (l) => Number(l.debit) - Number(l.credit) > 0 && new Date(l.date) >= new Date('2026-06-01')
  );
  const ditAmount = dit ? Number(dit.debit) - Number(dit.credit) : 0;

  // Saldo akhir rekening koran (EKSTERNAL, seperti diinput admin) =
  //   saldo buku + item bank-only (jasa giro 62rb − biaya adm 185rb) − setoran dalam perjalanan.
  const closingBalance = glTotal - 123_000 - ditAmount;

  const [recon] = await knex('bank_reconciliations')
    .insert({
      bank_account_id: bankIdr.id, period: '2026-06', statement_date: '2026-06-30',
      opening_balance: 0, closing_balance: closingBalance, status: 'draft'
    })
    .returning('*');

  const stmtRows: Record<string, unknown>[] = [];
  for (const l of glLines) {
    if (dit && l.id === dit.id) continue; // biarkan book-only
    const amt = Number(l.debit) - Number(l.credit);
    stmtRows.push({
      bank_account_id: bankIdr.id, reconciliation_id: recon.id, line_date: l.date,
      description: l.description, amount: amt, line_type: amt >= 0 ? 'setoran' : 'penarikan',
      matched_journal_line_id: l.id, status: 'matched'
    });
  }
  stmtRows.push(
    { bank_account_id: bankIdr.id, reconciliation_id: recon.id, line_date: '2026-06-30', description: 'Jasa giro', amount: 62_000, line_type: 'jasa_giro', status: 'unmatched' },
    { bank_account_id: bankIdr.id, reconciliation_id: recon.id, line_date: '2026-06-30', description: 'Biaya administrasi bank', amount: -185_000, line_type: 'biaya_adm', status: 'unmatched' }
  );
  await knex('bank_statement_lines').insert(stmtRows);
}
