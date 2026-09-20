/**
 * Logika murni halaman Input Transaksi (Keuangan): konstanta akun, pratinjau
 * jurnal, alokasi HPP, dan validasi klien.
 *
 * Aturan alokasi HPP meniru PERSIS backend (`allocateVendorAdvance` di
 * `journal.engine.ts`) supaya pratinjau di layar = jurnal yang benar-benar
 * diposting: pro-rata menurut nominal (bulat rupiah), sisa pembulatan jatuh ke
 * komponen TERAKHIR.
 */
import { fmtFull } from '../../utils/format';

export interface PreviewLine {
  code: string;
  name: string;
  debit: number;
  credit: number;
  foreign?: string;
  /** Label kelompok — dipakai saat satu transaksi menghasilkan >1 jurnal (pendapatan + HPP). */
  group?: string;
}

/* ===== Akun kunci (coa.ts) ===== */
export const JAMAAH_ADVANCE = { code: '2-1100', name: 'Uang Muka Jamaah' } as const;
export const VENDOR_ADVANCE = { code: '1-1400', name: 'Uang Muka Vendor' } as const;
export const VENDOR_DEBT = { code: '2-1300', name: 'Hutang Vendor' } as const;
/** Baris pelunasan tagihan vendor tercatat WAJIB akun ini (kontrak POST /transactions/expense). */
export const VENDOR_BILL_ACCOUNT = VENDOR_DEBT.code;

export const REVENUE_ACCOUNTS = [
  ['4-1000', 'Pendapatan Jasa Umrah'],
  ['4-2000', 'Pendapatan Jasa Haji Khusus'],
  ['4-3000', 'Pendapatan Jasa Tambahan']
] as const;
export type RevenueAccountCode = (typeof REVENUE_ACCOUNTS)[number][0];

/** Kelas 5 — Beban Pokok Jasa (HPP), per cost center. */
export const HPP_ACCOUNTS = [
  ['5-1000', 'Beban Tiket Maskapai'],
  ['5-2000', 'Beban Hotel & Akomodasi'],
  ['5-3000', 'Beban Visa'],
  ['5-4000', 'Beban Katering / Konsumsi'],
  ['5-5000', 'Beban Transportasi & Handling'],
  ['5-6000', 'Beban Muthawwif / Tour Leader'],
  ['5-7000', 'Beban Perlengkapan Jamaah']
] as const;

export const BIAYA_ACCOUNTS = [
  ['1-1400', 'Uang Muka Vendor'],
  ['5-1000', 'Beban Tiket Maskapai'],
  ['5-2000', 'Beban Hotel & Akomodasi'],
  ['5-3000', 'Beban Visa'],
  ['5-4000', 'Beban Katering / Konsumsi'],
  ['5-5000', 'Beban Transportasi & Handling'],
  ['5-6000', 'Beban Muthawwif / TL'],
  ['5-7000', 'Beban Perlengkapan Jamaah'],
  ['6-5000', 'Beban Administrasi & Umum']
] as const;

const ACCOUNT_NAME = new Map<string, string>([
  ...BIAYA_ACCOUNTS.map(([code, name]) => [code, name] as [string, string]),
  ...HPP_ACCOUNTS.map(([code, name]) => [code, name] as [string, string]),
  ...REVENUE_ACCOUNTS.map(([code, name]) => [code, name] as [string, string]),
  [JAMAAH_ADVANCE.code, JAMAAH_ADVANCE.name],
  [VENDOR_ADVANCE.code, VENDOR_ADVANCE.name],
  [VENDOR_DEBT.code, VENDOR_DEBT.name]
]);

export function accountName(code: string): string {
  return ACCOUNT_NAME.get(code) ?? code;
}

/* ===== Tagihan vendor (GET /v1/vendor-bills) ===== */
export type VendorBillStatus = 'unpaid' | 'paid' | 'void';

export interface VendorBill {
  id: string;
  vendorId: string;
  vendorName: string;
  costCenterId: string | null;
  costCenterCode: string | null;
  accountCode: string | null;
  amount: number;
  paidAmount: number;
  remaining: number;
  currency: string;
  dueDate: string | null;
  status: VendorBillStatus;
}

