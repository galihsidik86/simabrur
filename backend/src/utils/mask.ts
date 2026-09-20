/**
 * SR-03: masking data PII (nomor HP) sebelum ditulis ke log audit. Menyisakan
 * hanya 4 digit terakhir agar log tetap berguna untuk investigasi (mencocokkan
 * akun) tanpa menyimpan nomor HP penuh dalam bentuk yang bisa dibaca.
 */
export function maskPhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return '*'.repeat(trimmed.length);
  return '*'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}
