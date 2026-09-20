import type { Knex } from 'knex';

/**
 * Langkah 9 (fitur pembatalan registrasi + refund) — lihat kontrak di
 * .orkestra/runs/20260915-1856-audit-sistem/plan.md "Kontrak pembatalan & refund".
 *
 * Perluasan enum (`ALTER TYPE ... ADD VALUE`): PostgreSQL 12+ mengizinkan ini di
 * dalam sebuah transaksi (knex membungkus tiap migrasi dalam transaksi secara
 * default) SELAMA nilai baru tidak ikut DIPAKAI (insert/update/where/default
 * literal) pada transaksi yang sama. Migrasi ini hanya mengubah skema — tidak ada
 * baris yang ditulis dengan status baru — jadi aman tanpa `config.transaction = false`.
 * `IF NOT EXISTS` membuat up() idempoten terhadap siklus rollback→migrate berulang
 * yang dipakai `resetTestDb` di setiap file tes (nilai enum tidak pernah benar-benar
 * dihapus oleh down(), lihat catatan di bawah).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'rejected'`);
  await knex.raw(`ALTER TYPE schedule_status ADD VALUE IF NOT EXISTS 'cancelled'`);
  // Jurnal refund pembatalan butuh sumber tersendiri (konsisten dgn payment/expense/
  // revenue/commission/manual/reconciliation yang sudah ada) agar bisa difilter di
  // Jurnal Umum dan tidak disalahartikan sebagai jurnal manual staf.
  await knex.raw(`ALTER TYPE journal_source ADD VALUE IF NOT EXISTS 'refund'`);

  await knex.schema.alterTable('registrations', (t) => {
    t.timestamp('cancelled_at');
    t.uuid('cancelled_by').references('id').inTable('users');
    t.text('cancel_reason');
  });

  await knex.schema.alterTable('payments', (t) => {
    t.text('reject_reason');
    t.uuid('rejected_by').references('id').inTable('users');
    t.timestamp('rejected_at');
  });

  await knex.schema.alterTable('commissions', (t) => {
    // Komisi berstatus 'paid' pada registrasi yang dibatalkan tidak bisa dijurnal-
    // balik otomatis (uang sudah keluar ke agen) — ditandai perlu ditagih kembali
    // (keputusan user putaran 2). Tidak menambah nilai enum commission_status baru:
    // status komisi tetap 'paid', penanda ini hanya metadata tambahan.
    t.boolean('clawback_required').notNullable().defaultTo(false);
    t.timestamp('clawback_marked_at');
  });

  await knex.schema.createTable('refunds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('registration_id').notNullable().references('id').inTable('registrations').unique();
    t.uuid('cost_center_id').notNullable().references('id').inTable('cost_centers');
    t.decimal('paid_total', 15, 2).notNullable();
    t.decimal('deduction', 15, 2).notNullable().defaultTo(0);
    t.decimal('refund_amount', 15, 2).notNullable();
    t.text('deduction_reason');
    t.enu('status', ['pending', 'paid'], { useNative: true, enumName: 'refund_status' }).notNullable().defaultTo('pending');
    t.uuid('bank_account_id').references('id').inTable('bank_accounts');
    t.uuid('journal_id').references('id').inTable('journals');
    t.string('reference');
    t.string('idempotency_key').unique();
    t.uuid('created_by').references('id').inTable('users');
    t.uuid('paid_by').references('id').inTable('users');
    t.timestamp('paid_at');
    t.timestamps(true, true);
  });
  await knex.raw(`
    ALTER TABLE refunds
      ADD CONSTRAINT refunds_paid_total_nonneg CHECK (paid_total >= 0),
      ADD CONSTRAINT refunds_deduction_range CHECK (deduction >= 0 AND deduction <= paid_total),
      ADD CONSTRAINT refunds_amount_eq CHECK (refund_amount = paid_total - deduction)
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('refunds');
  await knex.raw(`DROP TYPE IF EXISTS refund_status`);

  await knex.schema.alterTable('commissions', (t) => {
    t.dropColumn('clawback_required');
    t.dropColumn('clawback_marked_at');
  });
  await knex.schema.alterTable('payments', (t) => {
    t.dropColumn('reject_reason');
    t.dropColumn('rejected_by');
    t.dropColumn('rejected_at');
  });
  await knex.schema.alterTable('registrations', (t) => {
    t.dropColumn('cancelled_at');
    t.dropColumn('cancelled_by');
    t.dropColumn('cancel_reason');
  });

  // payment_status 'rejected', schedule_status 'cancelled', journal_source 'refund':
  // PostgreSQL TIDAK punya `ALTER TYPE ... DROP VALUE` (tidak seperti ADD VALUE) —
  // nilai enum ini tidak bisa dihapus lewat down(). Dibiarkan ada (no-op aman): kolom
  // yang memakainya sudah dihapus/dikosongkan di atas, dan `ADD VALUE IF NOT EXISTS`
  // di up() membuat siklus rollback→migrate berulang (dipakai tiap tes) tetap idempoten.
}
