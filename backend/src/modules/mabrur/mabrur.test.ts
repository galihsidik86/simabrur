import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { env } from '../../config/env.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

const app = createApp();

/* ===== Mock server Mabrur: merekam payload, membalas seperti endpoint sync asli ===== */
let mock: Server;
let lastPayload: any = null;
let mockMode: 'ok' | 'down' = 'ok';
const knownRefs = new Set<string>(); // externalRef yang sudah "ada" di Mabrur → updated

beforeAll(async () => {
  await resetTestDb(db);

  const m = express();
  m.use(express.json());
  m.post('/integrations/safar/sync', (req, res) => {
    if (req.header('x-service-token') !== env.mabrur.serviceToken) {
      return res.status(401).json({ error: { message: 'Service token tidak valid', code: 'UNAUTHORIZED' } });
    }
    lastPayload = req.body;
    const members = req.body.members.map((mm: any) => {
      const existed = knownRefs.has(mm.externalRef);
      knownRefs.add(mm.externalRef);
      return { externalRef: mm.externalRef, phone: mm.phone, status: existed ? 'updated' : 'created', mabrurUserId: randomUUID() };
    });
    res.json({ data: { mabrurGroupId: randomUUID(), group: 'created', members, schedules: (req.body.schedules ?? []).length } });
  });
  m.get('/integrations/safar/groups/:ref/status', (req, res) => {
    if (req.header('x-service-token') !== env.mabrur.serviceToken) {
      return res.status(401).json({ error: { message: 'unauthorized', code: 'UNAUTHORIZED' } });
    }
    res.json({ data: { group: { id: 'x', name: 'Mock', kloterCode: 'MOCK-1' }, members: [], stats: { total: 0 }, sos: [] } });
  });

  await new Promise<void>((resolve) => {
    mock = m.listen(0, () => resolve());
  });
  const port = (mock.address() as { port: number }).port;
  env.mabrur.apiUrl = `http://127.0.0.1:${port}`; // arahkan service ke mock
});

afterAll(async () => {
  await new Promise((r) => mock?.close(r));
  await db.destroy();
});

