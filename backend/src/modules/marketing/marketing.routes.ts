import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { ok, errors } from '../../utils/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { audit } from '../../middleware/audit.js';
import bcrypt from 'bcryptjs';
import { postJournal, commissionLines, reverseJournal } from '../accounting/journal.engine.js';
import { generateInitialPassword } from '../agent-portal/agent-portal.service.js';

const MKT = ['marketing', 'pimpinan', 'keuangan'] as const;

/* ===== Agents ===== */
// commissionPct dibatasi maksimum wajar (30%) — cegah salah-set beban komisi ekstrem.
const createAgentSchema = z.object({
  name: z.string().min(3),
  code: z.string().min(3).max(20).transform((s) => s.toUpperCase()),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish(),
  commissionPct: z.number().positive().max(30).default(3)
});

export const agentsRoutes = Router();

/** Daftar agen + kinerja (leads, konversi, jamaah, komisi) + KPI — view Marketing mockup. */
agentsRoutes.get('/', requireAuth, requireRoles(...MKT), async (_req, res) => {
  const agents = await db('agents').orderBy('name');
  const leadAgg: any[] = await db('leads')
    .select('agent_id', 'status')
    .count({ n: '*' })
    .groupBy('agent_id', 'status');
  const commAgg: any[] = await db('commissions')
    .select('agent_id', 'status')
    .sum({ amount: 'amount' })
    .count({ n: '*' })
    .groupBy('agent_id', 'status');

  const rows = agents.map((a) => {
    const leads = leadAgg.filter((l) => l.agent_id === a.id);
    const totalLeads = leads.reduce((s, l) => s + Number(l.n), 0);
    const converted = Number(leads.find((l) => l.status === 'converted')?.n ?? 0);
    const comms = commAgg.filter((c) => c.agent_id === a.id);
    const commissionTotal = comms.reduce((s, c) => s + Number(c.amount), 0);
    const commissionPending = Number(comms.find((c) => c.status === 'pending')?.amount ?? 0);
    return {
      id: a.id, name: a.name, code: a.code, referralCode: a.referral_code,
      commissionPct: Number(a.commission_pct), isActive: a.is_active,
      phone: a.phone ?? null, portalEnabled: !!a.portal_enabled,
      leads: totalLeads, converted,
      conversionPct: totalLeads ? Math.round((converted / totalLeads) * 100) : 0,
      commissionTotal, commissionPending
    };
  });

  // KPI tiles (Komisi Terhutang = saldo akun 2-1400 dari jurnal)
  const [{ debit, credit }]: any[] = await db('journal_lines as l')
    .join('accounts as a', 'a.id', 'l.account_id')
    .where('a.code', '2-1400')
    .sum({ debit: 'l.debit', credit: 'l.credit' });
  const owed = Number(credit ?? 0) - Number(debit ?? 0);
  const totalLeads = rows.reduce((s, r) => s + r.leads, 0);
  const totalConverted = rows.reduce((s, r) => s + r.converted, 0);

  ok(res, {
    agents: rows,
    kpi: {
      activeAgents: rows.filter((r) => r.isActive).length,
      totalLeads,
      avgConversionPct: totalLeads ? Math.round((totalConverted / totalLeads) * 100) : 0,
      commissionOwed: owed,
      agentsWithPending: rows.filter((r) => r.commissionPending > 0).length
    }
  });
});

agentsRoutes.post('/', requireAuth, requireRoles('marketing'), async (req, res) => {
  const input = createAgentSchema.parse(req.body);
  const exists = await db('agents').where({ code: input.code }).first();
  if (exists) throw errors.conflict(`Kode agen ${input.code} sudah dipakai`);
  const [agent] = await db('agents')
    .insert({
      name: input.name,
      code: input.code,
      referral_code: input.code,
      phone: input.phone ?? null,
      email: input.email ?? null,
      commission_pct: input.commissionPct
    })
    .returning('*');
  await audit(req, { action: 'agents.create', entity: 'agents', entityId: agent.id, newValues: input });
  ok(res, agent, undefined, 201);
});

