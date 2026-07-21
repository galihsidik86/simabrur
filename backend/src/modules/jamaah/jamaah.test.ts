import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { ageAt, isPassportValid, needsMahram, passportValidUntilLimit, regNumberKey } from './jamaah.rules.js';

const app = createApp();

beforeAll(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.destroy();
});

// ===== Unit: aturan bisnis murni =====
describe('aturan paspor ≥ 7 bulan', () => {
  it('menghitung batas minimal berlaku', () => {
    expect(passportValidUntilLimit('2026-08-20').toISOString().slice(0, 10)).toBe('2027-03-20');
  });
  it('valid tepat di batas, tidak valid sehari sebelumnya', () => {
    expect(isPassportValid('2027-03-20', '2026-08-20')).toBe(true);
    expect(isPassportValid('2027-03-19', '2026-08-20')).toBe(false);
  });
});

describe('aturan mahram (P < 45 th saat keberangkatan)', () => {
  it('wajib untuk perempuan 31 th, tidak untuk 49 th, tidak untuk laki-laki', () => {
    expect(needsMahram('P', '1995-01-17', '2026-08-12')).toBe(true);
    expect(needsMahram('P', '1977-05-21', '2026-08-20')).toBe(false);
    expect(needsMahram('L', '1999-06-25', '2026-08-12')).toBe(false);
  });
  it('umur dihitung pada tanggal keberangkatan (belum/sudah ulang tahun)', () => {
    expect(ageAt('1981-09-01', '2026-08-20')).toBe(44); // ultah setelah berangkat
    expect(ageAt('1981-08-01', '2026-08-20')).toBe(45);
  });
});

describe('kunci penomoran registrasi', () => {
  it('UMR/HAJ + tahun keberangkatan', () => {
    expect(regNumberKey('umrah', '2026-08-20')).toBe('UMR-2026');
    expect(regNumberKey('haji', '2027-05-28')).toBe('HAJ-2027');
  });
});

// ===== Integrasi =====
async function token(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

function jamaahPayload(nik: string, overrides: Record<string, unknown> = {}) {
  return {
    nik,
    fullName: 'TEST JAMAAH BARU',
    gender: 'L',
    birthPlace: 'Jakarta',
    birthDate: '1990-01-01',
    phone: '081200001111',
    address: 'Jl. Test No. 1, Jakarta',
    emergencyContactName: 'Keluarga Test',
    emergencyContactPhone: '081300001111',
    passportNo: 'X1234567',
    passportExpiry: '2030-01-01',
    ...overrides
  };
}

describe('POST /v1/registrations (wizard publik)', () => {
  let plusTurkiDepId: string;

  beforeAll(async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-TR')
      .select('d.id')
      .first();
    plusTurkiDepId = dep.id;
  });

  it('mendaftarkan jamaah baru: nomor UMR-2026-05xx, kuota bertambah, harga sesuai kamar', async () => {
    const before = await db('departures').where({ id: plusTurkiDepId }).first();
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'triple', paymentScheme: 'cicil', jamaah: jamaahPayload('9900000000000001') });
    expect(res.status).toBe(201);
    expect(res.body.data.regNumber).toMatch(/^UMR-2026-05\d{2}$/);
    expect(res.body.data.totalPrice).toBe(39_900_000 + 3_500_000);
    const after = await db('departures').where({ id: plusTurkiDepId }).first();
    expect(after.seats_taken).toBe(before.seats_taken + 1);
  });

  it('menolak paspor < 7 bulan setelah keberangkatan', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload('9900000000000002', { passportExpiry: '2026-12-01' }) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Paspor tidak memenuhi syarat');
  });

  it('menolak perempuan < 45 th tanpa mahram', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload('9900000000000003', { gender: 'P', birthDate: '1998-04-01' }) });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('mahram');
  });

  it('menolak NIK yang sama mendaftar dua kali di keberangkatan yang sama', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload('9900000000000001') });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('sudah terdaftar');
  });

  it('menolak saat kuota penuh (409)', async () => {
    const adminToken = await token('admin@safar.co.id');
    const pkgRes = await request(app)
      .post('/v1/packages')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'TEST-QUOTA-1',
        name: 'Paket Uji Kuota',
        type: 'umrah',
        category: 'reguler',
        durationDays: 9,
        basePrice: 20_000_000,
        departure: { departureDate: '2026-11-11', quota: 1 }
      });
    expect(pkgRes.status).toBe(201);
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'TEST-QUOTA-1')
      .select('d.id')
      .first();

    const first = await request(app)
      .post('/v1/registrations')
      .send({ departureId: dep.id, roomType: 'quad', paymentScheme: 'lunas', jamaah: jamaahPayload('9900000000000004') });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/v1/registrations')
      .send({ departureId: dep.id, roomType: 'quad', paymentScheme: 'lunas', jamaah: jamaahPayload('9900000000000005') });
    expect(second.status).toBe(409);
    expect(second.body.error.message).toContain('penuh');
  });
});

describe('GET /v1/registrations/passport-check', () => {
  it('memberi batas minimal & status valid', async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-TR')
      .select('d.id')
      .first();
    const okRes = await request(app).get('/v1/registrations/passport-check').query({ departureId: dep.id, expiry: '2027-09-30' });
    expect(okRes.body.data).toMatchObject({ valid: true, minValidUntil: '2027-03-20' });
    const badRes = await request(app).get('/v1/registrations/passport-check').query({ departureId: dep.id, expiry: '2026-10-01' });
    expect(badRes.body.data.valid).toBe(false);
  });
});

