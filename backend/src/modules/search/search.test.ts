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

describe('GET /v1/search (pencarian global header)', () => {
  it('menemukan jamaah, paket, dan invoice dari satu kata kunci', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/search?q=siti').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.data.jamaah.some((j: { name: string }) => j.name.includes('Siti'))).toBe(true);
    expect(res.body.data.jamaah[0].regNumber).toMatch(/^(UMR|HAJ)-/);

    const paket = await request(app).get('/v1/search?q=turki').set('Authorization', `Bearer ${ops}`);
    expect(paket.body.data.packages.some((p: { name: string }) => /turki/i.test(p.name))).toBe(true);

    const inv = await request(app).get('/v1/search?q=INV/').set('Authorization', `Bearer ${ops}`);
    expect(inv.body.data.invoices.length).toBeGreaterThan(0);
    expect(inv.body.data.invoices[0].number).toMatch(/^INV\//);
    expect(inv.body.data.invoices[0].jamaahName).toBeTruthy();
  });

  it('kata kunci < 2 huruf → hasil kosong; tanpa login 401', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/search?q=a').set('Authorization', `Bearer ${ops}`);
    expect(res.body.data).toEqual({ jamaah: [], packages: [], invoices: [] });
    expect((await request(app).get('/v1/search?q=siti')).status).toBe(401);
  });
});

describe('GET /v1/search/notifications (lonceng header)', () => {
  it('menghitung dokumen & pembayaran pending, hanya item ber-count > 0', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/search/notifications').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(0);
    for (const item of res.body.data.items) {
      expect(item.count).toBeGreaterThan(0);
      expect(item.to).toMatch(/^\//);
      expect(item.label).toBeTruthy();
    }
    const sum = res.body.data.items.reduce((s: number, i: { count: number }) => s + i.count, 0);
    expect(res.body.data.total).toBe(sum);
  });
});
