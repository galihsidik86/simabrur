/**
 * SR-01: kunci `keyGenerator` express-rate-limit untuk login Portal Jamaah/Agen —
 * diekstrak sebagai fungsi murni (tanpa Express `Request`) agar bisa diuji unit
 * tanpa NODE_ENV=test menonaktifkan limiter itu sendiri (limiter dimatikan saat
 * test, sehingga logikanya hanya bisa diverifikasi lewat fungsi murni ini).
 *
 * Dua lapis dipakai bersama di app.ts:
 * 1. `identityIpKey` (utama, ambang rendah) — kombinasi identitas+IP. Mencegah
 *    penyerang MENGUNCI KORBAN (lockout DoS) hanya dengan menyebut identitas
 *    korban dari IP miliknya sendiri; korban di IP lain tidak ikut terkunci.
 * 2. `identityOnlyKey` (kedua, ambang tinggi) — identitas saja, lintas IP. Rem
 *    terhadap brute force terdistribusi (banyak IP mencoba satu identitas) yang
 *    lolos dari lapis utama karena tiap IP sendiri-sendiri di bawah ambang.
 */

/** Normalisasi nomor registrasi (Portal Jamaah): trim + uppercase. */
export function normalizeRegNumber(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

/** Normalisasi nomor HP (Portal Agen): trim + lowercase. */
export function normalizePhone(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Kunci lapis utama: identitas+IP. Identitas kosong tidak digabung ke IP orang lain. */
export function identityIpKey(identity: string, ip: string | undefined): string {
  return `${identity || 'unknown'}:${ip || 'unknown'}`;
}

/**
 * Kunci lapis kedua: identitas saja. Fallback ke IP bila identitas kosong
 * (payload tak valid) — tetap ada batas, bukan tanpa batas sama sekali.
 */
export function identityOnlyKey(identity: string, ip: string | undefined): string {
  return identity || ip || 'unknown';
}
