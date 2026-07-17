import type { Knex } from 'knex';

/**
 * Ambil nomor urut berikutnya untuk sebuah prefix secara atomik (baris di-lock
 * dalam transaksi). Contoh: nextNumber(trx, 'UMR-2026') → 'UMR-2026-0500'.
 */
export async function nextNumber(trx: Knex.Transaction, key: string, pad = 4, separator = '-'): Promise<string> {
  const inserted = await trx('numbering_sequences')
    .insert({ key, next_value: 2 })
    .onConflict('key')
    .ignore()
    .returning('key');

  let value = 1;
  if (inserted.length === 0) {
    const row = await trx('numbering_sequences').where({ key }).forUpdate().first();
    value = row.next_value;
    await trx('numbering_sequences').where({ key }).update({ next_value: value + 1 });
  }
  return `${key}${separator}${String(value).padStart(pad, '0')}`;
}
