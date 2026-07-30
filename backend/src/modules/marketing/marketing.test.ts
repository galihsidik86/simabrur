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
    // Gate: hanya registrasi aktif yang komisinya bisa disetujui
    await db('registrations').where({ id: pending.registration_id }).update({ status: 'active' });
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

  it('RBAC: operasional & marketing tidak boleh approve (403) — pemisahan tugas', async () => {
    const ops = await token('ops@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const c = await db('commissions').first();
    expect((await request(app).post(`/v1/commissions/${c.id}/approve`).set('Authorization', `Bearer ${ops}`)).status).toBe(403);
    expect((await request(app).post(`/v1/commissions/${c.id}/approve`).set('Authorization', `Bearer ${mkt}`)).status).toBe(403);
  });

  it('gate: komisi registrasi belum aktif tak bisa disetujui (400)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const pending = await db('commissions as c').join('registrations as r', 'r.id', 'c.registration_id')
      .where('c.status', 'pending').andWhere('r.status', 'pending_documents').select('c.id').first();
    if (!pending) return; // tak ada kandidat → lewati
    const res = await request(app).post(`/v1/commissions/${pending.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('belum aktif');
  });
});

describe('siklus komisi: bayar, batalkan (storno), atribusi, komisi manual', () => {
  // Buat komisi approved segar via jalur manual (agentId) — mandiri dari jumlah komisi seed
  async function approvedCommission(keu: string) {
    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const res = await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${keu}`)
      .send({ agentId: agent.id, base: 5_000_000, pct: 3 });
    return res.body.data.commissionId as string;
  }

  it('bayar komisi approved → Dr 2-1400 · Cr Bank, status paid', async () => {
    const keu = await token('keuangan@safar.co.id');
    const id = await approvedCommission(keu);
    const res = await request(app).post(`/v1/commissions/${id}/pay`).set('Authorization', `Bearer ${keu}`).send({ bankAccountCode: '1-1200' });
    expect(res.status).toBe(200);
    const c = await db('commissions').where({ id }).first();
    expect(c.status).toBe('paid');
    const lines = await db('journal_lines as l').join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code', 'l.debit', 'l.credit').where('l.journal_id', c.payment_journal_id);
    expect(Number(lines.find((l) => l.code === '2-1400')?.debit)).toBe(Number(c.amount));
    expect(Number(lines.find((l) => l.code === '1-1200')?.credit)).toBe(Number(c.amount));
  });

  it('batalkan (storno) komisi approved → jurnal balik, kembali pending; komisi paid tak bisa dibatalkan (409)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const id = await approvedCommission(keu);
    const rev = await request(app).post(`/v1/commissions/${id}/reverse`).set('Authorization', `Bearer ${keu}`);
    expect(rev.status).toBe(200);
    const c = await db('commissions').where({ id }).first();
    expect(c.status).toBe('pending');
    expect(c.reversed_at).toBeTruthy();
    // jurnal storno membalik: Dr 2-1400 · Cr 6-2000
    const lines = await db('journal_lines as l').join('accounts as a', 'a.id', 'l.account_id')
      .select('a.code', 'l.debit', 'l.credit').where('l.journal_id', c.reversal_journal_id);
    expect(Number(lines.find((l) => l.code === '2-1400')?.debit)).toBe(Number(c.amount));
    expect(Number(lines.find((l) => l.code === '6-2000')?.credit)).toBe(Number(c.amount));

    // paid → reverse ditolak
    const id2 = await approvedCommission(keu);
    await request(app).post(`/v1/commissions/${id2}/pay`).set('Authorization', `Bearer ${keu}`).send({ bankAccountCode: '1-1200' });
    expect((await request(app).post(`/v1/commissions/${id2}/reverse`).set('Authorization', `Bearer ${keu}`)).status).toBe(409);
  });

  it('komisi manual via agentId (FK) → baris commissions terlacak + approved; agentName bebas ditolak', async () => {
    const keu = await token('keuangan@safar.co.id');
    const agent = await db('agents').where({ code: 'BRKH-07' }).first();
    const ok = await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${keu}`)
      .send({ agentId: agent.id, base: 10_000_000, pct: 3 });
    expect(ok.status).toBe(201);
    const c = await db('commissions').where({ id: ok.body.data.commissionId }).first();
    expect(c.status).toBe('approved');
    expect(c.registration_id).toBeNull();
    expect(Number(c.amount)).toBe(300_000);

    const bad = await request(app).post('/v1/transactions/commission').set('Authorization', `Bearer ${keu}`)
      .send({ agentName: 'Bebas', base: 1_000_000, pct: 3 });
    expect(bad.status).toBe(400);
  });

  it('atribusi ulang: tetapkan agen pada registrasi yang belum bersumber agen', async () => {
    const keu = await token('keuangan@safar.co.id');
    const agent = await db('agents').where({ code: 'AMNH-12' }).first();
    // registrasi tanpa komisi (source web)
    const reg = await db('registrations as r')
      .leftJoin('commissions as c', 'c.registration_id', 'r.id')
      .whereNull('c.id').select('r.id').first();
    if (!reg) return;
    const res = await request(app).post('/v1/commissions/attribute').set('Authorization', `Bearer ${keu}`)
      .send({ registrationId: reg.id, agentId: agent.id });
    expect(res.status).toBe(200);
    const c = await db('commissions').where({ registration_id: reg.id }).first();
    expect(c.agent_id).toBe(agent.id);
    const r = await db('registrations').where({ id: reg.id }).first();
    expect(r.agent_id).toBe(agent.id);
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
