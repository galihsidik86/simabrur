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

async function token(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

describe('master data: kategori paket', () => {
  it('GET publik memuat 4 kategori bawaan terurut', async () => {
    const res = await request(app).get('/v1/package-categories');
    expect(res.status).toBe(200);
    expect(res.body.data.map((c: { code: string }) => c.code)).toEqual(['reguler', 'plus', 'vip', 'khusus']);
  });

  it('marketing bisa CRUD; kategori terpakai paket tidak bisa dihapus (409)', async () => {
    const mkt = await token('marketing@safar.co.id');

    const created = await request(app)
      .post('/v1/package-categories')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ code: 'premium', label: 'Premium', sort: 9 });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .put(`/v1/package-categories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${mkt}`)
      .send({ code: 'premium', label: 'Premium Plus', sort: 9 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.label).toBe('Premium Plus');

    // paket baru boleh memakai kategori baru; kategori tak dikenal ditolak jelas
    const pkg = await request(app)
      .post('/v1/packages')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ code: 'UMR-PRM-10', name: 'Premium 10 Hari', type: 'umrah', category: 'premium', durationDays: 10, basePrice: 50_000_000 });
    expect(pkg.status).toBe(201);
    const bad = await request(app)
      .post('/v1/packages')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ code: 'UMR-XXX-10', name: 'Salah Kategori', type: 'umrah', category: 'tidak-ada', durationDays: 10, basePrice: 1_000_000 });
    expect(bad.status).toBe(400);

    const blocked = await request(app)
      .delete(`/v1/package-categories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${mkt}`);
    expect(blocked.status).toBe(409);

    await db('packages').where({ code: 'UMR-PRM-10' }).del();
    const deleted = await request(app)
      .delete(`/v1/package-categories/${created.body.data.id}`)
      .set('Authorization', `Bearer ${mkt}`);
    expect(deleted.status).toBe(200);
  });

  it('operasional ditolak menulis (403), kode duplikat 409', async () => {
    const ops = await token('ops@safar.co.id');
    const denied = await request(app)
      .post('/v1/package-categories')
      .set('Authorization', `Bearer ${ops}`)
      .send({ code: 'x-ops', label: 'X', sort: 0 });
    expect(denied.status).toBe(403);

    const mkt = await token('marketing@safar.co.id');
    const dup = await request(app)
      .post('/v1/package-categories')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ code: 'reguler', label: 'Reguler Lagi', sort: 0 });
    expect(dup.status).toBe(409);
  });
});

describe('master data: hotel & maskapai', () => {
  it('CRUD hotel; hotel terpakai paket tidak bisa dihapus (409)', async () => {
    const mkt = await token('marketing@safar.co.id');

    const created = await request(app)
      .post('/v1/hotels')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ name: 'Hotel Uji Baru', city: 'Madinah', star: 4 });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .put(`/v1/hotels/${created.body.data.id}`)
      .set('Authorization', `Bearer ${mkt}`)
      .send({ name: 'Hotel Uji Baru', city: 'Makkah', star: 5 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.city).toBe('Makkah');

    const usedHotel = await db('packages').whereNotNull('hotel_id').first();
    const blocked = await request(app).delete(`/v1/hotels/${usedHotel.hotel_id}`).set('Authorization', `Bearer ${mkt}`);
    expect(blocked.status).toBe(409);

    const deleted = await request(app).delete(`/v1/hotels/${created.body.data.id}`).set('Authorization', `Bearer ${mkt}`);
    expect(deleted.status).toBe(200);
  });

  it('CRUD maskapai; IATA dinormalisasi kapital; terpakai paket → 409', async () => {
    const mkt = await token('marketing@safar.co.id');

    const created = await request(app)
      .post('/v1/airlines')
      .set('Authorization', `Bearer ${mkt}`)
      .send({ name: 'Uji Air', iataCode: 'ua' });
    expect(created.status).toBe(201);
    expect(created.body.data.iata_code).toBe('UA');

    const usedAirline = await db('packages').whereNotNull('airline_id').first();
    const blocked = await request(app).delete(`/v1/airlines/${usedAirline.airline_id}`).set('Authorization', `Bearer ${mkt}`);
    expect(blocked.status).toBe(409);

    const deleted = await request(app).delete(`/v1/airlines/${created.body.data.id}`).set('Authorization', `Bearer ${mkt}`);
    expect(deleted.status).toBe(200);
  });
});
