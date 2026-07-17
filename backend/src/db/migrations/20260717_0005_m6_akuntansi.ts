import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code', 10).notNullable().unique(); // pola K-NNNN, digit pertama = kelas
    t.string('name').notNullable();
    t.integer('class').notNullable(); // 1 Aset · 2 Liabilitas · 3 Ekuitas · 4 Pendapatan · 5 HPP · 6 Beban Ops · 7 Lain
    t.enu('normal_balance', ['debit', 'credit'], { useNative: true, enumName: 'normal_balance' }).notNullable();
    t.uuid('parent_id').references('id').inTable('accounts');
    t.boolean('is_postable').notNullable().defaultTo(true); // akun induk (level 0) = false
    t.boolean('is_highlighted').notNullable().defaultTo(false); // 2-1100 & 1-1400 (mockup COA)
    t.string('note');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('cost_centers', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('departure_id').references('id').inTable('departures').unique(); // null = CC non-keberangkatan (mis. MKT-Komisi)
    t.string('code').notNullable().unique(); // mis. UMR-PLUS-TR-2608
    t.string('name').notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('vendors', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.enu('type', ['hotel', 'airline', 'visa', 'catering', 'transport', 'other'], { useNative: true, enumName: 'vendor_type' })
      .notNullable()
      .defaultTo('other');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('vendor_bills', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('vendor_id').notNullable().references('id').inTable('vendors');
    t.uuid('cost_center_id').references('id').inTable('cost_centers');
    t.decimal('amount', 18, 2).notNullable();
    t.string('currency', 3).notNullable().defaultTo('IDR');
    t.date('due_date');
    t.enu('status', ['unpaid', 'paid'], { useNative: true, enumName: 'vendor_bill_status' }).notNullable().defaultTo('unpaid');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('journals', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('journal_no').notNullable().unique(); // JV-YYYY-NNNN
    t.date('date').notNullable();
    t.text('description').notNullable();
    t.enu('source', ['payment', 'expense', 'revenue', 'commission', 'manual', 'reconciliation'], {
      useNative: true,
      enumName: 'journal_source'
    }).notNullable();
    t.string('ref_type'); // polimorfik: payments / departures / …
    t.uuid('ref_id');
    t.uuid('cost_center_id').references('id').inTable('cost_centers');
    t.string('currency', 3).notNullable().defaultTo('IDR');
    t.decimal('exchange_rate', 12, 4).notNullable().defaultTo(1);
    t.uuid('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['date']);
    t.index(['source']);
  });

  await knex.schema.createTable('journal_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('journal_id').notNullable().references('id').inTable('journals').onDelete('CASCADE');
    t.uuid('account_id').notNullable().references('id').inTable('accounts');
    // Fungsional IDR (PLAN.md §4.4); amount_foreign menyimpan nilai valas asal bila ada
    t.decimal('debit', 18, 2).notNullable().defaultTo(0);
    t.decimal('credit', 18, 2).notNullable().defaultTo(0);
    t.decimal('amount_foreign', 18, 2);
    t.integer('position').notNullable().defaultTo(0);
    t.index(['account_id']);
    t.index(['journal_id']);
  });

  await knex.schema.createTable('exchange_rates', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('currency', 3).notNullable();
    t.decimal('rate', 12, 4).notNullable(); // IDR per 1 unit valas
    t.date('rate_date').notNullable();
    t.unique(['currency', 'rate_date']);
  });

  await knex.schema.createTable('bank_statement_lines', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bank_account_id').notNullable().references('id').inTable('bank_accounts');
    t.date('line_date').notNullable();
    t.string('description').notNullable();
    t.decimal('amount', 18, 2).notNullable(); // + masuk / − keluar
    t.uuid('matched_journal_id').references('id').inTable('journals');
    t.enu('status', ['unmatched', 'matched'], { useNative: true, enumName: 'statement_line_status' })
      .notNullable()
      .defaultTo('unmatched');
    t.timestamps(true, true);
    t.index(['bank_account_id', 'line_date']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('bank_statement_lines');
  await knex.schema.dropTableIfExists('exchange_rates');
  await knex.schema.dropTableIfExists('journal_lines');
  await knex.schema.dropTableIfExists('journals');
  await knex.schema.dropTableIfExists('vendor_bills');
  await knex.schema.dropTableIfExists('vendors');
  await knex.schema.dropTableIfExists('cost_centers');
  await knex.schema.dropTableIfExists('accounts');
  for (const e of ['statement_line_status', 'journal_source', 'vendor_bill_status', 'vendor_type', 'normal_balance']) {
    await knex.raw(`DROP TYPE IF EXISTS ${e}`);
  }
}
