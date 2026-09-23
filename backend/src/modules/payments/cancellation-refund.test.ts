import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { db } from '../../config/db.js';
import { createApp } from '../../app.js';
import { resetTestDb } from '../../test/db-setup.js';

/**
 * Langkah 9 — pembatalan registrasi + refund (lihat kontrak di
 * .orkestra/runs/20260915-1856-audit-sistem/plan.md "Kontrak pembatalan & refund").
 * File terpisah (bukan menambah ke jamaah.test.ts/payments.test.ts yang sudah besar)
 * karena fitur ini lintas modul (jamaah, payments, marketing, operations, portal).
 */

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

let nikCounter = 0;
function jamaahPayload(overrides: Record<string, unknown> = {}) {
  nikCounter++;
  const seq = String(nikCounter).padStart(14, '0');
  return {
    nik: `97${seq}`,
    fullName: `UJI BATAL ${nikCounter}`,
    gender: 'L',
    birthPlace: 'Jakarta',
    birthDate: '1990-01-01',
    phone: '081200001111',
    address: 'Jl. Uji Batal No. 1, Jakarta',
    emergencyContactName: 'Keluarga Uji',
    emergencyContactPhone: '081300001111',
    passportNo: `PB${String(nikCounter).padStart(6, '0')}`,
    passportExpiry: '2031-01-01',
    ...overrides
  };
}

async function createPackageWithDeparture(
  admin: string,
  code: string,
  opts: Partial<{ quota: number; basePrice: number }> = {}
) {
  const res = await request(app)
    .post('/v1/packages')
    .set('Authorization', `Bearer ${admin}`)
    .send({
      code,
      name: `Paket Uji ${code}`,
      type: 'umrah',
      category: 'reguler',
      durationDays: 9,
      basePrice: opts.basePrice ?? 20_000_000,
      departure: { departureDate: '2027-05-20', quota: opts.quota ?? 5 }
    });
  expect(res.status).toBe(201);
  const pkg = await db('packages').where({ code }).first();
  const dep = await db('departures').where({ package_id: pkg.id }).first();
  const cc = await db('cost_centers').where({ departure_id: dep.id }).first();
  return { pkg, dep, cc };
}

async function register(depId: string, jamaah: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return request(app)
    .post('/v1/registrations')
    .send({ departureId: depId, roomType: 'quad', paymentScheme: 'lunas', ...extra, jamaah });
}

async function liab2100(costCenterId: string): Promise<number> {
  const [{ liab }] = await db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .join('journals as j', 'j.id', 'l.journal_id')
    .where('a.code', '2-1100')
    .andWhere('j.cost_center_id', costCenterId)
    .select(db.raw('COALESCE(SUM(l.credit - l.debit), 0) AS liab'));
  return Number(liab);
}

