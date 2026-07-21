import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { expenseLines, receiptLines, revenueRecognitionLines, hppRecognitionLines, commissionLines } from './journal.engine.js';

const app = createApp();

beforeAll(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.destroy();
});

async function token(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

// ===== Unit: template ayat jurnal =====
describe('template jurnal A–F (Chart of Accounts)', () => {
  it('A/B penerimaan: Dr Bank · Cr 2-1100', () => {
    expect(receiptLines('1-1200', 5_000_000)).toEqual([
      { accountCode: '1-1200', debit: 5_000_000 },
      { accountCode: '2-1100', credit: 5_000_000 }
    ]);
  });
  it('D pengakuan pendapatan: Dr 2-1100 · Cr 4-1000', () => {
    expect(revenueRecognitionLines('4-1000', 30_000_000)).toEqual([
      { accountCode: '2-1100', debit: 30_000_000 },
      { accountCode: '4-1000', credit: 30_000_000 }
    ]);
  });
  it('E pengakuan HPP: Dr 5-xxxx per komponen · Cr 1-1400 total', () => {
    const lines = hppRecognitionLines([
      { accountCode: '5-2000', amount: 10_000_000 },
      { accountCode: '5-1000', amount: 9_000_000 },
      { accountCode: '5-3000', amount: 3_000_000 }
    ]);
    expect(lines).toHaveLength(4);
    expect(lines[3]).toEqual({ accountCode: '1-1400', credit: 22_000_000 });
  });
  it('F komisi: Dr 6-2000 · Cr 2-1400', () => {
    expect(commissionLines(900_000)).toEqual([
      { accountCode: '6-2000', debit: 900_000 },
      { accountCode: '2-1400', credit: 900_000 }
    ]);
  });
});

describe('template biaya valas (contoh Handoff §5)', () => {
  it('SAR 45.000 + 12.000 @ 4.150 → IDR 186,75 jt + 49,8 jt · Cr bank 236,55 jt', () => {
    const lines = expenseLines({
      sourceBankCode: '1-1220',
      lines: [
        { accountCode: '5-2000', amount: 45_000 },
        { accountCode: '5-4000', amount: 12_000 }
      ],
      exchangeRate: 4150
    });
    expect(lines[0]).toMatchObject({ accountCode: '5-2000', debit: 186_750_000 });
    expect(lines[1]).toMatchObject({ accountCode: '5-4000', debit: 49_800_000 });
    expect(lines[2]).toMatchObject({ accountCode: '1-1220', credit: 236_550_000 });
    const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBe(credit);
  });

  it('pelunasan hutang valas: selisih kurs → 7-1000 (rugi saat kurs naik)', () => {
    // Hutang diakui @4.100, dibayar @4.150 → rugi kurs 50 × 10.000 SAR = 500.000
    const lines = expenseLines({
      sourceBankCode: '1-1220',
      lines: [{ accountCode: '2-1300', amount: 10_000 }],
      exchangeRate: 4150,
      settleDebt: true,
      exchangeRateAtRecognition: 4100
    });
    expect(lines.find((l) => l.accountCode === '2-1300')).toMatchObject({ debit: 41_000_000 });
    expect(lines.find((l) => l.accountCode === '7-1000')).toMatchObject({ debit: 500_000 });
    expect(lines.find((l) => l.accountCode === '1-1220')).toMatchObject({ credit: 41_500_000 });
  });

  it('laba kurs saat kurs turun → kredit 7-1000', () => {
    const lines = expenseLines({
      sourceBankCode: '1-1220',
      lines: [{ accountCode: '2-1300', amount: 10_000 }],
      exchangeRate: 4050,
      settleDebt: true,
      exchangeRateAtRecognition: 4100
    });
    expect(lines.find((l) => l.accountCode === '7-1000')).toMatchObject({ credit: 500_000 });
  });
});

// ===== Integrasi =====
describe('seed akuntansi', () => {
  it('COA lengkap ~41 akun, 2-1100 & 1-1400 highlighted', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(41);
    const uangMuka = res.body.data.find((a: { code: string }) => a.code === '2-1100');
    expect(uangMuka.highlighted).toBe(true);
    expect(uangMuka.normalBalance).toBe('credit');
    expect(uangMuka.balance).toBeGreaterThan(0); // saldo dari jurnal retroaktif pembayaran
  });

  it('SEMUA jurnal balance (Σdebit = Σkredit per jurnal)', async () => {
    const rows = await db('journal_lines')
      .select('journal_id')
      .sum({ debit: 'debit', credit: 'credit' })
      .groupBy('journal_id');
    expect(rows.length).toBeGreaterThan(20);
    for (const r of rows) expect(Number(r.debit)).toBe(Number(r.credit));
  });

  it('saldo 2-1100 = total pembayaran terverifikasi (retroaktif utuh)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const [{ total }] = await db('payments').where({ status: 'verified' }).sum({ total: 'amount' });
    const res = await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`);
    const acc = res.body.data.find((a: { code: string }) => a.code === '2-1100');
    expect(acc.balance).toBe(Number(total));
  });
});

describe('journal engine: penolakan', () => {
  it('jurnal tidak balance ditolak 400', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-07-17',
      description: 'Jurnal sengaja pincang',
      lines: [
        { accountCode: '6-5000', debit: 100_000 },
        { accountCode: '1-1100', credit: 90_000 }
      ]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('tidak balance');
  });

  it('akun induk non-postable ditolak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-07-17',
      description: 'Posting ke akun induk',
      lines: [
        { accountCode: '1-1000', debit: 100_000 },
        { accountCode: '2-1100', credit: 100_000 }
      ]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('akun induk');
  });

  it('akun tidak dikenal ditolak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-07-17',
      description: 'Akun fiktif',
      lines: [
        { accountCode: '9-9999', debit: 100_000 },
        { accountCode: '1-1100', credit: 100_000 }
      ]
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /v1/transactions/expense (valas SAR)', () => {
  it('contoh Handoff: 45k+12k SAR @4150 → jurnal IDR balance + saldo bank SAR berkurang', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-TR' }).first();
    const before = await db('bank_accounts').where({ account_code: '1-1220' }).first();

    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorName: 'Grand Al Massa Hotel',
      costCenterId: cc.id,
      sourceBankCode: '1-1220',
      exchangeRate: 4150,
      lines: [
        { accountCode: '5-2000', amount: 45_000 },
        { accountCode: '5-4000', amount: 12_000 }
      ]
    });
    expect(res.status).toBe(201);
    expect(res.body.data.journal_no).toMatch(/^JV-\d{4}-\d{4}$/);
    expect(res.body.data.totalDebit).toBe(236_550_000);
    expect(res.body.data.totalCredit).toBe(236_550_000);

    const after = await db('bank_accounts').where({ account_code: '1-1220' }).first();
    expect(Number(before.balance) - Number(after.balance)).toBe(236_550_000);
  });

  it('rekening valas tanpa kurs ditolak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      sourceBankCode: '1-1220',
      lines: [{ accountCode: '5-3000', amount: 1000 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Kurs');
  });
});

describe('POST /v1/transactions/revenue-recognition (PSAK 72)', () => {
  it('reclass 2-1100 → 4-1000 + HPP, saldo liabilitas turun', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-REG-9' }).first();
    const before = (await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`)).body.data;
    const liabBefore = before.find((a: { code: string }) => a.code === '2-1100').balance;

    const res = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id,
      revenueAccountCode: '4-1000',
      amount: 30_000_000,
      hpp: [
        { accountCode: '5-2000', amount: 10_000_000 },
        { accountCode: '5-1000', amount: 9_000_000 },
        { accountCode: '5-3000', amount: 3_000_000 }
      ]
    });
    expect(res.status).toBe(201);
    expect(res.body.data.revenue.totalDebit).toBe(30_000_000);
    expect(res.body.data.hpp.totalDebit).toBe(22_000_000);

    const after = (await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`)).body.data;
    expect(after.find((a: { code: string }) => a.code === '2-1100').balance).toBe(liabBefore - 30_000_000);
    expect(after.find((a: { code: string }) => a.code === '4-1000').balance).toBe(30_000_000);
    expect(after.find((a: { code: string }) => a.code === '5-2000').balance).toBeGreaterThanOrEqual(10_000_000);
  });
});

describe('POST /v1/transactions/commission', () => {
  it('3% × 141 jt = 4,23 jt (kalkulasi mockup Input Transaksi)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${keu}`).send({
      agentName: 'Barokah Tour', base: 141_000_000, pct: 3
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalDebit).toBe(4_230_000);
  });
});

