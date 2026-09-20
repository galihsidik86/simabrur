import { describe, expect, it } from 'vitest';
import { ipKeyGenerator } from 'express-rate-limit';
import { identityIpKey, identityOnlyKey, normalizePhone, normalizeRegNumber } from './rate-limit-keys.js';

/**
 * SR-01: limiter login Portal Jamaah/Agen dimatikan saat NODE_ENV=test (lihat
 * app.ts), jadi perilakunya hanya bisa diverifikasi lewat unit test fungsi
 * murni ini (bukan tes integrasi HTTP).
 */
describe('normalizeRegNumber', () => {
  it('trim + uppercase', () => {
    expect(normalizeRegNumber('  umr-2026-0418 ')).toBe('UMR-2026-0418');
  });
  it('null/undefined → string kosong', () => {
    expect(normalizeRegNumber(null)).toBe('');
    expect(normalizeRegNumber(undefined)).toBe('');
  });
  it('tipe non-string (mis. angka/objek dari body tak terduga) tidak melempar', () => {
    expect(normalizeRegNumber(12345)).toBe('12345');
  });
});

describe('normalizePhone', () => {
  it('trim + lowercase', () => {
    expect(normalizePhone('  0812AB0012 ')).toBe('0812ab0012');
  });
  it('null/undefined → string kosong', () => {
    expect(normalizePhone(null)).toBe('');
    expect(normalizePhone(undefined)).toBe('');
  });
});

describe('identityIpKey (lapis utama SR-01: identitas+IP, ambang rendah)', () => {
  it('identitas sama, IP beda → key BEDA (korban di IP lain tidak ikut terkunci)', () => {
    const a = identityIpKey('UMR-2026-0418', '1.2.3.4');
    const b = identityIpKey('UMR-2026-0418', '9.9.9.9');
    expect(a).not.toBe(b);
  });
  it('identitas beda, IP sama → key beda', () => {
    const a = identityIpKey('UMR-2026-0418', '1.2.3.4');
    const b = identityIpKey('UMR-2026-0419', '1.2.3.4');
    expect(a).not.toBe(b);
  });
  it('identitas+IP sama → key sama (deterministik)', () => {
    expect(identityIpKey('UMR-2026-0418', '1.2.3.4')).toBe(identityIpKey('UMR-2026-0418', '1.2.3.4'));
  });
  it('identitas kosong tidak digabung mentah (tak membuat key ambigu antar IP tanpa identitas)', () => {
    const a = identityIpKey('', '1.2.3.4');
    const b = identityIpKey('', '9.9.9.9');
    expect(a).not.toBe(b);
    expect(a).toContain('1.2.3.4');
  });
});

describe('identityOnlyKey (lapis kedua SR-01: identitas saja, ambang tinggi, rem brute force terdistribusi)', () => {
  it('identitas sama, IP BEDA → key SAMA (brute force lintas IP tetap kena satu ember)', () => {
    const a = identityOnlyKey('UMR-2026-0418', '1.2.3.4');
    const b = identityOnlyKey('UMR-2026-0418', '9.9.9.9');
    expect(a).toBe(b);
  });
  it('identitas kosong → fallback ke IP (tetap ada batas, bukan tanpa batas)', () => {
    expect(identityOnlyKey('', '1.2.3.4')).toBe('1.2.3.4');
  });
  it('identitas & IP sama-sama kosong → fallback konstan, bukan string kosong (bucket "unknown")', () => {
    expect(identityOnlyKey('', undefined)).toBe('unknown');
  });
});

/**
 * Ditemukan saat QA browser 2026-09-20: app.ts dulu menyuapkan `req.ip` MENTAH ke
 * kedua key generator. Untuk klien IPv6 itu berarti tiap alamat dalam blok /64 milik
 * penyerang (2^64 alamat) menjadi ember limiter tersendiri — lapis identitas+IP bisa
 * dilewati begitu saja. Perbaikan: app.ts membungkus IP dengan `ipKeyGenerator`
 * (memadatkan IPv6 ke /64, IPv4 dibiarkan). Tes di bawah menguji KOMPOSISI yang
 * sama persis dengan yang dipakai app.ts, karena limiter sendiri mati saat test.
 */
describe('komposisi kunci limiter dengan ipKeyGenerator (IPv6)', () => {
  it('dua alamat IPv6 dalam /64 yang sama → SATU ember limiter (tidak bisa diputar)', () => {
    const a = identityIpKey('UMR-2026-0418', ipKeyGenerator('2001:db8:abcd:1234::1'));
    const b = identityIpKey('UMR-2026-0418', ipKeyGenerator('2001:db8:abcd:1234:ffff:ffff:ffff:ffff'));
    expect(a).toBe(b);
  });

  it('IPv6 dari /64 BERBEDA → ember berbeda (pengguna sah tidak saling mengunci)', () => {
    const a = identityIpKey('UMR-2026-0418', ipKeyGenerator('2001:db8:abcd:1234::1'));
    const b = identityIpKey('UMR-2026-0418', ipKeyGenerator('2001:db8:abcd:9999::1'));
    expect(a).not.toBe(b);
  });

  it('IPv4 tetap per-alamat (perilaku lama tidak berubah)', () => {
    const a = identityIpKey('UMR-2026-0418', ipKeyGenerator('1.2.3.4'));
    const b = identityIpKey('UMR-2026-0418', ipKeyGenerator('1.2.3.5'));
    expect(a).not.toBe(b);
    expect(a).toBe('UMR-2026-0418:1.2.3.4');
  });
});
