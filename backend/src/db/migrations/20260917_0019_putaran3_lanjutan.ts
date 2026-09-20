import type { Knex } from 'knex';

/**
 * Putaran 3 — tugas lanjutan (keputusan user atas pertanyaan handoff 15):
 * 1. Pembatalan tagihan vendor (`PATCH /v1/vendor-bills/:id/void`) — nilai enum baru
 *    `vendor_bill_status.void` (konsisten dengan pola `payment_status.rejected` di
 *    migrasi 0017 — lihat catatan `ALTER TYPE ... ADD VALUE` di sana, berlaku sama
 *    di sini: aman tanpa `config.transaction = false` selama nilai baru tidak
 *    DIPAKAI pada migrasi yang sama) + kolom metadata pembatalan & jurnal pembalik.
 * 2. `UNIQUE INDEX` parsial pada `journals.reversal_of_journal_id` (mengizinkan
 *    banyak NULL) — pertahanan tambahan terhadap race dua permintaan
 *    `POST /journals/:id/reverse` bersamaan pada jurnal yang sama (lihat pertanyaan
 *    no. 4 handoff 15).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.raw(`ALTER TYPE vendor_bill_status ADD VALUE IF NOT EXISTS 'void'`);

  await knex.schema.alterTable('vendor_bills', (t) => {
    t.text('void_reason');
    t.uuid('voided_by').references('id').inTable('users');
    t.timestamp('voided_at');
    // Jurnal pembalik (Dr 2-1300 · Cr akun HPP komponen) yang diposting saat dibatalkan.
    t.uuid('reversal_journal_id').references('id').inTable('journals');
  });

  // Partial unique index: hanya menegakkan keunikan pada baris yang BENAR-BENAR
  // menjadi pembalik (reversal_of_journal_id bukan NULL) — jurnal biasa (bukan
  // pembalik) tetap boleh punya reversal_of_journal_id NULL sebanyak apa pun.
  await knex.raw(`
    CREATE UNIQUE INDEX journals_reversal_of_journal_id_uidx
    ON journals (reversal_of_journal_id)
    WHERE reversal_of_journal_id IS NOT NULL
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(`DROP INDEX IF EXISTS journals_reversal_of_journal_id_uidx`);
  await knex.schema.alterTable('vendor_bills', (t) => {
    t.dropColumn('void_reason');
    t.dropColumn('voided_by');
    t.dropColumn('voided_at');
    t.dropColumn('reversal_journal_id');
  });
  // `vendor_bill_status.void` tidak bisa dihapus (Postgres tidak punya
  // `ALTER TYPE ... DROP VALUE`) — no-op aman, sama seperti nilai enum di migrasi 0017.
}
