import type { Knex } from 'knex';
// Catatan: tanpa ekstensi .js — file seed dimuat dinamis oleh Knex baik di tsx
// maupun Vitest; folder seeds dikecualikan dari kompilasi tsc (lihat tsconfig).
import { terbilang } from '../../utils/terbilang';
import { buildSchedules } from '../../modules/payments/payments.rules';

/**
 * Seed M3 — pembayaran persis mockup:
 * - Golden thread Hj. Siti Rohmah: INV/2026/06/0418, termin 5,0 / 11,9 / 11,8 / 11,2 (=39,9 Jt),
 *   terbayar 28,7 Jt, sisa 11,2 Jt tempo 10 Jul 2026, kwitansi T2 = KWT/2026/06/1183.
 * - Baris kartu piutang & aging (0402/0412/0421/0425/0429/0430/0433/HAJ-0033) sesuai angka mockup.
 */

const JT = 1_000_000;

interface Line { label: string; amount: number; due: string; paid?: string } // paid = tanggal bayar

interface Plan {
  reg: string;
  issued: string;
  total: number;
  lines: Line[];
}

// Baris eksplisit — angka mockup (kartu piutang + aging Laporan Operasional)
const PLANS: Plan[] = [
  { reg: 'UMR-2026-0402', issued: '2026-01-02', total: 28.5 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5 * JT, due: '2026-01-05', paid: '2026-01-05' },
    { label: 'Termin 1', amount: 5 * JT, due: '2026-02-02', paid: '2026-02-02' },
    { label: 'Termin 2', amount: 5 * JT, due: '2026-03-02', paid: '2026-03-02' },
    { label: 'Termin 3', amount: 5 * JT, due: '2026-03-20', paid: '2026-03-20' },
    { label: 'Termin 4', amount: 4 * JT, due: '2026-04-02' },
    { label: 'Termin 5 (pelunasan)', amount: 4.5 * JT, due: '2026-05-02' } ] },
  { reg: 'UMR-2026-0412', issued: '2026-02-10', total: 28.5 * JT, lines: [
    { label: 'Pelunasan', amount: 28.5 * JT, due: '2026-02-17', paid: '2026-02-15' } ] },
  { reg: 'UMR-2026-0418', issued: '2026-06-10', total: 39.9 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5 * JT, due: '2026-03-10', paid: '2026-03-10' },
    { label: 'Termin 1', amount: 11.9 * JT, due: '2026-05-10', paid: '2026-05-10' },
    { label: 'Termin 2', amount: 11.8 * JT, due: '2026-06-10', paid: '2026-06-10' },
    { label: 'Termin 3 (pelunasan)', amount: 11.2 * JT, due: '2026-07-10' } ] },
  { reg: 'UMR-2026-0421', issued: '2026-03-18', total: 62 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5 * JT, due: '2026-03-21', paid: '2026-03-21' },
    { label: 'Termin 1', amount: 11.9 * JT, due: '2026-04-18', paid: '2026-04-18' },
    { label: 'Termin 2', amount: 11 * JT, due: '2026-05-18', paid: '2026-05-20' },
    { label: 'Termin 3', amount: 11.4 * JT, due: '2026-07-18' },
    { label: 'Termin 4', amount: 11.4 * JT, due: '2026-08-18' },
    { label: 'Termin 5 (pelunasan)', amount: 11.3 * JT, due: '2026-08-25' } ] },
  { reg: 'UMR-2026-0425', issued: '2026-04-02', total: 28.5 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5.7 * JT, due: '2026-04-05', paid: '2026-04-05' },
    { label: 'Pelunasan', amount: 22.8 * JT, due: '2026-07-05' } ] },
  { reg: 'UMR-2026-0429', issued: '2026-02-05', total: 62 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5 * JT, due: '2026-02-08', paid: '2026-02-08' },
    { label: 'Termin 1', amount: 12.8 * JT, due: '2026-03-05', paid: '2026-03-05' },
    { label: 'Termin 2', amount: 12.8 * JT, due: '2026-04-05', paid: '2026-04-05' },
    { label: 'Termin 3', amount: 12.8 * JT, due: '2026-05-05', paid: '2026-05-05' },
    { label: 'Termin 4', amount: 9.3 * JT, due: '2026-08-05' },
    { label: 'Termin 5 (pelunasan)', amount: 9.3 * JT, due: '2026-09-05' } ] },
  { reg: 'UMR-2026-0430', issued: '2026-05-25', total: 44.5 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 6.7 * JT, due: '2026-05-28', paid: '2026-05-28' },
    { label: 'Pelunasan', amount: 37.8 * JT, due: '2026-07-25' } ] },
  { reg: 'UMR-2026-0433', issued: '2026-04-15', total: 31 * JT, lines: [
    { label: 'Uang Muka (DP)', amount: 5 * JT, due: '2026-04-18', paid: '2026-04-18' },
    { label: 'Termin 1', amount: 6.8 * JT, due: '2026-05-15', paid: '2026-05-15' },
    { label: 'Termin 2', amount: 6.8 * JT, due: '2026-06-15', paid: '2026-06-15' },
    { label: 'Termin 3', amount: 6.2 * JT, due: '2026-07-15' },
    { label: 'Termin 4 (pelunasan)', amount: 6.2 * JT, due: '2026-08-15' } ] },
  { reg: 'HAJ-2027-0033', issued: '2026-01-20', total: 245 * JT, lines: [
    { label: 'Pelunasan', amount: 245 * JT, due: '2026-01-27', paid: '2026-01-25' } ] }
];

