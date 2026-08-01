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

async function staff(email: string) {
  const res = await request(app).post('/v1/auth/login').send({ email, password: 'safar123' });
  return res.body.data.accessToken as string;
}

/** Aktifkan portal utk sebuah agen (set HP dulu) → kembalikan {phone, password, token, mustChange}. */
async function activateAndLogin(code: string, phone: string) {
  await db('agents').where({ code }).update({ phone });
  const mkt = await staff('marketing@safar.co.id');
  const agent = await db('agents').where({ code }).first();
  const act = await request(app).post(`/v1/agents/${agent.id}/portal-activate`).set('Authorization', `Bearer ${mkt}`);
  expect(act.status).toBe(200);
  const login = await request(app).post('/v1/portal-agen/login').send({ phone, password: act.body.data.initialPassword });
  expect(login.status).toBe(200);
  return { agentId: agent.id, phone, password: act.body.data.initialPassword, token: login.body.data.token, mustChange: login.body.data.mustChangePassword };
}

describe('Portal Agen — aktivasi & login', () => {
  it('marketing aktifkan portal → agen login (wajib ganti password); RBAC & password salah', async () => {
    const s = await activateAndLogin('BRKH-07', '081200000007');
    expect(s.mustChange).toBe(true);

    // password salah → 401
    expect((await request(app).post('/v1/portal-agen/login').send({ phone: s.phone, password: 'SALAHSALAH' })).status).toBe(401);
    // agen belum diaktifkan tak bisa login (AMNH-12 belum diaktifkan)
    await db('agents').where({ code: 'AMNH-12' }).update({ phone: '081200000012' });
    expect((await request(app).post('/v1/portal-agen/login').send({ phone: '081200000012', password: 'apapun12' })).status).toBe(401);

    // RBAC: operasional tak boleh aktifkan portal (403)
    const ops = await staff('ops@safar.co.id');
    const amnh = await db('agents').where({ code: 'AMNH-12' }).first();
    expect((await request(app).post(`/v1/agents/${amnh.id}/portal-activate`).set('Authorization', `Bearer ${ops}`)).status).toBe(403);
  });

  it('ganti password: lama salah 400; sukses → mustChange false & login pakai password baru', async () => {
    const s = await activateAndLogin('FTMH-21', '081200000021');
    const H = { Authorization: `Bearer ${s.token}` };
    expect((await request(app).post('/v1/portal-agen/change-password').set(H).send({ oldPassword: 'salah', newPassword: 'barubaru123' })).status).toBe(400);
    const cp = await request(app).post('/v1/portal-agen/change-password').set(H).send({ oldPassword: s.password, newPassword: 'barubaru123' });
    expect(cp.status).toBe(200);
    const relogin = await request(app).post('/v1/portal-agen/login').send({ phone: s.phone, password: 'barubaru123' });
    expect(relogin.body.data.mustChangePassword).toBe(false);
  });
});