describe('verifikasi pembayaran → jurnal otomatis', () => {
  it('payment verify menghasilkan jurnal Dr Bank · Cr 2-1100 dgn cost center', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first();
    const sch = await db('payment_schedules').where({ registration_id: inv.registration_id, status: 'unpaid' }).first();
    const pay = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: inv.id, scheduleId: sch.id, bankAccountCode: '1-1200', amount: Number(sch.amount) });
    const verify = await request(app).patch(`/v1/payments/${pay.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(verify.status).toBe(200);
    expect(verify.body.data.journal.journalNo).toMatch(/^JV-/);

    const journal = await db('journals').where({ journal_no: verify.body.data.journal.journalNo }).first();
    expect(journal.source).toBe('payment');
    expect(journal.cost_center_id).toBeTruthy();
    const lines = await db('journal_lines as l').join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code', 'l.debit', 'l.credit').where('l.journal_id', journal.id);
    expect(lines.find((l) => l.code === '1-1200')?.debit).toBe(String(sch.amount));
    expect(lines.find((l) => l.code === '2-1100')?.credit).toBe(String(sch.amount));
  });
});

describe('GET /v1/ledger/:code', () => {
  it('buku besar 2-1100 dgn saldo berjalan kredit', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/ledger/2-1100').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.lines.length).toBeGreaterThan(10);
    expect(res.body.data.endingBalance).toBe(res.body.data.lines.at(-1).balance);
  });
});

describe('GET /v1/journals + filter', () => {
  it('KPI seimbang; filter sumber payment', async () => {
    const keu = await token('keuangan@safar.co.id');
    const all = await request(app).get('/v1/journals').set('Authorization', `Bearer ${keu}`);
    expect(all.body.data.kpi.balanced).toBe(true);
    const pay = await request(app).get('/v1/journals?source=payment').set('Authorization', `Bearer ${keu}`);
    for (const e of pay.body.data.entries) expect(e.source).toBe('payment');
  });
});

describe('rekonsiliasi bank Juni (mockup)', () => {
  it('penyesuaian dua sisi seimbang; 3 mutasi belum tercocok', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/bank-reconciliations')
      .query({ bankAccountCode: '1-1200', month: '2026-06' })
      .set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.totalCount).toBe(6);
    expect(d.matchedCount).toBe(3);
    expect(d.adjusted.balanced).toBe(true);
    expect(d.adjustments.depositsInTransit[0].amount).toBe(15_000_000);
    expect(d.adjustments.bankOnlyCharges[0].amount).toBe(-185_000);
    expect(d.adjustments.bankOnlyIncome.find((l: { description: string }) => l.description === 'Jasa giro').amount).toBe(62_000);
  });

  it('tombol Cocokkan: toggle matched', async () => {
    const keu = await token('keuangan@safar.co.id');
    const line = await db('bank_statement_lines').where({ status: 'unmatched' }).first();
    const res = await request(app).post(`/v1/bank-reconciliations/${line.id}/match`).set('Authorization', `Bearer ${keu}`);
    expect(res.body.data.status).toBe('matched');
  });
});

describe('RBAC & summary', () => {
  it('operasional tidak boleh akses akuntansi (403)', async () => {
    const ops = await token('ops@safar.co.id');
    expect((await request(app).get('/v1/accounts').set('Authorization', `Bearer ${ops}`)).status).toBe(403);
    expect((await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${ops}`).send({})).status).toBe(403);
  });

  it('summary: KPI + laba per cost center + feed jurnal', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/accounting/summary').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.kpi.liabilitasJamaah).toBeGreaterThan(0);
    expect(res.body.data.journalFeed.length).toBeGreaterThan(0);
    expect(res.body.data.ccProfit.length).toBeGreaterThan(0);
  });
});

