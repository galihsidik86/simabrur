import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { safeEntryName } from '../../utils/zip.js';

const app = createApp();

beforeAll(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.destroy();
});

async function staffToken(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}
async function portalToken(regNumber: string, nik: string) {
  const res = await request(app).post('/v1/portal/login').send({ regNumber, nik });
  return res.body.data.token as string;
}

// Isi tak penting — fileFilter hanya cek ekstensi; zip cukup baca byte apa pun.
const IMG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const THUMB = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 42, 0xff, 0xd9]);

// Parser biner supertest agar body ZIP terbaca sebagai Buffer.
function binaryParser(res: request.Response, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

describe('Galeri foto rombongan', () => {
  let depPlusTurki = '';
  let depReguler = '';
  let photoId = '';

  beforeAll(async () => {
    const byCode = async (code: string) =>
      (await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', code).select('d.id').first()).id as string;
    depPlusTurki = await byCode('UMR-PLUS-TR');
    depReguler = await byCode('UMR-REG-9');
  });

  it('operasional mengunggah beberapa foto sekaligus', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const res = await request(app)
      .post(`/v1/departures/${depPlusTurki}/gallery`)
      .set('Authorization', `Bearer ${ops}`)
      .attach('files', IMG, 'kabah.jpg')
      .attach('files', IMG, 'madinah.jpg');
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(2);
    photoId = res.body.data[0].id;
  });

  it('RBAC: marketing tidak boleh mengunggah (403)', async () => {
    const mkt = await staffToken('marketing@safar.co.id');
    const res = await request(app)
      .post(`/v1/departures/${depPlusTurki}/gallery`)
      .set('Authorization', `Bearer ${mkt}`)
      .attach('files', IMG, 'x.jpg');
    expect(res.status).toBe(403);
  });

  it('unggah ke keberangkatan fiktif ditolak (404)', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const res = await request(app)
      .post('/v1/departures/00000000-0000-0000-0000-000000000000/gallery')
      .set('Authorization', `Bearer ${ops}`)
      .attach('files', IMG, 'x.jpg');
    expect(res.status).toBe(404);
  });

  it('jamaah rombongan itu melihat & mengunduh fotonya', async () => {
    const tok = await portalToken('UMR-2026-0418', '3175012345670003');
    const list = await request(app).get('/v1/portal/gallery').set('Authorization', `Bearer ${tok}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);

    const file = await request(app).get(`/v1/portal/gallery/${photoId}/file`).set('Authorization', `Bearer ${tok}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('image/jpeg');
  });

  it('IDOR: jamaah rombongan lain tak melihat & tak bisa akses foto (404)', async () => {
    const other = await portalToken('UMR-2026-0412', '3175012345670002');
    const list = await request(app).get('/v1/portal/gallery').set('Authorization', `Bearer ${other}`);
    expect(list.body.data).toHaveLength(0);

    const file = await request(app).get(`/v1/portal/gallery/${photoId}/file`).set('Authorization', `Bearer ${other}`);
    expect(file.status).toBe(404);
  });

  it('unduh semua sebagai ZIP valid', async () => {
    const tok = await portalToken('UMR-2026-0418', '3175012345670003');
    const res = await request(app)
      .get('/v1/portal/gallery.zip')
      .set('Authorization', `Bearer ${tok}`)
      .buffer(true)
      .parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/zip');
    expect(res.headers['content-disposition']).toContain('.zip');
    // Tanda tangan arsip ZIP + akhiran End Of Central Directory
    expect(res.body.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(res.body.subarray(-22, -18).toString('hex')).toBe('504b0506');
  });

  it('unggah dengan thumbnail + caption; sajikan varian thumb; edit caption', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const up = await request(app)
      .post(`/v1/departures/${depReguler}/gallery`)
      .set('Authorization', `Bearer ${ops}`)
      .field('captions', 'Kota Madinah')
      .attach('files', IMG, 'kota.jpg')
      .attach('thumbnails', THUMB, 'thumb-0.jpg');
    expect(up.status).toBe(201);
    const photo = up.body.data[0];
    expect(photo.caption).toBe('Kota Madinah');
    expect(photo.hasThumb).toBe(true);

    // varian thumb tersaji (dan berbeda ukuran dari foto penuh)
    const thumb = await request(app).get(`/v1/gallery/${photo.id}/file?variant=thumb`).set('Authorization', `Bearer ${ops}`).buffer(true).parse(binaryParser);
    expect(thumb.status).toBe(200);
    expect(thumb.body.length).toBe(THUMB.length);
    const full = await request(app).get(`/v1/gallery/${photo.id}/file`).set('Authorization', `Bearer ${ops}`).buffer(true).parse(binaryParser);
    expect(full.body.length).toBe(IMG.length);

    // list mencerminkan hasThumb + caption
    const list = await request(app).get(`/v1/departures/${depReguler}/gallery`).set('Authorization', `Bearer ${ops}`);
    expect(list.body.data[0]).toMatchObject({ caption: 'Kota Madinah', hasThumb: true });

    // edit caption
    const patch = await request(app).patch(`/v1/gallery/${photo.id}`).set('Authorization', `Bearer ${ops}`).send({ caption: 'Madinah Al-Munawwarah' });
    expect(patch.status).toBe(200);
    expect(patch.body.data.caption).toBe('Madinah Al-Munawwarah');

    // RBAC: marketing tak boleh edit caption
    const mkt = await staffToken('marketing@safar.co.id');
    const denied = await request(app).patch(`/v1/gallery/${photo.id}`).set('Authorization', `Bearer ${mkt}`).send({ caption: 'x' });
    expect(denied.status).toBe(403);
  });

  it('operasional menghapus satu foto', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const del = await request(app).delete(`/v1/gallery/${photoId}`).set('Authorization', `Bearer ${ops}`);
    expect(del.status).toBe(200);
    const list = await request(app).get(`/v1/departures/${depPlusTurki}/gallery`).set('Authorization', `Bearer ${ops}`);
    expect(list.body.data).toHaveLength(1);
  });
});