/** Registrasi + pembayaran penuh terverifikasi + pembatalan → refund `pending`. */
async function setupCancelledWithRefund(admin: string, keu: string, ops: string, code: string, amount: number) {
  const { dep, cc } = await createPackageWithDeparture(admin, code, { basePrice: amount, quota: 3 });
  const reg = await register(dep.id, jamaahPayload());
  expect(reg.status).toBe(201);
  const invoiceId = reg.body.data.invoiceId;
  const pay = await request(app)
    .post('/v1/payments')
    .set('Authorization', `Bearer ${keu}`)
    .send({ invoiceId, bankAccountCode: '1-1200', amount, method: 'transfer' });
  expect(pay.status).toBe(201);
  const ver = await request(app).patch(`/v1/payments/${pay.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
  expect(ver.status).toBe(200);
  const cancel = await request(app)
    .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
    .set('Authorization', `Bearer ${ops}`)
    .send({ reason: 'Uji refund' });
  expect(cancel.status).toBe(200);
  return { dep, cc, reg, refund: cancel.body.data.refund as { id: string; status: string } };
}

describe('POST /v1/registrations/:id/cancel — tanpa pembayaran', () => {
  it('a) 200, status cancelled, seats_taken turun 1, termin unpaid → cancelled, refund null; kuota penuh reusable', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-BATAL-A', { quota: 1 });

    const reg = await register(dep.id, jamaahPayload(), { paymentScheme: 'dp' });
    expect(reg.status).toBe(201);

    const full = await register(dep.id, jamaahPayload(), { paymentScheme: 'dp' });
    expect(full.status).toBe(409);

    const cancel = await request(app)
      .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Jamaah mengundurkan diri' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data).toMatchObject({ registrationId: reg.body.data.registrationId, status: 'cancelled', refund: null });

    const depAfter = await db('departures').where({ id: dep.id }).first();
    expect(depAfter.seats_taken).toBe(0);

    const schedules = await db('payment_schedules').where({ registration_id: reg.body.data.registrationId });
    expect(schedules.length).toBeGreaterThan(0);
    expect(schedules.every((s) => s.status === 'cancelled')).toBe(true);

    // Kuota yang dilepas bisa dipakai pendaftar baru
    const again = await register(dep.id, jamaahPayload(), { paymentScheme: 'dp' });
    expect(again.status).toBe(201);
  });
});

describe('POST /v1/registrations/:id/cancel — komisi agen', () => {
  it('komisi pending (belum dijurnal) tetap pending, tak bisa disetujui lagi setelah registrasi dibatalkan', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-KOMISI-P');
    const res = await register(dep.id, jamaahPayload(), { source: 'agent:brkh-07' });
    expect(res.status).toBe(201);
    const commissionBefore = await db('commissions').where({ registration_id: res.body.data.registrationId }).first();
    expect(commissionBefore.status).toBe('pending');

    const cancel = await request(app)
      .post(`/v1/registrations/${res.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal sebelum aktif' });
    expect(cancel.status).toBe(200);

    const commissionAfter = await db('commissions').where({ id: commissionBefore.id }).first();
    expect(commissionAfter.status).toBe('pending');

    const approve = await request(app).post(`/v1/commissions/${commissionBefore.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(approve.status).toBe(400); // registrasi cancelled, bukan active/completed
  });

  it('komisi approved (sudah dijurnal) dibalik: status kembali pending, jurnal storno tercatat', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-KOMISI-A');
    const res = await register(dep.id, jamaahPayload(), { source: 'agent:brkh-07' });
    const regId = res.body.data.registrationId;
    await db('registrations').where({ id: regId }).update({ status: 'active' });
    const commission = await db('commissions').where({ registration_id: regId }).first();
    const approve = await request(app).post(`/v1/commissions/${commission.id}/approve`).set('Authorization', `Bearer ${keu}`);
    expect(approve.status).toBe(200);

    const cancel = await request(app)
      .post(`/v1/registrations/${regId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal setelah komisi disetujui' });
    expect(cancel.status).toBe(200);

    const after = await db('commissions').where({ id: commission.id }).first();
    expect(after.status).toBe('pending');
    expect(after.journal_id).toBeNull();
    expect(after.reversal_journal_id).toBeTruthy();
    expect(after.reversed_at).toBeTruthy();
    expect(after.clawback_required).toBe(false);
  });

  it('komisi paid ditandai clawback_required (tidak dibalik otomatis, status tetap paid)', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-KOMISI-B');
    const res = await register(dep.id, jamaahPayload(), { source: 'agent:brkh-07' });
    const regId = res.body.data.registrationId;
    await db('registrations').where({ id: regId }).update({ status: 'active' });
    const commission = await db('commissions').where({ registration_id: regId }).first();
    await request(app).post(`/v1/commissions/${commission.id}/approve`).set('Authorization', `Bearer ${keu}`);
    const pay = await request(app)
      .post(`/v1/commissions/${commission.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ bankAccountCode: '1-1200' });
    expect(pay.status).toBe(200);

    const cancel = await request(app)
      .post(`/v1/registrations/${regId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal setelah komisi dibayar' });
    expect(cancel.status).toBe(200);

    const after = await db('commissions').where({ id: commission.id }).first();
    expect(after.status).toBe('paid');
    expect(after.clawback_required).toBe(true);
    expect(after.clawback_marked_at).toBeTruthy();
  });
});

describe('POST /v1/registrations/:id/cancel — pembayaran campuran', () => {
  it('b) verified + pending → pending jadi rejected; refund pending dgn paidTotal = Σ verified', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-BATAL-B', { basePrice: 20_000_000, quota: 3 });
    const reg = await register(dep.id, jamaahPayload());
    expect(reg.status).toBe(201);
    const invoiceId = reg.body.data.invoiceId;

    const p1 = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId, bankAccountCode: '1-1200', amount: 12_000_000, method: 'transfer' });
    expect(p1.status).toBe(201);
    const v1 = await request(app).patch(`/v1/payments/${p1.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(v1.status).toBe(200);

    const p2 = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId, bankAccountCode: '1-1200', amount: 5_000_000, method: 'transfer' });
    expect(p2.status).toBe(201);

    const cancel = await request(app)
      .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal — campuran pembayaran' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.refund).toMatchObject({ status: 'pending', paidTotal: 12_000_000, refundAmount: 12_000_000, deduction: 0 });

    const p2After = await db('payments').where({ id: p2.body.data.id }).first();
    expect(p2After.status).toBe('rejected');
    expect(p2After.reject_reason).toBe('registrasi dibatalkan');
  });
});

describe('RBAC pembatalan & refund', () => {
  it('c) keuangan/marketing/pimpinan tak bisa cancel; operasional tak bisa pay refund; pimpinan bisa GET refunds', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const pim = await token('pimpinan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-RBAC');
    const reg = await register(dep.id, jamaahPayload());
    expect(reg.status).toBe(201);

    for (const tok of [keu, mkt, pim]) {
      const res = await request(app)
        .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
        .set('Authorization', `Bearer ${tok}`)
        .send({ reason: 'Percobaan tanpa hak' });
      expect(res.status).toBe(403);
    }

    const { refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-RBAC-PAY', 5_000_000);
    const payAttempt = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ deduction: 0, bankAccountCode: '1-1200' });
    expect(payAttempt.status).toBe(403);

    const list = await request(app).get('/v1/refunds').set('Authorization', `Bearer ${pim}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
  });
});

