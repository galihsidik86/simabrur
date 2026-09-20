import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { terbilang } from '../../utils/terbilang.js';
import { buildSchedules, receivableStatus, agingBucket, invoiceNumber, vaNumber } from './payments.rules.js';
import { idempotencyConflicts, paymentsService } from './payments.service.js';

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

// ===== Unit =====
describe('terbilang', () => {
  it('contoh kwitansi mockup: 11,8 juta', () => {
    expect(terbilang(11_800_000)).toBe('Sebelas juta delapan ratus ribu rupiah');
  });
  it('kasus khusus seribu/seratus/sebelas', () => {
    expect(terbilang(1000)).toBe('Seribu rupiah');
    expect(terbilang(100)).toBe('Seratus rupiah');
    expect(terbilang(111)).toBe('Seratus sebelas rupiah');
    expect(terbilang(0)).toBe('Nol rupiah');
  });
  it('nilai besar', () => {
    expect(terbilang(245_000_000)).toBe('Dua ratus empat puluh lima juta rupiah');
    expect(terbilang(39_900_000)).toBe('Tiga puluh sembilan juta sembilan ratus ribu rupiah');
    expect(terbilang(1_500_000_000)).toBe('Satu miliar lima ratus juta rupiah');
  });
});

describe('buildSchedules', () => {
  it('cicil = DP + 5 termin, jumlah = total', () => {
    const lines = buildSchedules('cicil', 39_900_000, '2026-03-10', '2026-08-20');
    expect(lines).toHaveLength(6);
    expect(lines[0]).toMatchObject({ termNo: 0, amount: 5_000_000 });
    expect(lines[5].label).toContain('pelunasan');
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(39_900_000);
  });
  it('dp = 2 baris, pelunasan H-30 keberangkatan', () => {
    const lines = buildSchedules('dp', 28_500_000, '2026-04-02', '2026-08-12');
    expect(lines).toHaveLength(2);
    expect(lines[1].dueDate).toBe('2026-07-13');
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(28_500_000);
  });
  it('lunas = 1 baris penuh', () => {
    expect(buildSchedules('lunas', 62_000_000, '2026-01-01', '2026-09-03')).toHaveLength(1);
  });
});

describe('status piutang & aging bucket', () => {
  const T = '2026-07-17';
  it('aturan pill: Lunas / Terjadwal / Jatuh Tempo / Terlambat', () => {
    expect(receivableStatus(0, null, T)).toBe('Lunas');
    expect(receivableStatus(1, '2026-09-01', T)).toBe('Terjadwal');
    expect(receivableStatus(1, '2026-07-20', T)).toBe('Jatuh Tempo');
    expect(receivableStatus(1, '2026-07-10', T)).toBe('Jatuh Tempo'); // lewat 7 hari tepat
    expect(receivableStatus(1, '2026-07-09', T)).toBe('Terlambat'); // lewat 8 hari
  });
  it('bucket umur: batas 30/60 hari', () => {
    expect(agingBucket('2026-08-01', T)).toBe('belum');
    expect(agingBucket('2026-07-01', T)).toBe('d30');
    expect(agingBucket('2026-06-01', T)).toBe('d60');
    expect(agingBucket('2026-04-02', T)).toBe('d90');
  });
});

describe('penomoran invoice & VA', () => {
  it('INV menyematkan serial registrasi; VA pola 8801', () => {
    expect(invoiceNumber('UMR-2026-0418', '2026-06-10')).toBe('INV/2026/06/0418');
    expect(vaNumber('UMR-2026-0418')).toBe('8801 0418 0000 0418');
  });
});

