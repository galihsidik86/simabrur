import { describe, expect, it } from 'vitest';
import { allocateVendorAdvance, alignAllocation, isFilledHppRow, newRowUid, type HppComponent } from './transaksi';

/**
 * R3-03: `allocateVendorAdvance` SENGAJA ada dua kali — di sini dan di
 * `backend/src/modules/accounting/journal.engine.ts`. Frontend butuh angkanya secara
 * langsung untuk pratinjau jurnal saat pengguna mengetik; menariknya dari server berarti
 * satu round-trip tiap ketukan. Duplikasinya diterima sebagai trade-off, TAPI duplikasi
 * yang tidak dijaga akan menyimpang diam-diam.
 *
 * Berkas ini penjaganya: vektor uji di bawah disalin PERSIS dari
 * `backend/src/modules/accounting/accounting.test.ts` (describe "B (putaran 3):
 * allocateVendorAdvance"). Kalau salah satu sisi diubah tanpa sisi lain, tes ini merah.
 *
 * Bila kelak angkanya memang harus berubah, ubah KEDUA berkas — atau hapus duplikasinya.
 */
const komponen = (accountCode: string, amount: number, vendorId = ''): HppComponent => ({
  uid: newRowUid(),
  accountCode,
  amount,
  vendorId,
  dueDate: ''
});

describe('allocateVendorAdvance — harus identik dengan backend (R3-03)', () => {
  it('total HPP ≤ saldo → semua komponen teralokasi penuh, excess 0', () => {
    const alloc = allocateVendorAdvance([komponen('5-2000', 10_000_000), komponen('5-1000', 9_000_000)], 22_000_000);
    expect(alloc[0]).toMatchObject({ allocated: 10_000_000, excess: 0 });
    expect(alloc[1]).toMatchObject({ allocated: 9_000_000, excess: 0 });
  });

  it('total HPP > saldo → pro-rata menurut nominal, sisa pembulatan ke komponen terakhir', () => {
    // saldo 210 jt, komponen 150 jt & 100 jt (total 250 jt) → capped 210 jt
    // alloc0 = round(210jt × 150jt/250jt) = 126 jt; alloc1 (terakhir) = 210jt − 126jt = 84 jt
    const alloc = allocateVendorAdvance(
      [komponen('5-2000', 150_000_000, 'v1'), komponen('5-4000', 100_000_000, 'v2')],
      210_000_000
    );
    expect(alloc[0]).toMatchObject({ allocated: 126_000_000, excess: 24_000_000 });
    expect(alloc[1]).toMatchObject({ allocated: 84_000_000, excess: 16_000_000 });
    expect(alloc[0].allocated + alloc[1].allocated).toBe(210_000_000);
    expect(alloc[0].excess + alloc[1].excess).toBe(40_000_000);
  });

  it('saldo 0 → seluruh nominal jadi excess (hutang vendor), allocated 0', () => {
    const alloc = allocateVendorAdvance([komponen('5-3000', 18_000_000, 'v1')], 0);
    expect(alloc[0]).toMatchObject({ allocated: 0, excess: 18_000_000 });
  });

  it('daftar kosong → hasil kosong (tidak melempar)', () => {
    expect(allocateVendorAdvance([], 5_000_000)).toEqual([]);
  });

  it('saldo melebihi total HPP tidak pernah mengalokasikan lebih dari nominal komponennya', () => {
    const alloc = allocateVendorAdvance([komponen('5-2000', 1_000_000)], 9_999_999_999);
    expect(alloc[0]).toMatchObject({ allocated: 1_000_000, excess: 0 });
  });
});

describe('alignAllocation — memetakan hasil alokasi kembali ke baris di layar', () => {
  it('baris kosong tetap null sehingga alokasi tidak bergeser ke baris yang salah', () => {
    const rows = [komponen('5-2000', 10_000_000), komponen('5-3000', 0), komponen('5-4000', 5_000_000)];
    const terisi = rows.filter(isFilledHppRow);
    const alokasi = allocateVendorAdvance(terisi, 15_000_000);
    const sejajar = alignAllocation(rows, alokasi);

    expect(sejajar).toHaveLength(3);
    expect(sejajar[1]).toBeNull(); // baris bernominal 0 — tidak ikut dialokasikan
    expect(sejajar[0]?.allocated).toBe(10_000_000);
    expect(sejajar[2]?.allocated).toBe(5_000_000);
  });
});
