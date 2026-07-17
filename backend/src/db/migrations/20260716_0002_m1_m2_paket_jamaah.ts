import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ===== M1 — Paket & Jadwal =====
  await knex.schema.createTable('hotels', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('city').notNullable();
    t.integer('star').notNullable().defaultTo(3);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('airlines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('iata_code', 3).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('packages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code').notNullable().unique();
    t.string('name').notNullable();
    t.enu('type', ['umrah', 'haji'], { useNative: true, enumName: 'package_type' }).notNullable();
    t.enu('category', ['reguler', 'plus', 'vip', 'khusus'], { useNative: true, enumName: 'package_category' }).notNullable();
    t.integer('duration_days').notNullable();
    t.decimal('base_price', 15, 2).notNullable();
    // Selisih harga kamar dari kuota Quad (mockup wizard step 4)
    t.decimal('triple_upcharge', 15, 2).notNullable().defaultTo(3500000);
    t.decimal('double_upcharge', 15, 2).notNullable().defaultTo(8000000);
    t.uuid('hotel_id').references('id').inTable('hotels');
    t.uuid('airline_id').references('id').inTable('airlines');
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('package_costs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('package_id').notNullable().references('id').inTable('packages').onDelete('CASCADE');
    t.string('component').notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('departures', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('package_id').notNullable().references('id').inTable('packages').onDelete('CASCADE');
    t.date('departure_date').notNullable();
    t.date('return_date').notNullable();
    t.integer('quota').notNullable();
    t.integer('seats_taken').notNullable().defaultTo(0);
    t.enu('status', ['open', 'closed', 'departed', 'completed'], { useNative: true, enumName: 'departure_status' })
      .notNullable()
      .defaultTo('open');
    t.timestamps(true, true);
    t.index(['package_id', 'departure_date']);
  });

  // ===== M2 — Jamaah & Pendaftaran =====
  await knex.schema.createTable('jamaah', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('nik', 16).notNullable().unique();
    t.string('full_name').notNullable();
    t.enu('gender', ['L', 'P'], { useNative: true, enumName: 'gender_type' }).notNullable();
    t.string('birth_place');
    t.date('birth_date');
    t.string('phone');
    t.string('email');
    t.text('address');
    t.string('emergency_contact_name');
    t.string('emergency_contact_phone');
    t.string('passport_no');
    t.date('passport_issued_at');
    t.date('passport_expiry');
    t.string('porsi_number');
    t.uuid('mahram_id').references('id').inTable('jamaah');
    t.string('mahram_name');
    t.string('mahram_relation');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('groups', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('departure_id').notNullable().references('id').inTable('departures').onDelete('CASCADE');
    t.string('name').notNullable();
    t.integer('capacity').notNullable().defaultTo(45);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('registrations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('reg_number').notNullable().unique();
    t.uuid('jamaah_id').notNullable().references('id').inTable('jamaah');
    t.uuid('departure_id').notNullable().references('id').inTable('departures');
    t.uuid('group_id').references('id').inTable('groups');
    t.enu('room_type', ['quad', 'triple', 'double'], { useNative: true, enumName: 'room_type' })
      .notNullable()
      .defaultTo('quad');
    t.string('room_number');
    t.enu('payment_scheme', ['dp', 'cicil', 'lunas'], { useNative: true, enumName: 'payment_scheme' })
      .notNullable()
      .defaultTo('dp');
    t.string('source'); // mis. "agent:BRKH-07" atau "web"
    t.enu('status', ['pending_documents', 'active', 'completed', 'cancelled'], {
      useNative: true,
      enumName: 'registration_status'
    })
      .notNullable()
      .defaultTo('pending_documents');
    t.timestamps(true, true);
    t.unique(['jamaah_id', 'departure_id']);
  });

  await knex.schema.createTable('documents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('jamaah_id').notNullable().references('id').inTable('jamaah').onDelete('CASCADE');
    t.enu('doc_type', ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'], { useNative: true, enumName: 'doc_type' }).notNullable();
    t.text('file_url').notNullable();
    t.enu('status', ['pending', 'verified', 'rejected'], { useNative: true, enumName: 'document_status' })
      .notNullable()
      .defaultTo('pending');
    t.timestamp('verified_at');
    t.uuid('verified_by').references('id').inTable('users');
    t.text('note');
    t.timestamps(true, true);
    t.unique(['jamaah_id', 'doc_type']);
  });

  // Penomoran berurutan per prefix (UMR-2026, HAJ-2027, nanti JV/INV/KWT di fase berikutnya)
  await knex.schema.createTable('numbering_sequences', (t) => {
    t.string('key').primary();
    t.integer('next_value').notNullable().defaultTo(1);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('numbering_sequences');
  await knex.schema.dropTableIfExists('documents');
  await knex.schema.dropTableIfExists('registrations');
  await knex.schema.dropTableIfExists('groups');
  await knex.schema.dropTableIfExists('jamaah');
  await knex.schema.dropTableIfExists('departures');
  await knex.schema.dropTableIfExists('package_costs');
  await knex.schema.dropTableIfExists('packages');
  await knex.schema.dropTableIfExists('airlines');
  await knex.schema.dropTableIfExists('hotels');
  for (const e of ['document_status', 'doc_type', 'registration_status', 'payment_scheme', 'room_type', 'gender_type', 'departure_status', 'package_category', 'package_type']) {
    await knex.raw(`DROP TYPE IF EXISTS ${e}`);
  }
}