describe('Portal Agen — isolasi & PII', () => {
  it('agen hanya melihat referral & komisi MILIKNYA; data jamaah TANPA PII sensitif', async () => {
    const s = await activateAndLogin('BRKH-07', '081200000107');
    const H = { Authorization: `Bearer ${s.token}` };

    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const ownRegs = await db('registrations').where({ agent_id: agent.id }).count({ n: '*' }).first();

    const jamaah = await request(app).get('/v1/portal-agen/jamaah').set(H);
    expect(jamaah.status).toBe(200);
    expect(jamaah.body.data.length).toBe(Number(ownRegs.n));
    // referral agen LAIN (AMNH-12 → UMR-2026-0421) TIDAK muncul
    expect(jamaah.body.data.find((r: { regNumber: string }) => r.regNumber === 'UMR-2026-0421')).toBeUndefined();
    // PII sensitif tak bocor
    const first = jamaah.body.data[0] ?? {};
    for (const k of ['nik', 'passportNo', 'passport_no', 'documents', 'address']) expect(first[k]).toBeUndefined();
    expect(first).toHaveProperty('paymentPct');

    const comms = await request(app).get('/v1/portal-agen/commissions').set(H);
    const ownComms = await db('commissions').where({ agent_id: agent.id }).count({ n: '*' }).first();
    expect(comms.body.data.length).toBe(Number(ownComms.n));

    const summary = await request(app).get('/v1/portal-agen/summary').set(H);
    expect(summary.body.data.totalReferrals).toBe(Number(ownRegs.n));
  });

  it('saling-tolak antar-kind: token agen ditolak di rute staf & portal jamaah; sebaliknya juga', async () => {
    const s = await activateAndLogin('RHMH-09', '081200000009');
    const agentH = { Authorization: `Bearer ${s.token}` };
    // token agen → rute staf 403, portal jamaah 401
    expect((await request(app).get('/v1/agents').set(agentH)).status).toBe(403);
    expect((await request(app).get('/v1/portal/me').set(agentH)).status).toBe(401);
    // token staf → rute agen 401 (bukan kind agent)
    const mkt = await staff('marketing@safar.co.id');
    expect((await request(app).get('/v1/portal-agen/me').set({ Authorization: `Bearer ${mkt}` })).status).toBe(401);
  });

  it('input lead dari portal → tersimpan utk agen ini (source portal-agen)', async () => {
    const s = await activateAndLogin('SKNH-03', '081200000003');
    const H = { Authorization: `Bearer ${s.token}` };
    const add = await request(app).post('/v1/portal-agen/leads').set(H).send({ name: 'Prospek Portal', phone: '0812999' });
    expect(add.status).toBe(201);
    const list = await request(app).get('/v1/portal-agen/leads').set(H);
    const lead = list.body.data.find((l: { name: string }) => l.name === 'Prospek Portal');
    expect(lead).toBeTruthy();
    expect(lead.source).toBe('portal-agen');
  });
});

describe('Portal Agen — notifikasi komisi cair', () => {
  it('bayar komisi → notifikasi masuk portal agen; badge unread; tandai terbaca', async () => {
    const keu = await staff('keuangan@safar.co.id');
    const s = await activateAndLogin('BRKH-07', '081200000299');
    const H = { Authorization: `Bearer ${s.token}` };
    const agent = await db('agents').where({ code: 'BRKH-07' }).first();

    // komisi pending milik BRKH-07 (punya registrasi) → aktifkan registrasi, setujui, bayar
    const comm = await db('commissions').where({ agent_id: agent.id, status: 'pending' }).whereNotNull('registration_id').first();
    await db('registrations').where({ id: comm.registration_id }).update({ status: 'active' });
    await request(app).post(`/v1/commissions/${comm.id}/approve`).set('Authorization', `Bearer ${keu}`);
    const pay = await request(app).post(`/v1/commissions/${comm.id}/pay`).set('Authorization', `Bearer ${keu}`).send({ bankAccountCode: '1-1200' });
    expect(pay.status).toBe(200);

    // agen melihat notifikasi + badge unread
    const summary = await request(app).get('/v1/portal-agen/summary').set(H);
    expect(summary.body.data.unreadNotifications).toBeGreaterThanOrEqual(1);
    const notif = await request(app).get('/v1/portal-agen/notifications').set(H);
    const cair = notif.body.data.find((n: { type: string }) => n.type === 'commission_paid');
    expect(cair).toBeTruthy();
    expect(cair.body).toContain('telah dibayar');
    expect(cair.readAt).toBeNull();
    // beberapa jenis notifikasi hadir: disetujui (dari approve barusan) + referral (dari seed)
    const types = new Set(notif.body.data.map((n: { type: string }) => n.type));
    expect(types.has('commission_approved')).toBe(true);
    expect(types.has('referral_registered')).toBe(true);

    // tandai terbaca → badge 0
    await request(app).post('/v1/portal-agen/notifications/read').set(H);
    const after = await request(app).get('/v1/portal-agen/summary').set(H);
    expect(after.body.data.unreadNotifications).toBe(0);

    // isolasi: agen lain tak melihat notifikasi ini
    const other = await activateAndLogin('AMNH-12', '081200000212');
    const otherNotif = await request(app).get('/v1/portal-agen/notifications').set({ Authorization: `Bearer ${other.token}` });
    expect(otherNotif.body.data.find((n: { type: string }) => n.type === 'commission_paid')).toBeUndefined();
  });
});