/** Aktifkan / reset kredensial Portal Agen — terbitkan password awal (ditampilkan sekali). */
agentsRoutes.post('/:id/portal-activate', requireAuth, requireRoles('marketing'), async (req, res) => {
  const { phone: bodyPhone } = z.object({ phone: z.string().min(6).max(30).nullish() }).parse(req.body ?? {});
  const agent = await db('agents').where({ id: String(req.params.id) }).first();
  if (!agent) throw errors.notFound('Agen tidak ditemukan');
  // HP = username portal; boleh diisi saat aktivasi bila agen belum punya
  const phone = agent.phone ?? bodyPhone;
  if (!phone) throw errors.badRequest('Agen belum punya nomor HP — isi nomor HP untuk mengaktifkan portal.');
  const dupe = await db('agents')
    .whereRaw('lower(phone) = ?', [String(phone).toLowerCase()])
    .andWhere('portal_enabled', true)
    .andWhereNot('id', agent.id)
    .first();
  if (dupe) throw errors.conflict('Nomor HP sudah dipakai agen lain yang portalnya aktif');
  if (!agent.phone) await db('agents').where({ id: agent.id }).update({ phone });

  const initialPassword = generateInitialPassword();
  const passwordHash = await bcrypt.hash(initialPassword, 10);
  await db('agents').where({ id: agent.id }).update({
    password_hash: passwordHash, must_change_password: true, portal_enabled: true, updated_at: db.fn.now()
  });
  await audit(req, { action: 'agents.portal_activate', entity: 'agents', entityId: agent.id });
  // Password plaintext HANYA ditampilkan sekali ke staf untuk diserahkan ke agen
  ok(res, { phone, initialPassword });
});

/* ===== Leads ===== */
const createLeadSchema = z.object({
  agentId: z.string().uuid(),
  name: z.string().min(2),
  phone: z.string().max(30).nullish(),
  source: z.string().max(40).default('referral')
});

export const leadsRoutes = Router();
leadsRoutes.post('/', requireAuth, requireRoles('marketing'), async (req, res) => {
  const input = createLeadSchema.parse(req.body);
  const agent = await db('agents').where({ id: input.agentId }).first();
  if (!agent) throw errors.notFound('Agen tidak ditemukan');
  const [lead] = await db('leads')
    .insert({ agent_id: input.agentId, name: input.name, phone: input.phone ?? null, source: input.source })
    .returning('*');
  await audit(req, { action: 'leads.create', entity: 'leads', entityId: lead.id, newValues: input });
  ok(res, lead, undefined, 201);
});

/* ===== Commissions ===== */
export const commissionsRoutes = Router();

commissionsRoutes.get('/', requireAuth, requireRoles(...MKT), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = await db('commissions as c')
    .join('agents as a', 'a.id', 'c.agent_id')
    .leftJoin('registrations as r', 'r.id', 'c.registration_id')
    .leftJoin('jamaah as j', 'j.id', 'r.jamaah_id')
    .leftJoin('journals as jr', 'jr.id', 'c.journal_id')
    .select('c.*', 'a.name as agent_name', 'a.code as agent_code', 'r.reg_number', 'r.status as reg_status', 'j.full_name as jamaah_name', 'jr.journal_no')
    .modify((q) => { if (status) q.where('c.status', status); })
    .orderBy('c.created_at', 'desc');
  ok(res, rows.map((c: Record<string, unknown>) => ({
    id: c.id, agentName: c.agent_name, agentCode: c.agent_code,
    regNumber: c.reg_number ?? null, jamaahName: c.jamaah_name ?? '(komisi manual)',
    regStatus: c.reg_status ?? null,
    baseAmount: Number(c.base_amount), pct: Number(c.pct), amount: Number(c.amount),
    status: c.status, journalNo: c.journal_no,
    paidAt: c.paid_at ?? null, reversedAt: c.reversed_at ?? null,
    createdAt: c.created_at
  })));
});

