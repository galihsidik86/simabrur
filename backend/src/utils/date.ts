/**
 * Tanggal kalender "hari ini" dalam zona waktu Asia/Jakarta (WIB, UTC+7, tanpa DST).
 *
 * `new Date().toISOString().slice(0, 10)` SELALU memakai UTC, terlepas dari TZ
 * proses Node — pada jendela 00:00–06:59 WIB, itu masih tanggal KEMARIN. Dipakai
 * sebagai default "hari ini" (tanpa input tanggal eksplisit) di transaksi/laporan
 * akuntansi, ini menggeser periode pembukuan (AK-02). Helper di file ini adalah
 * SATU-SATUNYA cara yang benar untuk mendapatkan "hari ini" versi WIB.
 *
 * Jangan pakai untuk mengonversi kolom DATE/tanggal INPUT yang sudah eksplisit
 * (mis. `new Date(row.line_date)`) — itu bukan masalah zona waktu "hari ini".
 */

const WIB_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** 'YYYY-MM-DD' hari ini (atau tanggal `d`) menurut kalender Asia/Jakarta. */
export function todayWib(d: Date = new Date()): string {
  return WIB_DATE_FORMATTER.format(d);
}

/** 'YYYY-MM' bulan berjalan (atau bulan `d`) menurut kalender Asia/Jakarta. */
export function yearMonthWib(d: Date = new Date()): string {
  return todayWib(d).slice(0, 7);
}

/**
 * 'YYYY-MM' dari `n` bulan sebelum bulan `d` (WIB), aman terhadap overflow
 * tanggal (hanya beroperasi pada komponen tahun/bulan, bukan `Date.setMonth`
 * pada tanggal 29–31 yang bisa melompat bulan — lihat DOM-08).
 */
export function monthsAgoWib(n: number, d: Date = new Date()): string {
  const [y, m] = yearMonthWib(d).split('-').map(Number);
  const idx = y * 12 + (m - 1) - n;
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}
