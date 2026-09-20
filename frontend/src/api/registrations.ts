/**
 * Status registrasi — SATU sumber badge untuk daftar Jamaah (JamaahPage) dan
 * detail jamaah (JamaahDetailPage). Warna dari palet badge yang sudah ada.
 */
export type RegistrationStatus = 'pending_documents' | 'active' | 'completed' | 'cancelled';

export interface StatusPill {
  label: string;
  color: string;
  bg: string;
}

export const REG_STATUS: Record<RegistrationStatus, StatusPill> = {
  pending_documents: { label: 'Menunggu Dokumen', color: 'oklch(0.45 0.10 78)', bg: 'oklch(0.95 0.04 82)' },
  active: { label: 'Aktif', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  completed: { label: 'Selesai', color: '#6f6858', bg: '#f2ecdf' },
  cancelled: { label: 'Dibatalkan', color: '#fff', bg: 'oklch(0.55 0.15 28)' }
};

/** Filter status daftar Jamaah (query `status` — kontrak GET /v1/jamaah). */
export const REG_STATUS_FILTERS: readonly { key: '' | RegistrationStatus; label: string }[] = [
  { key: '', label: 'Semua status' },
  { key: 'pending_documents', label: 'Menunggu Dokumen' },
  { key: 'active', label: 'Aktif' },
  { key: 'completed', label: 'Selesai' },
  { key: 'cancelled', label: 'Dibatalkan' }
];

/** Penanda registrasi yang login portalnya ditahan sampai identitas dikonfirmasi. */
export const IDENTITY_PENDING_PILL: StatusPill = {
  label: 'Menunggu konfirmasi identitas',
  color: 'oklch(0.45 0.10 78)',
  bg: 'oklch(0.95 0.04 82)'
};

export function regStatusPill(status: string): StatusPill {
  return REG_STATUS[status as RegistrationStatus] ?? { label: status, color: '#6f6858', bg: '#f2ecdf' };
}
