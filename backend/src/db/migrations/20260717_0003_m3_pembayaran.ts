import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Kas & bank dibuat lebih awal dari M6 karena payments mengacu ke sini (ERD).
  // account_code = kode COA (1-1100 Kas, 1-1200 Bank IDR, dst) — dipakai jurnal otomatis Fase 5.
  await knex.schema.createTable('bank_accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('account_code', 10).notNullable().unique();
    t.string('name').notNullable();
    t.string('bank');
    t.string('account_no');
    t.string('currency', 3).notNullable().defaultTo('IDR');
    t.decimal('balance', 18, 2).notNullable().defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').unique();
    t.string('number').notNullable().unique(); // INV/YYYY/MM/NNNN (NNNN = serial registrasi)
    t.date('issued_date').notNullable();
    t.date('due_date').notNullable();
    t.string('currency', 3).notNullable().defaultTo('IDR');
    t.decimal('total_amount', 15, 2).notNullable();
    t.enu('status', ['unpaid', 'partial', 'paid'], { useNative: true, enumName: 'invoice_status' })
      .notNullable()
      .defaultTo('unpaid');
    t.string('va_number'); // 8801 <serial> 0000 <serial> (BSI VA, mockup invoice)
    t.timestamps(true, true);
  });

  await knex.schema.createTable('payment_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').onDelete('CASCADE');
    t.integer('term_no').notNullable(); // 0 = DP
    t.string('label').notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.date('due_date').notNullable();
    t.enu('status', ['unpaid', 'paid'], { useNative: true, enumName: 'schedule_status' })
      .notNullable()
      .defaultTo('unpaid');
    t.timestamps(true, true);
    t.unique(['registration_id', 'term_no']);
  });

  await knex.schema.createTable('payments', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('invoice_id').notNullable().references('id').inTable('invoices');
    t.uuid('schedule_id').references('id').inTable('payment_schedules');
    t.uuid('bank_account_id').references('id').inTable('bank_accounts');
    t.decimal('amount', 15, 2).notNullable();
    t.string('currency', 3).notNullable().defaultTo('IDR');
    t.decimal('exchange_rate', 12, 4).notNullable().defaultTo(1);
    t.enu('method', ['va', 'transfer', 'cash', 'card'], { useNative: true, enumName: 'payment_method' })
      .notNullable()
      .defaultTo('va');
    t.timestamp('paid_at').notNullable().defaultTo(knex.fn.now());
    t.string('reference');
    t.enu('status', ['pending', 'verified'], { useNative: true, enumName: 'payment_status' })
      .notNullable()
      .defaultTo('pending');
    t.string('idempotency_key').unique();
    t.uuid('created_by').references('id').inTable('users');
    t.uuid('verified_by').references('id').inTable('users');
    t.timestamp('verified_at');
    t.text('note');
    t.timestamps(true, true);
    t.index(['invoice_id']);
  });

  await knex.schema.createTable('receipts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_id').notNullable().references('id').inTable('payments').unique();
    t.string('number').notNullable().unique(); // KWT/YYYY/MM/NNNN (serial independen)
    t.date('issued_date').notNullable();
    t.decimal('amount', 15, 2).notNullable();
    t.text('terbilang').notNullable();
    t.text('description').notNullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('receipts');
  await knex.schema.dropTableIfExists('payments');
  await knex.schema.dropTableIfExists('payment_schedules');
  await knex.schema.dropTableIfExists('invoices');
  await knex.schema.dropTableIfExists('bank_accounts');
  for (const e of ['payment_status', 'payment_method', 'schedule_status', 'invoice_status']) {
    await knex.raw(`DROP TYPE IF EXISTS ${e}`);
  }
}
