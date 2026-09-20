/**
 * Escape karakter wildcard Postgres ILIKE (`\`, `%`, `_`) agar input pengguna
 * dicocokkan sebagai teks literal, bukan pola. Tanpa ini, "_" pada query
 * pencarian cocok dengan SATU karakter apa pun (mis. "%_%" ≈ cocok semua baris
 * non-kosong) — lihat DOM-07.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
