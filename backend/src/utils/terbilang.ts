/**
 * Angka → terbilang bahasa Indonesia (kwitansi wajib terbilang, PLAN.md §4.10).
 * Contoh: 11_800_000 → "Sebelas juta delapan ratus ribu rupiah"
 */

const SATUAN = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan'];

function tigaDigit(n: number): string {
  const parts: string[] = [];
  const ratus = Math.floor(n / 100);
  const sisa = n % 100;
  if (ratus === 1) parts.push('seratus');
  else if (ratus > 1) parts.push(`${SATUAN[ratus]} ratus`);

  if (sisa >= 10 && sisa < 20) {
    if (sisa === 10) parts.push('sepuluh');
    else if (sisa === 11) parts.push('sebelas');
    else parts.push(`${SATUAN[sisa - 10]} belas`);
  } else {
    const puluh = Math.floor(sisa / 10);
    const unit = sisa % 10;
    if (puluh > 0) parts.push(`${SATUAN[puluh]} puluh`);
    if (unit > 0) parts.push(SATUAN[unit]);
  }
  return parts.join(' ');
}

export function terbilang(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Nol rupiah';

  const scales: [number, string][] = [
    [1_000_000_000_000, 'triliun'],
    [1_000_000_000, 'miliar'],
    [1_000_000, 'juta'],
    [1_000, 'ribu']
  ];
  const parts: string[] = [];
  for (const [value, name] of scales) {
    const count = Math.floor(n / value);
    if (count > 0) {
      // "seribu", bukan "satu ribu"
      if (value === 1_000 && count === 1) parts.push('seribu');
      else parts.push(`${tigaDigit(count)} ${name}`);
      n %= value;
    }
  }
  if (n > 0) parts.push(tigaDigit(n));

  const text = parts.join(' ').replace(/\s+/g, ' ').trim() + ' rupiah';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
