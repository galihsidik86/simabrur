/**
 * Kontrak refund pembatalan (plan.md "Kontrak pembatalan & refund").
 * Dipakai bersama oleh Pembayaran (tab Refund) dan detail jamaah (ringkasan refund).
 */
export type RefundStatus = 'pending' | 'paid';

export interface RefundDto {
  id: string;
  registrationId: string;
  regNumber: string;
  jamaahName: string;
  packageName: string;
  departureDate: string;
  costCenterCode: string | null;
  paidTotal: number;
  deduction: number;
  refundAmount: number;
  deductionReason: string | null;
  status: RefundStatus;
  cancelReason: string | null;
  cancelledAt: string | null;
  paidAt: string | null;
  bankAccountCode: string | null;
  journalNumber: string | null;
  /** Nomor kwitansi refund `KWR/YYYY/MM/NNNN` — null sebelum refund dibayar. */
  receiptNumber: string | null;
}

/** Dokumen kwitansi refund — `GET /v1/refunds/:id/receipt` (404 bila belum dibayar). */
export interface RefundReceiptDoc {
  refundId: string;
  receiptNumber: string;
  issuedDate: string;
  regNumber: string;
  jamaahName: string;
  packageName: string;
  departureDate: string;
  cancelReason: string | null;
  cancelledAt: string | null;
  paidTotal: number;
  deduction: number;
  deductionReason: string | null;
  refundAmount: number;
  amountInWords: string;
  bankAccount: { code: string; name: string; bank: string | null; accountNo: string | null } | null;
  reference: string | null;
  journalNumber: string | null;
  paidByName: string | null;
}

/** Warna diambil dari palet badge status yang sudah ada (REG_STATUS / STATUS_PILL). */
export const REFUND_STATUS: Record<RefundStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Menunggu refund', color: 'oklch(0.45 0.10 78)', bg: 'oklch(0.95 0.04 82)' },
  paid: { label: 'Refund dibayar', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' }
};

export function refundStatusPill(status: string): { label: string; color: string; bg: string } {
  return REFUND_STATUS[status as RefundStatus] ?? { label: status, color: '#6f6858', bg: '#f2ecdf' };
}
