import { describe, expect, it } from 'vitest';
import { maskPhone } from './mask.js';

/** SR-03: audit login gagal Portal Agen menyimpan nomor HP ter-mask. */
describe('maskPhone', () => {
  it('nomor HP wajar → hanya 4 digit terakhir tersisa', () => {
    expect(maskPhone('081234567890')).toBe('********7890');
  });
  it('trim spasi di awal/akhir sebelum masking', () => {
    expect(maskPhone('  081200000012  ')).toBe('********0012');
  });
  it('panjang ≤ 4 → seluruhnya di-mask (tidak ada sisa digit asli)', () => {
    expect(maskPhone('1234')).toBe('****');
    expect(maskPhone('12')).toBe('**');
    expect(maskPhone('')).toBe('');
  });
  it('mempertahankan panjang asli (jumlah karakter mask + sisa = panjang input)', () => {
    const masked = maskPhone('081200001111');
    expect(masked).toHaveLength('081200001111'.length);
  });
});