describe('POST /v1/refunds/:id/pay', () => {
  it('d) deduction 0 → Dr 2-1100 = Cr Bank; saldo 2-1100 CC turun sebesar paidTotal; replay idempotent; pay dua kali (tanpa key) → 409', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { cc, refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-D0', 10_000_000);
    const before = await liab2100(cc.id);

    const key = `refund-idem-${refund.id}`;
    const pay1 = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .set('Idempotency-Key', key)
      .send({ deduction: 0, bankAccountCode: '1-1200' });
    expect(pay1.status).toBe(200);
    expect(pay1.body.data.status).toBe('paid');
    expect(pay1.body.data.refundAmount).toBe(10_000_000);
    const journalNo1 = pay1.body.data.journalNumber as string;

    const lines = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .join('journals as j', 'j.id', 'l.journal_id')
      .where('j.journal_no', journalNo1)
      .select('a.code', 'l.debit', 'l.credit');
    const liabLine = lines.find((l) => l.code === '2-1100');
    const bankLine = lines.find((l) => l.code === '1-1200');
    expect(Number(liabLine?.debit)).toBe(10_000_000);
    expect(Number(bankLine?.credit)).toBe(10_000_000);
    expect(lines.find((l) => l.code === '4-9000')).toBeUndefined();

    const after = await liab2100(cc.id);
    expect(after).toBe(before - 10_000_000);

    const journalCountBefore = await db('journals').where({ source: 'refund', ref_id: refund.id }).count({ n: '*' }).first();
    const replay = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .set('Idempotency-Key', key)
      .send({ deduction: 0, bankAccountCode: '1-1200' });
    expect(replay.status).toBe(200);
    expect(replay.body.data.journalNumber).toBe(journalNo1);
    const journalCountAfter = await db('journals').where({ source: 'refund', ref_id: refund.id }).count({ n: '*' }).first();
    expect(Number(journalCountAfter?.n)).toBe(Number(journalCountBefore?.n));

    const again = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 0, bankAccountCode: '1-1200' });
    expect(again.status).toBe(409);
  });

  it('R3-01: dua request BERSAMAAN dgn Idempotency-Key sama → dua-duanya 200 & satu jurnal (bukan 409 palsu)', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-R301', 7_000_000);

    const key = `refund-balapan-${refund.id}`;
    const kirim = () =>
      request(app)
        .post(`/v1/refunds/${refund.id}/pay`)
        .set('Authorization', `Bearer ${keu}`)
        .set('Idempotency-Key', key)
        .send({ deduction: 0, bankAccountCode: '1-1200' });

    // Pemeriksaan Idempotency-Key berjalan DI LUAR transaksi, jadi dua request yang
    // datang bersamaan sama-sama lolos. Sebelum perbaikan, yang kalah lock mendapati
    // refund sudah `paid` lalu dijawab 409 — padahal justru percobaan ulang seperti
    // inilah yang seharusnya dilindungi Idempotency-Key.
    const [a, b] = await Promise.all([kirim(), kirim()]);

    expect([a.status, b.status], `a=${JSON.stringify(a.body)} b=${JSON.stringify(b.body)}`).toEqual([200, 200]);
    expect(a.body.data.status).toBe('paid');
    expect(b.body.data.journalNumber).toBe(a.body.data.journalNumber);

    // Yang terpenting: tidak ada pembayaran ganda — hanya satu jurnal refund terbentuk.
    const jurnal = await db('journals').where({ source: 'refund', ref_id: refund.id }).count({ n: '*' }).first();
    expect(Number(jurnal?.n)).toBe(1);
  });

  it('deduction 1.000.000 → Cr 4-9000 sebesar potongan, refundAmount = paidTotal − deduction', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-DED', 10_000_000);
    const pay = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 1_000_000, deductionReason: 'Biaya administrasi pembatalan', bankAccountCode: '1-1200' });
    expect(pay.status).toBe(200);
    expect(pay.body.data.deduction).toBe(1_000_000);
    expect(pay.body.data.refundAmount).toBe(9_000_000);
    const lines = await db('journal_lines as l')
      .join('accounts as a', 'a.id', 'l.account_id')
      .join('journals as j', 'j.id', 'l.journal_id')
      .where('j.journal_no', pay.body.data.journalNumber)
      .select('a.code', 'l.debit', 'l.credit');
    const gain = lines.find((l) => l.code === '4-9000');
    expect(Number(gain?.credit)).toBe(1_000_000);
  });

  it('deduction > paidTotal → 400; deduction > 0 tanpa alasan → 400', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-INV', 10_000_000);
    const over = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 11_000_000, bankAccountCode: '1-1200' });
    expect(over.status).toBe(400);
    const noReason = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 500_000, bankAccountCode: '1-1200' });
    expect(noReason.status).toBe(400);
  });
});