// TS-02: existing bisa undefined setelah ON CONFLICT DO NOTHING (defensif); dan
// perbandingan replay invoice/nominal/termin harus persis, tak boleh longgar.
describe('idempotencyConflicts (TS-02)', () => {
  const existing = { invoice_id: 'inv-1', amount: '1000000', schedule_id: null };
  const input = { invoiceId: 'inv-1', amount: 1_000_000, scheduleId: null, bankAccountCode: '1-1200', method: 'transfer' as const };

  it('replay identik (invoice/nominal/termin sama) → bukan conflict', () => {
    expect(idempotencyConflicts(existing, input)).toBe(false);
  });
  it('invoice berbeda → conflict', () => {
    expect(idempotencyConflicts(existing, { ...input, invoiceId: 'inv-2' })).toBe(true);
  });
  it('nominal berbeda → conflict', () => {
    expect(idempotencyConflicts(existing, { ...input, amount: 500_000 })).toBe(true);
  });
  it('termin berbeda → conflict', () => {
    expect(idempotencyConflicts(existing, { ...input, scheduleId: 'sch-1' })).toBe(true);
  });
  it('existing undefined (row tak ditemukan saat re-fetch) → dianggap conflict, tidak crash', () => {
    expect(idempotencyConflicts(undefined, input)).toBe(true);
  });
});

// ===== Integrasi =====
describe('golden thread Hj. Siti Rohmah (angka mockup)', () => {
  it('kartu piutang: total 39,9 · terbayar 28,7 · sisa 11,2', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/receivables').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const siti = res.body.data.data.find((r: { regNumber: string }) => r.regNumber === 'UMR-2026-0418');
    expect(siti).toMatchObject({ total: 39_900_000, paid: 28_700_000, remaining: 11_200_000 });
    expect(['Jatuh Tempo', 'Terlambat']).toContain(siti.status);
  });

  it('dokumen invoice INV/2026/06/0418: derivasi line item 36,4 + 3,5', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first();
    const res = await request(app).get(`/v1/invoices/${inv.id}/document`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.number).toBe('INV/2026/06/0418');
    expect(d.vaNumber).toBe('8801 0418 0000 0418');
    expect(d.items[0].price).toBe(36_400_000);
    expect(d.items[1].price).toBe(3_500_000);
    expect(d.subtotal).toBe(39_900_000);
    expect(d.paid).toBe(28_700_000);
    expect(d.remaining).toBe(11_200_000);
    expect(d.schedules).toHaveLength(4);
  });

  it('dokumen kwitansi KWT/2026/06/1183: terbilang benar', async () => {
    const keu = await token('keuangan@safar.co.id');
    const rc = await db('receipts').where({ number: 'KWT/2026/06/1183' }).first();
    const res = await request(app).get(`/v1/receipts/${rc.id}/document`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.amount).toBe(11_800_000);
    expect(res.body.data.terbilang).toBe('Sebelas juta delapan ratus ribu rupiah');
    expect(res.body.data.summary).toMatchObject({ total: 39_900_000, paid: 28_700_000, remaining: 11_200_000 });
  });
});

describe('registrasi baru → invoice otomatis', () => {
  it('wizard mengembalikan invoiceId; skema cicil menghasilkan 6 termin', async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-AQ')
      .select('d.id')
      .first();
    const res = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'cicil', source: 'web',
      jamaah: {
        nik: '9911000000000001', fullName: 'UJI INVOICE OTOMATIS', gender: 'L', birthPlace: 'Bogor',
        birthDate: '1980-01-01', phone: '081255556666', address: 'Jl. Uji No. 3, Bogor',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081277778888',
        passportNo: 'X7654321', passportExpiry: '2030-06-01'
      }
    });
    expect(res.status).toBe(201);
    expect(res.body.data.invoiceId).toBeTruthy();

    const schedules = await db('payment_schedules').where({ registration_id: res.body.data.registrationId });
    expect(schedules).toHaveLength(6);
    expect(schedules.reduce((s, x) => s + Number(x.amount), 0)).toBe(44_500_000);
  });
});

