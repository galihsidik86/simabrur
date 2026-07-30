import type { Knex } from 'knex';

/**
 * Penajaman komisi marketing (menutup temuan audit):
 *  - `registrations.agent_id` — normalisasi atribusi jamaah→agen (sumber kebenaran,
 *    menggantikan parsing string `source`).
 *  - `commissions`: registration_id boleh NULL (komisi manual/ad-hoc tanpa registrasi);
 *    kolom siklus bayar (paid_*) & pembalikan (reversed_*) agar status 'paid' hidup
 *    dan komisi bisa di-storno bila registrasi batal.
 *  - `agents.parent_agent_id` DIBUANG — hierarki MLM tak pernah diimplementasikan
 *    (dead schema write-only); Safar memakai atribusi 1 agen langsung.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (t) => {
    t.uuid('agent_id').references('id').inTable('agents'); // atribusi agen (nullable)
    t.index('agent_id');
  });

  await knex.schema.alterTable('commissions', (t) => {
    t.uuid('paid_by').references('id').inTable('users');
    t.timestamp('paid_at');
    t.uuid('payment_journal_id').references('id').inTable('journals'); // jurnal Dr 2-1400 · Cr Bank
    t.uuid('reversed_by').references('id').inTable('users');
    t.timestamp('reversed_at');
    t.uuid('reversal_journal_id').references('id').inTable('journals'); // storno beban+hutang
  });
  // Komisi manual (Input Transaksi) tak selalu terkait registrasi
  await knex.raw('ALTER TABLE commissions ALTER COLUMN registration_id DROP NOT NULL');

  await knex.schema.alterTable('agents', (t) => {
    t.dropColumn('parent_agent_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (t) => {
    t.uuid('parent_agent_id').references('id').inTable('agents');
  });
  // Komisi manual (registration_id NULL) adalah fitur migrasi ini — hapus dulu agar NOT NULL bisa dipulihkan
  await knex('commissions').whereNull('registration_id').del();
  await knex.raw('ALTER TABLE commissions ALTER COLUMN registration_id SET NOT NULL');
  await knex.schema.alterTable('commissions', (t) => {
    t.dropColumn('paid_by');
    t.dropColumn('paid_at');
    t.dropColumn('payment_journal_id');
    t.dropColumn('reversed_by');
    t.dropColumn('reversed_at');
    t.dropColumn('reversal_journal_id');
  });
  await knex.schema.alterTable('registrations', (t) => {
    t.dropColumn('agent_id');
  });
}