describe('A (putaran 3): kwitansi refund KWR/YYYY/MM/NNNN + GET /v1/refunds/:id/receipt', () => {
  it('nomor KWR terbit saat dibayar (bulan/tahun dari tanggal refund WIB); tampil di RefundDto (list & detail)', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { reg, refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-KWR', 10_000_000);

    // Sebelum dibayar: belum ada nomor kwitansi di RefundDto pending.
    const pending = await request(app).get('/v1/refunds').query({ status: 'pending' }).set('Authorization', `Bearer ${keu}`);
    const pendingRow = pending.body.data.find((r: { id: string }) => r.id === refund.id);
    expect(pendingRow.receiptNumber).toBeNull();

    const pay = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 1_000_000, deductionReason: 'Biaya adm', bankAccountCode: '1-1200' });
    expect(pay.status).toBe(200);
    expect(pay.body.data.receiptNumber).toMatch(/^KWR\/\d{4}\/\d{2}\/\d{4}$/);

    const list = await request(app).get('/v1/refunds').query({ status: 'paid' }).set('Authorization', `Bearer ${keu}`);
    const row = list.body.data.find((r: { id: string }) => r.id === refund.id);
    expect(row.receiptNumber).toBe(pay.body.data.receiptNumber);

    const jamaahDetail = await request(app).get(`/v1/jamaah/${reg.body.data.jamaahId}`).set('Authorization', `Bearer ${keu}`);
    const regRow = jamaahDetail.body.data.registrations.find((r: { id: string }) => r.id === reg.body.data.registrationId);
    expect(regRow.refund.receiptNumber).toBe(pay.body.data.receiptNumber);

    // Replay idempotent (key sama) TIDAK menerbitkan nomor baru.
    const key = `refund-kwr-idem-${refund.id}`;
    const admin2 = await token('admin@safar.co.id');
    const ops2 = await token('ops@safar.co.id');
    const { refund: refund2 } = await setupCancelledWithRefund(admin2, keu, ops2, 'UJI-REFUND-KWR-2', 5_000_000);
    const first = await request(app).post(`/v1/refunds/${refund2.id}/pay`).set('Authorization', `Bearer ${keu}`)
      .set('Idempotency-Key', key).send({ deduction: 0, bankAccountCode: '1-1200' });
    const replay = await request(app).post(`/v1/refunds/${refund2.id}/pay`).set('Authorization', `Bearer ${keu}`)
      .set('Idempotency-Key', key).send({ deduction: 0, bankAccountCode: '1-1200' });
    expect(replay.body.data.receiptNumber).toBe(first.body.data.receiptNumber);
  });

  it('GET /v1/refunds/:id/receipt: 404 sebelum dibayar; setelah dibayar mengembalikan bentuk kwitansi lengkap; role keuangan/pimpinan/operasional/marketing/admin lolos', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const mkt = await token('marketing@safar.co.id');
    const pimpinan = await token('pimpinan@safar.co.id');
    const { refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-REFUND-RCP', 10_000_000);

    const before = await request(app).get(`/v1/refunds/${refund.id}/receipt`).set('Authorization', `Bearer ${keu}`);
    expect(before.status).toBe(404);

    const pay = await request(app)
      .post(`/v1/refunds/${refund.id}/pay`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ deduction: 2_000_000, deductionReason: 'Potongan admin', bankAccountCode: '1-1200', reference: 'REF-KWR-1' });
    expect(pay.status).toBe(200);

    for (const t of [keu, pimpinan, ops, mkt, admin]) {
      const res = await request(app).get(`/v1/refunds/${refund.id}/receipt`).set('Authorization', `Bearer ${t}`);
      expect(res.status).toBe(200);
    }

    const doc = (await request(app).get(`/v1/refunds/${refund.id}/receipt`).set('Authorization', `Bearer ${keu}`)).body.data;
    expect(doc).toMatchObject({
      refundId: refund.id,
      receiptNumber: pay.body.data.receiptNumber,
      regNumber: expect.any(String),
      jamaahName: expect.any(String),
      packageName: expect.any(String),
      departureDate: expect.any(String),
      cancelReason: 'Uji refund',
      paidTotal: 10_000_000,
      deduction: 2_000_000,
      deductionReason: 'Potongan admin',
      refundAmount: 8_000_000,
      reference: 'REF-KWR-1',
      journalNumber: pay.body.data.journalNumber,
      paidByName: expect.any(String)
    });
    expect(doc.amountInWords.toLowerCase()).toContain('rupiah');
    expect(doc.bankAccount).toMatchObject({ code: '1-1200' });
  });

  it('404 utk refund yang tidak ada', async () => {
    const keu = await token('keuangan@safar.co.id');
    const res = await request(app).get('/v1/refunds/00000000-0000-0000-0000-000000000000/receipt').set('Authorization', `Bearer ${keu}`);
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/registrations/:id/cancel — ditolak', () => {
  it('e1) setelah pendapatan keberangkatan diakui → 409', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep, cc } = await createPackageWithDeparture(admin, 'UJI-BATAL-REV', { basePrice: 10_000_000, quota: 2 });
    const reg = await register(dep.id, jamaahPayload());
    const invoiceId = reg.body.data.invoiceId;
    const pay = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId, bankAccountCode: '1-1200', amount: 10_000_000, method: 'transfer' });
    await request(app).patch(`/v1/payments/${pay.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);

    const rev = await request(app)
      .post('/v1/transactions/revenue-recognition')
      .set('Authorization', `Bearer ${keu}`)
      .send({ costCenterId: cc.id, revenueAccountCode: '4-1000', amount: 10_000_000 });
    expect(rev.status).toBe(201);

    const cancel = await request(app)
      .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Coba batal setelah pendapatan diakui' });
    expect(cancel.status).toBe(409);
  });

  it('e2) batal dua kali → 409', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-BATAL-DUA');
    const reg = await register(dep.id, jamaahPayload());
    const first = await request(app)
      .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal pertama' });
    expect(first.status).toBe(200);
    const second = await request(app)
      .post(`/v1/registrations/${reg.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Batal kedua' });
    expect(second.status).toBe(409);
  });
});

