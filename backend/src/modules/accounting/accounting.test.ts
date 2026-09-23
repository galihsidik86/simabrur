import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import {
  expenseLines, receiptLines, revenueRecognitionLines, hppRecognitionLines, commissionLines,
  allocateVendorAdvance, hppRecognitionLinesAllocated
} from './journal.engine.js';

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

describe('B (putaran 3): allocateVendorAdvance — alokasi pro-rata saldo 1-1400', () => {
  it('total HPP ≤ saldo → semua komponen teralokasi penuh, excess 0', () => {
    const alloc = allocateVendorAdvance([
      { accountCode: '5-2000', amount: 10_000_000 },
      { accountCode: '5-1000', amount: 9_000_000 }
    ], 22_000_000);
    expect(alloc[0]).toMatchObject({ allocated: 10_000_000, excess: 0 });
    expect(alloc[1]).toMatchObject({ allocated: 9_000_000, excess: 0 });
  });

  it('total HPP > saldo, 2 komponen → pro-rata menurut nominal, sisa pembulatan ke komponen terakhir', () => {
    // saldo 210 jt, komponen 150 jt & 100 jt (total 250 jt) → capped 210 jt
    // alloc0 = round(210jt × 150jt/250jt) = 126 jt; alloc1 (terakhir) = 210jt − 126jt = 84jt
    const alloc = allocateVendorAdvance([
      { accountCode: '5-2000', amount: 150_000_000, vendorId: 'v1' },
      { accountCode: '5-4000', amount: 100_000_000, vendorId: 'v2' }
    ], 210_000_000);
    expect(alloc[0]).toMatchObject({ allocated: 126_000_000, excess: 24_000_000 });
    expect(alloc[1]).toMatchObject({ allocated: 84_000_000, excess: 16_000_000 });
    expect(alloc[0].allocated + alloc[1].allocated).toBe(210_000_000);
    expect(alloc[0].excess + alloc[1].excess).toBe(40_000_000);
  });

  it('saldo 0 → seluruh nominal jadi excess (hutang vendor), allocated 0', () => {
    const alloc = allocateVendorAdvance([{ accountCode: '5-3000', amount: 18_000_000, vendorId: 'v1' }], 0);
    expect(alloc[0]).toMatchObject({ allocated: 0, excess: 18_000_000 });
  });

  it('hppRecognitionLinesAllocated: tanpa excess = perilaku lama (satu baris Cr 1-1400 total)', () => {
    const alloc = allocateVendorAdvance([{ accountCode: '5-2000', amount: 5_000_000 }], 5_000_000);
    const lines = hppRecognitionLinesAllocated(alloc);
    expect(lines).toEqual([
      { accountCode: '5-2000', debit: 5_000_000 },
      { accountCode: '1-1400', credit: 5_000_000 }
    ]);
  });

  it('hppRecognitionLinesAllocated: dgn excess → Dr per komponen penuh · Cr 1-1400 alokasi · Cr 2-1300 per kelebihan; tetap balance', () => {
    const alloc = allocateVendorAdvance([
      { accountCode: '5-2000', amount: 150_000_000, vendorId: 'v1' },
      { accountCode: '5-4000', amount: 100_000_000, vendorId: 'v2' }
    ], 210_000_000);
    const lines = hppRecognitionLinesAllocated(alloc);
    const debit = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(debit).toBe(credit);
    expect(lines.find((l) => l.accountCode === '1-1400')).toMatchObject({ credit: 210_000_000 });
    const excessLines = lines.filter((l) => l.accountCode === '2-1300');
    expect(excessLines.reduce((s, l) => s + (l.credit ?? 0), 0)).toBe(40_000_000);
  });

  it('hppRecognitionLinesAllocated: saldo 0 → tanpa baris 1-1400 sama sekali (Cr hanya ke 2-1300)', () => {
    const alloc = allocateVendorAdvance([{ accountCode: '5-3000', amount: 18_000_000, vendorId: 'v1' }], 0);
    const lines = hppRecognitionLinesAllocated(alloc);
    expect(lines.some((l) => l.accountCode === '1-1400')).toBe(false);
    expect(lines.find((l) => l.accountCode === '2-1300')).toMatchObject({ credit: 18_000_000 });
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

    // N-4: HPP mereklas Uang Muka Vendor 1-1400 (PLAN §4.2) — sejak guard AK-01,
    // reklas tidak boleh melebihi DP vendor yang benar-benar tercatat di cost
    // center ini. Seed hanya memberi DP vendor ke CC-UMR-PLUS-TR, jadi sediakan
    // dulu DP 22 jt ke CC-UMR-REG-9 sebelum mengakui HPP-nya.
    const dp = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorName: 'Vendor Uji CC-REG-9',
      costCenterId: cc.id,
      sourceBankCode: '1-1200',
      lines: [{ accountCode: '1-1400', amount: 22_000_000 }]
    });
    expect(dp.status).toBe(201);

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

describe('AK-01: HPP tidak boleh melebihi saldo Uang Muka Vendor 1-1400 per cost center', () => {
  it('CC tanpa DP vendor (1-1400 = 0) menerima HPP 25 jt → 400, tidak ada jurnal tercatat', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-AQ' }).first();
    const journalsBefore = await db('journals').count<{ n: string }[]>('id as n').first();

    const res = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id,
      revenueAccountCode: '4-1000',
      amount: 5_000_000,
      hpp: [{ accountCode: '5-2000', amount: 25_000_000 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('1-1400');

    const journalsAfter = await db('journals').count<{ n: string }[]>('id as n').first();
    expect(Number(journalsAfter?.n)).toBe(Number(journalsBefore?.n)); // transaksi rollback utuh

    const [{ adv }] = await db('journal_lines as jl')
      .join('accounts as a', 'a.id', 'jl.account_id')
      .join('journals as j', 'j.id', 'jl.journal_id')
      .where('a.code', '1-1400').andWhere('j.cost_center_id', cc.id)
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS adv'));
    expect(Number(adv)).toBe(0); // tidak jadi negatif (bug AK-01 lama)
  });

  it('global 1-1400 cukup tapi CC ini nol tetap ditolak (guard global tidak cukup)', async () => {
    const keu = await token('keuangan@safar.co.id');
    // CC-UMR-PLUS-TR (dari seed) punya DP vendor 210 jt — saldo GLOBAL 1-1400 sangat positif,
    // tapi CC-HAJ-FURODA-27 yang dituju tidak punya DP sama sekali.
    const ccTarget = await db('cost_centers').where({ code: 'CC-HAJ-FURODA-27' }).first();
    const res = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: ccTarget.id,
      revenueAccountCode: '4-1000',
      amount: 1_000_000,
      hpp: [{ accountCode: '5-2000', amount: 1_000_000 }]
    });
    expect(res.status).toBe(400);
  });
});

describe('B (putaran 3): HPP > saldo 1-1400 → hutang vendor per komponen (integrasi)', () => {
  it('2 komponen melebihi saldo → alokasi pro-rata, jurnal balance, 2-1300 = Σ kelebihan, vendor_bills per komponen, saldo 1-1400 CC = 0', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-TR' }).first(); // saldo 1-1400 seed = 210 jt
    const vendorHotel = await db('vendors').where({ name: 'Grand Al Massa Hotel' }).first();
    const vendorAirline = await db('vendors').where({ name: 'Turkish Airlines' }).first();

    const res = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id,
      revenueAccountCode: '4-1000',
      amount: 50_000_000,
      hpp: [
        { accountCode: '5-2000', amount: 150_000_000, vendorId: vendorHotel.id },
        { accountCode: '5-4000', amount: 100_000_000, vendorId: vendorAirline.id }
      ]
    });
    expect(res.status).toBe(201);
    expect(res.body.data.hpp.totalDebit).toBe(res.body.data.hpp.totalCredit); // jurnal balance
    expect(res.body.data.hpp.totalDebit).toBe(250_000_000);

    const bills = res.body.data.vendorBills as { id: string; vendorId: string; accountCode: string; amount: number }[];
    expect(bills).toHaveLength(2);
    const billHotel = bills.find((b) => b.accountCode === '5-2000')!;
    const billAirline = bills.find((b) => b.accountCode === '5-4000')!;
    expect(billHotel).toMatchObject({ vendorId: vendorHotel.id, amount: 24_000_000 });
    expect(billAirline).toMatchObject({ vendorId: vendorAirline.id, amount: 16_000_000 });

    const rows = await db('vendor_bills').where({ cost_center_id: cc.id });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'unpaid')).toBe(true);
    expect(rows.reduce((s, r) => s + Number(r.amount), 0)).toBe(40_000_000);

    const [{ adv }] = await db('journal_lines as jl')
      .join('accounts as a', 'a.id', 'jl.account_id')
      .join('journals as j', 'j.id', 'jl.journal_id')
      .where('a.code', '1-1400').andWhere('j.cost_center_id', cc.id)
      .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS adv'));
    expect(Number(adv)).toBe(0); // saldo 1-1400 CC habis terpakai
  });

  it('saldo 1-1400 = 0 dgn vendorId → SELURUH HPP jadi hutang vendor (bukan ditolak)', async () => {
    const keu = await token('keuangan@safar.co.id');
    // CC-HAJ-FURODA-27: saldo 1-1400 seed = 0 (belum ada DP vendor), liabilitas 2-1100
    // seed = 245 jt (cukup utk pendapatan kecil di bawah).
    const cc = await db('cost_centers').where({ code: 'CC-HAJ-FURODA-27' }).first();
    const vendor = await db('vendors').where({ name: 'Katering Al Baik' }).first();

    const res = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id,
      revenueAccountCode: '4-1000',
      amount: 2_000_000,
      hpp: [{ accountCode: '5-3000', amount: 18_000_000, vendorId: vendor.id }]
    });
    expect(res.status).toBe(201);
    expect(res.body.data.vendorBills).toEqual([
      expect.objectContaining({ vendorId: vendor.id, accountCode: '5-3000', amount: 18_000_000 })
    ]);
    const lines = res.body.data.hpp.lines as { accountCode: string; debit: number; credit: number }[];
    expect(lines.some((l) => l.accountCode === '1-1400')).toBe(false); // tanpa reklas 1-1400 sama sekali
    expect(lines.find((l) => l.accountCode === '2-1300')).toMatchObject({ credit: 18_000_000 });
  });

  it('pelunasan tagihan vendor via Pembayaran Biaya (vendorBillId) → paid_amount naik, status paid saat lunas, jurnal Dr 2-1300', async () => {
    const keu = await token('keuangan@safar.co.id');
    // CC-UMR-PLUS-AQ: saldo 1-1400 seed = 0, liabilitas 2-1100 seed = 6,7 jt (cukup utk
    // pendapatan kecil di bawah) — belum dipakai skenario lain di describe ini.
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-AQ' }).first();
    const vendor = await db('vendors').where({ name: 'Kedutaan — Visa Agent' }).first();

    const rev = await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id, revenueAccountCode: '4-1000', amount: 1_000_000,
      hpp: [{ accountCode: '5-4000', amount: 10_000_000, vendorId: vendor.id }]
    });
    expect(rev.status).toBe(201);
    const billId = rev.body.data.vendorBills[0].id as string;

    // Pelunasan parsial 4 jt — belum lunas
    const part = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 4_000_000, vendorBillId: billId }]
    });
    expect(part.status).toBe(201);
    expect(part.body.data.lines.find((l: { accountCode: string }) => l.accountCode === '2-1300')).toMatchObject({ debit: 4_000_000 });
    let bill = await db('vendor_bills').where({ id: billId }).first();
    expect(Number(bill.paid_amount)).toBe(4_000_000);
    expect(bill.status).toBe('unpaid');

    // Pelunasan sisa 6 jt — lunas
    const rest = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 6_000_000, vendorBillId: billId }]
    });
    expect(rest.status).toBe(201);
    bill = await db('vendor_bills').where({ id: billId }).first();
    expect(Number(bill.paid_amount)).toBe(10_000_000);
    expect(bill.status).toBe('paid');

    // Pelunasan lanjutan pada tagihan yang sudah lunas ditolak
    const again = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 1_000_000, vendorBillId: billId }]
    });
    expect(again.status).toBe(409);
  });

  // Skenario (3) brief (komponen berkelebihan TANPA vendorId → 400, tanpa jurnal,
  // saldo 1-1400 tidak berubah) sudah dijamin oleh describe AK-01 di atas — tidak
  // diulang di sini agar tidak kehabisan cost center bebas-revenue di file tes ini
  // (setiap keberangkatan seed hanya bisa mengakui pendapatan SEKALI).
});