export const VENDOR_BILL_STATUS: Record<VendorBillStatus, { label: string; color: string; bg: string }> = {
  unpaid: { label: 'Belum lunas', color: 'oklch(0.45 0.10 78)', bg: 'oklch(0.95 0.04 82)' },
  paid: { label: 'Lunas', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  void: { label: 'Dibatalkan', color: '#fff', bg: 'oklch(0.55 0.15 28)' }
};

export function vendorBillStatusPill(status: string): { label: string; color: string; bg: string } {
  return VENDOR_BILL_STATUS[status as VendorBillStatus] ?? { label: status, color: '#6f6858', bg: '#f2ecdf' };
}

/** Hanya tagihan belum lunas yang masih bersisa yang boleh dipilih untuk pelunasan. */
export function isSettleableBill(bill: VendorBill): boolean {
  return bill.status === 'unpaid' && bill.remaining > 0;
}

/**
 * Syarat pembatalan tagihan (kontrak `PATCH /v1/vendor-bills/:id/void`): masih
 * `unpaid` DAN belum dibayar sebagian sama sekali (`paidAmount = 0`).
 */
export function canVoidBill(bill: VendorBill): boolean {
  return bill.status === 'unpaid' && bill.paidAmount === 0;
}

export const VOID_REASON_MIN = 5;
export const VOID_REASON_MAX = 300;

/** Tagihan vendor yang terbit dari pengakuan HPP (respons revenue-recognition). */
export interface IssuedVendorBill {
  id: string;
  vendorId: string;
  vendorName: string;
  accountCode: string;
  amount: number;
  dueDate: string | null;
}

/* ===== Saldo cost center (GET /v1/cost-centers/:id/balances) ===== */
export interface CostCenterBalances {
  costCenterId: string;
  vendorAdvance1400: number;
  liability2100: number;
}

/* ===== Komponen HPP & alokasi saldo 1-1400 ===== */
export interface HppComponent {
  accountCode: string;
  amount: number;
  /** Wajib HANYA bila komponen ini berkelebihan (excess > 0) — kontrak backend. */
  vendorId: string;
  dueDate: string;
}

export interface HppAllocationRow extends HppComponent {
  /** Bagian komponen ini yang dilunasi via reklas saldo 1-1400 (Uang Muka Vendor). */
  allocated: number;
  /** Kelebihan di atas saldo 1-1400 — dicatat sebagai hutang vendor (2-1300). */
  excess: number;
}

/** Baris HPP yang layak dikirim ke backend (zod menolak amount ≤ 0). */
export function isFilledHppRow(row: HppComponent): boolean {
  return Boolean(row.accountCode) && Number.isFinite(row.amount) && row.amount > 0;
}

/** Baris yang benar-benar dikirim ke backend (zod menolak amount ≤ 0). */
export function filledHpp(rows: readonly HppComponent[]): HppComponent[] {
  return rows.filter(isFilledHppRow);
}

/**
 * Sejajarkan hasil alokasi (dihitung HANYA atas baris terisi) kembali ke daftar
 * baris form, supaya tiap baris di layar bisa menampilkan alokasi/kelebihannya
 * sendiri. Baris kosong → null.
 */
export function alignAllocation(
  rows: readonly HppComponent[],
  allocation: readonly HppAllocationRow[]
): (HppAllocationRow | null)[] {
  let n = 0;
  return rows.map((row) => (isFilledHppRow(row) ? allocation[n++] ?? null : null));
}

/**
 * Alokasikan saldo 1-1400 yang tersedia ke komponen HPP pro-rata menurut nominal
 * (bulat rupiah); sisa pembulatan ke komponen TERAKHIR agar Σ allocated persis
 * `min(available, totalHpp)`. Salinan 1:1 dari `allocateVendorAdvance` backend.
 */
export function allocateVendorAdvance(components: readonly HppComponent[], available: number): HppAllocationRow[] {
  if (components.length === 0) return [];
  const amounts = components.map((c) => Math.round(c.amount));
  const total = amounts.reduce((s, a) => s + a, 0);
  const capped = Math.max(0, Math.min(Math.round(available), total));

  const rows: HppAllocationRow[] = [];
  let allocatedSum = 0;
  for (let i = 0; i < components.length - 1; i++) {
    const allocated = total > 0 ? Math.round((capped * amounts[i]) / total) : 0;
    allocatedSum += allocated;
    rows.push({ ...components[i], amount: amounts[i], allocated, excess: amounts[i] - allocated });
  }
  const last = components.length - 1;
  // Clamp agar tidak negatif / melebihi nominal komponen itu sendiri (kasus tepi pembulatan).
  const lastAllocated = Math.max(0, Math.min(amounts[last], capped - allocatedSum));
  rows.push({ ...components[last], amount: amounts[last], allocated: lastAllocated, excess: amounts[last] - lastAllocated });
  return rows;
}

/**
 * Pratinjau 2 jurnal Pengakuan Pendapatan:
 *  1. Dr 2-1100 · Cr 4-xxxx (reclass PSAK 72)
 *  2. Dr 5-xxxx per komponen (nominal PENUH) · Cr 1-1400 (total alokasi, dihilangkan
 *     bila 0) · Cr 2-1300 per komponen berkelebihan.
 */
export function revenuePreviewLines(opts: {
  revenueAccountCode: string;
  amount: number;
  allocation: readonly HppAllocationRow[];
}): PreviewLine[] {
  const revenueGroup = 'Jurnal 1 — Pengakuan pendapatan';
  const lines: PreviewLine[] = [
    { ...JAMAAH_ADVANCE, debit: opts.amount, credit: 0, group: revenueGroup },
    { code: opts.revenueAccountCode, name: accountName(opts.revenueAccountCode), debit: 0, credit: opts.amount, group: revenueGroup }
  ];
  if (opts.allocation.length === 0) return lines;

  const hppGroup = 'Jurnal 2 — Pengakuan HPP';
  const totalAllocated = opts.allocation.reduce((s, c) => s + c.allocated, 0);
  for (const c of opts.allocation) {
    lines.push({ code: c.accountCode, name: accountName(c.accountCode), debit: c.amount, credit: 0, group: hppGroup });
  }
  if (totalAllocated > 0) lines.push({ ...VENDOR_ADVANCE, debit: 0, credit: totalAllocated, group: hppGroup });
  for (const c of opts.allocation) {
    if (c.excess > 0) lines.push({ ...VENDOR_DEBT, debit: 0, credit: c.excess, group: hppGroup });
  }
  return lines;
}

/** Validasi klien Pengakuan Pendapatan = kontrak backend. Pesan pertama yang gagal, atau null. */
export function validateRevenueForm(input: {
  costCenterId: string;
  amount: number;
  allocation: readonly HppAllocationRow[];
  liability2100: number | null;
}): string | null {
  if (!input.costCenterId) return 'Pilih keberangkatan / cost center terlebih dahulu.';
  if (!Number.isFinite(input.amount) || input.amount <= 0) return 'Nilai pendapatan yang diakui harus lebih dari 0.';
  if (input.liability2100 != null && input.amount > input.liability2100) {
    return `Pendapatan yang diakui melebihi saldo Uang Muka Jamaah 2-1100 keberangkatan ini (${fmtFull(input.liability2100)}) — dana jamaah belum cukup diterima.`;
  }
  const missingVendor = input.allocation.find((c) => c.excess > 0 && !c.vendorId);
  if (missingVendor) {
    return `Komponen HPP ${missingVendor.accountCode} kelebihan ${fmtFull(missingVendor.excess)} dari saldo Uang Muka Vendor 1-1400 keberangkatan ini — wajib pilih vendor untuk sisa kelebihan (dicatat sbg hutang vendor 2-1300).`;
  }
  return null;
}

/** Validasi klien pelunasan tagihan vendor pada Pembayaran Biaya = kontrak backend. */
export function validateExpenseForm(input: {
  lines: readonly { accountCode: string; amount: number; vendorBillId?: string }[];
  currency: string;
  bills: readonly VendorBill[];
}): string | null {
  const billLines = input.lines.filter((l) => l.vendorBillId && l.amount > 0);
  if (billLines.length === 0) return null;
  if (input.currency !== 'IDR') return 'Pelunasan tagihan vendor tercatat hanya didukung via rekening IDR.';
  for (const l of billLines) {
    if (l.accountCode !== VENDOR_BILL_ACCOUNT) {
      return `Baris pelunasan tagihan vendor wajib memakai akun ${VENDOR_BILL_ACCOUNT} (Hutang Vendor).`;
    }
    const bill = input.bills.find((b) => b.id === l.vendorBillId);
    if (!bill) return 'Tagihan vendor yang dipilih tidak ada lagi di daftar tagihan — muat ulang halaman.';
    if (bill.status !== 'unpaid') {
      return `Tagihan vendor ${bill.vendorName} sudah ${vendorBillStatusPill(bill.status).label.toLowerCase()} — tidak bisa dilunasi.`;
    }
    if (Math.round(l.amount) > bill.remaining) {
      return `Nominal pelunasan ${fmtFull(Math.round(l.amount))} melebihi sisa tagihan vendor ${fmtFull(bill.remaining)} (${bill.vendorName}).`;
    }
  }
  return null;
}
