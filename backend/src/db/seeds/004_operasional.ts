import type { Knex } from 'knex';

/**
 * Seed M4 — operasional persis mockup:
 * - Rombongan Plus Turki: Muthawwif Ust. Fadhil, TL Bpk. Surya (Grup A & B)
 * - Status visa/tiket manifest (Terbit/Biometrik/Proses, PNR TK-04xx, kamar)
 * - Checklist perlengkapan portal Siti: koper ✓, seragam ✓, buku manasik ✗, ihram ✗
 */

// [regNumber, visaStatus, visaNo|null, pnr|null]
const OPS: [string, 'process' | 'biometric' | 'issued', string | null, string | null][] = [
  ['UMR-2026-0402', 'issued', 'V-88014102', 'SV-0331'],
  ['UMR-2026-0412', 'issued', 'V-88014112', 'SV-0451'],
  ['UMR-2026-0418', 'issued', 'V-88014118', 'TK-0452'],
  ['UMR-2026-0421', 'biometric', null, null],
  ['UMR-2026-0425', 'process', null, null],
  ['UMR-2026-0429', 'process', null, null],
  ['UMR-2026-0430', 'process', null, null],
  ['UMR-2026-0433', 'issued', 'V-88014133', 'SV-0455'],
  ['HAJ-2027-0033', 'process', null, null],
  ['UMR-2026-0436', 'issued', 'V-88014136', 'TK-0451'],
  ['UMR-2026-0437', 'biometric', null, null],
  ['UMR-2026-0438', 'issued', 'V-88014138', 'TK-0453'],
  ['UMR-2026-0439', 'process', null, null],
  ['UMR-2026-0440', 'issued', 'V-88014140', 'TK-0454']
];

const CHECKLIST_ITEMS = ['Koper & tas kabin', 'Seragam batik', 'Buku manasik & doa', 'Kain ihram / mukena'];

export async function seed(knex: Knex): Promise<void> {
  // ---- Penugasan rombongan Plus Turki ----
  const groups = await knex('groups').whereIn('name', ['Grup A', 'Grup B']);
  for (const g of groups) {
    await knex('group_staff').insert([
      { group_id: g.id, staff_name: 'Ust. Fadhil', role: 'muthawwif' },
      { group_id: g.id, staff_name: 'Bpk. Surya', role: 'tour_leader' }
    ]);
  }

  // ---- Visa & tiket ----
  for (const [regNumber, visaStatus, visaNo, pnr] of OPS) {
    const reg = await knex('registrations').where({ reg_number: regNumber }).first();
    if (!reg) continue;
    await knex('visas').insert({
      registration_id: reg.id,
      status: visaStatus,
      visa_no: visaNo,
      biometric_at: visaStatus === 'biometric' || visaStatus === 'issued' ? '2026-06-20T09:00:00+07:00' : null,
      issued_at: visaStatus === 'issued' ? '2026-07-01T09:00:00+07:00' : null
    });
    if (pnr) {
      await knex('tickets').insert({
        registration_id: reg.id,
        pnr,
        status: 'issued',
        issued_at: '2026-07-05T09:00:00+07:00'
      });
    }
  }

  // ---- Checklist perlengkapan ----
  const regs = await knex('registrations').select('id', 'reg_number');
  for (const reg of regs) {
    // Golden thread Siti: 2 pertama diterima (portal mockup); lainnya acak-tetap per urutan
    const doneCount = reg.reg_number === 'UMR-2026-0418' ? 2 : reg.reg_number.endsWith('2') ? 4 : reg.reg_number.endsWith('0') ? 1 : 3;
    await knex('checklists').insert(
      CHECKLIST_ITEMS.map((item, i) => ({ registration_id: reg.id, item, is_done: i < doneCount }))
    );
  }

  // ---- Manifest Plus Turki siap ----
  const plusTurki = await knex('departures as d')
    .join('packages as p', 'p.id', 'd.package_id')
    .where('p.code', 'UMR-PLUS-TR')
    .select('d.id')
    .first();
  await knex('manifests').insert({ departure_id: plusTurki.id, status: 'ready', issued_at: '2026-07-10T09:00:00+07:00' });
}
