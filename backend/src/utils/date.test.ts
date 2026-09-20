import { describe, expect, it } from 'vitest';
import { monthsAgoWib, todayWib, yearMonthWib } from './date.js';

/**
 * AK-02: WIB = UTC+7 tanpa DST. Batas kritis: 16:59 UTC (= 23:59 WIB, hari yang
 * SAMA) vs 17:00 UTC (= 00:00 WIB, hari BERIKUTNYA).
 */
describe('todayWib', () => {
  it('16:59:59 UTC 31 Des → masih 2026-12-31 WIB (23:59:59)', () => {
    expect(todayWib(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12-31');
  });

  it('17:00:00 UTC 31 Des → sudah 2027-01-01 WIB (00:00:00) — batas tepat', () => {
    expect(todayWib(new Date('2026-12-31T17:00:00Z'))).toBe('2027-01-01');
  });

  it('jam 02:00 WIB (= 19:00 UTC hari sebelumnya) → tanggal WIB, BUKAN tanggal UTC (bug AK-02 lama)', () => {
    expect(todayWib(new Date('2027-01-01T02:00:00+07:00'))).toBe('2027-01-01');
  });

  it('siang hari, tidak ada pergeseran (WIB & UTC tanggal sama)', () => {
    expect(todayWib(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06-15');
  });
});

describe('yearMonthWib', () => {
  it('17:00 UTC 30 Sep → sudah Oktober WIB', () => {
    expect(yearMonthWib(new Date('2026-09-30T17:00:00Z'))).toBe('2026-10');
  });
  it('16:59 UTC 30 Sep → masih September WIB', () => {
    expect(yearMonthWib(new Date('2026-09-30T16:59:00Z'))).toBe('2026-09');
  });
});

describe('monthsAgoWib', () => {
  it('0 bulan lalu = bulan berjalan', () => {
    expect(monthsAgoWib(0, new Date('2026-07-15T10:00:00Z'))).toBe('2026-07');
  });
  it('aman terhadap overflow tanggal 31 (tidak memakai Date.setMonth)', () => {
    // 31 Jan − 1 bulan mundur harus tetap "Desember", tidak melompat ke bulan
    // yang salah seperti bug Date.setMonth pada tanggal 29–31 (lihat DOM-08).
    expect(monthsAgoWib(1, new Date('2027-01-31T10:00:00Z'))).toBe('2026-12');
  });
  it('mundur lintas tahun', () => {
    expect(monthsAgoWib(5, new Date('2026-02-15T10:00:00Z'))).toBe('2025-09');
  });
});