async function token(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

describe('util kripto (AES-256-GCM)', () => {
  it('encrypt/decrypt bolak-balik; format iv:tag:cipher', () => {
    const enc = encrypt('123456');
    expect(enc.split(':')).toHaveLength(3);
    expect(enc).not.toContain('123456');
    expect(decrypt(enc)).toBe('123456');
  });

  it('menolak payload malformed & auth tag terpotong', () => {
    expect(() => decrypt('bukan-format-benar')).toThrow();
    const [iv, tag, data] = encrypt('rahasia').split(':');
    expect(() => decrypt(`${iv}:${tag.slice(0, 16)}:${data}`)).toThrow(); // tag 8 byte
    expect(() => decrypt(`${iv}:${tag}:${data}ff`)).toThrow(); // ciphertext diubah → auth gagal
  });
});

describe('POST /v1/mabrur/groups/:id/sync', () => {
  it('sinkron Grup B golden thread: payload benar, mapping + kredensial tersimpan', async () => {
    const ops = await token('ops@safar.co.id');
    const grupB = await db('groups').where({ name: 'Grup B' }).first();

    const res = await request(app).post(`/v1/mabrur/groups/${grupB.id}/sync`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.created).toBeGreaterThanOrEqual(4); // 2 staf + >=2 jamaah (Siti, Bambang, Kartini)
    expect(d.conflicts).toHaveLength(0);
    expect(d.schedules).toBe(2);

    // Payload yang dikirim ke Mabrur
    expect(lastPayload.group.externalRef).toBe(grupB.id);
    expect(lastPayload.group.kloterCode).toBe('UMR-PLUS-TR-B');
    expect(lastPayload.group.name).toContain('Plus Turki');
    const fadhil = lastPayload.members.find((m: any) => m.name === 'Ust. Fadhil');
    expect(fadhil).toMatchObject({ role: 'muthawwif', phone: '081288112233' });
    const siti = lastPayload.members.find((m: any) => m.name === 'Hj. Siti Rohmah');
    expect(siti.role).toBe('jamaah');
    expect(siti.phone).toMatch(/^08\d{8,13}$/); // dinormalisasi dari format ber-strip
    expect(siti.passportNo).toBe('C5120388');
    expect(siti.initialPassword).toMatch(/^\d{6}$/);

    // Mapping tersimpan
    const groupAfter = await db('groups').where({ id: grupB.id }).first();
    expect(groupAfter.mabrur_group_id).toBeTruthy();
    expect(groupAfter.mabrur_synced_at).toBeTruthy();
    const sitiRow = await db('jamaah').where({ full_name: 'Hj. Siti Rohmah' }).first();
    expect(sitiRow.mabrur_user_id).toBeTruthy();

    // Kredensial terenkripsi + bisa didekripsi = password yang dikirim
    const cred = await db('mabrur_credentials').where({ subject_type: 'jamaah', subject_id: sitiRow.id }).first();
    expect(cred).toBeTruthy();
    expect(cred.initial_password_enc).not.toContain(siti.initialPassword);
    expect(decrypt(cred.initial_password_enc)).toBe(siti.initialPassword);
  });

  it('sinkron ulang: akun lama "updated" → kredensial lama TIDAK ditimpa', async () => {
    const ops = await token('ops@safar.co.id');
    const grupB = await db('groups').where({ name: 'Grup B' }).first();
    const sitiRow = await db('jamaah').where({ full_name: 'Hj. Siti Rohmah' }).first();
    const before = await db('mabrur_credentials').where({ subject_type: 'jamaah', subject_id: sitiRow.id }).first();

    const res = await request(app).post(`/v1/mabrur/groups/${grupB.id}/sync`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBeGreaterThanOrEqual(4);
    expect(res.body.data.created).toBe(0);

    const after = await db('mabrur_credentials').where({ subject_type: 'jamaah', subject_id: sitiRow.id }).first();
    expect(after.initial_password_enc).toBe(before.initial_password_enc); // tidak berubah
  });

  it('sinkron ulang setelah ganti HP jamaah → phone kredensial ikut segar, password tetap', async () => {
    const ops = await token('ops@safar.co.id');
    const grupB = await db('groups').where({ name: 'Grup B' }).first();
    const sitiRow = await db('jamaah').where({ full_name: 'Hj. Siti Rohmah' }).first();
    const before = await db('mabrur_credentials').where({ subject_type: 'jamaah', subject_id: sitiRow.id }).first();

    const upd = await request(app)
      .patch(`/v1/jamaah/${sitiRow.id}`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ phone: '08139530699' });
    expect(upd.status).toBe(200);

    const res = await request(app).post(`/v1/mabrur/groups/${grupB.id}/sync`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);

    const after = await db('mabrur_credentials').where({ subject_type: 'jamaah', subject_id: sitiRow.id }).first();
    expect(after.phone).toBe('08139530699');
    expect(after.initial_password_enc).toBe(before.initial_password_enc);

    // kembalikan HP agar test lain tidak terpengaruh
    await db('jamaah').where({ id: sitiRow.id }).update({ phone: before.phone });
  });

  it('rombongan tanpa muthawwif ber-HP → ditolak dgn pesan jelas', async () => {
    const ops = await token('ops@safar.co.id');
    // Buat rombongan baru tanpa staf
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-VIP-12').select('d.id').first();
    const g = await request(app).post('/v1/groups').set('Authorization', `Bearer ${ops}`)
      .send({ departureId: dep.id, name: 'Grup Tanpa Staf', capacity: 10 });
    const res = await request(app).post(`/v1/mabrur/groups/${g.body.data.id}/sync`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('muthawwif');
  });

  it('kredensial rombongan bisa dilihat ops; RBAC marketing 403', async () => {
    const ops = await token('ops@safar.co.id');
    const grupB = await db('groups').where({ name: 'Grup B' }).first();
    const res = await request(app).get(`/v1/mabrur/groups/${grupB.id}/credentials`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(res.body.data[0].initialPassword).toMatch(/^\d{6}$/);

    const mkt = await token('marketing@safar.co.id');
    expect((await request(app).post(`/v1/mabrur/groups/${grupB.id}/sync`).set('Authorization', `Bearer ${mkt}`)).status).toBe(403);
  });

  it('portal jamaah memuat kredensial Mabrur', async () => {
    const siti = await db('jamaah').where({ full_name: 'Hj. Siti Rohmah' }).first();
    const login = await request(app).post('/v1/portal/login').send({ regNumber: 'UMR-2026-0418', nik: siti.nik });
    const me = await request(app).get('/v1/portal/me').set('Authorization', `Bearer ${login.body.data.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.mabrur).toBeTruthy();
    expect(me.body.data.mabrur.phone).toMatch(/^08/);
    expect(me.body.data.mabrur.initialPassword).toMatch(/^\d{6}$/);
    expect(me.body.data.mabrur.appUrl).toContain('mabrur');
  });

  it('status lapangan via proxy (mock)', async () => {
    const ops = await token('ops@safar.co.id');
    const grupB = await db('groups').where({ name: 'Grup B' }).first();
    const res = await request(app).get(`/v1/mabrur/groups/${grupB.id}/status`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    expect(res.body.data.group.kloterCode).toBe('MOCK-1');
  });

  it('status lapangan rombongan belum sinkron → 400 dgn pesan jelas', async () => {
    const ops = await token('ops@safar.co.id');
    const dep = await db('departures as d').join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT').select('d.id').first();
    const g = await request(app).post('/v1/groups').set('Authorization', `Bearer ${ops}`)
      .send({ departureId: dep.id, name: 'Grup Belum Sinkron', capacity: 10 });
    const res = await request(app).get(`/v1/mabrur/groups/${g.body.data.id}/status`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('belum disinkron');
  });

  it('server Mabrur mati → error jelas, sinkron aman diulang', async () => {
    const ops = await token('ops@safar.co.id');
    const grupA = await db('groups').where({ name: 'Grup A' }).first();
    const saved = env.mabrur.apiUrl;
    env.mabrur.apiUrl = 'http://127.0.0.1:9'; // port mati
    const res = await request(app).post(`/v1/mabrur/groups/${grupA.id}/sync`).set('Authorization', `Bearer ${ops}`);
    env.mabrur.apiUrl = saved;
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('tidak terjangkau');
    // tidak ada mapping tersimpan utk Grup A
    const g = await db('groups').where({ id: grupA.id }).first();
    expect(g.mabrur_synced_at).toBeNull();
  });
});
