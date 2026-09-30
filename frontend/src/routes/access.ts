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
  // `keuangan` disamakan dengan backend: `GET /v1/jamaah` dan `GET /v1/jamaah/:id`
  // sudah memakai requireRoles('operasional','marketing','keuangan','pimpinan'), dan
  // Keuangan berwenang atas `POST /v1/commissions/attribute` yang dipicu dari halaman
  // detail jamaah (panel "Tetapkan agen"). Sebelumnya frontend lebih ketat dari backend.
  { to: '/jamaah', label: 'Jamaah & Pendaftaran', dot: 'var(--color-mod-jamaah)', roles: ['admin', 'pimpinan', 'operasional', 'marketing', 'keuangan'] },
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

/**
 * SEC-03: role yang boleh membuka dokumen invoice `/dokumen/invoice/:id` dan kwitansi
 * `/dokumen/kwitansi/:id`. Harus sama persis dengan `requireRoles('keuangan','pimpinan')`
 * pada `GET /v1/invoices/:id/document` dan `GET /v1/receipts/:id/document`.
 *
 * Nilainya sengaja identik dengan role NAV `/pembayaran`: satu-satunya pintu masuk ke
 * halaman ini adalah tabel di PembayaranPage dan panel lonceng, yang dua-duanya sudah
 * dipagari `canAccess('/pembayaran')`.
 */
export const PAYMENT_DOC_ROLES: readonly string[] = ['admin', 'keuangan', 'pimpinan'];

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
 * path di luar NAV secara default hanya butuh login → true.
 *
 * Halaman `/dokumen/*` ada di luar NAV, jadi TIDAK dijaga fungsi ini — masing-masing
 * dipagari eksplisit di App.tsx lewat `PAYMENT_DOC_ROLES` / `REFUND_RECEIPT_ROLES`
 * agar cocok dengan `requireRoles` di backend (SEC-03).
 */
export function canAccess(path: string, role: string | undefined): boolean {
  if (!role) return false;
  const pathname = path.split(/[?#]/)[0] || '/';
  const match = NAV_ITEMS
    .filter((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(`${n.to}/`)))
    .sort((a, b) => b.to.length - a.to.length)[0];
  return match ? hasRole(role, match.roles) : true;
}
