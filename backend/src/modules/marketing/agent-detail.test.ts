import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';

/** GET /v1/jamaah/:id memuat agen + status komisi per registrasi (tanpa N+1 di klien). */

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

let seq = 0;
async function register(source?: string) {
  seq++;
  const dep = await db('departures as d')
    .join('packages as p', 'p.id', 'd.package_id')
    .where('p.code', 'UMR-REG-AT')
    .select('d.id')
    .first();
  const res = await request(app).post('/v1/registrations').send({
    departureId: dep.id, roomType: 'quad', paymentScheme: 'dp', ...(source ? { source } : {}),
    jamaah: {
      nik: `9933${String(seq).padStart(12, '0')}`, fullName: `UJI AGEN DETAIL ${seq}`, gender: 'L',
      birthPlace: 'Jakarta', birthDate: '1979-03-03', phone: '081200008888',
      address: 'Jl. Agen Detail No. 1, Jakarta', emergencyContactName: 'Keluarga',
      emergencyContactPhone: '081300008888', passportNo: `AD${String(seq).padStart(6, '0')}`,
      passportExpiry: '2030-12-01'
    }
  });
  expect(res.status).toBe(201);
  const reg = await db('registrations').where({ id: res.body.data.registrationId }).first();
  return { registrationId: reg.id as string, jamaahId: reg.jamaah_id as string };
}

async function detailReg(jamaahId: string, registrationId: string) {
  const adm = await token('admin@safar.co.id');
  const res = await request(app).get(`/v1/jamaah/${jamaahId}`).set('Authorization', `Bearer ${adm}`);
  expect(res.status).toBe(200);
  return res.body.data.registrations.find((r: { id: string }) => r.id === registrationId);
}

describe('GET /v1/jamaah/:id — agen & komisi per registrasi', () => {
  it('registrasi tanpa agen → agentId/agentName/commissionStatus null', async () => {
    const { registrationId, jamaahId } = await register();
    const r = await detailReg(jamaahId, registrationId);
    expect(r.agentId).toBeNull();
    expect(r.agentName).toBeNull();
    expect(r.commissionStatus).toBeNull();
  });

  it('wizard dgn kode referral → agen terisi, komisi pending; approve → approved', async () => {
    const { registrationId, jamaahId } = await register('agent:BRKH-07');
    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const r = await detailReg(jamaahId, registrationId);
    expect(r.agentId).toBe(agent.id);
    expect(r.agentName).toBe(agent.name);
    expect(r.commissionStatus).toBe('pending');

    const keu = await token('keuangan@safar.co.id');
    await db('registrations').where({ id: registrationId }).update({ status: 'active' }); // gate approve
    const commission = await db('commissions').where({ registration_id: registrationId }).first();
    const ap = await request(app).post(`/v1/commissions/${commission.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(ap.status).toBe(200);
    expect((await detailReg(jamaahId, registrationId)).commissionStatus).toBe('approved');
  });

  it('atribusi ulang ke agen lain → agentName ikut berubah', async () => {
    const { registrationId, jamaahId } = await register('agent:BRKH-07');
    const other = await db('agents').where({ code: 'AMNH-12' }).first();
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).post('/v1/commissions/attribute').set('Authorization', `Bearer ${keu}`)
      .send({ registrationId, agentId: other.id });
    expect(res.status).toBe(200);
    const r = await detailReg(jamaahId, registrationId);
    expect(r.agentId).toBe(other.id);
    expect(r.agentName).toBe(other.name);
    expect(r.commissionStatus).toBe('pending');
  });
});
