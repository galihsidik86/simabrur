import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';
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

  // ===== Demo Portal Agen (BRKH-07) — dashboard kaya untuk presentasi manajemen =====
  const brkh = await knex('agents').where({ code: 'BRKH-07' }).first();
  const brkhPct = Number(brkh.commission_pct);
  // Portal aktif, password demo 'agen1234', tak wajib ganti agar langsung ke dashboard
  await knex('agents').where({ id: brkh.id }).update({
    phone: '08129000007', password_hash: await bcrypt.hash('agen1234', 10),
    must_change_password: false, portal_enabled: true
  });

  const payCommission = async (commissionId: string, amount: number, date: string) => {
    const pj = await postJournal(knex, {
      date, description: 'Pembayaran komisi agen — Barokah Tour', source: 'commission',
      refType: 'commissions', refId: commissionId,
      lines: [{ accountCode: '2-1400', debit: amount }, { accountCode: '1-1200', credit: amount }]
    });
    await knex('commissions').where({ id: commissionId }).update({ status: 'paid', payment_journal_id: pj.id, paid_at: `${date}T10:00:00+07:00` });
  };

  // Bayar komisi BRKH-07 yang sudah approved (UMR-2026-0412) → status paid
  const already = await knex('commissions').where({ agent_id: brkh.id, status: 'approved' }).first();
  if (already) await payCommission(already.id, Number(already.amount), '2026-07-20');

  // Attribusi 3 registrasi lagi ke BRKH-07 (status bervariasi) + komisi (paid/approved/pending)
  const spare = await knex('registrations as r')
    .join('invoices as i', 'i.registration_id', 'r.id')
    .join('jamaah as j', 'j.id', 'r.jamaah_id')
    .whereNull('r.agent_id')
    .select('r.id', 'r.reg_number', 'r.departure_id', 'i.total_amount', 'j.full_name')
    .orderBy('r.reg_number').limit(3);
  const regStatuses = ['active', 'active', 'pending_documents'];
  const commStatuses = ['paid', 'approved', 'pending'];
  const extra: { commId: string; regId: string; jamaah: string; amount: number; commStatus: string; regStatus: string }[] = [];
  for (let i = 0; i < spare.length; i++) {
    const reg = spare[i];
    await knex('registrations').where({ id: reg.id }).update({ agent_id: brkh.id, source: 'agent:BRKH-07', status: regStatuses[i] });
    const base = Number(reg.total_amount);
    const amount = Math.round((base * brkhPct) / 100);
    const [comm] = await knex('commissions').insert({ agent_id: brkh.id, registration_id: reg.id, base_amount: base, pct: brkhPct, amount, status: 'pending' }).returning('*');
    if (commStatuses[i] !== 'pending') {
      const cc = await knex('cost_centers').where({ departure_id: reg.departure_id }).first();
      const jr = await postJournal(knex, {
        date: '2026-07-18', description: `Komisi agen — Barokah Tour (${brkhPct}% × Rp ${base.toLocaleString('id-ID')})`,
        source: 'commission', refType: 'commissions', refId: comm.id, costCenterId: cc?.id ?? null, lines: commissionLines(amount)
      });
      await knex('commissions').where({ id: comm.id }).update({ status: 'approved', journal_id: jr.id, approved_at: '2026-07-18T10:00:00+07:00' });
      if (commStatuses[i] === 'paid') await payCommission(comm.id, amount, '2026-07-22');
    }
    extra.push({ commId: comm.id, regId: reg.id, jamaah: reg.full_name, amount, commStatus: commStatuses[i], regStatus: regStatuses[i] });
  }

  // Notifikasi — beragam jenis; sebagian belum dibaca (badge). read_at null = belum dibaca.
  const N = (type: string, title: string, body: string, refType: string, refId: string, createdAt: string, unread: boolean) =>
    ({ agent_id: brkh.id, type, title, body, ref_type: refType, ref_id: refId, created_at: createdAt, read_at: unread ? null : '2026-07-31T09:00:00+07:00' });
  const notifRows: Record<string, unknown>[] = [];
  for (const e of extra) {
    notifRows.push(N('referral_registered', 'Jamaah referral baru', `${e.jamaah} mendaftar via kode referral Anda.`, 'registrations', e.regId, '2026-07-10T08:00:00+07:00', false));
    if (e.regStatus === 'active') notifRows.push(N('registration_active', 'Dokumen jamaah lengkap', `${e.jamaah} dokumennya lengkap — registrasi aktif.`, 'registrations', e.regId, '2026-07-15T09:00:00+07:00', false));
    if (e.commStatus !== 'pending') notifRows.push(N('commission_approved', 'Komisi disetujui', `Komisi Rp ${e.amount.toLocaleString('id-ID')} (${e.jamaah}) disetujui, menunggu pembayaran.`, 'commissions', e.commId, '2026-07-18T10:30:00+07:00', true));
    if (e.commStatus === 'paid') notifRows.push(N('commission_paid', 'Komisi cair', `Komisi Rp ${e.amount.toLocaleString('id-ID')} (${e.jamaah}) telah dibayar ke Anda.`, 'commissions', e.commId, '2026-07-22T11:00:00+07:00', true));
  }
  if (already) notifRows.push(N('commission_paid', 'Komisi cair', `Komisi Rp ${Number(already.amount).toLocaleString('id-ID')} telah dibayar ke Anda.`, 'commissions', already.id, '2026-07-20T11:00:00+07:00', true));
  if (notifRows.length) await knex('agent_notifications').insert(notifRows);

  // Leads segar untuk tab Leads
  await knex('leads').insert([
    { agent_id: brkh.id, name: 'Kel. Bpk. Sudirman', phone: '0813-5566-7788', source: 'portal-agen', status: 'new' },
    { agent_id: brkh.id, name: 'Ibu Halimah', phone: '0813-2211-9900', source: 'portal-agen', status: 'contacted' }
  ]);
}
