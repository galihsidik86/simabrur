/** Aturan pembayaran — fungsi murni agar mudah diuji (generator termin, status piutang). */

export const DP_AMOUNT = 5_000_000;
export const CICIL_TERMS = 5; // "Cicilan 6× Termin" = DP + 5 termin bulanan (mockup wizard)

export interface ScheduleLine {
  termNo: number;
  label: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Susun jadwal termin dari skema pembayaran.
 * - lunas : 1 baris penuh (tempo 7 hari)
 * - dp    : DP 5 jt (tempo 3 hari) + pelunasan H-30 keberangkatan
 * - cicil : DP 5 jt + 5 termin bulanan; termin terakhir menyerap pembulatan
 */
export function buildSchedules(scheme: 'dp' | 'cicil' | 'lunas', total: number, issueDate: string, departureDate: string): ScheduleLine[] {
  if (scheme === 'lunas') {
    return [{ termNo: 1, label: 'Pelunasan', amount: total, dueDate: addDays(issueDate, 7) }];
  }
  const dp = Math.min(DP_AMOUNT, total);
  if (scheme === 'dp') {
    const pelunasanDue = addDays(departureDate, -30);
    return [
      { termNo: 0, label: 'Uang Muka (DP)', amount: dp, dueDate: addDays(issueDate, 3) },
      { termNo: 1, label: 'Pelunasan', amount: total - dp, dueDate: pelunasanDue > issueDate ? pelunasanDue : addDays(issueDate, 7) }
    ];
  }
  // cicil
  const sisa = total - dp;
  const per = Math.floor(sisa / CICIL_TERMS / 100_000) * 100_000; // bulat ke ratusan ribu
  const lines: ScheduleLine[] = [{ termNo: 0, label: 'Uang Muka (DP)', amount: dp, dueDate: addDays(issueDate, 3) }];
  for (let i = 1; i <= CICIL_TERMS; i++) {
    const amount = i === CICIL_TERMS ? sisa - per * (CICIL_TERMS - 1) : per;
    lines.push({
      termNo: i,
      label: i === CICIL_TERMS ? `Termin ${i} (pelunasan)` : `Termin ${i}`,
      amount,
      dueDate: addMonths(issueDate, i)
    });
  }
  return lines;
}

/**
 * Status kartu piutang (pill mockup Pembayaran):
 * Lunas · Terlambat (lewat > 7 hari) · Jatuh Tempo (lewat ≤ 7 hari / ≤ 7 hari lagi) · Terjadwal
 */
export function receivableStatus(remaining: number, nextDueDate: string | null, today: string): 'Lunas' | 'Terlambat' | 'Jatuh Tempo' | 'Terjadwal' {
  if (remaining <= 0) return 'Lunas';
  if (!nextDueDate) return 'Terjadwal';
  const diffDays = Math.round((new Date(nextDueDate + 'T00:00:00Z').getTime() - new Date(today + 'T00:00:00Z').getTime()) / 86_400_000);
  if (diffDays < -7) return 'Terlambat';
  if (diffDays <= 7) return 'Jatuh Tempo';
  return 'Terjadwal';
}

/** Bucket umur piutang (mockup Laporan Operasional): belum / 1–30 / 31–60 / >60 hari. */
export function agingBucket(nextDueDate: string | null, today: string): 'belum' | 'd30' | 'd60' | 'd90' {
  if (!nextDueDate) return 'belum';
  const overdue = Math.round((new Date(today + 'T00:00:00Z').getTime() - new Date(nextDueDate + 'T00:00:00Z').getTime()) / 86_400_000);
  if (overdue <= 0) return 'belum';
  if (overdue <= 30) return 'd30';
  if (overdue <= 60) return 'd60';
  return 'd90';
}

/** Nomor invoice INV/YYYY/MM/NNNN — NNNN mengikuti serial nomor registrasi (mockup). */
export function invoiceNumber(regNumber: string, issueDate: string): string {
  const serial = regNumber.slice(-4);
  const [y, m] = issueDate.split('-');
  return `INV/${y}/${m}/${serial}`;
}

/** VA BSI menyematkan serial registrasi: 8801 0418 0000 0418 (mockup). */
export function vaNumber(regNumber: string): string {
  const serial = regNumber.slice(-4);
  return `8801 ${serial} 0000 ${serial}`;
}
