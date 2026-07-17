import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { ok, errors } from '../../utils/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { audit } from '../../middleware/audit.js';

/** Administrasi sistem (screen baru — gap PLAN.md §5): users + audit log viewer. */

export const auditLogsRoutes = Router();
auditLogsRoutes.get('/', requireAuth, requireRoles(), async (req, res) => {
  const page = Math.max(1, Number(req.query.page ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 30)));
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;

  const base = db('audit_logs as al')
    .leftJoin('users as u', 'u.id', 'al.user_id')
    .modify((qb) => {
      if (q) qb.where((w) => w.whereILike('al.action', `%${q}%`).orWhereILike('al.entity', `%${q}%`).orWhereILike('u.name', `%${q}%`));
    });
  const [{ count }] = await base.clone().count({ count: '*' });
  const rows = await base
    .clone()
    .select('al.*', 'u.name as user_name', 'u.email as user_email')
    .orderBy('al.id', 'desc')
    .limit(limit)
    .offset((page - 1) * limit);
  ok(
    res,
    rows.map((r: Record<string, unknown>) => ({
      id: r.id, action: r.action, entity: r.entity, entityId: r.entity_id,
      user: r.user_name ?? 'Sistem / Publik', email: r.user_email,
      oldValues: r.old_values, newValues: r.new_values, ip: r.ip, createdAt: r.created_at
    })),
    { page, limit, total: Number(count) }
  );
});

const createUserSchema = z.object({
  name: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8, 'Password minimal 8 karakter'),
  role: z.string().min(3),
  branchId: z.string().uuid().nullish()
});

export const usersRoutes = Router();

usersRoutes.get('/', requireAuth, requireRoles(), async (_req, res) => {
  const rows = await db('users as u')
    .join('roles as r', 'r.id', 'u.role_id')
    .join('branches as b', 'b.id', 'u.branch_id')
    .select('u.id', 'u.name', 'u.email', 'u.is_active', 'u.created_at', 'r.name as role', 'r.label as role_label', 'b.name as branch')
    .orderBy('u.created_at');
  ok(res, rows);
});

usersRoutes.post('/', requireAuth, requireRoles(), async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const role = await db('roles').where({ name: input.role }).first();
  if (!role) throw errors.badRequest(`Role ${input.role} tidak dikenal`);
  const branch = input.branchId
    ? await db('branches').where({ id: input.branchId }).first()
    : await db('branches').orderBy('created_at').first();
  if (!branch) throw errors.badRequest('Cabang tidak ditemukan');
  const exists = await db('users').where({ email: input.email }).first();
  if (exists) throw errors.conflict('Email sudah terdaftar');

  const [user] = await db('users')
    .insert({
      name: input.name,
      email: input.email,
      password_hash: await bcrypt.hash(input.password, 10),
      role_id: role.id,
      branch_id: branch.id
    })
    .returning(['id', 'name', 'email']);
  await audit(req, { action: 'users.create', entity: 'users', entityId: user.id, newValues: { name: input.name, email: input.email, role: input.role } });
  ok(res, user, undefined, 201);
});

usersRoutes.patch('/:id/toggle-active', requireAuth, requireRoles(), async (req, res) => {
  const user = await db('users').where({ id: String(req.params.id) }).first();
  if (!user) throw errors.notFound('User tidak ditemukan');
  if (user.id === req.user!.id) throw errors.badRequest('Tidak bisa menonaktifkan akun sendiri');
  const [updated] = await db('users').where({ id: user.id }).update({ is_active: !user.is_active, updated_at: db.fn.now() }).returning(['id', 'is_active']);
  await audit(req, { action: 'users.toggle_active', entity: 'users', entityId: user.id, oldValues: { isActive: user.is_active }, newValues: { isActive: updated.is_active } });
  ok(res, updated);
});

export const rolesRoutes = Router();
rolesRoutes.get('/', requireAuth, requireRoles(), async (_req, res) => {
  ok(res, await db('roles').select('id', 'name', 'label', 'permissions').orderBy('name'));
});
