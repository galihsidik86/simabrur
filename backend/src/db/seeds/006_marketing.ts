import type { Knex } from 'knex';
// Tanpa ekstensi .js — dimuat dinamis oleh Knex (lihat catatan seed 003)
import { postJournal, commissionLines } from '../../modules/accounting/journal.engine';

/**
 * Seed M5 — agen persis mockup Marketing (Barokah Tour BRKH-07, dst),
 * leads contoh per agen, dan komisi utk registrasi bersumber agen:
 * sebagian pending (demo tombol Setujui), sebagian approved + jurnal F.
 */

const AGENTS = [
  { name: 'Barokah Tour', code: 'BRKH-07', pct: 3 },
  { name: 'Amanah Wisata', code: 'AMNH-12', pct: 3 },
  { name: 'Sakinah Travel Mitra', code: 'SKNH-03', pct: 2.5 },
  { name: 'Hj. Fatimah (Perorangan)', code: 'FTMH-21', pct: 3.5 },
  { name: 'Rahmah Umrah Network', code: 'RHMH-09', pct: 3 },
  { name: 'Cahaya Madinah', code: 'CHYM-15', pct: 2.5 }
];

// [regNumber, agentCode, status]
const COMMISSIONS: [string, string, 'pending' | 'approved'][] = [
  ['UMR-2026-0412', 'BRKH-07', 'approved'],
  ['UMR-2026-0418', 'BRKH-07', 'pending'],
  ['UMR-2026-0421', 'AMNH-12', 'approved'],
  ['UMR-2026-0430', 'FTMH-21', 'pending'],
  ['UMR-2026-0433', 'RHMH-09', 'pending'],
  ['HAJ-2027-0033', 'SKNH-03', 'approved']
];

const LEAD_NAMES = ['Farid Akbar', 'Ibu Ratna', 'Kel. Bpk. Yanto', 'Ust. Halim', 'Ibu Sari', 'Bpk. Dedi', 'Hj. Aminah', 'Grup Pengajian Al-Ikhlas'];

export async function seed(knex: Knex): Promise<void> {
  const agentRows: Record<string, { id: string; pct: number }> = {};
  for (const a of AGENTS) {
    const [row] = await knex('agents')
      .insert({ name: a.name, code: a.code, referral_code: a.code, commission_pct: a.pct })
      .returning('*');
    agentRows[a.code] = { id: row.id, pct: a.pct };
  }

  // Leads contoh: jumlah & status bervariasi-tetap per agen
  const statuses = ['new', 'contacted', 'converted', 'lost'] as const;
  let i = 0;
  for (const a of AGENTS) {
    const n = 4 + (i % 4); // 4-7 leads
    for (let k = 0; k < n; k++) {
      await knex('leads').insert({
        agent_id: agentRows[a.code].id,
        name: LEAD_NAMES[(i + k) % LEAD_NAMES.length],
        phone: `0813-77${String(100 + i * 10 + k)}-000`,
        source: k % 3 === 0 ? 'referral' : k % 3 === 1 ? 'medsos' : 'walk-in',
        status: statuses[(i + k) % statuses.length]
      });
    }
    i++;
  }

  // Komisi utk registrasi bersumber agen + update source registrasi + lead converted
  for (const [regNumber, code, status] of COMMISSIONS) {
    const reg = await knex('registrations as r')
      .join('invoices as i', 'i.registration_id', 'r.id')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .select('r.id', 'r.departure_id', 'i.total_amount', 'j.id as jamaah_id', 'j.full_name', 'j.phone')
      .where('r.reg_number', regNumber)
      .first();
    if (!reg) continue;
    const agent = agentRows[code];

    await knex('registrations').where({ id: reg.id }).update({ source: `agent:${code}`, agent_id: agent.id });
    await knex('leads').insert({
      agent_id: agent.id, jamaah_id: reg.jamaah_id, name: reg.full_name, phone: reg.phone,
      source: 'referral', status: 'converted'
    });

    const base = Number(reg.total_amount);
    const amount = Math.round((base * agent.pct) / 100);
    const [commission] = await knex('commissions')
      .insert({ agent_id: agent.id, registration_id: reg.id, base_amount: base, pct: agent.pct, amount, status: 'pending' })
      .returning('*');

    if (status === 'approved') {
      const cc = await knex('cost_centers').where({ departure_id: reg.departure_id }).first();
      const agentName = AGENTS.find((a) => a.code === code)!.name;
      const journal = await postJournal(knex, {
        date: '2026-07-01',
        description: `Komisi agen — ${agentName} (${agent.pct}% × Rp ${base.toLocaleString('id-ID')})`,
        source: 'commission',
        refType: 'commissions',
        refId: commission.id,
        costCenterId: cc?.id ?? null,
        lines: commissionLines(amount)
      });
      await knex('commissions').where({ id: commission.id }).update({ status: 'approved', journal_id: journal.id, approved_at: '2026-07-01T10:00:00+07:00' });
    }
  }
}