// Parser STORED-ZIP untuk uji round-trip (tanpa pustaka unzip).
function parseZip(buf: Buffer) {
  const entries: { name: string; data: Buffer }[] = [];
  let i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const size = buf.readUInt32LE(i + 22);
    const nameLen = buf.readUInt16LE(i + 26);
    const extraLen = buf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const dataStart = nameStart + nameLen + extraLen;
    entries.push({ name: buf.subarray(nameStart, nameStart + nameLen).toString('utf8'), data: buf.subarray(dataStart, dataStart + size) });
    i = dataStart + size;
  }
  return entries;
}

describe('Galeri — validasi ZIP, fileFilter, varian & RBAC', () => {
  let depVip = '';
  let depAqsa = '';
  let depFuroda = '';

  beforeAll(async () => {
    const byCode = async (code: string) =>
      (await db('departures as d').join('packages as p', 'p.id', 'd.package_id').where('p.code', code).select('d.id').first()).id as string;
    depVip = await byCode('UMR-VIP-12');
    depAqsa = await byCode('UMR-PLUS-AQ');
    depFuroda = await byCode('HAJ-FURODA-27');
  });

  it('fileFilter menolak ekstensi terlarang (400)', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const res = await request(app).post(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${ops}`).attach('files', IMG, 'jahat.gif');
    expect(res.status).toBe(400);
  });

  it('variant=thumb fallback ke foto penuh saat tidak ada thumbnail', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const up = await request(app).post(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${ops}`).attach('files', IMG, 'tanpa-thumb.jpg');
    expect(up.status).toBe(201);
    const id = up.body.data[0].id;
    expect(up.body.data[0].hasThumb).toBe(false);
    const thumb = await request(app).get(`/v1/gallery/${id}/file?variant=thumb`).set('Authorization', `Bearer ${ops}`).buffer(true).parse(binaryParser);
    expect(thumb.status).toBe(200);
    expect(thumb.body.length).toBe(IMG.length); // fallback = byte foto penuh
  });

  it('ZIP staf: entri, jumlah, dan byte cocok (round-trip)', async () => {
    const ops = await staffToken('ops@safar.co.id');
    await request(app).post(`/v1/departures/${depAqsa}/gallery`).set('Authorization', `Bearer ${ops}`)
      .field('captions', 'Foto A').attach('files', IMG, 'a.jpg')
      .field('captions', 'Foto B').attach('files', IMG, 'b.jpg')
      .field('captions', 'Foto C').attach('files', IMG, 'c.jpg');
    const zip = await request(app).get(`/v1/departures/${depAqsa}/gallery/zip`).set('Authorization', `Bearer ${ops}`).buffer(true).parse(binaryParser);
    expect(zip.status).toBe(200);
    // EOCD: jumlah entri
    expect(zip.body.readUInt16LE(zip.body.length - 22 + 10)).toBe(3);
    const entries = parseZip(zip.body);
    expect(entries).toHaveLength(3);
    for (const e of entries) expect(Buffer.compare(e.data, IMG)).toBe(0); // byte tersimpan utuh
    expect(entries.every((e) => /\.(jpg|jpeg|png|webp)$/i.test(e.name))).toBe(true);
  });

  it('ZIP galeri kosong → 404', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const res = await request(app).get(`/v1/departures/${depFuroda}/gallery/zip`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(404);
  });

  it('updateCaption id tak dikenal → 404', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const res = await request(app).patch('/v1/gallery/00000000-0000-0000-0000-000000000000').set('Authorization', `Bearer ${ops}`).send({ caption: 'x' });
    expect(res.status).toBe(404);
  });

  it('RBAC: keuangan tak boleh PATCH caption & pimpinan tak boleh unggah (403), tapi keduanya boleh melihat', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const up = await request(app).post(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${ops}`).attach('files', IMG, 'x.jpg');
    const id = up.body.data[0].id;

    const keu = await staffToken('keuangan@safar.co.id');
    expect((await request(app).patch(`/v1/gallery/${id}`).set('Authorization', `Bearer ${keu}`).send({ caption: 'y' })).status).toBe(403);

    const pim = await staffToken('pimpinan@safar.co.id');
    expect((await request(app).post(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${pim}`).attach('files', IMG, 'z.jpg')).status).toBe(403);

    // melihat (list) diizinkan utk keuangan & pimpinan
    expect((await request(app).get(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${keu}`)).status).toBe(200);
    expect((await request(app).get(`/v1/departures/${depVip}/gallery`).set('Authorization', `Bearer ${pim}`)).status).toBe(200);
  });

  it('safeEntryName menyanitasi pemisah path & karakter kendali', () => {
    expect(safeEntryName('../../etc/passwd')).not.toMatch(/[\\/]/);
    expect(safeEntryName('a/b\\c')).toBe('a-b-c');
    expect(safeEntryName('   ')).toBe('file');
  });
});
