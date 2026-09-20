import type { Knex } from 'knex';

/**
 * Putaran 3 (langkah 15) — lihat
 * .orkestra/runs/20260915-1856-audit-sistem/plan.md "Putaran 3 — DISETUJUI user".
 *
 * A. Kwitansi refund: nomor `KWR/YYYY/MM/NNNN` pada `refunds`.
 * B. HPP sisa otomatis → hutang vendor PER KOMPONEN: kolom penghubung di `vendor_bills`
 *    (jurnal HPP yang menerbitkannya, akun HPP komponen, pelunasan parsial).
 * C. Balik jurnal manual: relasi pembalikan pada `journals`.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refunds', (t) => {
    t.string('receipt_number').unique();
    t.date('receipt_issued_date');
  });

  await knex.schema.alterTable('vendor_bills', (t) => {
    // Jurnal HPP (source=expense, reklas 1-1400/2-1300) yang menerbitkan tagihan ini.
    t.uuid('journal_id').references('id').inTable('journals');
    // Akun HPP (5-xxxx) komponen yang menghasilkan kelebihan ini — utk tampilan/telusur.
    t.string('account_code', 10);
    // Pelunasan parsial via Pembayaran Biaya (settleDebt + vendorBillId).
    t.decimal('paid_amount', 18, 2).notNullable().defaultTo(0);
  });
  await knex.raw(`
    ALTER TABLE vendor_bills
      ADD CONSTRAINT vendor_bills_paid_amount_range CHECK (paid_amount >= 0 AND paid_amount <= amount)
  `);

  await knex.schema.alterTable('journals', (t) => {
    // Jurnal MANUAL yang membalik jurnal lain (POST /journals/:id/reverse). Baris asal
    // tidak menyimpan pointer balik — "sudah dibalik?" dicek via EXISTS pada kolom ini.
    t.uuid('reversal_of_journal_id').references('id').inTable('journals');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('journals', (t) => {
    t.dropColumn('reversal_of_journal_id');
  });
  await knex.schema.alterTable('vendor_bills', (t) => {
    t.dropColumn('journal_id');
    t.dropColumn('account_code');
    t.dropColumn('paid_amount');
  });
  await knex.schema.alterTable('refunds', (t) => {
    t.dropColumn('receipt_number');
    t.dropColumn('receipt_issued_date');
  });
}
