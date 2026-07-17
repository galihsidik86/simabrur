import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';
import { passportExpiringSoon, readinessLevel, readinessScore } from './operations.rules.js';

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

// ===== Unit =====
describe('skor kesiapan', () => {
  it('rata-rata 4 metrik + ambang warna', () => {
    const score = readinessScore({ paymentPct: 100, documentPct: 96, visaIssued: 40, ticketIssued: 45, totalJamaah: 45 });
    expect(score).toBe(Math.round((100 + 96 + (40 / 45) * 100 + 100) / 4));
    expect(readinessLevel(92)).toBe('green');
    expect(readinessLevel(79)).toBe('gold');
    expect(readinessLevel(64)).toBe('red');
  });
});

describe('paspor perlu perpanjangan (< 7 bulan setelah keberangkatan)', () => {
  it('deteksi batas', () => {
    expect(passportExpiringSoon('2026-11-05', '2026-09-03')).toBe(true); // Budi (mockup: merah)
    expect(passportExpiringSoon('2027-09-30', '2026-08-20')).toBe(false); // Siti
    expect(passportExpiringSoon(null, '2026-08-20')).toBe(false);
  });
});

// ===== Integrasi =====
describe('GET /v1/departures/:id/manifest', () => {
  it('manifest Plus Turki: rombongan + muthawwif/TL + baris visa/tiket/kamar', async () => {
    const ops = await token('ops@safar.co.id');
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-TR')
      .select('d.id')
      .first();
    const res = await request(app).get(`/v1/departures/${dep.id}/manifest`).set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.manifestStatus).toBe('ready');
    expect(d.groups.map((g: { name: string }) => g.name).sort()).toEqual(['Grup A', 'Grup B']);
    expect(d.groups[0].muthawwif).toContain('Ust. Fadhil');
    expect(d.groups[0].tourLeader).toContain('Bpk. Surya');

    const siti = d.rows.find((r: { regNumber: string }) => r.regNumber === 'UMR-2026-0418');
    expect(siti).toMatchObject({ passportNo: 'C5120388', room: 'Triple 511' });
    expect(siti.visa.status).toBe('issued');
    expect(siti.ticket.pnr).toBe('TK-0452');
    expect(siti.passportExpiringSoon).toBe(false);

    const hendra = d.rows.find((r: { name: string }) => r.name === 'Ir. Hendra Wijaya');
    expect(hendra.visa.status).toBe('biometric');
    expect(hendra.passportExpiringSoon).toBe(true); // paspor 30 Des 2026 < Agu 2026 + 7 bln
  });

  it('RBAC: marketing ditolak 403', async () => {
    const mkt = await token('marketing@safar.co.id');
    const dep = await db('departures').first();
    const res = await request(app).get(`/v1/departures/${dep.id}/manifest`).set('Authorization', `Bearer ${mkt}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /v1/visas & /v1/tickets (upsert)', () => {
  it('operasional memperbarui status visa → terbit, lalu tiket PNR', async () => {
    const ops = await token('ops@safar.co.id');
    const reg = await db('registrations').where({ reg_number: 'UMR-2026-0421' }).first();

    const visa = await request(app).post('/v1/visas').set('Authorization', `Bearer ${ops}`)
      .send({ registrationId: reg.id, status: 'issued', visaNo: 'V-88014121' });
    expect(visa.status).toBe(201);
    expect(visa.body.data.status).toBe('issued');
    expect(visa.body.data.issued_at).toBeTruthy();

    const ticket = await request(app).post('/v1/tickets').set('Authorization', `Bearer ${ops}`)
      .send({ registrationId: reg.id, pnr: 'EK-0721', seat: '12A' });
    expect(ticket.status).toBe(201);
    expect(ticket.body.data.pnr).toBe('EK-0721');

    // Upsert: kirim ulang mengganti, bukan menduplikasi
    await request(app).post('/v1/tickets').set('Authorization', `Bearer ${ops}`)
      .send({ registrationId: reg.id, pnr: 'EK-0722' });
    const rows = await db('tickets').where({ registration_id: reg.id });
    expect(rows).toHaveLength(1);
    expect(rows[0].pnr).toBe('EK-0722');
  });
});

describe('checklist perlengkapan', () => {
  it('daftar item golden thread Siti + toggle', async () => {
    const ops = await token('ops@safar.co.id');
    const reg = await db('registrations').where({ reg_number: 'UMR-2026-0418' }).first();
    const list = await request(app).get('/v1/checklists').query({ registrationId: reg.id }).set('Authorization', `Bearer ${ops}`);
    expect(list.body.data).toHaveLength(4);
    expect(list.body.data.filter((c: { is_done: boolean }) => c.is_done)).toHaveLength(2); // koper + seragam (portal mockup)

    const item = list.body.data.find((c: { is_done: boolean }) => !c.is_done);
    const toggled = await request(app).patch(`/v1/checklists/${item.id}`).set('Authorization', `Bearer ${ops}`).send({ isDone: true });
    expect(toggled.body.data.is_done).toBe(true);
  });
});

describe('laporan kepatuhan & kesiapan', () => {
  it('kepatuhan: tile + per keberangkatan + matriks dokumen', async () => {
    const ops = await token('ops@safar.co.id');
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .where('p.code', 'UMR-PLUS-TR')
      .select('d.id')
      .first();
    const res = await request(app)
      .get('/v1/reports/document-compliance')
      .query({ departureId: dep.id })
      .set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.tiles.totalActive).toBeGreaterThanOrEqual(14);
    expect(d.tiles.passportIssues).toBeGreaterThanOrEqual(2); // Budi + Hendra (paspor < 7 bln)
    expect(d.perDeparture.length).toBeGreaterThanOrEqual(5);
    expect(d.matrix.length).toBe(6); // 6 jamaah Plus Turki
    const siti = d.matrix.find((m: { name: string }) => m.name === 'Hj. Siti Rohmah');
    expect(siti.cells.find((c: { type: string }) => c.type === 'VKS').status).toBe('no');
    expect(siti.rowStatus).toBe('Belum lengkap');
    const hendra = d.matrix.find((m: { name: string }) => m.name === 'Ir. Hendra Wijaya');
    expect(hendra.rowStatus).toBe('Perlu tindakan'); // PPR rejected
  });

  it('kesiapan: kartu per keberangkatan dengan skor & manifest', async () => {
    const ops = await token('ops@safar.co.id');
    const res = await request(app).get('/v1/reports/readiness').set('Authorization', `Bearer ${ops}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.tiles.manifestReady).toBeGreaterThanOrEqual(1);
    const plusTurki = d.cards.find((c: { packageName: string }) => c.packageName === 'Plus Turki');
    expect(plusTurki.manifestStatus).toBe('ready');
    expect(plusTurki.score).toBeGreaterThan(0);
    expect(plusTurki.metrics.visaIssued).toBeGreaterThanOrEqual(4);
    expect(['green', 'gold', 'red']).toContain(plusTurki.level);
  });
});

describe('GET /v1/reports/export (Excel)', () => {
  it('menghasilkan file xlsx untuk aging/compliance/readiness', async () => {
    const keu = await token('keuangan@safar.co.id');
    for (const report of ['aging', 'compliance', 'readiness']) {
      const res = await request(app).get('/v1/reports/export').query({ report }).set('Authorization', `Bearer ${keu}`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain(`laporan-${report}.xlsx`);
      expect(Number(res.headers['content-length'])).toBeGreaterThan(1000);
    }
  });

  it('report tidak dikenal → 400', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/reports/export').query({ report: 'xxx' }).set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(400);
  });
});