describe('PATCH /v1/payments/:id/reject', () => {
  it('f) reject pending → 200 rejected tanpa jurnal; reject verified → 409; verify yang sudah rejected → 409', async () => {
    const admin = await token('admin@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-REJECT', { basePrice: 10_000_000, quota: 2 });
    const reg = await register(dep.id, jamaahPayload());
    const invoiceId = reg.body.data.invoiceId;

    const p1 = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId, bankAccountCode: '1-1200', amount: 4_000_000, method: 'transfer' });
    expect(p1.status).toBe(201);
    const journalCountBefore = await db('journals').count({ n: '*' }).first();

    const reject = await request(app)
      .patch(`/v1/payments/${p1.body.data.id}/reject`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Bukti transfer tidak valid' });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe('rejected');
    expect(reject.body.data.rejectReason).toBe('Bukti transfer tidak valid');
    const journalCountAfter = await db('journals').count({ n: '*' }).first();
    expect(Number(journalCountAfter?.n)).toBe(Number(journalCountBefore?.n));

    const rejectAgain = await request(app)
      .patch(`/v1/payments/${p1.body.data.id}/reject`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba lagi' });
    expect(rejectAgain.status).toBe(409);

    const verifyRejected = await request(app).patch(`/v1/payments/${p1.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(verifyRejected.status).toBe(409);

    const p2 = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId, bankAccountCode: '1-1200', amount: 4_000_000, method: 'transfer' });
    const v2 = await request(app).patch(`/v1/payments/${p2.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);
    expect(v2.status).toBe(200);
    const rejectVerified = await request(app)
      .patch(`/v1/payments/${p2.body.data.id}/reject`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ reason: 'Coba tolak yang sudah terverifikasi' });
    expect(rejectVerified.status).toBe(409);
  });
});