describe('pengaman akuntansi (audit fixes)', () => {
  it('pengakuan pendapatan tidak boleh dobel utk cost center yang sama (409)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-VIP-12' }).first();
    const body = { costCenterId: cc.id, revenueAccountCode: '4-1000' as const, amount: 10_000_000 };
    const first = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send(body);
    expect(first.status).toBe(201);
    const dup = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/sudah pernah diakui/i);
  });

  it('pelunasan hutang valas dgn kurs sama tetap men-Dr 2-1300 (bukan beban dobel)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-REG-9' }).first();
    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id, sourceBankCode: '1-1220', exchangeRate: 4265, settleDebt: true,
      exchangeRateAtRecognition: 4265, lines: [{ accountCode: '2-1300', amount: 100 }]
    });
    expect(res.status).toBe(201);
    const codes = res.body.data.lines.map((l: { accountCode: string }) => l.accountCode);
    expect(codes).toContain('2-1300'); // hutang dilunasi
    expect(codes).not.toContain('5-2000'); // TIDAK menambah beban lagi
  });

  it('jurnal manual dengan nominal pecahan tetap balance (round konsisten)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-07-01', description: 'Uji pembulatan',
      lines: [
        { accountCode: '6-5000', debit: 100.4 },
        { accountCode: '6-4000', debit: 100.4 },
        { accountCode: '1-1200', credit: 200.8 }
      ]
    });
    // 100+100 debit vs 201 credit → tidak balance → ditolak (bukan tersimpan pincang)
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/tidak balance/i);
  });
});
