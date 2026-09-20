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

describe('POST /v1/portal/login', () => {
  it('regNumber+NIK cocok → 200 token; audit portal.login tercatat', async () => {
    const res = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-0418', nik: '3175012345670003' });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeTruthy();
    const log = await db('audit_logs').where({ action: 'portal.login' }).orderBy('id', 'desc').first();
    expect(log).toBeTruthy();
  });

  // SEC-01: dulu hanya login SUKSES yang diaudit — percobaan gagal tak berjejak.
  it('NIK salah → 401 generik; audit portal.login_failed tercatat (SEC-01)', async () => {
    const res = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-0418', nik: '3175019999999999' });
    expect(res.status).toBe(401);
    const log = await db('audit_logs').where({ action: 'portal.login_failed' }).orderBy('id', 'desc').first();
    expect(log).toBeTruthy();
    expect(log.new_values.regNumber).toBe('UMR-2026-0418');
  });

  it('nomor registrasi tak dikenal → 401 generik + audit gagal, tanpa entityId', async () => {
    const res = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-9999', nik: '3175019999999999' });
    expect(res.status).toBe(401);
    const log = await db('audit_logs').where({ action: 'portal.login_failed' }).orderBy('id', 'desc').first();
    expect(log.entity_id).toBeNull();
  });
});
