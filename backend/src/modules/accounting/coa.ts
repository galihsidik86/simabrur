/**
 * Bagan Akun (COA) Travel Haji & Umrah — persis Chart of Accounts.dc.html.
 * [code, name, level(0 induk/1 sub), note?, highlighted?]
 * Kelas: 1 Aset · 2 Liabilitas · 3 Ekuitas · 4 Pendapatan · 5 HPP · 6 Beban Ops · 7 Lain
 */

export interface CoaDef {
  code: string;
  name: string;
  level: 0 | 1;
  note?: string;
  highlighted?: boolean;
}

export const COA: CoaDef[] = [
  // ===== Kelas 1 — ASET =====
  { code: '1-1000', name: 'Aset Lancar', level: 0 },
  { code: '1-1100', name: 'Kas', level: 1 },
  { code: '1-1200', name: 'Bank — IDR', level: 1, note: 'Rekening operasional Rupiah' },
  { code: '1-1210', name: 'Bank — USD', level: 1, note: 'Multi-currency' },
  { code: '1-1220', name: 'Bank — SAR', level: 1, note: 'Multi-currency' },
  { code: '1-1300', name: 'Piutang Jamaah', level: 1, note: 'Sisa tagihan belum lunas' },
  { code: '1-1400', name: 'Uang Muka Vendor', level: 1, note: 'DP ke hotel/maskapai/handling', highlighted: true },
  { code: '1-1500', name: 'Biaya Dibayar Dimuka', level: 1 },
  { code: '1-1600', name: 'Persediaan Perlengkapan', level: 1, note: 'Koper, seragam, buku manasik' },
  { code: '1-2000', name: 'Aset Tetap', level: 0 },
  { code: '1-2100', name: 'Peralatan & Inventaris Kantor', level: 1 },
  { code: '1-2200', name: 'Akumulasi Penyusutan', level: 1, note: 'Akun kontra' },
  // ===== Kelas 2 — LIABILITAS =====
  { code: '2-1000', name: 'Liabilitas Jangka Pendek', level: 0 },
  { code: '2-1100', name: 'Uang Muka Jamaah', level: 1, note: 'DP + pelunasan diterima dimuka', highlighted: true },
  { code: '2-1200', name: 'Pendapatan Diterima Dimuka', level: 1, note: 'Jasa tambahan belum diberikan' },
  { code: '2-1300', name: 'Hutang Vendor', level: 1, note: 'Hotel / maskapai / handling' },
  { code: '2-1400', name: 'Hutang Komisi Agen', level: 1 },
  { code: '2-1500', name: 'Hutang Pajak', level: 1, note: 'PPh / PPN terutang' },
  { code: '2-1600', name: 'Titipan Dana Tabungan Haji', level: 1, note: 'Setoran bertahap jamaah' },
  // ===== Kelas 3 — EKUITAS =====
  { code: '3-1000', name: 'Modal Disetor', level: 0 },
  { code: '3-2000', name: 'Laba Ditahan', level: 0 },
  { code: '3-3000', name: 'Laba (Rugi) Tahun Berjalan', level: 0 },
  // ===== Kelas 4 — PENDAPATAN =====
  { code: '4-1000', name: 'Pendapatan Jasa Umrah', level: 0, note: 'Diakui saat keberangkatan' },
  { code: '4-2000', name: 'Pendapatan Jasa Haji Khusus', level: 0, note: 'Furoda / khusus' },
  { code: '4-3000', name: 'Pendapatan Jasa Tambahan', level: 0, note: 'Visa, tour, handling, upgrade' },
  { code: '4-9000', name: 'Pendapatan Lain-lain', level: 0, note: 'Selisih kurs, jasa giro' },
  // ===== Kelas 5 — BEBAN POKOK JASA (HPP), per cost center =====
  { code: '5-1000', name: 'Beban Tiket Maskapai', level: 0, note: 'Per cost center' },
  { code: '5-2000', name: 'Beban Hotel & Akomodasi', level: 0, note: 'Per cost center' },
  { code: '5-3000', name: 'Beban Visa', level: 0, note: 'Per cost center' },
  { code: '5-4000', name: 'Beban Katering / Konsumsi', level: 0, note: 'Per cost center' },
  { code: '5-5000', name: 'Beban Transportasi & Handling', level: 0, note: 'Per cost center' },
  { code: '5-6000', name: 'Beban Muthawwif / Tour Leader', level: 0, note: 'Per cost center' },
  { code: '5-7000', name: 'Beban Perlengkapan Jamaah', level: 0, note: 'Per cost center' },
  // ===== Kelas 6 — BEBAN OPERASIONAL =====
  { code: '6-1000', name: 'Beban Gaji & Tunjangan', level: 0 },
  { code: '6-2000', name: 'Beban Komisi Agen', level: 0 },
  { code: '6-3000', name: 'Beban Marketing & Promosi', level: 0 },
  { code: '6-4000', name: 'Beban Sewa Kantor', level: 0 },
  { code: '6-5000', name: 'Beban Administrasi & Umum', level: 0 },
  { code: '6-6000', name: 'Beban Penyusutan', level: 0 },
  // ===== Kelas 7 — PENDAPATAN & BEBAN LAIN =====
  { code: '7-1000', name: 'Laba (Rugi) Selisih Kurs', level: 0, note: 'Multi-currency IDR/USD/SAR' },
  { code: '7-2000', name: 'Beban Bunga & Administrasi Bank', level: 0 }
];

export const CLASS_NAMES: Record<number, string> = {
  1: 'Aset', 2: 'Liabilitas', 3: 'Ekuitas', 4: 'Pendapatan',
  5: 'Beban Pokok Jasa (HPP)', 6: 'Beban Operasional', 7: 'Pendapatan & Beban Lain'
};

export function accountClass(code: string): number {
  return Number(code[0]);
}

/** Saldo normal per kelas: 1/5/6 debit; 2/3/4 kredit; 7 kredit (pendapatan lain, kontra saat rugi). */
export function normalBalance(code: string): 'debit' | 'credit' {
  const c = accountClass(code);
  if (c === 1 || c === 5 || c === 6) return 'debit';
  if (c === 7) return code === '7-2000' ? 'debit' : 'credit';
  return 'credit';
}
