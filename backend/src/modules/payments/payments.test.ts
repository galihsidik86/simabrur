import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { terbilang } from '../../utils/terbilang.js';
import { buildSchedules, receivableStatus, agingBucket, invoiceNumber, vaNumber } from './payments.rules.js';

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
