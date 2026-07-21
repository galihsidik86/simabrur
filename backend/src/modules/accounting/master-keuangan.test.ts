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

describe('master data: vendor', () => {
  it('keuangan bisa CRUD; vendor dgn tagihan tidak bisa dihapus (409); ops ditolak 403', async () => {
    const keu = await token('keuangan@safar.co.id');

    const created = await request(app)
      .post('/v1/vendors')
      .set('Authorization', `Bearer ${keu}`)
      .send({ name: 'Katering Uji', type: 'catering' });
    expect(created.status).toBe(201);

    const updated = await request(app)
      .put(`/v1/vendors/${created.body.data.id}`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ name: 'Katering Uji Barokah', type: 'catering' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Katering Uji Barokah');

    // vendor dgn tagihan tercatat → hapus ditolak
    const seedVendor = await db('vendors').whereNot({ id: created.body.data.id }).first();
    await db('vendor_bills').insert({ vendor_id: seedVendor.id, amount: 1_000_000 });
    const blocked = await request(app)
      .delete(`/v1/vendors/${seedVendor.id}`)
      .set('Authorization', `Bearer ${keu}`);
    expect(blocked.status).toBe(409);
    await db('vendor_bills').where({ vendor_id: seedVendor.id, amount: 1_000_000 }).del();

    const deleted = await request(app)
      .delete(`/v1/vendors/${created.body.data.id}`)
      .set('Authorization', `Bearer ${keu}`);
    expect(deleted.status).toBe(200);

    const ops = await token('ops@safar.co.id');
    const denied = await request(app)
      .post('/v1/vendors')
      .set('Authorization', `Bearer ${ops}`)
      .send({ name: 'X', type: 'other' });
    expect(denied.status).toBe(403);
  });
});

describe('master data: rekening bank', () => {
  it('kode akun wajib ada di COA kelas 1; rekening baru bersaldo 0', async () => {
    const keu = await token('keuangan@safar.co.id');

    const badCode = await request(app)
      .post('/v1/bank-accounts')
      .set('Authorization', `Bearer ${keu}`)
      .send({ accountCode: '2-1100', name: 'Salah Kelas' });
    expect(badCode.status).toBe(400); // regex kelas 1

    const unknown = await request(app)
      .post('/v1/bank-accounts')
      .set('Authorization', `Bearer ${keu}`)
      .send({ accountCode: '1-9999', name: 'Akun Tak Ada' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.message).toContain('Bagan Akun');

    // siapkan akun COA baru khusus uji (kelas 1, postable)
    await db('accounts')
      .insert({ code: '1-1250', name: 'Bank Uji', class: 1, normal_balance: 'debit', is_postable: true })
      .onConflict('code')
      .ignore();

    const created = await request(app)
      .post('/v1/bank-accounts')
      .set('Authorization', `Bearer ${keu}`)
      .send({ accountCode: '1-1250', name: 'Bank Uji Operasional', bank: 'Bank Uji', accountNo: '000', currency: 'IDR' });
    expect(created.status).toBe(201);
    expect(Number(created.body.data.balance)).toBe(0);

    const dup = await request(app)
      .post('/v1/bank-accounts')
      .set('Authorization', `Bearer ${keu}`)
      .send({ accountCode: '1-1250', name: 'Duplikat' });
    expect(dup.status).toBe(409);

    const updated = await request(app)
      .put(`/v1/bank-accounts/${created.body.data.id}`)
      .set('Authorization', `Bearer ${keu}`)
      .send({ accountCode: '1-1250', name: 'Bank Uji Cabang', currency: 'IDR' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Bank Uji Cabang');

    const deleted = await request(app)
      .delete(`/v1/bank-accounts/${created.body.data.id}`)
      .set('Authorization', `Bearer ${keu}`);
    expect(deleted.status).toBe(200);
  });

  it('rekening bersaldo / dipakai pembayaran tidak bisa dihapus (409)', async () => {
    const keu = await token('keuangan@safar.co.id');
    const bsi = await db('bank_accounts').where({ account_code: '1-1200' }).first();
    const blocked = await request(app).delete(`/v1/bank-accounts/${bsi.id}`).set('Authorization', `Bearer ${keu}`);
    expect(blocked.status).toBe(409);
  });
});