describe('GET /v1/cost-centers/:id/balances (putaran 3)', () => {
  it('mengembalikan saldo 1-1400 & 2-1100 sesuai jurnal berjalan CC ini', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-TR' }).first();
    const res = await request(app).get(`/v1/cost-centers/${cc.id}/balances`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ costCenterId: cc.id });
    expect(res.body.data.vendorAdvance1400).toBeGreaterThanOrEqual(0);
    expect(res.body.data.liability2100).toBeGreaterThanOrEqual(0);
  });
});

async function acctBalanceForCC(code: string, costCenterId: string): Promise<number> {
  const [{ bal }] = await db('journal_lines as jl')
    .join('accounts as a', 'a.id', 'jl.account_id')
    .join('journals as j', 'j.id', 'jl.journal_id')
    .where('a.code', code).andWhere('j.cost_center_id', costCenterId)
    .select(db.raw('COALESCE(SUM(jl.debit - jl.credit), 0) AS bal'));
  return Number(bal);
}

describe('PATCH /v1/vendor-bills/:id/void (tugas lanjutan putaran 3)', () => {
  it('void tagihan unpaid (paid_amount=0) → 200, jurnal balik seimbang (Dr 2-1300 · Cr akun HPP), saldo 2-1300 turun & HPP turun sebesar nominal', async () => {
    const keu = await token('keuangan@safar.co.id');
    // Tagihan dari skenario B "saldo 1-1400=0 dgn vendorId" (describe di atas): CC-HAJ-FURODA-27,
    // vendor Katering Al Baik, akun 5-3000, 18 jt, masih unpaid & belum pernah disentuh pelunasan.
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Katering Al Baik')
      .select('vb.*')
      .first();
    expect(bill.status).toBe('unpaid');
    expect(Number(bill.paid_amount)).toBe(0);

    const cc2300Before = await acctBalanceForCC('2-1300', bill.cost_center_id);
    const hppBefore = await acctBalanceForCC(bill.account_code, bill.cost_center_id);

    const res = await request(app).patch(`/v1/vendor-bills/${bill.id}/void`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Vendor katering dibatalkan, tidak jadi dipesan' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: bill.id, status: 'void' });

    const journal = await db('journals').where({ journal_no: res.body.data.journalNo }).first();
    expect(journal.source).toBe('expense');
    expect(journal.cost_center_id).toBe(bill.cost_center_id);
    const lines = await db('journal_lines as l').join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code', 'l.debit', 'l.credit').where('l.journal_id', journal.id);
    expect(lines.find((l) => l.code === '2-1300')).toMatchObject({ debit: String(Number(bill.amount).toFixed(2)) });
    expect(lines.find((l) => l.code === bill.account_code)).toMatchObject({ credit: String(Number(bill.amount).toFixed(2)) });
    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit); // jurnal balik seimbang

    // Saldo 2-1300 (liabilitas, normal kredit) turun sebesar nominal → representasi
    // debit-normal (jl.debit - jl.credit) NAIK sebesar amount (mendekati/menuju nol).
    const cc2300After = await acctBalanceForCC('2-1300', bill.cost_center_id);
    expect(cc2300After - cc2300Before).toBe(Number(bill.amount));
    // HPP (5-xxxx, normal debit) turun sebesar nominal → representasi debit-normal TURUN.
    const hppAfter = await acctBalanceForCC(bill.account_code, bill.cost_center_id);
    expect(hppBefore - hppAfter).toBe(Number(bill.amount));

    const updated = await db('vendor_bills').where({ id: bill.id }).first();
    expect(updated.status).toBe('void');
    expect(updated.void_reason).toBe('Vendor katering dibatalkan, tidak jadi dipesan');
    expect(updated.voided_at).toBeTruthy();
    expect(updated.reversal_journal_id).toBe(journal.id);
  });

  it('void tagihan yang sudah dibayar sebagian/lunas → 409 tanpa jurnal baru', async () => {
    const keu = await token('keuangan@safar.co.id');
    // Tagihan dari skenario B "pelunasan via Pembayaran Biaya" (describe di atas):
    // CC-UMR-PLUS-AQ, vendor Kedutaan — Visa Agent, 10 jt, sudah LUNAS (paid) di sana.
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Kedutaan — Visa Agent')
      .select('vb.*')
      .first();
    expect(bill.status).toBe('paid');
    const journalsBefore = await db('journals').count<{ n: string }[]>('id as n').first();

    const res = await request(app).patch(`/v1/vendor-bills/${bill.id}/void`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba batalkan tagihan yang sudah lunas' });
    expect(res.status).toBe(409);

    const journalsAfter = await db('journals').count<{ n: string }[]>('id as n').first();
    expect(Number(journalsAfter?.n)).toBe(Number(journalsBefore?.n));
  });

  it('void dua kali → 409 pada percobaan kedua', async () => {
    const keu = await token('keuangan@safar.co.id');
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Katering Al Baik')
      .select('vb.*')
      .first();
    expect(bill.status).toBe('void'); // dibatalkan oleh tes pertama di describe ini

    const res = await request(app).patch(`/v1/vendor-bills/${bill.id}/void`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba batalkan lagi' });
    expect(res.status).toBe(409);
  });

  it('role operasional/marketing ditolak 403', async () => {
    const ops = await token('ops@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Grand Al Massa Hotel')
      .select('vb.*')
      .first();
    for (const t of [ops, mkt]) {
      const res = await request(app).patch(`/v1/vendor-bills/${bill.id}/void`).set('Authorization', `Bearer ${t}`).send({ reason: 'Tidak berwenang' });
      expect(res.status).toBe(403);
    }
    // Tidak tersentuh oleh percobaan RBAC di atas — tetap unpaid utk tes lain bila perlu.
    const stillUnpaid = await db('vendor_bills').where({ id: bill.id }).first();
    expect(stillUnpaid.status).toBe('unpaid');
  });

  it('lunasi tagihan yang sudah void (via vendorBillId di Pembayaran Biaya) → 409', async () => {
    const keu = await token('keuangan@safar.co.id');
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Katering Al Baik')
      .select('vb.*')
      .first();
    expect(bill.status).toBe('void');

    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 1_000_000, vendorBillId: bill.id }]
    });
    expect(res.status).toBe(409);
  });

  it('alasan < 5 karakter ditolak validasi (400)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const bill = await db('vendor_bills as vb')
      .join('vendors as v', 'v.id', 'vb.vendor_id')
      .where('v.name', 'Turkish Airlines')
      .select('vb.*')
      .first();
    const res = await request(app).patch(`/v1/vendor-bills/${bill.id}/void`).set('Authorization', `Bearer ${keu}`).send({ reason: 'ab' });
    expect(res.status).toBe(400);
  });

  it('GET /v1/vendor-bills?status=void mengembalikan tagihan yang sudah dibatalkan', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/vendor-bills').query({ status: 'void' }).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of res.body.data) expect(row.status).toBe('void');
  });
});