describe('dokumen: unggah & verifikasi', () => {
  it('unggah (publik) → verifikasi oleh operasional; marketing ditolak 403', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const up = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .field('docType', 'KTP')
      .attach('file', Buffer.from('%PDF-1.4 test'), 'ktp.pdf');
    expect(up.status).toBe(201);
    expect(up.body.data.status).toBe('pending');

    const mkt = await token('marketing@safar.co.id');
    const forbidden = await request(app)
      .patch(`/v1/documents/${up.body.data.id}/verify`)
      .set('Authorization', `Bearer ${mkt}`)
      .send({ status: 'verified' });
    expect(forbidden.status).toBe(403);

    const ops = await token('ops@safar.co.id');
    const verified = await request(app)
      .patch(`/v1/documents/${up.body.data.id}/verify`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ status: 'verified' });
    expect(verified.status).toBe(200);
    expect(verified.body.data.status).toBe('verified');
    expect(verified.body.data.verified_at).toBeTruthy();
  });

  it('registrasi menjadi aktif saat 5 dokumen wajib terverifikasi', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const ops = await token('ops@safar.co.id');
    for (const docType of ['KK', 'PPR', 'FTO', 'VKS']) {
      const up = await request(app)
        .post(`/v1/jamaah/${jamaahRow.id}/documents`)
        .field('docType', docType)
        .attach('file', Buffer.from('%PDF-1.4 test'), `${docType.toLowerCase()}.pdf`);
      await request(app)
        .patch(`/v1/documents/${up.body.data.id}/verify`)
        .set('Authorization', `Bearer ${ops}`)
        .send({ status: 'verified' });
    }
    const reg = await db('registrations').where({ jamaah_id: jamaahRow.id }).first();
    expect(reg.status).toBe('active');
  });
});

describe('GET /v1/jamaah (tabel admin)', () => {
  it('mengembalikan badge 5 dokumen + meta pagination', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/jamaah?limit=5').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(14);
    expect(res.body.data[0].docs).toHaveLength(5);
  });

  it('tab dokumen hanya berisi jamaah dgn dokumen wajib belum lengkap', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/jamaah?tab=dokumen&limit=50').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data) expect(row.docsComplete).toBe(false);
  });

  it('menolak akses tanpa login', async () => {
    expect((await request(app).get('/v1/jamaah')).status).toBe(401);
  });
});

describe('PATCH /v1/jamaah/:id (edit profil oleh operasional)', () => {
  it('mengubah nama & HP, mencatat audit log; marketing ditolak 403', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();

    const mkt = await token('marketing@safar.co.id');
    const forbidden = await request(app)
      .patch(`/v1/jamaah/${jamaahRow.id}`)
      .set('Authorization', `Bearer ${mkt}`)
      .send({ fullName: 'Nama Baru' });
    expect(forbidden.status).toBe(403);

    const ops = await token('ops@safar.co.id');
    const res = await request(app)
      .patch(`/v1/jamaah/${jamaahRow.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ fullName: 'Euis Ratnaningsih', phone: '08139530633', mahramName: 'R Dede Atmawijaya' });
    expect(res.status).toBe(200);
    expect(res.body.data.full_name).toBe('Euis Ratnaningsih');
    expect(res.body.data.phone).toBe('08139530633');
    expect(res.body.data.mahram_name).toBe('R Dede Atmawijaya');

    const log = await db('audit_logs')
      .where({ entity: 'jamaah', entity_id: jamaahRow.id, action: 'jamaah.update' })
      .orderBy('id', 'desc')
      .first();
    expect(log).toBeTruthy();
    expect(log.old_values.full_name).toBe(jamaahRow.full_name);
    expect(log.new_values.phone).toBe('08139530633');
  });

  it('menolak body kosong (400) dan id tak dikenal (404)', async () => {
    const ops = await token('ops@safar.co.id');
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    expect(
      (await request(app).patch(`/v1/jamaah/${jamaahRow.id}`).set('Authorization', `Bearer ${ops}`).send({})).status
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch('/v1/jamaah/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${ops}`)
          .send({ fullName: 'Siapa Saja' })
      ).status
    ).toBe(404);
  });
});

describe('keamanan upload dokumen (audit fixes)', () => {
  it('menolak path traversal pada :id (id non-UUID) tanpa menulis file', async () => {
    const res = await request(app)
      .post('/v1/jamaah/..%2F..%2F..%2Fpwn/documents')
      .field('docType', 'KTP')
      .attach('file', Buffer.from('%PDF-1.4'), 'x.pdf');
    expect([400, 404]).toContain(res.status);
    expect(res.body.success).toBe(false);
  });

  it('menolak docType di luar allow-list (cegah traversal via nama file)', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const res = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .field('docType', '../../../../pwn')
      .attach('file', Buffer.from('%PDF-1.4'), 'x.pdf');
    expect(res.status).toBe(400);
  });

  it('menolak :id UUID yang tidak ada jamaah-nya (tanpa file yatim)', async () => {
    const res = await request(app)
      .post('/v1/jamaah/00000000-0000-0000-0000-000000000000/documents')
      .field('docType', 'KTP')
      .attach('file', Buffer.from('%PDF-1.4'), 'x.pdf');
    expect(res.status).toBe(404);
  });
});
