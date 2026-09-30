/**
 * Kontrak bersama modul Marketing & Komisi — dipakai halaman Marketing, panel
 * atribusi agen di detail jamaah, dan tautan referral Portal Agen.
 *
 * Sumber kontrak: `backend/src/modules/marketing/marketing.routes.ts`
 * (GET /v1/agents, GET /v1/commissions, POST /v1/commissions/attribute).
 */
import type { StatusPill } from './registrations';

/** Satu baris `GET /v1/agents` → `data.agents[]`. */
export interface AgentRow {
  id: string;
  name: string;
  code: string;
  referralCode: string;
  commissionPct: number;
  isActive: boolean;
  phone: string | null;
  portalEnabled: boolean;
  leads: number;
  converted: number;
  conversionPct: number;
  commissionTotal: number;
  commissionPending: number;
}

/** Status baris komisi registrasi. */
export type CommissionStatus = 'pending' | 'approved' | 'paid';

/**
 * Atribusi agen satu registrasi, sesuai kontrak `GET /v1/jamaah/:id` → tiap item
 * `registrations[]`. Ketiganya `null` bila registrasi belum punya agen.
 */
export interface RegistrationAgent {
  agentId: string | null;
  agentName: string | null;
  commissionStatus: CommissionStatus | null;
}

/** Respons `POST /v1/commissions/attribute`. */
export interface AttributionResult {
  registrationId: string;
  agentId: string;
  agentName: string;
  amount: number;
}

/**
 * Role yang boleh memanggil `POST /v1/commissions/attribute` —
 * `requireRoles('marketing', 'keuangan')`; `admin` lolos lewat `hasRole`.
 */
export const AGENT_ATTRIBUTION_ROLES: readonly string[] = ['marketing', 'keuangan'];

/** Komisi yang sudah disetujui/dibayar tidak bisa dialihkan (backend membalas 409). */
export const ATTRIBUTABLE_COMMISSION_STATUS: CommissionStatus = 'pending';

/**
 * Agen registrasi terkunci bila komisinya sudah melewati `pending`; tombol
 * "Tetapkan/Ubah agen" disembunyikan agar tidak memancing 409 dari backend.
 */
export function isCommissionLocked(status: CommissionStatus | null | undefined): boolean {
  return status != null && status !== ATTRIBUTABLE_COMMISSION_STATUS;
}

/** Palet badge komisi — sama dengan Portal Agen (COMM_STATUS) agar konsisten. */
const COMMISSION_STATUS: Record<string, StatusPill> = {
  pending: { label: 'Menunggu persetujuan', color: 'oklch(0.5 0.1 78)', bg: 'oklch(0.96 0.04 78)' },
  approved: { label: 'Disetujui', color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  paid: { label: 'Dibayar', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' }
};

export function commissionStatusPill(status: string): StatusPill {
  return COMMISSION_STATUS[status] ?? { label: status, color: '#6f6858', bg: '#f2ecdf' };
}

/** Nama query param yang dibaca wizard publik `/daftar` untuk kode referral agen. */
export const REFERRAL_QUERY_PARAM = 'ref';

/** Normalisasi kode referral: tanpa spasi, huruf kapital (kontrak `agent:<KODE>`). */
export function normalizeReferralCode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

/** Tautan pendaftaran siap-bagikan milik satu agen, mis. `https://…/daftar?ref=BRKH-07`. */
export function referralLink(referralCode: string, origin: string = window.location.origin): string {
  return `${origin}/daftar?${REFERRAL_QUERY_PARAM}=${encodeURIComponent(normalizeReferralCode(referralCode))}`;
}

/** Ajakan singkat + tautan, siap dikirim lewat WhatsApp. */
export function referralInviteText(agentName: string, link: string): string {
  return (
    `Assalamu'alaikum. Ingin mendaftar Umrah/Haji bersama Safar? ` +
    `Silakan daftar lewat tautan saya (${agentName}) — data Anda otomatis tercatat atas nama saya:\n${link}`
  );
}

/** URL share WhatsApp (wa.me) untuk teks apa pun. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