describe('registrasi cancelled dikecualikan dari laporan; login portal ditolak', () => {
  it('g) tak muncul di receivables/aging/readiness/compliance/manifest; login portal → 403', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { dep } = await createPackageWithDeparture(admin, 'UJI-EXCL', { basePrice: 10_000_000, quota: 3 });
    const jm1 = jamaahPayload();
    const reg1 = await register(dep.id, jm1);
    expect(reg1.status).toBe(201);
    const jm2 = jamaahPayload();
    const reg2 = await register(dep.id, jm2);
    expect(reg2.status).toBe(201);

    const inv2 = reg2.body.data.invoiceId;
    const pay2 = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: inv2, bankAccountCode: '1-1200', amount: 4_000_000, method: 'transfer' });
    await request(app).patch(`/v1/payments/${pay2.body.data.id}/verify`).set('Authorization', `Bearer ${keu}`);

    const cancel = await request(app)
      .post(`/v1/registrations/${reg2.body.data.registrationId}/cancel`)
      .set('Authorization', `Bearer ${ops}`)
      .send({ reason: 'Uji pengecualian laporan' });
    expect(cancel.status).toBe(200);

    const receivables = await request(app).get('/v1/receivables').set('Authorization', `Bearer ${keu}`);
    expect(receivables.body.data.data.some((r: { regNumber: string }) => r.regNumber === reg2.body.data.regNumber)).toBe(false);

    const aging = await request(app).get('/v1/receivables/aging').set('Authorization', `Bearer ${ops}`);
    expect(aging.body.data.rows.some((r: { regNumber: string }) => r.regNumber === reg2.body.data.regNumber)).toBe(false);

    const readiness = await request(app).get('/v1/reports/readiness').set('Authorization', `Bearer ${ops}`);
    const card = readiness.body.data.cards.find((c: { departureId: string }) => c.departureId === dep.id);
    expect(card.jamaahCount).toBe(1); // hanya reg1 (reg2 dibatalkan)

    const compliance = await request(app)
      .get('/v1/reports/document-compliance')
      .query({ departureId: dep.id })
      .set('Authorization', `Bearer ${ops}`);
    expect(compliance.body.data.matrix).toHaveLength(1);
    expect(compliance.body.data.matrix[0].name).toBe(jm1.fullName);

    const manifest = await request(app).get(`/v1/departures/${dep.id}/manifest`).set('Authorization', `Bearer ${ops}`);
    expect(manifest.body.data.rows.some((r: { regNumber: string }) => r.regNumber === reg2.body.data.regNumber)).toBe(false);

    const login = await request(app).post('/v1/portal/login').send({ regNumber: reg2.body.data.regNumber, nik: jm2.nik });
    expect(login.status).toBe(403);
    expect(login.body.error.message).toContain('dibatalkan');

    const loginStillActive = await request(app).post('/v1/portal/login').send({ regNumber: reg1.body.data.regNumber, nik: jm1.nik });
    expect(loginStillActive.status).toBe(200);
  });
});

