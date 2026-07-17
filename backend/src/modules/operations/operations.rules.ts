/** Aturan operasional — fungsi murni (skor kesiapan, ambang warna). */

export interface ReadinessMetrics {
  paymentPct: number; // pelunasan
  documentPct: number; // dokumen wajib terverifikasi
  visaIssued: number;
  ticketIssued: number;
  totalJamaah: number;
}

/** Skor kesiapan = rata-rata 4 metrik (Pelunasan, Dokumen, Visa, Tiket) — mockup Kesiapan Keberangkatan. */
export function readinessScore(m: ReadinessMetrics): number {
  if (m.totalJamaah === 0) return 0;
  const visaPct = (m.visaIssued / m.totalJamaah) * 100;
  const ticketPct = (m.ticketIssued / m.totalJamaah) * 100;
  return Math.round((m.paymentPct + m.documentPct + visaPct + ticketPct) / 4);
}

/** Ambang warna skor: ≥90 hijau, ≥70 emas, di bawahnya merah (mockup). */
export function readinessLevel(score: number): 'green' | 'gold' | 'red' {
  if (score >= 90) return 'green';
  if (score >= 70) return 'gold';
  return 'red';
}

/** Paspor kedaluwarsa < 7 bulan setelah keberangkatan → butuh perpanjangan. */
export function passportExpiringSoon(passportExpiry: string | null, departureDate: string): boolean {
  if (!passportExpiry) return false;
  const limit = new Date(departureDate + 'T00:00:00Z');
  limit.setUTCMonth(limit.getUTCMonth() + 7);
  return new Date(passportExpiry + 'T00:00:00Z') < limit;
}
