import type { Knex } from 'knex';

/**
 * M6+ — Rekonsiliasi bank fungsional (menutup gap audit).
 *
 * Sebelumnya hanya ada `bank_statement_lines` dan "saldo koran" diturunkan dari
 * buku besar (tautologi — tak pernah bisa mendeteksi selisih). Migrasi ini:
 *  - Membuat tabel `bank_reconciliations` (dijanjikan PLAN.md §3): sesi per
 *    (rekening, periode) dengan **saldo akhir koran yang diinput admin** sebagai
 *    angka EKSTERNAL independen, status draft/completed, snapshot selisih & pengunci.
 *  - Memperkaya `bank_statement_lines`: tautan ke sesi, tipe baris terstruktur
 *    (ganti heuristik regex), tautan ke BARIS jurnal (bukan header), jejak impor
 *    + guard duplikasi.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('bank_reconciliations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('bank_account_id').notNullable().references('id').inTable('bank_accounts');
    t.string('period', 7).notNullable(); // 'YYYY-MM'
    t.date('statement_date').notNullable(); // tanggal cut-off lembar koran
    t.decimal('opening_balance', 18, 2).notNullable().defaultTo(0);
    t.decimal('closing_balance', 18, 2).notNullable(); // saldo akhir koran — DIINPUT admin
    t.enu('status', ['draft', 'completed'], { useNative: true, enumName: 'reconciliation_status' })
      .notNullable()
      .defaultTo('draft');
    t.decimal('reconciled_diff', 18, 2); // snapshot selisih residu saat finalize
    t.uuid('reconciled_by').references('id').inTable('users');
    t.timestamp('reconciled_at');
    t.uuid('created_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.unique(['bank_account_id', 'period']);
  });

  await knex.schema.alterTable('bank_statement_lines', (t) => {
    t.uuid('reconciliation_id').references('id').inTable('bank_reconciliations');
    t.enu('line_type', ['setoran', 'penarikan', 'jasa_giro', 'biaya_adm', 'pajak_giro', 'transfer', 'lain'], {
      useNative: true,
      enumName: 'statement_line_type'
    })
      .notNullable()
      .defaultTo('lain');
    // Taut ke BARIS jurnal spesifik (perbaikan: matched_journal_id lama menaut ke header)
    t.uuid('matched_journal_line_id').references('id').inTable('journal_lines');
    t.string('external_ref'); // untuk dedup impor
    t.uuid('import_batch_id');
    t.uuid('created_by').references('id').inTable('users');
    t.index('reconciliation_id');
  });

  // Guard duplikasi impor: unik (rekening, tanggal, external_ref) bila external_ref diisi
  await knex.raw(
    `CREATE UNIQUE INDEX bank_statement_lines_dedup
       ON bank_statement_lines (bank_account_id, line_date, external_ref)
       WHERE external_ref IS NOT NULL`
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS bank_statement_lines_dedup');
  await knex.schema.alterTable('bank_statement_lines', (t) => {
    t.dropColumn('reconciliation_id');
    t.dropColumn('line_type');
    t.dropColumn('matched_journal_line_id');
    t.dropColumn('external_ref');
    t.dropColumn('import_batch_id');
    t.dropColumn('created_by');
  });
  await knex.schema.dropTableIfExists('bank_reconciliations');
  await knex.raw('DROP TYPE IF EXISTS statement_line_type');
  await knex.raw('DROP TYPE IF EXISTS reconciliation_status');
}