describe('TS-01/RV-01: verifyPayment vs cancelRegistration konkuren pada invoice yang sama', () => {
  it('5 iterasi: tidak ada 500 (deadlock 40P01); hasil akhir selalu konsisten — verify menang (payment verified, refund pending paidTotal) ATAU cancel menang lock invoice duluan (payment rejected, verify 409, refund null)', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const ITERATIONS = 5;

    for (let i = 0; i < ITERATIONS; i++) {
      const amount = 7_000_000;
      const { dep } = await createPackageWithDeparture(admin, `UJI-LOCK-${i}`, { basePrice: amount, quota: 3 });
      const reg = await register(dep.id, jamaahPayload());
      expect(reg.status).toBe(201);
      const invoiceId = reg.body.data.invoiceId;
      const registrationId = reg.body.data.registrationId;

      const pay = await request(app)
        .post('/v1/payments')
        .set('Authorization', `Bearer ${keu}`)
        .send({ invoiceId, bankAccountCode: '1-1200', amount, method: 'transfer' });
      expect(pay.status).toBe(201);
      const paymentId = pay.body.data.id;

      // Tembak verifyPayment (payments.service.ts) & cancelRegistration (jamaah.service.ts)
      // BERSAMAAN pada invoice yang sama — sebelum fix TS-01, urutan lock terbalik
      // (payments→invoices vs invoices→payments) berisiko deadlock Postgres 40P01,
      // yang di kode ini akan muncul sebagai 500 generik pada salah satu respons.
      const [verifyRes, cancelRes] = await Promise.all([
        request(app).patch(`/v1/payments/${paymentId}/verify`).set('Authorization', `Bearer ${keu}`),
        request(app)
          .post(`/v1/registrations/${registrationId}/cancel`)
          .set('Authorization', `Bearer ${ops}`)
          .send({ reason: `Uji konkuren lock #${i}` })
      ]);

      expect(verifyRes.status, `verify #${i}: ${JSON.stringify(verifyRes.body)}`).not.toBe(500);
      expect(cancelRes.status, `cancel #${i}: ${JSON.stringify(cancelRes.body)}`).not.toBe(500);
      // cancelRegistration tidak bergantung status payment (belum ada pendapatan
      // diakui) — selalu diterima terlepas siapa yang menang lock invoice duluan.
      expect(cancelRes.status).toBe(200);

      const paymentAfter = await db('payments').where({ id: paymentId }).first();
      const refund = cancelRes.body.data.refund as { status: string; paidTotal: number } | null;

      if (verifyRes.status === 200) {
        // verify menang lock invoice duluan & committed sebelum cancel resume.
        expect(paymentAfter.status).toBe('verified');
        expect(refund).toMatchObject({ status: 'pending', paidTotal: amount });
      } else {
        // cancel menang lock invoice duluan → payment pending ikut direject sebagai
        // bagian dari pembatalan; verify yang resume kemudian melihat status
        // 'rejected' (BUKAN payment stale yang sudah dibaca sebelum lock) → 409.
        expect(verifyRes.status).toBe(409);
        expect(paymentAfter.status).toBe('rejected');
        expect(paymentAfter.reject_reason).toBe('registrasi dibatalkan');
        expect(refund).toBeNull();
      }
    }
  });
});

