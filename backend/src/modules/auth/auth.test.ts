import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { errorHandler } from '../../middleware/error.js';

const app = createApp();

beforeAll(async () => {
  await resetTestDb(db);
});

afterAll(async () => {
  await db.destroy();
});

async function login(email: string, password = 'safar123') {
  return request(app).post('/v1/auth/login').send({ email, password });
}

/**
 * SEC-07: refresh token hidup sebagai cookie httpOnly, bukan lagi field body. Supertest
 * tidak menyimpan cookie antar-request, jadi tes mengambilnya sendiri dari `Set-Cookie`
 * lalu mengirimkannya balik — persis seperti yang dilakukan browser.
 */
function refreshCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers['set-cookie'] as string[] | undefined;
  const found = (raw ?? []).find((c) => c.startsWith('safar.refresh='));
  if (!found) throw new Error('Respons tidak menyetel cookie safar.refresh');
  return found.split(';')[0]; // "safar.refresh=<token>" tanpa atributnya
}

describe('POST /v1/auth/login', () => {
  it('mengembalikan token + profil untuk kredensial valid', async () => {
    const res = await login('admin@safar.co.id');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user).toMatchObject({ email: 'admin@safar.co.id', role: 'admin', branch: 'Safar Jakarta' });
  });

  it('SEC-07: refresh token dikirim sebagai cookie httpOnly, bukan di body', async () => {
    const res = await login('admin@safar.co.id');
    // Body tidak boleh lagi memuat kredensial berumur panjang — ini inti SEC-07.
    expect(res.body.data.refreshToken).toBeUndefined();

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('safar.refresh='))!;
    expect(cookie).toBeTruthy();
    expect(cookie).toContain('HttpOnly'); // tak terbaca JavaScript → XSS tak bisa mencurinya
    expect(cookie).toContain('SameSite=Strict'); // tak ikut terkirim lintas situs → proteksi CSRF
    expect(cookie).toContain('Path=/v1/auth'); // hanya dikirim ke endpoint auth
  });

  it('menolak password salah dengan envelope error standar', async () => {
    const res = await login('admin@safar.co.id', 'salah');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  it('menolak body tidak valid dengan VALIDATION_ERROR', async () => {
    const res = await request(app).post('/v1/auth/login').send({ email: 'bukan-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('mencatat audit log saat login', async () => {
    await login('keuangan@safar.co.id');
    const row = await db('audit_logs').where({ action: 'auth.login' }).orderBy('id', 'desc').first();
    expect(row).toBeTruthy();
    expect(row.entity).toBe('users');
  });
});

describe('GET /v1/auth/me', () => {
  it('mengembalikan profil dengan access token', async () => {
    const { body } = await login('ops@safar.co.id');
    const res = await request(app).get('/v1/auth/me').set('Authorization', `Bearer ${body.data.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('operasional');
  });

  it('menolak tanpa token', async () => {
    const res = await request(app).get('/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/refresh (rotasi)', () => {
  it('menerbitkan pasangan token baru dan mencabut token lama', async () => {
    const res = await login('marketing@safar.co.id');
    const oldCookie = refreshCookie(res);

    const first = await request(app).post('/v1/auth/refresh').set('Cookie', oldCookie);
    expect(first.status).toBe(200);
    expect(refreshCookie(first)).not.toBe(oldCookie);

    // token lama sudah dirotasi → ditolak
    const reuse = await request(app).post('/v1/auth/refresh').set('Cookie', oldCookie);
    expect(reuse.status).toBe(401);
  });

  it('tanpa cookie sama sekali → 401 (bukan 400), sehingga klien langsung ke halaman login', async () => {
    const res = await request(app).post('/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/auth/logout (NEW-FE-02)', () => {
  it('tanpa header Authorization (token sudah dihapus di klien) tetap 200 dan mencabut refresh token', async () => {
    const loginRes = await login('marketing@safar.co.id');
    const cookie = refreshCookie(loginRes);

    const res = await request(app).post('/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.loggedOut).toBe(true);
    // Cookie ikut dihapus di browser: Max-Age/Expires nol agar tak ada sisa kredensial.
    expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('safar.refresh=;'))).toBe(true);

    const refreshAfter = await request(app).post('/v1/auth/refresh').set('Cookie', cookie);
    expect(refreshAfter.status).toBe(401);
  });

  it('idempoten & tidak membocorkan validitas token: cookie acak juga 200', async () => {
    const res = await request(app).post('/v1/auth/logout').set('Cookie', 'safar.refresh=token-acak-tidak-pernah-ada');
    expect(res.status).toBe(200);
  });

  it('idempoten juga tanpa cookie sama sekali — tombol Keluar tidak boleh pernah gagal', async () => {
    const res = await request(app).post('/v1/auth/logout');
    expect(res.status).toBe(200);
  });
});

describe('RBAC requireRoles', () => {
  function protectedApp(...roles: string[]) {
    const a = express();
    a.get('/protected', requireAuth, requireRoles(...roles), (_req, res) => res.json({ success: true, data: 'ok' }));
    a.use(errorHandler);
    return a;
  }

  it('mengizinkan role yang sesuai dan admin', async () => {
    const a = protectedApp('keuangan');
    const keu = await login('keuangan@safar.co.id');
    const adm = await login('admin@safar.co.id');
    expect((await request(a).get('/protected').set('Authorization', `Bearer ${keu.body.data.accessToken}`)).status).toBe(200);
    expect((await request(a).get('/protected').set('Authorization', `Bearer ${adm.body.data.accessToken}`)).status).toBe(200);
  });

  it('menolak role lain dengan 403', async () => {
    const a = protectedApp('keuangan');
    const ops = await login('ops@safar.co.id');
    const res = await request(a).get('/protected').set('Authorization', `Bearer ${ops.body.data.accessToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});