describe('R3SEC-02: cost center pelunasan tagihan vendor wajib cocok dengan tagihannya', () => {
  // Tagihan disisipkan LANGSUNG ke DB (bukan lewat revenue-recognition) karena tiap
  // cost center seed hanya boleh mengakui pendapatan SEKALI — lihat catatan di akhir
  // describe "B (putaran 3)". Yang diuji di sini murni guard pelunasan, bukan alur HPP.
  async function seedUnpaidBill(costCenterCode: string, amount: number) {
    const cc = await db('cost_centers').where({ code: costCenterCode }).first();
    const vendor = await db('vendors').where({ name: 'Grand Al Massa Hotel' }).first();
    const [bill] = await db('vendor_bills')
      .insert({
        vendor_id: vendor.id, cost_center_id: cc.id, amount, currency: 'IDR',
        status: 'unpaid', account_code: '5-2000'
      })
      .returning('*');
    return { cc, vendor, bill };
  }

  const journalCount = async () =>
    Number((await db('journals').count<{ n: string }[]>('id as n').first())!.n);

  it('costCenterId input ≠ cost center tagihan → 400, tanpa jurnal & paid_amount tidak berubah', async () => {
    const keu = await token('keuangan@safar.co.id');
    const { vendor, bill } = await seedUnpaidBill('CC-UMR-PLUS-AQ', 5_000_000);
    const lain = await db('cost_centers').where({ code: 'CC-UMR-REG-9' }).first();
    const before = await journalCount();

    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, costCenterId: lain.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 1_000_000, vendorBillId: bill.id }]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cost center/i);
    expect(await journalCount()).toBe(before); // rollback utuh — tidak ada jurnal nyasar
    const after = await db('vendor_bills').where({ id: bill.id }).first();
    expect(Number(after.paid_amount)).toBe(0);
  });

  it('costCenterId input = cost center tagihan → 201 (jalur sah tidak diblokir)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const { cc, vendor, bill } = await seedUnpaidBill('CC-UMR-PLUS-AQ', 3_000_000);
    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, costCenterId: cc.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 3_000_000, vendorBillId: bill.id }]
    });
    expect(res.status).toBe(201);
    const after = await db('vendor_bills').where({ id: bill.id }).first();
    expect(Number(after.paid_amount)).toBe(3_000_000);
    expect(after.status).toBe('paid');
  });

  it('tanpa costCenterId tetap diterima — tidak ada keberangkatan salah yang dituju', async () => {
    const keu = await token('keuangan@safar.co.id');
    const { vendor, bill } = await seedUnpaidBill('CC-UMR-PLUS-AQ', 2_000_000);
    const res = await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorId: vendor.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '2-1300', amount: 2_000_000, vendorBillId: bill.id }]
    });
    expect(res.status).toBe(201);
    expect(Number((await db('vendor_bills').where({ id: bill.id }).first()).paid_amount)).toBe(2_000_000);
  });
});