// Rombongan Plus Turki lain — jadwal via generator, k termin pertama lunas
const GENERATED: { reg: string; issued: string; paidTerms: number }[] = [
  { reg: 'UMR-2026-0436', issued: '2026-03-15', paidTerms: 3 },
  { reg: 'UMR-2026-0437', issued: '2026-03-15', paidTerms: 1 },
  { reg: 'UMR-2026-0438', issued: '2026-03-15', paidTerms: 99 }, // lunas
  { reg: 'UMR-2026-0439', issued: '2026-03-15', paidTerms: 2 },
  { reg: 'UMR-2026-0440', issued: '2026-03-15', paidTerms: 99 } // lunas
];

export async function seed(knex: Knex): Promise<void> {
  // ---- Kas & bank (kode COA — dipakai jurnal Fase 5) ----
  const banks = await knex('bank_accounts')
    .insert([
      { account_code: '1-1100', name: 'Kas Kantor', bank: null, account_no: null, currency: 'IDR' },
      { account_code: '1-1200', name: 'Bank IDR (BSI)', bank: 'BSI', account_no: '8801-0418', currency: 'IDR' },
      { account_code: '1-1210', name: 'Bank USD', bank: 'BSI', account_no: '8801-0421', currency: 'USD' },
      { account_code: '1-1220', name: 'Bank SAR', bank: 'BSI', account_no: '8801-0422', currency: 'SAR' }
    ])
    .returning('*');
  const bankIdr = banks.find((b) => b.account_code === '1-1200')!.id;

  let kwtSerial = 1100; // serial kwitansi berjalan; T2 Siti dipaksa 1183 (mockup)

  async function insertPlan(plan: Plan) {
    const reg = await knex('registrations').where({ reg_number: plan.reg }).first();
    if (!reg) throw new Error(`Seed 003: registrasi ${plan.reg} tidak ditemukan`);
    const serial = plan.reg.slice(-4);
    const [iy, im] = plan.issued.split('-');
    const totalPaid = plan.lines.filter((l) => l.paid).reduce((s, l) => s + l.amount, 0);

    const [invoice] = await knex('invoices')
      .insert({
        registration_id: reg.id,
        number: `INV/${iy}/${im}/${serial}`,
        issued_date: plan.issued,
        due_date: plan.lines[plan.lines.length - 1].due,
        total_amount: plan.total,
        status: totalPaid >= plan.total ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid',
        va_number: `8801 ${serial} 0000 ${serial}`
      })
      .returning('*');

    for (let i = 0; i < plan.lines.length; i++) {
      const line = plan.lines[i];
      const [schedule] = await knex('payment_schedules')
        .insert({
          registration_id: reg.id,
          term_no: line.label.startsWith('Uang Muka') ? 0 : i,
          label: line.label,
          amount: line.amount,
          due_date: line.due,
          status: line.paid ? 'paid' : 'unpaid'
        })
        .returning('*');

      if (line.paid) {
        const [payment] = await knex('payments')
          .insert({
            invoice_id: invoice.id,
            schedule_id: schedule.id,
            bank_account_id: bankIdr,
            amount: line.amount,
            method: 'va',
            paid_at: line.paid + 'T10:00:00+07:00',
            reference: `BSI-VA-${serial}-${i}`,
            status: 'verified',
            verified_at: line.paid + 'T15:00:00+07:00'
          })
          .returning('*');

        // Kwitansi — T2 Siti Rohmah dipaksa KWT/2026/06/1183 (mockup)
        const isSitiT2 = plan.reg === 'UMR-2026-0418' && line.label === 'Termin 2';
        const [py, pm] = line.paid.split('-');
        const number = isSitiT2 ? 'KWT/2026/06/1183' : `KWT/${py}/${pm}/${String(kwtSerial++)}`;
        await knex('receipts').insert({
          payment_id: payment.id,
          number,
          issued_date: line.paid,
          amount: line.amount,
          terbilang: terbilang(line.amount),
          description: `${line.label} paket — No. Reg ${plan.reg}`
        });
      }
    }
  }

  for (const plan of PLANS) await insertPlan(plan);

  for (const g of GENERATED) {
    const reg = await knex('registrations as r')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('r.*', 'd.departure_date', 'p.base_price', 'p.triple_upcharge', 'p.double_upcharge')
      .where('r.reg_number', g.reg)
      .first();
    if (!reg) throw new Error(`Seed 003: registrasi ${g.reg} tidak ditemukan`);
    const upcharge = reg.room_type === 'triple' ? Number(reg.triple_upcharge) : reg.room_type === 'double' ? Number(reg.double_upcharge) : 0;
    const total = Number(reg.base_price) + upcharge;
    const scheme = reg.payment_scheme as 'dp' | 'cicil' | 'lunas';
    const lines = buildSchedules(scheme, total, g.issued, reg.departure_date).map((s, idx) => ({
      label: s.label,
      amount: s.amount,
      due: s.dueDate,
      paid: idx < g.paidTerms ? s.dueDate : undefined
    }));
    await insertPlan({ reg: g.reg, issued: g.issued, total, lines });
  }

  // Penomoran lanjutan: registrasi (dari seed 002) + kwitansi bulan berjalan
  await knex('numbering_sequences')
    .insert([
      { key: 'UMR-2026', next_value: 500 },
      { key: 'HAJ-2027', next_value: 50 },
      { key: 'KWT/2026/07', next_value: 1200 }
    ])
    .onConflict('key')
    .merge();
}
