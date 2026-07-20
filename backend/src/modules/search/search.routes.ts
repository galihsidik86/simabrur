import { Router } from 'express';
import { db } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { ok } from '../../utils/http.js';

const STAFF_ROLES = ['operasional', 'marketing', 'keuangan', 'pimpinan'] as const;

export const searchRoutes = Router();

/** Pencarian global header admin: jamaah (nama/no. registrasi/HP), paket, invoice. */
searchRoutes.get('/', requireAuth, requireRoles(...STAFF_ROLES), async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 2) return ok(res, { jamaah: [], packages: [], invoices: [] });
  const like = `%${q}%`;

  const [jamaah, packages, invoices] = await Promise.all([
    db('jamaah as j')
      .leftJoin('registrations as r', 'r.jamaah_id', 'j.id')
      .where((w) => w.whereILike('j.full_name', like).orWhereILike('r.reg_number', like).orWhereILike('j.phone', like))
      .groupBy('j.id', 'j.full_name')
      .select('j.id', 'j.full_name as name', db.raw('max(r.reg_number) as "regNumber"'))
      .orderBy('j.full_name')
      .limit(5),
    db('packages').whereILike('name', like).select('id', 'name', 'type').orderBy('name').limit(5),
    db('invoices as i')
      .join('registrations as r', 'r.id', 'i.registration_id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .where((w) => w.whereILike('i.number', like).orWhereILike('j.full_name', like))
      .select('i.id', 'i.number', 'i.status', 'j.full_name as jamaahName')
      .orderBy('i.number')
      .limit(5)
  ]);
  ok(res, { jamaah, packages, invoices });
});

/** Lonceng header: hal yang menunggu tindakan (dokumen & pembayaran belum diverifikasi). */
searchRoutes.get('/notifications', requireAuth, requireRoles(...STAFF_ROLES), async (_req, res) => {
  const [doc, pay] = await Promise.all([
    db('documents').where({ status: 'pending' }).count<{ count: string }[]>('id as count').first(),
    db('payments').where({ status: 'pending' }).count<{ count: string }[]>('id as count').first()
  ]);
  const items = [
    { key: 'dokumen', count: Number(doc?.count ?? 0), label: 'dokumen menunggu verifikasi', to: '/jamaah?tab=dokumen' },
    { key: 'pembayaran', count: Number(pay?.count ?? 0), label: 'pembayaran menunggu verifikasi', to: '/pembayaran' }
  ].filter((i) => i.count > 0);
  ok(res, { total: items.reduce((s, i) => s + i.count, 0), items });
});