describe('POST /v1/journals/:id/reverse (C, rekomendasi N-3)', () => {
  it('balik jurnal manual → jurnal pembalik balance, saldo akun kembali, relasi reversalOfJournalNo/reversedByJournalNo tampil di GET /journals', async () => {
    const keu = await token('keuangan@safar.co.id');
    const before = (await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`)).body.data;
    const bankBefore = before.find((a: { code: string }) => a.code === '1-1200').balance;

    const created = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Uji koreksi manual (akan dibalik)',
      lines: [{ accountCode: '6-4000', debit: 500_000 }, { accountCode: '1-1200', credit: 500_000 }]
    });
    expect(created.status).toBe(201);
    const journalId = created.body.data.id as string;

    const reversed = await request(app).post(`/v1/journals/${journalId}/reverse`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Salah input akun biaya' });
    expect(reversed.status).toBe(201);
    expect(reversed.body.data.totalDebit).toBe(reversed.body.data.totalCredit);
    expect(reversed.body.data.reversalOfJournalNo).toBe(created.body.data.journal_no);

    const after = (await request(app).get('/v1/accounts').set('Authorization', `Bearer ${keu}`)).body.data;
    expect(after.find((a: { code: string }) => a.code === '1-1200').balance).toBe(bankBefore); // saldo kembali

    const list = await request(app).get('/v1/journals').set('Authorization', `Bearer ${keu}`);
    const srcEntry = list.body.data.entries.find((e: { journalNo: string }) => e.journalNo === created.body.data.journal_no);
    const revEntry = list.body.data.entries.find((e: { journalNo: string }) => e.journalNo === reversed.body.data.journal_no);
    expect(srcEntry.reversedByJournalNo).toBe(reversed.body.data.journal_no);
    expect(revEntry.reversalOfJournalNo).toBe(created.body.data.journal_no);
  });

  it('balik dua kali → 409', async () => {
    const keu = await token('keuangan@safar.co.id');
    const created = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Uji balik dua kali',
      lines: [{ accountCode: '6-4000', debit: 200_000 }, { accountCode: '1-1200', credit: 200_000 }]
    });
    const journalId = created.body.data.id as string;
    const first = await request(app).post(`/v1/journals/${journalId}/reverse`).set('Authorization', `Bearer ${keu}`).send({ reason: 'Koreksi pertama' });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/v1/journals/${journalId}/reverse`).set('Authorization', `Bearer ${keu}`).send({ reason: 'Koreksi kedua' });
    expect(second.status).toBe(409);
  });

  it('jurnal source payment/revenue/expense/commission/reconciliation ditolak (409) — hanya source manual', async () => {
    const keu = await token('keuangan@safar.co.id');
    const paymentJournal = await db('journals').where({ source: 'payment' }).first();
    const res = await request(app).post(`/v1/journals/${paymentJournal.id}/reverse`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba balik jurnal otomatis' });
    expect(res.status).toBe(409);
  });

  it('role operasional/marketing ditolak 403', async () => {
    const ops = await token('ops@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const anyJournal = await db('journals').first();
    for (const t of [ops, mkt]) {
      const res = await request(app).post(`/v1/journals/${anyJournal.id}/reverse`).set('Authorization', `Bearer ${t}`).send({ reason: 'Tidak berwenang' });
      expect(res.status).toBe(403);
    }
  });

  it('alasan < 5 karakter ditolak validasi (400)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const created = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Uji alasan pendek',
      lines: [{ accountCode: '6-4000', debit: 50_000 }, { accountCode: '1-1200', credit: 50_000 }]
    });
    const res = await request(app).post(`/v1/journals/${created.body.data.id}/reverse`).set('Authorization', `Bearer ${keu}`).send({ reason: 'ab' });
    expect(res.status).toBe(400);
  });

  it('pembalikan yang membuat 2-1100 per CC negatif → 400 (guard N-3 tetap berlaku)', async () => {
    const keu = await token('keuangan@safar.co.id');
    // MKT-KOMISI: cost center non-keberangkatan, TIDAK dipakai tes lain di file ini utk
    // pengakuan pendapatan/saldo 2-1100 — aman dimanipulasi tanpa mengganggu tes lain
    // yang bergantung pada saldo 2-1100 keberangkatan tertentu (mis. CC-UMR-VIP-12).
    const cc = await db('cost_centers').where({ code: 'MKT-KOMISI' }).first();
    // Jurnal manual: kredit 2-1100 (menaikkan saldo) — membaliknya akan MENDEBIT 2-1100
    // sebesar itu, yang bisa membuat saldo CC ini negatif bila melebihi saldo berjalan.
    const liabBefore = await liab2100(cc.id);
    const created = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Koreksi tambah 2-1100 (akan coba dibalik setelah dana keluar)',
      costCenterId: cc.id,
      lines: [{ accountCode: '1-1200', debit: 50_000 }, { accountCode: '2-1100', credit: 50_000 }]
    });
    expect(created.status).toBe(201);
    // Kuras saldo 2-1100 CC ini hingga tersisa 10.000 (jurnal manual lain, dalam batas
    // saldo) — membalik jurnal `created` (Dr 2-1100 50.000) dari sisa 10.000 akan
    // mendorong saldo jadi negatif (-40.000), sehingga guard N-3 harus menolaknya.
    const drainAmount = liabBefore + 40_000;
    const drain = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Kuras saldo 2-1100 CC menyisakan 10.000',
      costCenterId: cc.id,
      lines: [{ accountCode: '2-1100', debit: drainAmount }, { accountCode: '1-1200', credit: drainAmount }]
    });
    expect(drain.status).toBe(201);
    const res = await request(app).post(`/v1/journals/${created.body.data.id}/reverse`).set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba balik walau akan negatif' });
    expect(res.status).toBe(400);
  });

  // Tugas lanjutan putaran 3 (pertanyaan no. 4 handoff 15): UNIQUE INDEX parsial
  // pada journals.reversal_of_journal_id sebagai pertahanan tambahan thd race.
  it('dua permintaan balik BERSAMAAN pada jurnal yang sama → hanya SATU jurnal pembalik tercatat; yang kalah 409 (bukan 500)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const created = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Uji balik konkuren',
      lines: [{ accountCode: '6-4000', debit: 300_000 }, { accountCode: '1-1200', credit: 300_000 }]
    });
    expect(created.status).toBe(201);
    const journalId = created.body.data.id as string;

    const [a, b] = await Promise.all([
      request(app).post(`/v1/journals/${journalId}/reverse`).set('Authorization', `Bearer ${keu}`).send({ reason: 'Balik konkuren A' }),
      request(app).post(`/v1/journals/${journalId}/reverse`).set('Authorization', `Bearer ${keu}`).send({ reason: 'Balik konkuren B' })
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const reversals = await db('journals').where({ reversal_of_journal_id: journalId });
    expect(reversals).toHaveLength(1);
  });
});

