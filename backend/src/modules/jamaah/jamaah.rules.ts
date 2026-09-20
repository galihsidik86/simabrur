/**
 * Aturan bisnis pendaftaran (PLAN.md §4.7) — fungsi murni agar mudah diuji.
 */

const PASSPORT_MONTHS_REQUIRED = 7;

/**
 * Paspor wajib berlaku ≥ 7 bulan kalender setelah tanggal keberangkatan.
 * Perhitungan selalu UTC (independen dari TZ proses) dan di-clamp ke hari
 * terakhir bulan tujuan bila tanggal keberangkatan jatuh di ekor bulan
 * (mis. 31 Jul + 7 bln → 28 Feb, bukan overflow ke 3 Mar).
 * Dipakai bersama oleh jamaah.rules.ts dan operations.rules.ts — jangan
 * duplikasi logika ini di tempat lain.
 */
export function passportValidUntilLimit(departureDate: string): Date {
  const d = new Date(departureDate + 'T00:00:00Z');
  const targetMonthIndex = d.getUTCMonth() + PASSPORT_MONTHS_REQUIRED;
  const year = d.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const month = ((targetMonthIndex % 12) + 12) % 12;
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDayOfMonth);
  return new Date(Date.UTC(year, month, day));
}

export function isPassportValid(passportExpiry: string, departureDate: string): boolean {
  return new Date(passportExpiry) >= passportValidUntilLimit(departureDate);
}

/** Umur pada tanggal keberangkatan. */
export function ageAt(birthDate: string, atDate: string): number {
  const b = new Date(birthDate);
  const a = new Date(atDate);
  let age = a.getFullYear() - b.getFullYear();
  const m = a.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && a.getDate() < b.getDate())) age--;
  return age;
}

/** Jamaah perempuan di bawah 45 tahun wajib didampingi mahram. */
export function needsMahram(gender: 'L' | 'P', birthDate: string, departureDate: string): boolean {
  return gender === 'P' && ageAt(birthDate, departureDate) < 45;
}

/** Prefix nomor registrasi: UMR/HAJ + tahun keberangkatan. */
export function regNumberKey(packageType: 'umrah' | 'haji', departureDate: string): string {
  const prefix = packageType === 'haji' ? 'HAJ' : 'UMR';
  return `${prefix}-${new Date(departureDate).getFullYear()}`;
}
