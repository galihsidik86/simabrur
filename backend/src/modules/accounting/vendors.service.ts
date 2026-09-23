import type { Request } from 'express';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';

/** R3TS-02 — master data vendor, dipecah dari `accounting.service.ts`. */
export const vendorsService = {
  vendors() {
    return db('vendors').select('id', 'name', 'type').orderBy('name');
  },

  async createVendor(req: Request, input: { name: string; type: string }) {
    const [row] = await db('vendors').insert(input).returning('*');
    await audit(req, { action: 'master.vendor.create', entity: 'vendors', entityId: row.id, newValues: input });
    return row;
  },

  async updateVendor(req: Request, id: string, input: { name: string; type: string }) {
    const before = await db('vendors').where({ id }).first();
    if (!before) throw errors.notFound('Vendor tidak ditemukan');
    const [row] = await db('vendors').where({ id }).update({ ...input, updated_at: db.fn.now() }).returning('*');
    await audit(req, { action: 'master.vendor.update', entity: 'vendors', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteVendor(req: Request, id: string) {
    const before = await db('vendors').where({ id }).first();
    if (!before) throw errors.notFound('Vendor tidak ditemukan');
    const bills = await db('vendor_bills').where({ vendor_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(bills?.count)) throw errors.conflict(`Vendor punya ${bills?.count} tagihan tercatat — tidak bisa dihapus`);
    const journals = await db('journals').where({ ref_type: 'vendors', ref_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(journals?.count)) throw errors.conflict(`Vendor dirujuk ${journals?.count} jurnal — tidak bisa dihapus`);
    await db('vendors').where({ id }).del();
    await audit(req, { action: 'master.vendor.delete', entity: 'vendors', entityId: id, oldValues: before });
    return { deleted: true };
  }
};
