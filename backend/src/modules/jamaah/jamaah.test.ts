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
  // DOM-08: +7 bulan kalender, UTC, di-clamp ke akhir bulan tujuan (bukan overflow ke Maret).
  it('clamp ke akhir bulan saat keberangkatan di ekor bulan (31 Jul → 28 Feb, bukan 3 Mar)', () => {
    expect(passportValidUntilLimit('2026-07-31').toISOString().slice(0, 10)).toBe('2027-02-28');
    expect(isPassportValid('2027-02-28', '2026-07-31')).toBe(true);
    expect(isPassportValid('2027-02-27', '2026-07-31')).toBe(false);
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
    // DOM-06: unik per NIK secara default — beberapa registrasi jamaah "berbeda" di
    // banyak tes TIDAK boleh berbagi no. paspor yang sama (itu kini dideteksi & ditolak).
    passportNo: `P${nik.slice(-8)}`,
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

  // SEC-01: alfabet Crockford base32 — 0-9 dan A-Z TANPA I, L, O, U.
  const REG_NUMBER_RE = /^UMR-2026-[0-9A-HJKMNP-TV-Z]{8}$/;

  it('mendaftarkan jamaah baru: nomor UMR-2026-xxxxxxxx, kuota bertambah, harga sesuai kamar', async () => {
    const before = await db('departures').where({ id: plusTurkiDepId }).first();
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'triple', paymentScheme: 'cicil', jamaah: jamaahPayload('9900000000000001') });
    expect(res.status).toBe(201);
    expect(res.body.data.regNumber).toMatch(REG_NUMBER_RE);
    expect(res.body.data.totalPrice).toBe(39_900_000 + 3_500_000);
    const after = await db('departures').where({ id: plusTurkiDepId }).first();
    expect(after.seats_taken).toBe(before.seats_taken + 1);
  });

  // NIK 99000000000000{01..21} sudah dipakai kasus uji lain di file ini, dan kuota
  // UMR-PLUS-TR tinggal 6 kursi (seed: quota 40 / taken 34) sehingga dipakai berebut.
  // Dua tes di bawah karena itu memakai NIK seri 31+ dan keberangkatan yang longgar.
  const depIdByCode = async (code: string) => {
    const d = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', code)
      .select('d.id')
      .first();
    return d.id as string;
  };

  it('SEC-01: nomor registrasi acak — bukan lagi serial 4 digit yang bisa ditebak', async () => {
    const depId = await depIdByCode('UMR-PLUS-AQ');
    const daftar = (nik: string) =>
      request(app)
        .post('/v1/registrations')
        .send({ departureId: depId, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload(nik) });

    const a = await daftar('9900000000000031');
    const b = await daftar('9900000000000032');
    expect([a.status, b.status]).toEqual([201, 201]);

    const pola = /^UMR-2026-[0-9A-HJKMNP-TV-Z]{8}$/;
    expect(a.body.data.regNumber).toMatch(pola);
    expect(b.body.data.regNumber).toMatch(pola);
    expect(b.body.data.regNumber).not.toBe(a.body.data.regNumber);

    // Inti SEC-01: skema lama selalu menghasilkan serial 4 digit berurutan (0500 → 0501),
    // sehingga satu nomor sah langsung membocorkan nomor jamaah lain. Serial sekarang
    // 8 karakter dari ruang 32^8 dan tidak berbentuk angka berurutan.
    const serial = (n: string) => n.slice('UMR-2026-'.length);
    expect(serial(a.body.data.regNumber)).not.toMatch(/^\d{4}$/);
    expect(serial(b.body.data.regNumber)).not.toMatch(/^\d{4}$/);
  });

  it('QA-03: jalur PUBLIK tidak mengisi kolom profil yang masih kosong milik jamaah yang sudah ada', async () => {
    const nik = '9900000000000033';
    const depPertama = await depIdByCode('UMR-PLUS-AQ');
    const pertama = await request(app)
      .post('/v1/registrations')
      .send({ departureId: depPertama, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload(nik) });
    expect(pertama.status).toBe(201);

    const sebelum = await db('jamaah').where({ nik }).first();
    expect(sebelum.email).toBeNull();

    // Orang lain menembakkan NIK korban + email miliknya sendiri, tanpa token petugas.
    const depKedua = await depIdByCode('UMR-REG-AT');
    const kedua = await request(app)
      .post('/v1/registrations')
      .send({
        departureId: depKedua,
        roomType: 'quad',
        paymentScheme: 'dp',
        jamaah: jamaahPayload(nik, { email: 'penyusup@example.com', fullName: 'NAMA PENYUSUP' })
      });
    expect(kedua.status).toBe(201);

    const sesudah = await db('jamaah').where({ nik }).first();
    expect(sesudah.email).toBeNull(); // kolom kosong TIDAK ikut terisi — inti QA-03
    expect(sesudah.full_name).toBe(sebelum.full_name); // profil tetap tidak tertimpa (NEW-BE-01)

    // Data pendaftar tidak dibuang diam-diam: registrasi ditahan sampai petugas
    // mengonfirmasi identitas, dan petugas itulah yang melengkapi profil.
    const reg = await db('registrations').where({ reg_number: kedua.body.data.regNumber }).first();
    expect(reg.identity_confirmation_required).toBe(true);
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

  it('menolak NIK yang sama mendaftar dua kali di keberangkatan yang sama (NEW-BE-01: pesan generik, tanpa nomor registrasi)', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({ departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp', jamaah: jamaahPayload('9900000000000001') });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('sudah terdaftar');
    expect(res.body.error.message).not.toMatch(/UMR-|HAJ-/);
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

  // DOM-01: paspor WAJIB — dulu nullish, celah menembus wizard publik lewat POST langsung.
  it('menolak registrasi tanpa passportNo/passportExpiry (paspor wajib)', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({
        departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp',
        jamaah: jamaahPayload('9900000000000006', { passportNo: undefined, passportExpiry: undefined })
      });
    expect(res.status).toBe(400);
  });

  it('menolak passportExpiry: null eksplisit (field di-strip → wajib tetap gagal)', async () => {
    const res = await request(app)
      .post('/v1/registrations')
      .send({
        departureId: plusTurkiDepId, roomType: 'quad', paymentScheme: 'dp',
        jamaah: jamaahPayload('9900000000000007', { passportNo: null, passportExpiry: null })
      });
    expect(res.status).toBe(400);
  });

  // N-1 (bagian dari NEW-BE-01): daftar ulang NIK sama ke keberangkatan LAIN tidak
  // boleh menghapus/menimpa paspor yang sudah tersimpan.
  it('daftar ulang NIK sama ke keberangkatan lain TIDAK menimpa paspor/HP yang sudah tersimpan', async () => {
    const dep1 = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-VIP-12').select('d.id').first();
    const dep2 = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-REG-AT').select('d.id').first();

    const first = await request(app).post('/v1/registrations').send({
      departureId: dep1.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: jamaahPayload('9900000000000008', { passportNo: 'N1234567', passportExpiry: '2030-01-01', phone: '081200000008' })
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/v1/registrations').send({
      departureId: dep2.id, roomType: 'quad', paymentScheme: 'dp',
      // Kirim paspor & HP BERBEDA — tidak boleh menimpa data yang sudah ada.
      jamaah: jamaahPayload('9900000000000008', { passportNo: 'ZZZZZZZ', passportExpiry: '2031-06-01', phone: '089999999999' })
    });
    expect(second.status).toBe(201);

    const j = await db('jamaah').where({ nik: '9900000000000008' }).first();
    expect(j.passport_no).toBe('N1234567');
    expect(j.phone).toBe('081200000008');
  });

  // DOM-06: paspor tidak boleh dipakai jamaah lain (NIK berbeda) — dicek tanpa unique index.
  it('menolak paspor yang sudah dipakai jamaah lain (409)', async () => {
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-REG-AT').select('d.id').first();
    const res = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: jamaahPayload('9900000000000009', { passportNo: 'N1234567', passportExpiry: '2030-01-01' })
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('paspor');
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

describe('DOM-03: detail jamaah memakai invoice.total_amount, bukan harga paket terkini', () => {
  it('ubah basePrice/tripleUpcharge setelah invoice terbit → totalPrice detail tetap sesuai invoice', async () => {
    const adminToken = await token('admin@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const pkgRes = await request(app).post('/v1/packages').set('Authorization', `Bearer ${adminToken}`).send({
      code: 'TEST-DOM03', name: 'Paket Uji DOM-03', type: 'umrah', category: 'reguler', durationDays: 9,
      basePrice: 20_000_000, departure: { departureDate: '2026-11-20', quota: 10 }
    });
    expect(pkgRes.status).toBe(201);
    const pkg = await db('packages').where({ code: 'TEST-DOM03' }).first();
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'TEST-DOM03').select('d.id').first();

    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'lunas',
      jamaah: jamaahPayload('9900000000000010')
    });
    expect(reg.status).toBe(201);
    const invoice = await db('invoices').where({ id: reg.body.data.invoiceId }).first();
    expect(Number(invoice.total_amount)).toBe(20_000_000);

    const upd = await request(app).put(`/v1/packages/${pkg.id}`).set('Authorization', `Bearer ${mkt}`).send({ basePrice: 99_000_000 });
    expect(upd.status).toBe(200);

    const detail = await request(app).get(`/v1/jamaah/${reg.body.data.jamaahId}`).set('Authorization', `Bearer ${ops}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.registrations[0].totalPrice).toBe(20_000_000);
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

  it('N-6: dokumen WAJIB yang ditolak kembali menurunkan registrasi aktif ke pending_documents', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const ops = await token('ops@safar.co.id');

    // Prasyarat: tes sebelumnya membuat registrasi ini `active` dgn 5 dokumen wajib verified.
    const sebelum = await db('registrations').where({ jamaah_id: jamaahRow.id }).first();
    expect(sebelum.status).toBe('active');

    // Satu dokumen WAJIB ditarik kembali — berkasnya jadi tidak lengkap lagi.
    const ktp = await db('documents').where({ jamaah_id: jamaahRow.id, doc_type: 'KTP' }).first();
    const tolak = await request(app)
      .patch(`/v1/documents/${ktp.id}/verify`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ status: 'rejected', note: 'Scan buram, mohon unggah ulang' });
    expect(tolak.status).toBe(200);

    // Dulu status tetap `active`, sehingga laporan kesiapan & manifest menganggapnya beres.
    const sesudah = await db('registrations').where({ jamaah_id: jamaahRow.id }).first();
    expect(sesudah.status).toBe('pending_documents');
  });
});

describe('DOM-04/SEC-05: unggah publik tidak boleh menimpa dokumen verified; staf boleh', () => {
  it('anonim ditolak (409) mengganti dokumen verified; operasional (staf) boleh', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const up = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .field('docType', 'NKH')
      .attach('file', Buffer.from('%PDF-1.4 v1'), 'nkh.pdf');
    expect(up.status).toBe(201);
    const ops = await token('ops@safar.co.id');
    const verified = await request(app)
      .patch(`/v1/documents/${up.body.data.id}/verify`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ status: 'verified' });
    expect(verified.status).toBe(200);

    const before = await db('documents').where({ id: up.body.data.id }).first();
    const anon = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .field('docType', 'NKH')
      .attach('file', Buffer.from('%PDF-1.4 v2 anon'), 'nkh2.pdf');
    expect(anon.status).toBe(409);
    const afterAnon = await db('documents').where({ id: up.body.data.id }).first();
    expect(afterAnon.status).toBe('verified');
    expect(afterAnon.file_url).toBe(before.file_url);

    const staff = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .set('Authorization', `Bearer ${ops}`)
      .field('docType', 'NKH')
      .attach('file', Buffer.from('%PDF-1.4 v3 staff'), 'nkh3.pdf');
    expect(staff.status).toBe(201);
    expect(staff.body.data.status).toBe('pending');
    expect(staff.body.data.file_url).not.toBe(before.file_url);
  });
});

describe('FE-04: batas ukuran unggah dokumen jamaah ditangani rapi (bukan 500)', () => {
  it('file > 5 MB → 400 FILE_TOO_LARGE', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const big = Buffer.alloc(5 * 1024 * 1024 + 1, 'a');
    const res = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .field('docType', 'FTO')
      .attach('file', big, 'besar.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
    expect(res.body.error.message).toContain('5 MB');
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

  // DOM-07: "_" (wildcard ILIKE 1-karakter) di-escape agar dicocokkan literal.
  it('escape wildcard ILIKE pada pencarian q: "__" tidak mencocokkan semua baris', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/jamaah?q=__').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe('G (putaran 3): GET /v1/jamaah — filter status registrasi & identityPending', () => {
  it('default (tanpa filter) tetap menampilkan semua status termasuk cancelled', async () => {
    const ops = await token('ops@safar.co.id');
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-PLUS-AQ').select('d.id').first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9933000000000001', fullName: 'UJI FILTER STATUS G', gender: 'L', birthPlace: 'Jakarta', birthDate: '1990-01-01',
        phone: '081200000001', address: 'Jl. Uji Filter G', emergencyContactName: 'Kel', emergencyContactPhone: '081300000001',
        passportNo: 'GFLT0001', passportExpiry: '2031-01-01'
      }
    });
    expect(reg.status).toBe(201);
    const cancel = await request(app).post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`).send({ reason: 'Uji filter status G' });
    expect(cancel.status).toBe(200);

    const all = await request(app).get('/v1/jamaah?limit=100').set('Authorization', `Bearer ${ops}`);
    expect(all.status).toBe(200);
    const row = all.body.data.find((r: { registrationId: string }) => r.registrationId === reg.body.data.registrationId);
    expect(row).toBeTruthy();
    expect(row.registrationStatus).toBe('cancelled');
  });

  it('status=cancelled hanya menampilkan registrasi cancelled; status=active mengecualikan cancelled', async () => {
    const ops = await token('ops@safar.co.id');
    const cancelledOnly = await request(app).get('/v1/jamaah?status=cancelled&limit=100').set('Authorization', `Bearer ${ops}`);
    expect(cancelledOnly.status).toBe(200);
    expect(cancelledOnly.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of cancelledOnly.body.data) expect(row.registrationStatus).toBe('cancelled');

    const activeOnly = await request(app).get('/v1/jamaah?status=active&limit=100').set('Authorization', `Bearer ${ops}`);
    expect(activeOnly.status).toBe(200);
    for (const row of activeOnly.body.data) expect(row.registrationStatus).toBe('active');
  });

  it('identityPending=true hanya menampilkan registrasi menunggu konfirmasi identitas; field identityConfirmationRequired tampil per baris', async () => {
    const ops = await token('ops@safar.co.id');
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-VIP-12').select('d.id').first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: {
        nik: '9933000000000002', fullName: 'UJI FILTER IDPENDING G', gender: 'L', birthPlace: 'Jakarta', birthDate: '1990-01-01',
        phone: '081200000002', address: 'Jl. Uji Filter G2', emergencyContactName: 'Kel', emergencyContactPhone: '081300000002',
        passportNo: 'GFLT0002', passportExpiry: '2031-01-01'
      }
    });
    expect(reg.status).toBe(201);
    await db('registrations').where({ id: reg.body.data.registrationId }).update({ identity_confirmation_required: true });

    const pending = await request(app).get('/v1/jamaah?identityPending=true&limit=100').set('Authorization', `Bearer ${ops}`);
    expect(pending.status).toBe(200);
    expect(pending.body.data.length).toBeGreaterThanOrEqual(1);
    for (const row of pending.body.data) expect(row.identityConfirmationRequired).toBe(true);
    const row = pending.body.data.find((r: { registrationId: string }) => r.registrationId === reg.body.data.registrationId);
    expect(row).toBeTruthy();

    const unfiltered = await request(app).get('/v1/jamaah?limit=100').set('Authorization', `Bearer ${ops}`);
    const otherRow = unfiltered.body.data.find((r: { registrationId: string }) => r.registrationId !== reg.body.data.registrationId);
    expect(otherRow.identityConfirmationRequired).toBe(false);
  });

  // R3TS-01 (review putaran 3): `z.coerce.boolean()` membaca string "false" sebagai
  // TRUE (semua string tak kosong truthy), sehingga `?identityPending=false` justru
  // MENGAKTIFKAN filter — salah diam-diam untuk klien/integrasi selain UI kita.
  it('identityPending=false TIDAK mengaktifkan filter (sama dengan tanpa filter)', async () => {
    const ops = await token('ops@safar.co.id');
    const off = await request(app).get('/v1/jamaah?identityPending=false&limit=100').set('Authorization', `Bearer ${ops}`);
    expect(off.status).toBe(200);
    const notPending = off.body.data.filter((r: { identityConfirmationRequired: boolean }) => r.identityConfirmationRequired === false);
    expect(notPending.length).toBeGreaterThan(0);

    const unfiltered = await request(app).get('/v1/jamaah?limit=100').set('Authorization', `Bearer ${ops}`);
    expect(off.body.meta.total).toBe(unfiltered.body.meta.total);
  });

  it('identityPending dengan nilai selain true/false ditolak 400 (tidak ditebak diam-diam)', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/jamaah?identityPending=kadang&limit=100').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(400);
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

  // DOM-01 (M, staf): field paspor kini ada di skema update, divalidasi ≥7 bulan
  // terhadap keberangkatan registrasi aktif jamaah.
  it('mengubah paspor: ditolak bila < 7 bulan sebelum keberangkatan aktif, diterima bila memenuhi', async () => {
    const ops = await token('ops@safar.co.id');
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first(); // berangkat UMR-PLUS-TR 2026-08-20

    const bad = await request(app)
      .patch(`/v1/jamaah/${jamaahRow.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ passportNo: 'Q7654321', passportExpiry: '2026-09-01' });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .patch(`/v1/jamaah/${jamaahRow.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ passportNo: 'Q7654321', passportExpiry: '2031-01-01' });
    expect(good.status).toBe(200);
    expect(good.body.data.passport_no).toBe('Q7654321');
  });

  // DOM-06: staf juga tak boleh memindahkan paspor jamaah lain ke jamaah ini.
  it('menolak paspor yang sudah dipakai jamaah lain saat diubah staf (409)', async () => {
    const ops = await token('ops@safar.co.id');
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const dup = await request(app)
      .patch(`/v1/jamaah/${jamaahRow.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ passportNo: 'N1234567' }); // dipakai NIK 9900000000000008 (tes N-1/DOM-06 di atas)
    expect(dup.status).toBe(409);
  });
});

describe('NEW-BE-01 (putaran 2): registrasi reuse NIK via wizard publik ditahan sampai konfirmasi identitas', () => {
  it('NIK baru → login portal langsung OK (tidak ditahan)', async () => {
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-VIP-12').select('d.id').first();
    const reg = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: jamaahPayload('9900000000000020', { passportNo: 'ID0000020', passportExpiry: '2031-01-01' })
    });
    expect(reg.status).toBe(201);
    const row = await db('registrations').where({ id: reg.body.data.registrationId }).first();
    expect(row.identity_confirmation_required).toBe(false);

    const login = await request(app).post('/v1/portal/login').send({ nik: '9900000000000020', regNumber: reg.body.data.regNumber });
    expect(login.status).toBe(200);
  });

  it('NIK lama via wizard publik ke keberangkatan lain → login dgn no. BARU ditahan (403); no. LAMA tetap OK; operasional bisa konfirmasi', async () => {
    const dep1 = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-VIP-12').select('d.id').first();
    const dep2 = await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', 'UMR-REG-AT').select('d.id').first();

    const first = await request(app).post('/v1/registrations').send({
      departureId: dep1.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: jamaahPayload('9900000000000021', { passportNo: 'ID0000021', passportExpiry: '2031-01-01' })
    });
    expect(first.status).toBe(201);
    const regNumberLama = first.body.data.regNumber;

    const second = await request(app).post('/v1/registrations').send({
      departureId: dep2.id, roomType: 'quad', paymentScheme: 'dp',
      jamaah: jamaahPayload('9900000000000021')
    });
    expect(second.status).toBe(201);
    const regNumberBaru = second.body.data.regNumber;
    const rowBaru = await db('registrations').where({ id: second.body.data.registrationId }).first();
    expect(rowBaru.identity_confirmation_required).toBe(true);

    const loginLama = await request(app).post('/v1/portal/login').send({ nik: '9900000000000021', regNumber: regNumberLama });
    expect(loginLama.status).toBe(200);

    const loginBaruTertahan = await request(app).post('/v1/portal/login').send({ nik: '9900000000000021', regNumber: regNumberBaru });
    expect(loginBaruTertahan.status).toBe(403);
    expect(loginBaruTertahan.body.error.message).toContain('konfirmasi identitas');

    // Detail jamaah mengekspos flag utk UI staf
    const ops = await token('ops@safar.co.id');
    const detail = await request(app).get(`/v1/jamaah/${first.body.data.jamaahId}`).set('Authorization', `Bearer ${ops}`);
    const regRowInDetail = detail.body.data.registrations.find((r: { regNumber: string }) => r.regNumber === regNumberBaru);
    expect(regRowInDetail.identityConfirmationRequired).toBe(true);

    // Role selain operasional/admin ditolak
    const mkt = await token('marketing@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    expect((await request(app).patch(`/v1/registrations/${second.body.data.registrationId}/confirm-identity`).set('Authorization', `Bearer ${mkt}`)).status).toBe(403);
    expect((await request(app).patch(`/v1/registrations/${second.body.data.registrationId}/confirm-identity`).set('Authorization', `Bearer ${keu}`)).status).toBe(403);

    // operasional mengonfirmasi → login dgn no. baru jadi OK; idempoten bila dipanggil ulang
    const confirm = await request(app).patch(`/v1/registrations/${second.body.data.registrationId}/confirm-identity`).set('Authorization', `Bearer ${ops}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.identity_confirmation_required).toBe(false);
    const confirmAgain = await request(app).patch(`/v1/registrations/${second.body.data.registrationId}/confirm-identity`).set('Authorization', `Bearer ${ops}`);
    expect(confirmAgain.status).toBe(200);

    const loginBaruSetelahKonfirmasi = await request(app).post('/v1/portal/login').send({ nik: '9900000000000021', regNumber: regNumberBaru });
    expect(loginBaruSetelahKonfirmasi.status).toBe(200);
  });

  it('confirm-identity pada registrasi tak dikenal → 404', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app)
      .patch('/v1/registrations/00000000-0000-0000-0000-000000000000/confirm-identity')
      .set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(404);
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

describe('berkas dokumen hanya lewat endpoint ber-otentikasi (audit fix)', () => {
  it('unggah lalu ambil berkas: tanpa login 401, dgn ops 200; portal ditolak', async () => {
    const jamaahRow = await db('jamaah').where({ nik: '9900000000000001' }).first();
    const ops = await token('ops@safar.co.id');
    // KK jamaah ini sudah 'verified' (tes lain di atas) — DOM-04/SEC-05 menolak jalur
    // anonim menimpanya, jadi unggah di sini memakai token staf (jalur berwenang).
    const up = await request(app)
      .post(`/v1/jamaah/${jamaahRow.id}/documents`)
      .set('Authorization', `Bearer ${ops}`)
      .field('docType', 'KK')
      .attach('file', Buffer.from('%PDF-1.4 berkas'), 'kk.pdf');
    expect(up.status).toBe(201);
    const docId = up.body.data.id;

    expect((await request(app).get(`/v1/documents/${docId}/file`)).status).toBe(401);

    const okRes = await request(app).get(`/v1/documents/${docId}/file`).set('Authorization', `Bearer ${ops}`);
    expect(okRes.status).toBe(200);
    expect(okRes.headers['content-type']).toContain('application/pdf');
    expect(okRes.headers['cache-control']).toContain('no-store');

    const login = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-0418', nik: '3175012345670003' });
    const portalToken = login.body.data.token;
    expect((await request(app).get(`/v1/documents/${docId}/file`).set('Authorization', `Bearer ${portalToken}`)).status).toBe(403);
  });
});