/**
 * Setujui komisi → posting jurnal F (Dr 6-2000 Beban Komisi · Cr 2-1400 Hutang Komisi).
 * Pemisahan tugas: HANYA role keuangan (marketing yang membuat agen tak boleh mengesahkan
 * beban+hutangnya). Gate: registrasi terkait harus sudah AKTIF (dokumen lengkap) & agen aktif —
 * beban komisi tak diakui untuk registrasi yang masih pending/batal.
 */
commissionsRoutes.post('/:id/approve', requireAuth, requireRoles('keuangan'), async (req, res) => {
  const result = await db.transaction(async (trx) => {
    const c = await trx('commissions as c')
      .join('agents as a', 'a.id', 'c.agent_id')
      .leftJoin('registrations as r', 'r.id', 'c.registration_id')
      .select('c.*', 'a.name as agent_name', 'a.is_active as agent_active', 'r.departure_id', 'r.status as reg_status')
      .where('c.id', String(req.params.id))
      .forUpdate('c')
      .first();
    if (!c) throw errors.notFound('Komisi tidak ditemukan');
    if (c.status !== 'pending') throw errors.conflict('Komisi sudah disetujui atau tidak dalam status pending');
    if (!c.agent_active) throw errors.badRequest('Agen tidak aktif — komisi tidak dapat disetujui');
    if (c.registration_id && c.reg_status !== 'active' && c.reg_status !== 'completed') {
      throw errors.badRequest('Registrasi belum aktif (dokumen belum lengkap) atau dibatalkan — komisi belum bisa disetujui');
    }

    const cc = c.departure_id ? await trx('cost_centers').where({ departure_id: c.departure_id }).first() : null;
    const journal = await postJournal(trx, {
      date: new Date().toISOString().slice(0, 10),
      description: `Komisi agen — ${c.agent_name} (${Number(c.pct)}% × Rp ${Number(c.base_amount).toLocaleString('id-ID')})`,
      source: 'commission',
      refType: 'commissions',
      refId: c.id,
      costCenterId: cc?.id ?? null,
      createdBy: req.user?.id ?? null,
      lines: commissionLines(Number(c.amount))
    });
    await trx('commissions').where({ id: c.id }).update({
      status: 'approved',
      journal_id: journal.id,
      approved_by: req.user?.id ?? null,
      approved_at: trx.fn.now(),
      // Bersihkan penanda pembalikan bila komisi ini pernah dibatalkan lalu disetujui ulang
      reversed_at: null,
      reversed_by: null,
      reversal_journal_id: null,
      updated_at: trx.fn.now()
    });
    return { commissionId: c.id, journalNo: journal.journal_no, amount: Number(c.amount) };
  });
  await audit(req, { action: 'commissions.approve', entity: 'commissions', entityId: result.commissionId, newValues: result });
  ok(res, result);
});

