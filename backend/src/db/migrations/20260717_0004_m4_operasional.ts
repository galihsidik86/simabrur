import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('manifests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('departure_id').notNullable().references('id').inTable('departures').unique();
    t.timestamp('issued_at');
    t.enu('status', ['draft', 'ready', 'sent'], { useNative: true, enumName: 'manifest_status' })
      .notNullable()
      .defaultTo('draft');
    t.timestamps(true, true);
  });

  // Visa per registrasi (perjalanan), bukan per jamaah — penyempurnaan dari ERD
  // (satu jamaah bisa berangkat lebih dari sekali; visa melekat ke keberangkatan).
  await knex.schema.createTable('visas', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').onDelete('CASCADE').unique();
    t.string('visa_no');
    t.enu('status', ['process', 'biometric', 'issued'], { useNative: true, enumName: 'visa_status' })
      .notNullable()
      .defaultTo('process');
    t.timestamp('biometric_at');
    t.timestamp('issued_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('tickets', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').onDelete('CASCADE').unique();
    t.string('pnr'); // mis. TK-0451
    t.string('seat');
    t.enu('status', ['pending', 'issued'], { useNative: true, enumName: 'ticket_status' })
      .notNullable()
      .defaultTo('pending');
    t.timestamp('issued_at');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('group_staff', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('group_id').notNullable().references('id').inTable('groups').onDelete('CASCADE');
    t.uuid('user_id').references('id').inTable('users'); // opsional — staf bisa non-user
    t.string('staff_name').notNullable();
    t.enu('role', ['muthawwif', 'tour_leader'], { useNative: true, enumName: 'group_staff_role' }).notNullable();
    t.timestamps(true, true);
    t.unique(['group_id', 'role', 'staff_name']);
  });

  await knex.schema.createTable('checklists', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').onDelete('CASCADE');
    t.string('item').notNullable();
    t.boolean('is_done').notNullable().defaultTo(false);
    t.timestamps(true, true);
    t.unique(['registration_id', 'item']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('checklists');
  await knex.schema.dropTableIfExists('group_staff');
  await knex.schema.dropTableIfExists('tickets');
  await knex.schema.dropTableIfExists('visas');
  await knex.schema.dropTableIfExists('manifests');
  for (const e of ['group_staff_role', 'ticket_status', 'visa_status', 'manifest_status']) {
    await knex.raw(`DROP TYPE IF EXISTS ${e}`);
  }
}