describe('pembayaran: idempoten + verifikasi → kwitansi', () => {
  it('Idempotency-Key: kiriman ulang mengembalikan payment yang sama (200)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first();
    const sch = await db('payment_schedules').where({ registration_id: inv.registration_id, status: 'unpaid' }).first();
    const body = { invoiceId: inv.id, scheduleId: sch.id, bankAccountCode: '1-1200', amount: Number(sch.amount), method: 'va' };

    const first = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', 'uji-key-001').send(body);
    expect(first.status).toBe(201);
    const second = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', 'uji-key-001').send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  it('verifikasi: termin lunas, invoice paid, kwitansi terbit + terbilang; verifikasi ulang 409', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first();
    const payment = await db('payments').where({ idempotency_key: 'uji-key-001' }).first();

    const res = await request(app).patch(`/v1/payments/${payment.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.invoiceStatus).toBe('paid'); // 28,7 + 11,2 = 39,9 lunas
    expect(res.body.data.receipt.number).toMatch(/^KWT\/\d{4}\/\d{2}\/\d{4}$/);
    expect(res.body.data.receipt.terbilang).toBe('Sebelas juta dua ratus ribu rupiah');

    const sch = await db('payment_schedules').where({ id: payment.schedule_id }).first();
    expect(sch.status).toBe('paid');
    const invAfter = await db('invoices').where({ id: inv.id }).first();
    expect(invAfter.status).toBe('paid');

    const again = await request(app).patch(`/v1/payments/${payment.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(again.status).toBe(409);
  });

  it('RBAC: operasional tidak boleh mencatat pembayaran (403)', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).post('/v1/payments').set('Authorization', `Bearer ${ops}`).send({});
    expect(res.status).toBe(403);
  });
});

describe('GET /v1/receivables/aging', () => {
  it('bucket >60 hari berisi Ahmad Zaki (sisa 8,5 Jt)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/receivables/aging').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.buckets.d90.amount).toBeGreaterThanOrEqual(8_500_000);
    const zaki = res.body.data.rows.find((r: { regNumber: string }) => r.regNumber === 'UMR-2026-0402');
    expect(zaki.remaining).toBe(8_500_000);
    expect(zaki.agingBucket).toBe('d90');
  });
});

describe('pengaman pembayaran (audit fixes)', () => {
  it('pembayaran via rekening valas ditolak (invoice IDR)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ status: 'unpaid' }).first();
    const res = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: inv.id, bankAccountCode: '1-1210', amount: 1_000_000, method: 'transfer' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('IDR');
  });

  it('nominal melebihi sisa tagihan ditolak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first(); // sudah lunas
    const res = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: inv.id, bankAccountCode: '1-1200', amount: 5_000_000, method: 'transfer' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/melebihi sisa tagihan/i);
  });

  it('token portal ditolak di endpoint staf (cegah IDOR invoice lintas jamaah)', async () => {
    const login = await request(app)
      .post('/v1/portal/login')
      .send({ regNumber: 'UMR-2026-0418', nik: '3175012345670003' });
    expect(login.status).toBe(200);
    const portalToken = login.body.data.token;
    const inv = await db('invoices').first();
    const res = await request(app)
      .get(`/v1/invoices/${inv.id}/document`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(res.status).toBe(403);
  });
});

describe('guard: pembayaran pending ganda tidak boleh over-credit 2-1100', () => {
  it('dua pembayaran pending penuh lolos createPayment, verifikasi kedua ditolak (409)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-AQ')
      .select('d.id')
      .first();
    // Registrasi baru → invoice terdedikasi (lunas)
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'lunas', source: 'web',
      jamaah: {
        nik: '9911000000000009', fullName: 'UJI DOBEL PENDING', gender: 'L', birthPlace: 'Bogor',
        birthDate: '1981-02-02', phone: '081255550009', address: 'Jl. Uji No. 9, Bogor',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081277770009',
        passportNo: 'X7654329', passportExpiry: '2030-06-01'
      }
    });
    expect(reg.status).toBe(201);
    const inv = await db('invoices').where({ id: reg.body.data.invoiceId }).first();
    const total = Number(inv.total_amount);
    const body = { invoiceId: inv.id, bankAccountCode: '1-1200', amount: total, method: 'transfer' };

    // Dua pembayaran penuh sama-sama lolos saat pending (verified masih 0)
    const p1 = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).send(body);
    const p2 = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).send(body);
    expect(p1.status).toBe(201);
    expect(p2.status).toBe(201);

    // Verifikasi pertama OK; kedua ditolak oleh guard kumulatif → tidak dobel-kredit 2-1100
    const v1 = await request(app).patch(`/v1/payments/${p1.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(v1.status).toBe(200);
    const v2 = await request(app).patch(`/v1/payments/${p2.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(v2.status).toBe(409);

    // Hanya satu jurnal penerimaan terposting utk invoice ini
    const receipts = await db('receipts as rc')
      .join('payments as pm', 'pm.id', 'rc.payment_id')
      .where('pm.invoice_id', inv.id);
    expect(receipts).toHaveLength(1);
  });
});