describe('POST /v1/transactions/commission', () => {
  it('3% × 141 jt = 4,23 jt via agentId (kalkulasi mockup Input Transaksi) → baris commissions terlacak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const res = await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${keu}`).send({
      agentId: agent.id, base: 141_000_000, pct: 3
    });
    expect(res.status).toBe(201);
    expect(res.body.data.totalDebit).toBe(4_230_000);
    const c = await db('commissions').where({ id: res.body.data.commissionId }).first();
    expect(c.status).toBe('approved');
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

describe('rekonsiliasi bank — sesi, pencocokan, penyesuaian, finalisasi', () => {
  const recon = (keu: string) =>
    request(app).get('/v1/bank-reconciliations').query({ bankAccountCode: '1-1200', month: '2026-06' }).set('Authorization', `Bearer ${keu}`);

  it('saldo koran independen dari buku besar → selisih NYATA (bukan tautologi)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const d = (await recon(keu)).body.data;
    expect(d.session.status).toBe('draft');
    expect(d.statementBalance).not.toBe(d.ledgerBalance); // angka koran independen
    expect(d.difference).not.toBe(0); // selisih nyata bisa ada
    expect(d.unexplained).toBe(0); // namun terjelaskan penuh oleh item pendamai
    expect(d.balanced).toBe(true);
    expect(d.canFinalize).toBe(false); // penyesuaian bank-only belum diposting
    expect(d.adjustments.bankOnlyIncome.some((a: { lineType: string }) => a.lineType === 'jasa_giro')).toBe(true);
    expect(d.adjustments.bankOnlyCharges.some((a: { lineType: string }) => a.lineType === 'biaya_adm')).toBe(true);
    expect(d.adjustments.depositsInTransit.length).toBeGreaterThanOrEqual(1);
  });

  it('closing keliru → unexplained ≠ 0 & balanced=false (deteksi selisih)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/bank-reconciliations').set('Authorization', `Bearer ${keu}`)
      .send({ bankAccountCode: '1-1210', period: '2026-06', statementDate: '2026-06-30', closingBalance: 123_456_789 });
    expect(res.status).toBe(201);
    expect(res.body.data.balanced).toBe(false);
    expect(res.body.data.unexplained).not.toBe(0);
  });

  it('posting penyesuaian → jurnal source=reconciliation, ledger bergerak; finalize lalu terkunci', async () => {
    const keu = await token('keuangan@safar.co.id');
    const d = (await recon(keu)).body.data;
    const sid = d.session.id;
    const giro = d.adjustments.bankOnlyIncome.find((a: { lineType: string }) => a.lineType === 'jasa_giro');
    const adm = d.adjustments.bankOnlyCharges.find((a: { lineType: string }) => a.lineType === 'biaya_adm');
    const ledger0 = d.ledgerBalance;

    // finalize ditolak sebelum penyesuaian diposting
    expect((await request(app).post(`/v1/bank-reconciliations/${sid}/finalize`).set('Authorization', `Bearer ${keu}`)).status).toBe(400);

    const a1 = await request(app).post(`/v1/bank-reconciliations/lines/${giro.id}/adjust`).set('Authorization', `Bearer ${keu}`);
    expect(a1.status).toBe(201);
    expect(a1.body.data.ledgerBalance).toBe(ledger0 + 62_000);

    const a2 = await request(app).post(`/v1/bank-reconciliations/lines/${adm.id}/adjust`).set('Authorization', `Bearer ${keu}`);
    expect(a2.body.data.ledgerBalance).toBe(ledger0 + 62_000 - 185_000);
    expect(a2.body.data.canFinalize).toBe(true);

    const jr = await request(app).get('/v1/journals').query({ source: 'reconciliation' }).set('Authorization', `Bearer ${keu}`);
    expect(jr.body.data.entries.length).toBeGreaterThanOrEqual(2);

    const fin = await request(app).post(`/v1/bank-reconciliations/${sid}/finalize`).set('Authorization', `Bearer ${keu}`);
    expect(fin.status).toBe(200);
    expect(fin.body.data.session.status).toBe('completed');
    expect(fin.body.data.session.reconciledBy).toBeTruthy();

    // mutasi setelah terkunci ditolak 409
    const anyLine = fin.body.data.lines.find((l: { status: string }) => l.status === 'matched');
    expect((await request(app).post(`/v1/bank-reconciliations/lines/${anyLine.id}/match`).set('Authorization', `Bearer ${keu}`).send({})).status).toBe(409);
  });

  it('entri manual + impor CSV dengan dedup externalRef', async () => {
    const keu = await token('keuangan@safar.co.id');
    const open = await request(app).post('/v1/bank-reconciliations').set('Authorization', `Bearer ${keu}`)
      .send({ bankAccountCode: '1-1100', period: '2026-07', statementDate: '2026-07-31', closingBalance: 0 });
    const sid = open.body.data.session.id;

    const add = await request(app).post(`/v1/bank-reconciliations/${sid}/lines`).set('Authorization', `Bearer ${keu}`)
      .send({ lineDate: '2026-07-05', description: 'Setoran tunai', amount: 500_000, lineType: 'setoran' });
    expect(add.status).toBe(201);
    expect(add.body.data.totalCount).toBe(1);

    const imp1 = await request(app).post(`/v1/bank-reconciliations/${sid}/import`).set('Authorization', `Bearer ${keu}`)
      .send({ rows: [
        { lineDate: '2026-07-06', description: 'Giro X', amount: 100_000, externalRef: 'TRX-1' },
        { lineDate: '2026-07-07', description: 'Giro Y', amount: 200_000, externalRef: 'TRX-2' }
      ] });
    expect(imp1.body.data.inserted).toBe(2);

    const imp2 = await request(app).post(`/v1/bank-reconciliations/${sid}/import`).set('Authorization', `Bearer ${keu}`)
      .send({ rows: [{ lineDate: '2026-07-06', description: 'Giro X (dup)', amount: 100_000, externalRef: 'TRX-1' }] });
    expect(imp2.body.data.inserted).toBe(0);
    expect(imp2.body.data.skipped).toBe(1);
  });

  it('RBAC: marketing tidak bisa membuka sesi (403)', async () => {
    const mkt = await token('marketing@safar.co.id');
    const res = await request(app).post('/v1/bank-reconciliations').set('Authorization', `Bearer ${mkt}`)
      .send({ bankAccountCode: '1-1200', period: '2026-08', statementDate: '2026-08-31', closingBalance: 0 });
    expect(res.status).toBe(403);
  });
});