const paySchema = z.object({ bankAccountCode: z.string().regex(/^\d-\d{4}$/).default('1-1200'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() });

/** Bayar komisi ke agen → Dr 2-1400 Hutang Komisi · Cr Bank/Kas; status 'paid'. */
commissionsRoutes.post('/:id/pay', requireAuth, requireRoles('keuangan'), async (req, res) => {
  const input = paySchema.parse(req.body ?? {});
  const result = await db.transaction(async (trx) => {
    const c = await trx('commissions').where({ id: String(req.params.id) }).forUpdate().first();
    if (!c) throw errors.notFound('Komisi tidak ditemukan');
    if (c.status !== 'approved') throw errors.conflict('Hanya komisi berstatus approved yang bisa dibayar');
    const journal = await postJournal(trx, {
      date: input.date ?? new Date().toISOString().slice(0, 10),
      description: `Pembayaran komisi agen — ref ${c.id.slice(0, 8)}`,
      source: 'commission',
      refType: 'commissions',
      refId: c.id,
      createdBy: req.user?.id ?? null,
      lines: [
        { accountCode: '2-1400', debit: Number(c.amount) },
        { accountCode: input.bankAccountCode, credit: Number(c.amount) }
      ]
    });
    await trx('commissions').where({ id: c.id }).update({
      status: 'paid', payment_journal_id: journal.id, paid_by: req.user?.id ?? null, paid_at: trx.fn.now(), updated_at: trx.fn.now()
    });
    return { commissionId: c.id, journalNo: journal.journal_no, amount: Number(c.amount) };
  });
  await audit(req, { action: 'commissions.pay', entity: 'commissions', entityId: result.commissionId, newValues: result });
  ok(res, result);
});

/** Batalkan komisi (storno) → balik jurnal beban+hutang. Hanya untuk komisi approved yang belum dibayar. */
commissionsRoutes.post('/:id/reverse', requireAuth, requireRoles('keuangan'), async (req, res) => {
  const result = await db.transaction(async (trx) => {
    const c = await trx('commissions').where({ id: String(req.params.id) }).forUpdate().first();
    if (!c) throw errors.notFound('Komisi tidak ditemukan');
    if (c.status === 'paid') throw errors.conflict('Komisi sudah dibayar — tak bisa dibatalkan langsung');
    if (c.status !== 'approved' || !c.journal_id) throw errors.conflict('Hanya komisi approved yang bisa dibatalkan');
    if (c.reversed_at) throw errors.conflict('Komisi sudah dibatalkan');
    const journal = await reverseJournal(trx, c.journal_id, {
      date: new Date().toISOString().slice(0, 10),
      description: `Pembatalan komisi agen — storno ref ${c.id.slice(0, 8)}`,
      createdBy: req.user?.id ?? null
    });
    await trx('commissions').where({ id: c.id }).update({
      status: 'pending', reversal_journal_id: journal.id, reversed_by: req.user?.id ?? null, reversed_at: trx.fn.now(),
      journal_id: null, approved_by: null, approved_at: null, updated_at: trx.fn.now()
    });
    return { commissionId: c.id, journalNo: journal.journal_no, amount: Number(c.amount) };
  });
  await audit(req, { action: 'commissions.reverse', entity: 'commissions', entityId: result.commissionId, newValues: result });
  ok(res, result);
});

const attributeSchema = z.object({ registrationId: z.string().uuid(), agentId: z.string().uuid() });

/** Tetapkan/ubah agen pada registrasi (mis. jamaah lupa sebut kode) — teraudit,
 *  menggantikan koreksi via akses DB langsung. Hanya bila komisi belum diproses. */
commissionsRoutes.post('/attribute', requireAuth, requireRoles('marketing', 'keuangan'), async (req, res) => {
  const input = attributeSchema.parse(req.body);
  const result = await db.transaction(async (trx) => {
    const reg = await trx('registrations').where({ id: input.registrationId }).first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
    const agent = await trx('agents').where({ id: input.agentId }).andWhere('is_active', true).first();
    if (!agent) throw errors.badRequest('Agen tidak ditemukan / tidak aktif');
    const existing = await trx('commissions').where({ registration_id: input.registrationId }).first();
    if (existing && existing.status !== 'pending') {
      throw errors.conflict('Komisi registrasi ini sudah disetujui/dibayar — tak bisa dialihkan');
    }
    const invoice = await trx('invoices').where({ registration_id: input.registrationId }).first();
    const base = Number(invoice?.total_amount ?? 0);
    const amount = Math.round((base * Number(agent.commission_pct)) / 100);
    await trx('registrations').where({ id: input.registrationId }).update({ agent_id: agent.id, updated_at: trx.fn.now() });
    if (existing) {
      await trx('commissions').where({ id: existing.id })
        .update({ agent_id: agent.id, base_amount: base, pct: agent.commission_pct, amount, updated_at: trx.fn.now() });
    } else {
      await trx('commissions').insert({ agent_id: agent.id, registration_id: input.registrationId, base_amount: base, pct: agent.commission_pct, amount });
    }
    return { registrationId: input.registrationId, agentId: agent.id, agentName: agent.name, amount };
  });
  await audit(req, { action: 'commissions.attribute', entity: 'registrations', entityId: input.registrationId, newValues: result });
  ok(res, result);
});