describe('FE-01: Idempotency-Key tidak boleh dipakai ulang utk pembayaran BERBEDA', () => {
  it('replay payload sama → 200 payment lama; key sama + amount/termin beda → 409, baris payments tidak bertambah', async () => {
    const keu = await token('keuangan@safar.co.id');
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-AQ')
      .select('d.id')
      .first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'lunas', source: 'web',
      jamaah: {
        nik: '9922000000000009', fullName: 'UJI FE-01 IDEMPOTENCY', gender: 'L', birthPlace: 'Bekasi',
        birthDate: '1979-03-03', phone: '081200009999', address: 'Jl. Uji FE-01',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081300009999',
        passportNo: 'FE01A001', passportExpiry: '2030-01-01'
      }
    });
    expect(reg.status).toBe(201);
    const invId = reg.body.data.invoiceId as string;
    const sch = await db('payment_schedules').where({ registration_id: reg.body.data.registrationId }).first();
    const key = `uji-fe01-${invId}`;
    const body = { invoiceId: invId, bankAccountCode: '1-1200', amount: 1_000_000, method: 'transfer' };

    const first = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', key).send(body);
    expect(first.status).toBe(201);
    const countBefore = await db('payments').count<{ n: string }[]>('id as n').first();

    // Replay dengan payload PERSIS SAMA → perilaku tetap (200, payment lama) — tidak berubah
    const replaySame = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', key).send(body);
    expect(replaySame.status).toBe(200);
    expect(replaySame.body.data.id).toBe(first.body.data.id);

    // Key sama, nominal BEDA → 409 (dulu: replay diam-diam mengembalikan payment Termin 1,
    // pembayaran ke-2 hilang tanpa error — FE-01)
    const conflictAmount = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', key)
      .send({ ...body, amount: 2_000_000 });
    expect(conflictAmount.status).toBe(409);
    expect(conflictAmount.body.error.message).toMatch(/Idempotency-Key sudah dipakai untuk pembayaran lain/i);

    // Key sama, scheduleId BEDA → 409
    const conflictSchedule = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`).set('Idempotency-Key', key)
      .send({ ...body, scheduleId: sch.id });
    expect(conflictSchedule.status).toBe(409);

    const countAfter = await db('payments').count<{ n: string }[]>('id as n').first();
    expect(Number(countAfter?.n)).toBe(Number(countBefore?.n)); // 409 tidak menambah baris payments
  });
});

describe('N-2: rincian item dokumen invoice memakai harga BEKU, bukan harga paket terkini', () => {
  it('ubah basePrice/tripleUpcharge paket setelah invoice terbit → rincian dokumen tidak berubah, Σ item = total_amount', async () => {
    const adm = await token('admin@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const keu = await token('keuangan@safar.co.id');

    const pkgRes = await request(app).post('/v1/packages').set('Authorization', `Bearer ${adm}`).send({
      code: 'VERIF-N2', name: 'Paket Uji N-2', type: 'umrah', category: 'reguler', durationDays: 9,
      basePrice: 20_000_000, departure: { departureDate: '2026-11-20', quota: 10 }
    });
    expect(pkgRes.status).toBe(201);
    const pkgId = pkgRes.body.data.id ?? (await db('packages').where({ code: 'VERIF-N2' }).first()).id;
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'VERIF-N2').select('d.id').first();

    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'triple', paymentScheme: 'lunas',
      jamaah: {
        nik: '9922000000000010', fullName: 'UJI N-2 RINCIAN INVOICE', gender: 'L', birthPlace: 'Depok',
        birthDate: '1985-05-05', phone: '081200002222', address: 'Jl. Uji N-2',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081300002222',
        passportNo: 'N2000001', passportExpiry: '2030-01-01'
      }
    });
    expect(reg.status).toBe(201);
    const invId = reg.body.data.invoiceId as string;

    const before = await request(app).get(`/v1/invoices/${invId}/document`).set('Authorization', `Bearer ${keu}`);
    expect(before.status).toBe(200);
    expect(before.body.data.items[0].price).toBe(20_000_000); // base_price beku
    expect(before.body.data.items[1].price).toBe(3_500_000); // tripleUpcharge default beku
    expect(before.body.data.subtotal).toBe(23_500_000);

    const upd = await request(app).put(`/v1/packages/${pkgId}`).set('Authorization', `Bearer ${mkt}`)
      .send({ basePrice: 30_000_000, tripleUpcharge: 9_000_000 });
    expect(upd.status).toBe(200);

    const after = await request(app).get(`/v1/invoices/${invId}/document`).set('Authorization', `Bearer ${keu}`);
    expect(after.status).toBe(200);
    expect(after.body.data.items[0].price).toBe(20_000_000); // TIDAK berubah (N-2 fix)
    expect(after.body.data.items[1].price).toBe(3_500_000); // TIDAK berubah (N-2 fix)
    expect(after.body.data.subtotal).toBe(23_500_000);

    const itemSum = after.body.data.items.reduce((s: number, it: { price: number; qty: number }) => s + it.price * it.qty, 0);
    const invRow = await db('invoices').where({ id: invId }).first();
    expect(itemSum).toBe(Number(invRow.total_amount)); // Σ item = total_amount
  });

  it('golden thread (baris invoice LAMA, backfill migrasi): Σ item tetap = total_amount', async () => {
    const keu = await token('keuangan@safar.co.id');
    const inv = await db('invoices').where({ number: 'INV/2026/06/0418' }).first();
    const res = await request(app).get(`/v1/invoices/${inv.id}/document`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    const itemSum = res.body.data.items.reduce((s: number, it: { price: number; qty: number }) => s + it.price * it.qty, 0);
    expect(itemSum).toBe(Number(inv.total_amount));
  });
});

describe('AK-02: tanggal default kwitansi & jurnal memakai kalender WIB, bukan UTC', () => {
  it('verifikasi jam 2027-01-01 02:00 WIB (= 2026-12-31 19:00 UTC) → kwitansi & jurnal 2027-01-01 / JV-2027', async () => {
    // Fixture dibuat pada jam SUNGGUHAN (bukan bagian yang diuji) — hanya verifikasi
    // pembayaran di bawah ini yang perlu jam dipalsukan.
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT')
      .select('d.id')
      .first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9922000000000012', fullName: 'UJI AK-02 VERIFIKASI', gender: 'L', birthPlace: 'Solo', birthDate: '1975-01-01',
        phone: '081200001234', address: 'Jl. Uji AK-02 Verifikasi', emergencyContactName: 'Kel', emergencyContactPhone: '081300001234',
        passportNo: 'AK02V001', passportExpiry: '2030-01-01'
      }
    });
    expect(reg.status).toBe(201);
    const invId = reg.body.data.invoiceId as string;
    const sch = await db('payment_schedules')
      .where({ registration_id: reg.body.data.registrationId, status: 'unpaid' })
      .orderBy('term_no')
      .first();

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2027-01-01T02:00:00+07:00'));
    const keu = await token('keuangan@safar.co.id'); // login SETELAH jam dipalsukan
    const created = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: invId, scheduleId: sch.id, bankAccountCode: '1-1200', amount: Number(sch.amount), method: 'va' });
    expect(created.status).toBe(201);
    const ver = await request(app).patch(`/v1/payments/${created.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(ver.status).toBe(200);
    expect(ver.body.data.receipt.issued_date).toBe('2027-01-01');
    expect(ver.body.data.receipt.number).toMatch(/^KWT\/2027\/01\//);
    expect(ver.body.data.journal.journalNo).toMatch(/^JV-2027-/);
    const journal = await db('journals').where({ id: ver.body.data.journal.id }).first();
    expect(journal.date).toBe('2027-01-01');
  });

  it('registrasi publik jam 2026-10-01 03:00 WIB (= 2026-09-30 20:00 UTC) → invoice bertanggal 2026-10-01, INV/2026/10', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T03:00:00+07:00'));
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-AQ')
      .select('d.id')
      .first();
    const res = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9922000000000011', fullName: 'UJI AK-02 TANGGAL', gender: 'L', birthPlace: 'Bogor', birthDate: '1980-01-01',
        phone: '081255556677', address: 'Jl. Uji AK-02', emergencyContactName: 'Kel', emergencyContactPhone: '081277778899',
        passportNo: 'AK02B001', passportExpiry: '2030-06-01'
      }
    });
    expect(res.status).toBe(201);
    const inv = await db('invoices').where({ id: res.body.data.invoiceId }).first();
    expect(inv.issued_date).toBe('2026-10-01');
    expect(inv.number).toMatch(/^INV\/2026\/10\//);
  });
});

