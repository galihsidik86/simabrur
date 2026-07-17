import type { Knex } from 'knex';
import bcrypt from 'bcryptjs';

// Role & hak akses sesuai tabel RBAC pada Handoff Developer
const ROLE_DEFS = [
  { name: 'admin', label: 'Admin', permissions: { all: true } },
  { name: 'marketing', label: 'Marketing', permissions: { modules: ['packages', 'leads', 'agents', 'commissions', 'reports:sales'] } },
  { name: 'operasional', label: 'Operasional', permissions: { modules: ['jamaah', 'documents', 'manifest', 'visas', 'tickets', 'groups'] } },
  { name: 'keuangan', label: 'Keuangan', permissions: { modules: ['payments', 'journals', 'reconciliations', 'reports:finance'] } },
  { name: 'pimpinan', label: 'Pimpinan', permissions: { modules: ['dashboard', 'reports'], readOnly: true } },
  { name: 'jamaah', label: 'Jamaah', permissions: { modules: ['portal'] } }
];

/** Tabel dihapus global di sini (anak → induk) agar file seed lain bebas urutan FK. */
const WIPE_ORDER = [
  'commissions', 'leads', 'agents',
  'bank_statement_lines', 'journal_lines', 'journals',
  'vendor_bills', 'vendors', 'cost_centers', 'exchange_rates', 'accounts',
  'checklists', 'group_staff', 'tickets', 'visas', 'manifests',
  'receipts', 'payments', 'payment_schedules', 'invoices',
  'documents', 'registrations', 'groups', 'jamaah',
  'departures', 'package_costs', 'packages', 'airlines', 'hotels',
  'bank_accounts', 'numbering_sequences',
  'refresh_tokens', 'audit_logs', 'users', 'roles', 'branches'
];

export async function seed(knex: Knex): Promise<void> {
  for (const table of WIPE_ORDER) {
    if (await knex.schema.hasTable(table)) await knex(table).del();
  }

  const [jakarta] = await knex('branches')
    .insert([
      { name: 'Safar Jakarta', city: 'Jakarta' },
      { name: 'Safar Surabaya', city: 'Surabaya' }
    ])
    .returning('*');

  const roles = await knex('roles')
    .insert(ROLE_DEFS.map((r) => ({ name: r.name, label: r.label, permissions: JSON.stringify(r.permissions) })))
    .returning('*');
  const roleId = (name: string) => roles.find((r) => r.name === name)!.id;

  const hash = await bcrypt.hash('safar123', 10);
  await knex('users').insert([
    { branch_id: jakarta.id, role_id: roleId('admin'), name: 'Rizki Amanullah', email: 'admin@safar.co.id', password_hash: hash },
    { branch_id: jakarta.id, role_id: roleId('keuangan'), name: 'Dina Kartika', email: 'keuangan@safar.co.id', password_hash: hash },
    { branch_id: jakarta.id, role_id: roleId('operasional'), name: 'Surya Pratama', email: 'ops@safar.co.id', password_hash: hash },
    { branch_id: jakarta.id, role_id: roleId('marketing'), name: 'Laila Hanum', email: 'marketing@safar.co.id', password_hash: hash },
    { branch_id: jakarta.id, role_id: roleId('pimpinan'), name: 'H. Mahmud Basri', email: 'pimpinan@safar.co.id', password_hash: hash }
  ]);
}
