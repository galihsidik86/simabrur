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

describe('GET /v1/agents (kinerja + KPI)', () => {
  it('6 agen seed dgn leads/konversi/komisi; KPI komisi terhutang = saldo 2-1400', async () => {
    const mkt = await token('marketing@safar.co.id');
    const res = await request(app).get('/v1/agents').set('Authorization', `Bearer ${mkt}`);
    expect(res.status).toBe(200);
    const { agents, kpi } = res.body.data;
    expect(agents.length).toBe(6);
    const barokah = agents.find((a: { code: string }) => a.code === 'BRKH-07');
    expect(barokah.referralCode).toBe('BRKH-07');
    expect(barokah.leads).toBeGreaterThan(0);
    expect(barokah.commissionTotal).toBeGreaterThan(0);
    expect(kpi.activeAgents).toBe(6);
    expect(kpi.commissionOwed).toBeGreaterThan(0); // jurnal komisi approved sudah diposting
  });

  it('RBAC: operasional 403', async () => {
    const ops = await token('ops@safar.co.id');
    expect((await request(app).get('/v1/agents').set('Authorization', `Bearer ${ops}`)).status).toBe(403);
  });
});

describe('registrasi wizard dgn kode referral', () => {
  it('source agent:BRKH-07 → lead converted + komisi pending 3% × total', async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT')
      .select('d.id')
      .first();
    const res = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'double', paymentScheme: 'dp', source: 'agent:brkh-07',
      jamaah: {
        nik: '9922000000000001', fullName: 'UJI REFERRAL AGEN', gender: 'L', birthPlace: 'Jakarta',
        birthDate: '1979-03-03', phone: '081200009999', address: 'Jl. Referral No. 7, Jakarta',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081300009999',
        passportNo: 'R1234567', passportExpiry: '2030-12-01'
      }
    });
    expect(res.status).toBe(201);
    const total = 31_000_000 + 8_000_000; // Reguler Akhir Tahun + double

    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const lead = await db('leads').where({ agent_id: agent.id, name: 'UJI REFERRAL AGEN' }).first();
    expect(lead.status).toBe('converted');

    const commission = await db('commissions').where({ registration_id: res.body.data.registrationId }).first();
    expect(commission.status).toBe('pending');
    expect(Number(commission.base_amount)).toBe(total);
    expect(Number(commission.amount)).toBe(Math.round(total * 0.03));
  });

  it('kode referral tidak dikenal → registrasi tetap sukses tanpa komisi', async () => {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-REG-AT')
      .select('d.id')
      .first();
    const res = await request(app).post('/v1/registrations').send({
      departureId: dep.id, roomType: 'quad', paymentScheme: 'dp', source: 'agent:TIDAK-ADA',
      jamaah: {
        nik: '9922000000000002', fullName: 'UJI TANPA AGEN', gender: 'L', birthPlace: 'Jakarta',
        birthDate: '1985-05-05', phone: '081200008888', address: 'Jl. Uji No. 8, Jakarta',
        emergencyContactName: 'Keluarga', emergencyContactPhone: '081300008888',
        passportNo: 'S1234567', passportExpiry: '2030-12-01'
      }
    });
    expect(res.status).toBe(201);
    const commission = await db('commissions').where({ registration_id: res.body.data.registrationId }).first();
    expect(commission).toBeUndefined();
  });
});

describe('POST /v1/commissions/:id/approve', () => {
  it('approve → jurnal F (Dr 6-2000 · Cr 2-1400) + status approved; approve ulang 409', async () => {
    const keu = await token('keuangan@safar.co.id');
    const pending = await db('commissions').where({ status: 'pending' }).first();
    const before2400 = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .where('a.code', '2-1400')
      .sum({ credit: 'l.credit' })
      .first();

    const res = await request(app).post(`/v1/commissions/${pending.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(200);
    expect(res.body.data.journalNo).toMatch(/^JV-/);
    expect(res.body.data.amount).toBe(Number(pending.amount));

    const after = await db('commissions').where({ id: pending.id }).first();
    expect(after.status).toBe('approved');
    expect(after.journal_id).toBeTruthy();

    const journal = await db('journals').where({ id: after.journal_id }).first();
    expect(journal.source).toBe('commission');
    const lines = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code', 'l.debit', 'l.credit')
      .where('l.journal_id', journal.id);
    expect(Number(lines.find((l) => l.code === '6-2000')?.debit)).toBe(Number(pending.amount));
    expect(Number(lines.find((l) => l.code === '2-1400')?.credit)).toBe(Number(pending.amount));

    const after2400 = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .where('a.code', '2-1400')
      .sum({ credit: 'l.credit' })
      .first();
    expect(Number(after2400?.credit) - Number(before2400?.credit)).toBe(Number(pending.amount));

    const again = await request(app).post(`/v1/commissions/${pending.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(again.status).toBe(409);
  });

  it('RBAC: operasional tidak boleh approve (403)', async () => {
    const ops = await token('ops@safar.co.id');
    const c = await db('commissions').first();
    expect((await request(app).post(`/v1/commissions/${c.id}/approve`).set('Authorization', `Bearer ${ops}`)).status).toBe(403);
  });
});

describe('agents & leads CRUD', () => {
  it('tambah agen (kode unik) + tambah lead', async () => {
    const mkt = await token('marketing@safar.co.id');
    const created = await request(app).post('/v1/agents').set('Authorization', `Bearer ${mkt}`)
      .send({ name: 'Mitra Baru Travel', code: 'mbru-01', commissionPct: 2 });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('MBRU-01');

    const dup = await request(app).post('/v1/agents').set('Authorization', `Bearer ${mkt}`)
      .send({ name: 'Duplikat', code: 'BRKH-07' });
    expect(dup.status).toBe(409);

    const lead = await request(app).post('/v1/leads').set('Authorization', `Bearer ${mkt}`)
      .send({ agentId: created.body.data.id, name: 'Prospek Baru', source: 'medsos' });
    expect(lead.status).toBe(201);
  });
});