describe('AK-02 (sisi SQL): KPI "terkumpul bulan ini" memakai kalender Asia/Jakarta, bukan TZ sesi Postgres', () => {
  it('pembayaran WIB 2026-10-01 00:30 (= 2026-09-30 17:30 UTC, paid_at naif) ikut terhitung bulan Oktober', async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT')
      .select('d.id')
      .first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9922000000000097', fullName: 'UJI AK-02 SQL KOLEKSI', gender: 'L', birthPlace: 'Bogor', birthDate: '1980-01-01',
        phone: '081200009997', address: 'Jl. Uji AK-02 SQL Koleksi', emergencyContactName: 'Kel', emergencyContactPhone: '081300009997',
        passportNo: 'AK02SQLK', passportExpiry: '2030-06-01'
      }
    });
    expect(reg.status).toBe(201);
    const sch = await db('payment_schedules')
      .where({ registration_id: reg.body.data.registrationId, status: 'unpaid' })
      .orderBy('term_no')
      .first();
    const keu = await token('keuangan@safar.co.id');
    // paid_at eksplisit WIB 00:30 tgl 1 (kolom `timestamp` naif — disimpan sbg
    // wall-clock UTC-nya, 2026-09-30 17:30, oleh Postgres saat parsing offset +07:00).
    const created = await request(app).post('/v1/payments').set('Authorization', `Bearer ${keu}`)
      .send({
        invoiceId: reg.body.data.invoiceId, scheduleId: sch.id, bankAccountCode: '1-1200',
        amount: Number(sch.amount), method: 'va', paidAt: '2026-10-01T00:30:00+07:00'
      });
    expect(created.status).toBe(201);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T04:00:00Z')); // jelas Oktober di WIB maupun UTC
    const before = (await paymentsService.receivables()).kpi.collectedThisMonth;
    // Token BARU setelah jam dipalsukan — token lama bisa lewat `exp` JWT-nya
    // karena jam sistem melompat maju (pola sama seperti tes AK-02 lain di atas).
    const keuAfterFake = await token('keuangan@safar.co.id');
    const verified = await request(app).patch(`/v1/payments/${created.body.data.id}/verify`).set('Authorization', `Bearer ${keuAfterFake}`);
    expect(verified.status).toBe(200);
    const after = (await paymentsService.receivables()).kpi.collectedThisMonth;
    vi.useRealTimers();
    expect(after).toBe(before + Number(sch.amount));
  });
});
