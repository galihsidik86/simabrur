import type { Knex } from 'knex';

/**
 * Notifikasi in-portal untuk agen (mis. "komisi cair"). Generik — `type` bebas
 * agar mudah menambah jenis notifikasi lain (komisi disetujui, lead dialihkan, dsb.)
 * tanpa migrasi baru.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agent_notifications', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('agent_id').notNullable().references('id').inTable('agents');
    t.string('type').notNullable(); // mis. 'commission_paid'
    t.string('title').notNullable();
    t.text('body').notNullable();
    t.string('ref_type');
    t.uuid('ref_id');
    t.timestamp('read_at');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['agent_id', 'read_at']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('agent_notifications');
}
