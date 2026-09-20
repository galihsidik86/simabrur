import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { financeReportsService } from './finance.service.js';

const app = createApp();

beforeAll(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.destroy();
});

afterEach(() => {
  vi.useRealTimers();
});

async function token(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

describe('laporan keuangan', () => {
  it('laba rugi terhitung dari jurnal; setelah pengakuan pendapatan strukturnya benar', async () => {
    const keu = await token('keuangan@safar.co.id');
    // Posting pengakuan pendapatan + HPP + komisi agar laporan berisi
    const cc = await db('cost_centers').where({ code: 'CC-UMR-REG-9' }).first();
    // AK-01: HPP mereklas Uang Muka Vendor 1-1400 — sediakan DP vendor dulu utk CC
    // ini (seed hanya memberi DP vendor ke CC-UMR-PLUS-TR).
    await request(app).post('/v1/transactions/expense').set('Authorization', `Bearer ${keu}`).send({
      vendorName: 'Vendor Uji Laporan', costCenterId: cc.id, sourceBankCode: '1-1200',
      lines: [{ accountCode: '1-1400', amount: 22_000_000 }]
    });
    await request(app).post('/v1/transactions/revenue-recognition').set('Authorization', `Bearer ${keu}`).send({
      costCenterId: cc.id, revenueAccountCode: '4-1000', amount: 30_000_000,
      hpp: [{ accountCode: '5-2000', amount: 10_000_000 }, { accountCode: '5-1000', amount: 9_000_000 }, { accountCode: '5-3000', amount: 3_000_000 }]
    });

    const res = await request(app).get('/v1/reports/income-statement').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const { lines, netIncome } = res.body.data;
    const find = (label: string) => lines.find((l: { label: string }) => l.label === label);
    expect(find('Total Pendapatan').amount).toBe(30_000_000);
    expect(find('Total HPP').amount).toBe(22_000_000);
    expect(find('Laba Kotor').amount).toBe(8_000_000); // contoh COA: 30 − 22 = 8 jt
    // Komisi seed 4,23 jt masuk beban operasional
    expect(find('Total Beban Operasional').amount).toBeGreaterThanOrEqual(4_230_000);
    expect(find('Laba Bersih').amount).toBe(netIncome);
  });

  it('neraca SEIMBANG: Total Aset = Liabilitas + Ekuitas', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/reports/balance-sheet').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.balanced).toBe(true);
    expect(res.body.data.assets.total).toBe(res.body.data.liabilitiesEquity.total);
    expect(res.body.data.assets.total).toBeGreaterThan(0);
  });

  it('laba per paket: margin & total konsisten', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/reports/profit-by-package').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const { packages, total } = res.body.data;
    const reguler = packages.find((p: { name: string }) => p.name === 'Reguler 9 Hari');
    expect(reguler.revenue).toBe(30_000_000);
    expect(reguler.grossProfit).toBe(8_000_000);
    expect(total.grossProfit).toBe(packages.reduce((s: number, p: { grossProfit: number }) => s + p.grossProfit, 0));
  });

  it('dashboard: KPI + chart 6 bulan + keberangkatan mendatang', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/reports/dashboard').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.cashflow).toHaveLength(6);
    expect(d.kpi.jamaahActive).toBeGreaterThanOrEqual(14);
    expect(d.kpi.cashAndBank).toBeGreaterThan(0);
    expect(d.upcoming.length).toBeGreaterThan(0);
  });

  it('ekspor Excel laporan keuangan', async () => {
    const keu = await token('keuangan@safar.co.id');
    for (const report of ['income-statement', 'balance-sheet', 'profit']) {
      const res = await request(app).get('/v1/reports/export').query({ report }).set('Authorization', `Bearer ${keu}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
    }
  });
});

describe('AK-02: default periode laporan memakai kalender WIB, bukan UTC', () => {
  it('incomeStatement()/balanceSheet() pada 2026-09-30T17:00Z (= 2026-10-01 00:00 WIB) → sudah tanggal Oktober', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T17:00:00Z'));
    const { period } = await financeReportsService.incomeStatement();
    expect(period.to).toBe('2026-10-01');
    const bs = await financeReportsService.balanceSheet();
    expect(bs.asOf).toBe('2026-10-01');
  });

  it('16:59 UTC (masih 2026-09-30 23:59 WIB) → belum berganti hari', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T16:59:00Z'));
    const { period } = await financeReportsService.incomeStatement();
    expect(period.to).toBe('2026-09-30');
  });

  it('dashboard(): chart 6 bulan & bulan berjalan mengikuti kalender WIB (bug lama: mencampur setMonth lokal & toISOString UTC)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T17:00:00Z')); // = 2026-10-01 00:00 WIB
    const dash = await financeReportsService.dashboard();
    expect(dash.cashflow).toHaveLength(6);
    const expectedLastMonth = new Date('2026-10-01T00:00:00Z').toLocaleDateString('id-ID', { month: 'short' });
    expect(dash.cashflow.at(-1)?.month).toBe(expectedLastMonth);
  });
});

describe('AK-02 (sisi SQL): KPI "jamaah baru bulan ini" memakai kalender Asia/Jakarta, bukan TZ sesi Postgres', () => {
  it('registrasi created_at UTC 2026-09-30T17:30Z (= WIB 2026-10-01 00:30) dihitung sbg bulan Oktober', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T04:00:00Z')); // jelas Oktober di WIB maupun UTC
    const before = (await financeReportsService.dashboard()).kpi.jamaahNewThisMonth;

    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT')
      .select('d.id')
      .first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9922000000000098', fullName: 'UJI AK-02 SQL DASHBOARD', gender: 'L', birthPlace: 'Bogor', birthDate: '1980-01-01',
        phone: '081200009998', address: 'Jl. Uji AK-02 SQL', emergencyContactName: 'Kel', emergencyContactPhone: '081300009998',
        passportNo: 'AK02SQLD', passportExpiry: '2030-06-01'
      }
    });
    expect(reg.status).toBe(201);
    // created_at DEFAULT diisi Postgres real-time (bukan JS Date yang dipalsukan) —
    // timpa langsung agar mensimulasikan registrasi tepat di jendela WIB 00:00–06:59.
    await db('registrations').where({ id: reg.body.data.registrationId }).update({ created_at: '2026-09-30T17:30:00Z' });

    const after = (await financeReportsService.dashboard()).kpi.jamaahNewThisMonth;
    expect(after).toBe(before + 1);
  });
});

describe('portal jamaah', () => {
  let portalToken = '';

  it('login dgn nomor registrasi + NIK; NIK salah ditolak', async () => {
    const siti = await db('jamaah').where({ full_name: 'Hj. Siti Rohmah' }).first();
    const bad = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-0418', nik: '9999999999999999' });
    expect(bad.status).toBe(401);

    const res = await request(app).post('/v1/portal/login').send({ regNumber: 'umr-2026-0418', nik: siti.nik });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Hj. Siti Rohmah');
    portalToken = res.body.data.token;
  });

  it('GET /portal/me: golden thread lengkap (trip, progress, termin, dokumen, checklist)', async () => {
    const res = await request(app).get('/v1/portal/me').set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.trip).toMatchObject({ packageName: 'Plus Turki', groupName: 'Grup B', roomType: 'triple', roomNumber: '511' });
    expect(d.trip.muthawwif).toContain('Ust. Fadhil');
    expect(d.progress.documents.pct).toBe(80); // 4 dari 5 (portal mockup)
    expect(d.progress.payment.pct).toBe(72); // 28,7 / 39,9 (portal mockup)
    expect(d.payment.schedules).toHaveLength(4);
    expect(d.payment.remaining).toBe(11_200_000);
    expect(d.documents.find((x: { type: string }) => x.type === 'VKS').status).toBe('missing');
    expect(d.checklist.filter((c: { isDone: boolean }) => c.isDone)).toHaveLength(2);
    expect(d.actions.length).toBeGreaterThanOrEqual(2); // termin + VKS (mockup "Perlu Tindakan")
    expect(d.payment.vaNumber).toBe('8801 0418 0000 0418');
  });

  it('dokumen invoice portal hanya milik sendiri', async () => {
    const res = await request(app).get('/v1/portal/invoice-document').set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.number).toBe('INV/2026/06/0418');
  });

  it('token staf tidak berlaku utk portal; tanpa token 401', async () => {
    const keu = await token('keuangan@safar.co.id');
    expect((await request(app).get('/v1/portal/me').set('Authorization', `Bearer ${keu}`)).status).toBe(401);
    expect((await request(app).get('/v1/portal/me')).status).toBe(401);
  });
});

describe('administrasi (admin-only)', () => {
  it('audit log: berisi jejak aksi + pagination; non-admin 403', async () => {
    const adm = await token('admin@safar.co.id');
    const res = await request(app).get('/v1/audit-logs?limit=10').set('Authorization', `Bearer ${adm}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThan(0);
    expect(res.body.data[0]).toHaveProperty('action');

    const keu = await token('keuangan@safar.co.id');
    expect((await request(app).get('/v1/audit-logs').set('Authorization', `Bearer ${keu}`)).status).toBe(403);
  });

  it('users: list, create, toggle aktif', async () => {
    const adm = await token('admin@safar.co.id');
    const list = await request(app).get('/v1/users').set('Authorization', `Bearer ${adm}`);
    expect(list.body.data.length).toBeGreaterThanOrEqual(5);

    const created = await request(app).post('/v1/users').set('Authorization', `Bearer ${adm}`)
      .send({ name: 'Staf Uji', email: 'uji@safar.co.id', password: 'rahasia123', role: 'operasional' });
    expect(created.status).toBe(201);

    const toggled = await request(app).patch(`/v1/users/${created.body.data.id}/toggle-active`).set('Authorization', `Bearer ${adm}`);
    expect(toggled.body.data.is_active).toBe(false);

    // user nonaktif tidak bisa login
    const login = await request(app).post('/v1/auth/login').send({ email: 'uji@safar.co.id', password: 'rahasia123' });
    expect(login.status).toBe(401);
  });
});