describe('AK-03: rekonsiliasi completed mengunci posting ke periode terkunci', () => {
  const journalCount = async () =>
    Number((await db('journals').count<{ n: string }[]>('id as n').first())!.n);

  // Prasyarat: describe rekonsiliasi di atas sudah memfinalisasi 1-1200 periode 2026-06
  // (statement_date 2026-06-30). Rekening lain hanya punya sesi draft.
  it('jurnal menyentuh rekening terkunci bertanggal ≤ statement_date → 409, tidak tersimpan', async () => {
    const keu = await token('keuangan@safar.co.id');
    const before = await journalCount();
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-06-15', description: 'Backdate ke periode rekonsiliasi yang sudah terkunci',
      lines: [{ accountCode: '6-5000', debit: 250_000 }, { accountCode: '1-1200', credit: 250_000 }]
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/rekonsiliasi/i);
    expect(await journalCount()).toBe(before);
  });

  it('tanggal SETELAH statement_date tetap boleh — periode berjalan tidak ikut terkunci', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-07-02', description: 'Posting periode berjalan setelah rekonsiliasi Juni',
      lines: [{ accountCode: '6-5000', debit: 250_000 }, { accountCode: '1-1200', credit: 250_000 }]
    });
    expect(res.status).toBe(201);
  });

  it('rekening yang sesinya masih draft tidak ikut terkunci', async () => {
    const keu = await token('keuangan@safar.co.id');
    // 1-1100 (kas) hanya punya sesi draft 2026-07 → backdate Juni masih sah.
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-06-15', description: 'Backdate ke rekening yang belum difinalisasi',
      lines: [{ accountCode: '6-5000', debit: 50_000 }, { accountCode: '1-1100', credit: 50_000 }]
    });
    expect(res.status).toBe(201);
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

