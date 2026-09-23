import { randomBytes } from 'node:crypto';
import type { Knex } from 'knex';

/**
 * Ambil nilai urut berikutnya untuk sebuah prefix secara atomik (baris di-lock
 * dalam transaksi). Dipakai langsung bila pemanggil butuh ANGKA-nya, bukan string
 * berformat — mis. nomor virtual account yang punya format sendiri.
 */
export async function nextSequenceValue(trx: Knex.Transaction, key: string): Promise<number> {
  const inserted = await trx('numbering_sequences')
    .insert({ key, next_value: 2 })
    .onConflict('key')
    .ignore()
    .returning('key');

  if (inserted.length > 0) return 1;

  const row = await trx('numbering_sequences').where({ key }).forUpdate().first();
  const value = row.next_value;
  await trx('numbering_sequences').where({ key }).update({ next_value: value + 1 });
  return value;
}

/**
 * Nomor berurutan berformat. Contoh: nextNumber(trx, 'JV-2026') → 'JV-2026-0001'.
 *
 * Dipakai untuk nomor BUKU BESAR dan dokumen keuangan (JV, INV, KWT, KWR) yang
 * memang HARUS berurutan agar bisa diaudit. JANGAN dipakai untuk pengenal yang
 * merangkap kredensial login — untuk itu ada `randomSerial` (lihat SEC-01).
 */
export async function nextNumber(trx: Knex.Transaction, key: string, pad = 4, separator = '-'): Promise<string> {
  const value = await nextSequenceValue(trx, key);
  return `${key}${separator}${String(value).padStart(pad, '0')}`;
}

/**
 * Alfabet Crockford base32: tanpa I, L, O, U — supaya tidak tertukar dengan
 * 1/0 saat dibaca atau didiktekan lewat telepon, dan tidak membentuk kata.
 */
const SERIAL_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Serial acak kriptografis (SEC-01).
 *
 * 256 habis dibagi 32, jadi `byte & 31` tetap terdistribusi seragam — tidak perlu
 * rejection sampling. Panjang 8 → 32^8 ≈ 1,1 triliun kemungkinan, sehingga nomor
 * registrasi tidak bisa ditebak atau dienumerasi walaupun penyerang sudah tahu satu
 * nomor yang sah.
 */
export function randomSerial(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += SERIAL_ALPHABET[bytes[i] & 31];
  return out;
}
