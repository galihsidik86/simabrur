/**
 * Aturan bisnis pendaftaran (PLAN.md §4.7) — fungsi murni agar mudah diuji.
 */

/** Paspor wajib berlaku ≥ 7 bulan setelah tanggal keberangkatan. */
export function passportValidUntilLimit(departureDate: string): Date {
  const limit = new Date(departureDate);
  limit.setMonth(limit.getMonth() + 7);
  return limit;
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
