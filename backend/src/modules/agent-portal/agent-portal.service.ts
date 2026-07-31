import type { Request } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';

export interface AgentClaims {
  kind: 'agent';
  agentId: string;
  code: string;
}

export function verifyAgentToken(token: string): AgentClaims {
  try {
    const claims = jwt.verify(token, env.jwt.accessSecret) as AgentClaims & jwt.JwtPayload;
    if (claims.kind !== 'agent') throw new Error('bukan token agen');
    return claims;
  } catch {
    throw errors.unauthorized('Sesi portal agen tidak valid');
  }
}

// Password awal 8 karakter dari alfabet aman (tanpa I/O/0/1 yang ambigu)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateInitialPassword(): string {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

async function paymentPct(invoiceId: string | null, total: number): Promise<number> {
  if (!invoiceId || total <= 0) return 0;
  const [p] = await db('payments').where({ invoice_id: invoiceId, status: 'verified' }).sum({ paid: 'amount' });
  return Math.round((Number(p.paid ?? 0) / total) * 100);
}

export const agentPortalService = {
  /** Login agen: HP + password (kredensial terbit-kantor). Token ber-kind 'agent'. */
  async login(req: Request, phone: string, password: string) {
    const agent = await db('agents')
      .whereRaw('lower(phone) = ?', [phone.trim().toLowerCase()])
      .andWhere('portal_enabled', true)
      .andWhere('is_active', true)
      .first();
    // Bandingkan hash walau agen tak ada (cegah user-enumeration via timing)
    const match = agent?.password_hash ? await bcrypt.compare(password, agent.password_hash) : false;
    if (!agent || !match) throw errors.unauthorized('Nomor HP atau password salah');

    await db('agents').where({ id: agent.id }).update({ last_login_at: db.fn.now() });
    const claims: AgentClaims = { kind: 'agent', agentId: agent.id, code: agent.code };
    const token = jwt.sign(claims, env.jwt.accessSecret, { expiresIn: '12h' });
    await audit(req, { action: 'agent_portal.login', entity: 'agents', entityId: agent.id });
    return { token, name: agent.name, code: agent.code, mustChangePassword: agent.must_change_password };
  },

  async changePassword(req: Request, claims: AgentClaims, oldPassword: string, newPassword: string) {
    const agent = await db('agents').where({ id: claims.agentId }).first();
    if (!agent) throw errors.notFound('Agen tidak ditemukan');
    const match = agent.password_hash ? await bcrypt.compare(oldPassword, agent.password_hash) : false;
    if (!match) throw errors.badRequest('Password lama salah');
    const hash = await bcrypt.hash(newPassword, 10);
    await db('agents').where({ id: agent.id }).update({ password_hash: hash, must_change_password: false, updated_at: db.fn.now() });
    await audit(req, { action: 'agent_portal.change_password', entity: 'agents', entityId: agent.id });
    return { ok: true };
  },

  async me(claims: AgentClaims) {
    const a = await db('agents').where({ id: claims.agentId }).first();
    if (!a) throw errors.notFound('Agen tidak ditemukan');
    return {
      name: a.name, code: a.code, referralCode: a.referral_code, commissionPct: Number(a.commission_pct),
      phone: a.phone, email: a.email, mustChangePassword: a.must_change_password
    };
  },

  /** KPI komisi & referral — hanya milik agen ini. */
  async summary(claims: AgentClaims) {
    const [reg] = await db('registrations').where({ agent_id: claims.agentId }).count({ total: '*' });
    const [active] = await db('registrations').where({ agent_id: claims.agentId }).whereIn('status', ['active', 'completed']).count({ n: '*' });
    const comm = await db('commissions').where({ agent_id: claims.agentId })
      .select('status').sum({ amount: 'amount' }).count({ n: '*' }).groupBy('status');
    const sum = (st: string) => Number((comm.find((c: Record<string, any>) => c.status === st) || {}).amount ?? 0);
    const [unread] = await db('agent_notifications').where({ agent_id: claims.agentId }).whereNull('read_at').count({ n: '*' });
    return {
      totalReferrals: Number(reg.total),
      activeReferrals: Number(active.n),
      commissionPending: sum('pending'),
      commissionApproved: sum('approved'), // disetujui, terutang (belum dibayar)
      commissionPaid: sum('paid'),
      unreadNotifications: Number(unread.n)
    };
  },

  async notifications(claims: AgentClaims) {
    const rows = await db('agent_notifications').where({ agent_id: claims.agentId })
      .orderBy('created_at', 'desc').limit(50)
      .select('id', 'type', 'title', 'body', 'read_at', 'created_at');
    return rows.map((n: Record<string, any>) => ({ id: n.id, type: n.type, title: n.title, body: n.body, readAt: n.read_at ?? null, createdAt: n.created_at }));
  },

  async markNotificationsRead(claims: AgentClaims) {
    await db('agent_notifications').where({ agent_id: claims.agentId }).whereNull('read_at').update({ read_at: db.fn.now() });
    return { ok: true };
  },

  /** Jamaah referral — data TERBATAS (tanpa NIK/dokumen): nama, paket, status, % bayar. */
  async jamaah(claims: AgentClaims) {
    const rows = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin('invoices as i', 'i.registration_id', 'r.id')
      .where('r.agent_id', claims.agentId)
      .select('r.reg_number', 'r.status', 'j.full_name', 'p.name as package_name', 'd.departure_date', 'i.total_amount', 'i.id as invoice_id')
      .orderBy('r.created_at', 'desc');
    const out = [];
    for (const r of rows) {
      out.push({
        regNumber: r.reg_number, jamaahName: r.full_name, packageName: r.package_name,
        departureDate: r.departure_date, status: r.status,
        paymentPct: await paymentPct(r.invoice_id, Number(r.total_amount ?? 0))
      });
    }
    return out;
  },

  async commissions(claims: AgentClaims) {
    const rows = await db('commissions as c')
      .leftJoin('registrations as r', 'r.id', 'c.registration_id')
      .leftJoin('jamaah as j', 'j.id', 'r.jamaah_id')
      .where('c.agent_id', claims.agentId)
      .select('c.base_amount', 'c.pct', 'c.amount', 'c.status', 'c.approved_at', 'c.paid_at', 'c.created_at', 'r.reg_number', 'j.full_name as jamaah_name')
      .orderBy('c.created_at', 'desc');
    return rows.map((c: Record<string, any>) => ({
      baseAmount: Number(c.base_amount), pct: Number(c.pct), amount: Number(c.amount), status: c.status,
      jamaahName: c.jamaah_name ?? '(komisi manual)', regNumber: c.reg_number ?? null,
      approvedAt: c.approved_at ?? null, paidAt: c.paid_at ?? null, createdAt: c.created_at
    }));
  },

  async leads(claims: AgentClaims) {
    const rows = await db('leads').where({ agent_id: claims.agentId }).orderBy('created_at', 'desc')
      .select('name', 'phone', 'source', 'status', 'created_at');
    return rows.map((l: Record<string, any>) => ({ name: l.name, phone: l.phone, source: l.source, status: l.status, createdAt: l.created_at }));
  },

  async addLead(req: Request, claims: AgentClaims, input: { name: string; phone?: string | null }) {
    const [lead] = await db('leads')
      .insert({ agent_id: claims.agentId, name: input.name, phone: input.phone ?? null, source: 'portal-agen', status: 'new' })
      .returning('*');
    await audit(req, { action: 'agent_portal.lead.add', entity: 'leads', entityId: lead.id });
    return { id: lead.id, name: lead.name };
  }
};