async function liab2100(costCenterId: string): Promise<number> {
  const [{ liab }] = await db('journal_lines as jl')
    .join('accounts as a', 'a.id', 'jl.account_id')
    .join('journals as j', 'j.id', 'jl.journal_id')
    .where('a.code', '2-1100').andWhere('j.cost_center_id', costCenterId)
    .select(db.raw('COALESCE(SUM(jl.credit - jl.debit), 0) AS liab'));
  return Number(liab);
}

describe('N-3: 2-1100 Uang Muka Jamaah per cost center tidak boleh negatif (jurnal manual)', () => {
  it('jurnal manual Dr 2-1100 melebihi saldo CC → 400, saldo tidak berubah (bekas bug refund AK-04)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-VIP-12' }).first();
    const liabBefore = await liab2100(cc.id);
    const over = liabBefore + 1_000_000;

    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-15', description: 'Refund jamaah batal (manual, uji N-3)', costCenterId: cc.id,
      lines: [{ accountCode: '2-1100', debit: over }, { accountCode: '1-1200', credit: over }]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('2-1100');
    expect(await liab2100(cc.id)).toBe(liabBefore); // tidak jadi negatif (N-3 lama)
  });

  it('jurnal manual menyentuh 2-1100 tanpa costCenterId ditolak (tidak bisa diverifikasi per-CC)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-15', description: 'Jurnal manual 2-1100 tanpa cost center',
      lines: [{ accountCode: '2-1100', debit: 100_000 }, { accountCode: '1-1200', credit: 100_000 }]
    });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/cost center/i);
  });

  it('koreksi manual dalam batas saldo CC tetap lolos (jalur sah tidak diblokir)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'CC-UMR-PLUS-TR' }).first();
    const liabBefore = await liab2100(cc.id);
    expect(liabBefore).toBeGreaterThan(1_000_000); // prasyarat: CC ini punya saldo besar dari seed

    const res = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-15', description: 'Koreksi kecil 2-1100 (uji N-3, dalam batas saldo)', costCenterId: cc.id,
      lines: [{ accountCode: '2-1100', debit: 100_000 }, { accountCode: '1-1200', credit: 100_000 }]
    });
    expect(res.status).toBe(201);
    expect(await liab2100(cc.id)).toBe(liabBefore - 100_000);
  });

  // R3SEC-01 (review putaran 3): guard N-3 membaca SUM tanpa mengunci cost center →
  // di bawah READ COMMITTED dua transaksi konkuren sama-sama melihat saldo LAMA dan
  // sama-sama lolos, sehingga 2-1100 per CC bisa jadi negatif. Perbaikan: postJournal
  // mengunci baris cost_centers (forUpdate) SEBELUM menghitung saldo.
  it('dua jurnal manual Dr 2-1100 BERSAMAAN pada CC sama → hanya satu lolos, saldo tidak pernah negatif', async () => {
    const keu = await token('keuangan@safar.co.id');
    const cc = await db('cost_centers').where({ code: 'MKT-KOMISI' }).first();
    const before = await liab2100(cc.id);

    // Naikkan saldo 100.000 supaya keadaan awal pasti diketahui.
    const topUp = await request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
      date: '2026-09-16', description: 'Top up 2-1100 utk uji konkurensi guard N-3', costCenterId: cc.id,
      lines: [{ accountCode: '1-1200', debit: 100_000 }, { accountCode: '2-1100', credit: 100_000 }]
    });
    expect(topUp.status).toBe(201);
    const avail = await liab2100(cc.id);
    expect(avail).toBe(before + 100_000);

    // Masing-masing menarik `avail - 40.000`: sendirian LOLOS (sisa 40.000),
    // berdua MUSTAHIL (sisa -(avail - 80.000) < 0).
    const each = avail - 40_000;
    const [a, b] = await Promise.all([
      request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
        date: '2026-09-16', description: 'Tarik 2-1100 konkuren A', costCenterId: cc.id,
        lines: [{ accountCode: '2-1100', debit: each }, { accountCode: '1-1200', credit: each }]
      }),
      request(app).post('/v1/journals').set('Authorization', `Bearer ${keu}`).send({
        date: '2026-09-16', description: 'Tarik 2-1100 konkuren B', costCenterId: cc.id,
        lines: [{ accountCode: '2-1100', debit: each }, { accountCode: '1-1200', credit: each }]
      })
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const after = await liab2100(cc.id);
    expect(after).toBe(40_000);
    expect(after).toBeGreaterThanOrEqual(0);
  });
});
