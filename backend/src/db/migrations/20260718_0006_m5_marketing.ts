import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('agents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code', 20).notNullable().unique(); // BRKH-07
    t.string('name').notNullable();
    t.string('referral_code', 20).notNullable().unique(); // dipakai di wizard: source "agent:BRKH-07"
    t.uuid('parent_agent_id').references('id').inTable('agents');
    t.string('phone');
    t.string('email');
    t.decimal('commission_pct', 5, 2).notNullable().defaultTo(3); // default 3% (contoh COA)
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('leads', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('agent_id').notNullable().references('id').inTable('agents');
    t.uuid('jamaah_id').references('id').inTable('jamaah'); // terisi saat konversi
    t.string('name').notNullable();
    t.string('phone');
    t.string('source'); // referral / walk-in / medsos
    t.enu('status', ['new', 'contacted', 'converted', 'lost'], { useNative: true, enumName: 'lead_status' })
      .notNullable()
      .defaultTo('new');
    t.timestamps(true, true);
    t.index(['agent_id']);
  });

  await knex.schema.createTable('commissions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('agent_id').notNullable().references('id').inTable('agents');
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').unique();
    t.decimal('base_amount', 15, 2).notNullable(); // dasar komisi = total invoice
    t.decimal('pct', 5, 2).notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.enu('status', ['pending', 'approved', 'paid'], { useNative: true, enumName: 'commission_status' })
      .notNullable()
      .defaultTo('pending');
    t.uuid('journal_id').references('id').inTable('journals'); // jurnal F saat approve
    t.uuid('approved_by').references('id').inTable('users');
    t.timestamp('approved_at');
    t.timestamps(true, true);
    t.index(['agent_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('commissions');
  await knex.schema.dropTableIfExists('leads');
  await knex.schema.dropTableIfExists('agents');
  for (const e of ['commission_status', 'lead_status']) {
    await knex.raw(`DROP TYPE IF EXISTS ${e}`);
  }
}
