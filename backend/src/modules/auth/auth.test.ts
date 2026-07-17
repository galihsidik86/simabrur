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

describe('POST /v1/auth/login', () => {
  it('mengembalikan token + profil untuk kredensial valid', async () => {
    const res = await login('admin@safar.co.id');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user).toMatchObject({ email: 'admin@safar.co.id', role: 'admin', branch: 'Safar Jakarta' });
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
    const { body } = await login('marketing@safar.co.id');
    const oldRefresh = body.data.refreshToken;

    const first = await request(app).post('/v1/auth/refresh').send({ refreshToken: oldRefresh });
    expect(first.status).toBe(200);
    expect(first.body.data.refreshToken).not.toBe(oldRefresh);

    // token lama sudah dirotasi → ditolak
    const reuse = await request(app).post('/v1/auth/refresh').send({ refreshToken: oldRefresh });
    expect(reuse.status).toBe(401);
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
