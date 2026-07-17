/** Format angka/tanggal Indonesia — pola persis mockup ("Rp 39,9 Jt", "20 Agu 2026"). */

export function fmtShort(n: number): string {
  if (n >= 1_000_000_000) return `Rp ${(n / 1_000_000_000).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 2 })} M`;
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} Jt`;
  return fmtFull(n);
}

export function fmtFull(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`;
}

export function fmtDate(iso: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: style === 'short' ? 'short' : 'long', year: 'numeric' });
}

export function age(birthDateIso: string, atIso?: string): number {
  const b = new Date(birthDateIso);
  const a = atIso ? new Date(atIso) : new Date();
  let n = a.getFullYear() - b.getFullYear();
  const m = a.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && a.getDate() < b.getDate())) n--;
  return n;
}
