/**
 * Matriks akses halaman staf — SATU sumber kebenaran untuk sidebar (AppShell)
 * dan guard route (App.tsx). Keputusan user 2026-09-15: NAV sidebar = acuan.
 * Navigasi identik mockup Aplikasi Travel.dc.html (navDefs + titles).
 * `admin` selalu lolos (lihat RequireAuth / canAccess), sejalan requireRoles backend.
 */
export interface NavItem {
  to: string;
  label: string;
  dot: string;
  roles: readonly string[];
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', dot: 'var(--color-mod-dashboard)', roles: ['admin', 'pimpinan', 'keuangan', 'marketing', 'operasional'] },
  { to: '/paket', label: 'Paket & Jadwal', dot: 'var(--color-mod-paket)', roles: ['admin', 'pimpinan', 'marketing'] },
  { to: '/paket/master', label: 'Master Data Paket', dot: 'var(--color-mod-paket)', roles: ['admin', 'pimpinan', 'marketing'] },
  { to: '/jamaah', label: 'Jamaah & Pendaftaran', dot: 'var(--color-mod-jamaah)', roles: ['admin', 'pimpinan', 'operasional', 'marketing'] },
  { to: '/pembayaran', label: 'Pembayaran', dot: 'var(--color-mod-pembayaran)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/operasional', label: 'Operasional & Manifest', dot: 'var(--color-mod-operasional)', roles: ['admin', 'pimpinan', 'operasional'] },
  { to: '/laporan-operasional', label: 'Laporan Operasional', dot: 'var(--color-mod-operasional)', roles: ['admin', 'pimpinan', 'operasional', 'keuangan'] },
  { to: '/marketing', label: 'Marketing & Komisi', dot: 'var(--color-mod-marketing)', roles: ['admin', 'pimpinan', 'marketing'] },
  { to: '/keuangan', label: 'Keuangan & Akuntansi', dot: 'var(--color-mod-keuangan)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/keuangan-master', label: 'Master Data Keuangan', dot: 'var(--color-mod-keuangan)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/laporan-keuangan', label: 'Laporan Keuangan', dot: 'var(--color-mod-keuangan)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/admin', label: 'Administrasi', dot: 'var(--color-mod-sistem)', roles: ['admin'] }
] as const satisfies readonly NavItem[];

export type NavPath = (typeof NAV_ITEMS)[number]['to'];

export const NAV: readonly NavItem[] = NAV_ITEMS;

/** Role tulis modul keuangan (Input Transaksi, jurnal manual, rekonsiliasi). Pimpinan = read-only. */
export const FINANCE_WRITE_ROLES: readonly string[] = ['admin', 'keuangan'];

/**
 * Role yang boleh membuka kwitansi refund `/dokumen/refund/:id` — sama persis dengan
 * `GET /v1/refunds/:id/receipt` (admin lolos otomatis lewat `hasRole`). Halaman ini di
 * luar NAV (dokumen A4 printable), jadi rolenya didefinisikan terpisah dari NAV_ITEMS.
 */
export const REFUND_RECEIPT_ROLES: readonly string[] = ['admin', 'keuangan', 'pimpinan', 'operasional', 'marketing'];

/** Roles untuk satu entri NAV (dipakai `<RequireAuth roles=…>` di App.tsx). */
export function rolesFor(path: NavPath): readonly string[] {
  const item = NAV_ITEMS.find((n) => n.to === path);
  if (!item) throw new Error(`Path NAV tidak dikenal: ${path}`);
  return item.roles;
}

export function hasRole(role: string | undefined, roles: readonly string[]): boolean {
  if (!role) return false;
  return role === 'admin' || roles.includes(role);
}

/**
 * Apakah role boleh membuka `path` (boleh berisi query/sub-path, mis. `/jamaah/123`
 * atau `/jamaah?tab=dokumen`). Dicocokkan ke entri NAV dengan prefix terpanjang;
 * path di luar NAV (mis. `/dokumen/invoice/:id`) hanya butuh login → true.
 */
export function canAccess(path: string, role: string | undefined): boolean {
  if (!role) return false;
  const pathname = path.split(/[?#]/)[0] || '/';
  const match = NAV_ITEMS
    .filter((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(`${n.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match ? hasRole(role, match.roles) : true;
}
