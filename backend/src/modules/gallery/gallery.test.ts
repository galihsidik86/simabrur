import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';

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

  it('operasional menghapus satu foto', async () => {
    const ops = await staffToken('ops@safar.co.id');
    const del = await request(app).delete(`/v1/gallery/${photoId}`).set('Authorization', `Bearer ${ops}`);
    expect(del.status).toBe(200);
    const list = await request(app).get(`/v1/departures/${depPlusTurki}/gallery`).set('Authorization', `Bearer ${ops}`);
    expect(list.body.data).toHaveLength(1);
  });
});
