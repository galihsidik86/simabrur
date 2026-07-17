import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { ok, errors } from '../../utils/http.js';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { audit } from '../../middleware/audit.js';
import { postJournal, commissionLines } from '../accounting/journal.engine.js';

const MKT = ['marketing', 'pimpinan', 'keuangan'] as const;

/* ===== Agents ===== */
const createAgentSchema = z.object({
  name: z.string().min(3),
  code: z.string().min(3).max(20).transform((s) => s.toUpperCase()),
  phone: z.string().max(30).nullish(),
  email: z.string().email().nullish(),
  commissionPct: z.number().positive().max(100).default(3),
  parentAgentId: z.string().uuid().nullish()
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
      commission_pct: input.commissionPct,
      parent_agent_id: input.parentAgentId ?? null
    })
    .returning('*');
  await audit(req, { action: 'agents.create', entity: 'agents', entityId: agent.id, newValues: input });
  ok(res, agent, undefined, 201);
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
    .join('registrations as r', 'r.id', 'c.registration_id')
    .join('jamaah as j', 'j.id', 'r.jamaah_id')
    .leftJoin('journals as jr', 'jr.id', 'c.journal_id')
    .select('c.*', 'a.name as agent_name', 'a.code as agent_code', 'r.reg_number', 'j.full_name as jamaah_name', 'jr.journal_no')
    .modify((q) => { if (status) q.where('c.status', status); })
    .orderBy('c.created_at', 'desc');
  ok(res, rows.map((c: Record<string, unknown>) => ({
    id: c.id, agentName: c.agent_name, agentCode: c.agent_code,
    regNumber: c.reg_number, jamaahName: c.jamaah_name,
    baseAmount: Number(c.base_amount), pct: Number(c.pct), amount: Number(c.amount),
    status: c.status, journalNo: c.journal_no, createdAt: c.created_at
  })));
});

/** Setujui komisi → posting jurnal F (Dr 6-2000 Beban Komisi · Cr 2-1400 Hutang Komisi). */
commissionsRoutes.post('/:id/approve', requireAuth, requireRoles('marketing', 'keuangan'), async (req, res) => {
  const result = await db.transaction(async (trx) => {
    const c = await trx('commissions as c')
      .join('agents as a', 'a.id', 'c.agent_id')
      .join('registrations as r', 'r.id', 'c.registration_id')
      .select('c.*', 'a.name as agent_name', 'r.departure_id')
      .where('c.id', String(req.params.id))
      .forUpdate('c')
      .first();
    if (!c) throw errors.notFound('Komisi tidak ditemukan');
    if (c.status !== 'pending') throw errors.conflict('Komisi sudah disetujui');

    const cc = await trx('cost_centers').where({ departure_id: c.departure_id }).first();
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
      updated_at: trx.fn.now()
    });
    return { commissionId: c.id, journalNo: journal.journal_no, amount: Number(c.amount) };
  });
  await audit(req, { action: 'commissions.approve', entity: 'commissions', entityId: result.commissionId, newValues: result });
  ok(res, result);
});