describe('GET /v1/jamaah/:id dan GET /v1/invoices/:id/payments — data pembatalan', () => {
  it('h) detail jamaah memuat status/cancelReason/refund; daftar pembayaran invoice memuat status & rejectReason', async () => {
    const admin = await token('admin@safar.co.id');
    const ops = await token('ops@safar.co.id');
    const keu = await token('keuangan@safar.co.id');
    const { reg, refund } = await setupCancelledWithRefund(admin, keu, ops, 'UJI-DETAIL', 10_000_000);

    const jamaahDetail = await request(app).get(`/v1/jamaah/${reg.body.data.jamaahId}`).set('Authorization', `Bearer ${ops}`);
    expect(jamaahDetail.status).toBe(200);
    const regDto = jamaahDetail.body.data.registrations.find((r: { id: string }) => r.id === reg.body.data.registrationId);
    expect(regDto.status).toBe('cancelled');
    expect(regDto.cancelReason).toBe('Uji refund');
    expect(regDto.refund).toMatchObject({ id: refund.id, status: 'pending', paidTotal: 10_000_000 });

    const { dep } = await createPackageWithDeparture(admin, 'UJI-DETAIL-2', { basePrice: 5_000_000, quota: 2 });
    const reg2 = await register(dep.id, jamaahPayload());
    const p = await request(app)
      .post('/v1/payments')
      .set('Authorization', `Bearer ${keu}`)
      .send({ invoiceId: reg2.body.data.invoiceId, bankAccountCode: '1-1200', amount: 2_000_000, method: 'transfer' });
    await request(app).patch(`/v1/payments/${p.body.data.id}/reject`).set('Authorization', `Bearer ${keu}`).send({ reason: 'Bukti tidak sah' });
    const listPayments = await request(app).get(`/v1/invoices/${reg2.body.data.invoiceId}/payments`).set('Authorization', `Bearer ${keu}`);
    expect(listPayments.status).toBe(200);
    expect(listPayments.body.data[0]).toMatchObject({ status: 'rejected', rejectReason: 'Bukti tidak sah' });
  });
});
