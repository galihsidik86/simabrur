import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../store/auth';

/** Navigasi identik mockup Aplikasi Travel.dc.html (navDefs + titles). */
const NAV = [
  { to: '/', label: 'Dashboard', dot: 'var(--color-mod-dashboard)', roles: ['admin', 'pimpinan', 'keuangan', 'marketing', 'operasional'] },
  { to: '/paket', label: 'Paket & Jadwal', dot: 'var(--color-mod-paket)', roles: ['admin', 'pimpinan', 'marketing'] },
  { to: '/jamaah', label: 'Jamaah & Pendaftaran', dot: 'var(--color-mod-jamaah)', roles: ['admin', 'pimpinan', 'operasional', 'marketing'] },
  { to: '/pembayaran', label: 'Pembayaran', dot: 'var(--color-mod-pembayaran)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/operasional', label: 'Operasional & Manifest', dot: 'var(--color-mod-operasional)', roles: ['admin', 'pimpinan', 'operasional'] },
  { to: '/laporan-operasional', label: 'Laporan Operasional', dot: 'var(--color-mod-operasional)', roles: ['admin', 'pimpinan', 'operasional', 'keuangan'] },
  { to: '/marketing', label: 'Marketing & Komisi', dot: 'var(--color-mod-marketing)', roles: ['admin', 'pimpinan', 'marketing'] },
  { to: '/keuangan', label: 'Keuangan & Akuntansi', dot: 'var(--color-mod-keuangan)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/laporan-keuangan', label: 'Laporan Keuangan', dot: 'var(--color-mod-keuangan)', roles: ['admin', 'pimpinan', 'keuangan'] },
  { to: '/admin', label: 'Administrasi', dot: 'var(--color-mod-sistem)', roles: ['admin'] }
];

const TITLES: Record<string, [string, string]> = {
  '/': ['Dashboard Eksekutif', 'Ringkasan omzet, jamaah, profitabilitas & arus kas'],
  '/paket': ['Paket & Jadwal Keberangkatan', 'Kelola paket Umrah/Haji, harga, kuota & status'],
  '/jamaah': ['Jamaah & Pendaftaran', 'Data jamaah, kelengkapan dokumen & status pendaftaran'],
  '/pembayaran': ['Manajemen Pembayaran', 'Kartu piutang, termin, dan jatuh tempo jamaah'],
  '/operasional': ['Operasional & Manifest', 'Manifest, visa, tiket & pembagian rombongan'],
  '/laporan-operasional': ['Laporan Operasional', 'Piutang aging, kepatuhan dokumen & kesiapan keberangkatan'],
  '/marketing': ['Marketing, Agen & Komisi', 'Kinerja agen mitra, referral & perhitungan komisi'],
  '/keuangan': ['Keuangan & Akuntansi', 'Liabilitas jamaah, pengakuan pendapatan & laba per keberangkatan'],
  '/laporan-keuangan': ['Laporan Keuangan', 'Laba rugi, neraca & laba per paket — PT Safar Barokah Wisata'],
  '/admin': ['Administrasi Sistem', 'Pengguna, role & audit log']
};

export function AppShell() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [title, sub] = TITLES[pathname] ?? TITLES['/' + pathname.split('/')[1]] ?? ['Safar', ''];
  const initials = user?.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase() ?? '';

  return (
    <div className="flex h-screen overflow-hidden">
      {/* SIDEBAR */}
      <aside
        className="flex w-64 flex-none flex-col text-forest-text"
        style={{ background: 'linear-gradient(180deg,#16211b,#1b2a20)' }}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-[22px] pb-[18px] pt-[22px]">
          <div className="flex h-[38px] w-[38px] items-center justify-center rounded-[10px] bg-gold font-display text-xl text-[#20180a]">
            S
          </div>
          <div>
            <div className="font-display text-[19px] leading-none tracking-[0.5px]">Safar</div>
            <div className="mt-[3px] text-[10.5px] uppercase tracking-[1px] text-forest-muted">
              Manajemen Umrah & Haji
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-[2px] overflow-y-auto p-3 pt-3.5">
          {NAV.filter((n) => user && (user.role === 'admin' || n.roles.includes(user.role))).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className="flex items-center gap-[11px] rounded-[9px] px-3 py-2.5 hover:bg-white/[0.06]"
              style={({ isActive }) => ({
                background: isActive ? 'rgba(255,255,255,0.08)' : undefined,
                borderLeft: `3px solid ${isActive ? 'var(--color-mod-dashboard)' : 'transparent'}`
              })}
            >
              {({ isActive }) => (
                <>
                  <span className="h-[9px] w-[9px] flex-none rounded-[3px]" style={{ background: n.dot }} />
                  <span
                    className="text-[13px]"
                    style={{ color: isActive ? '#fff' : 'var(--color-forest-nav)', fontWeight: isActive ? 600 : 500 }}
                  >
                    {n.label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-[11px] border-t border-white/[0.07] px-4 py-3.5">
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
            {initials}
          </div>
          <div className="flex-1">
            <div className="text-[12.5px] font-semibold">{user?.name}</div>
            <div className="text-[10.5px] text-forest-muted">
              {user?.roleLabel} · {user?.branch}
            </div>
          </div>
          <button
            onClick={logout}
            title="Keluar"
            className="cursor-pointer rounded-[7px] border border-white/15 px-2 py-1 text-[10px] text-forest-nav hover:bg-white/[0.06]"
          >
            Keluar
          </button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-[66px] flex-none items-center gap-5 border-b border-line-2 bg-panel px-7">
          <div className="flex-1">
            <div className="font-display text-[22px] leading-none text-ink-strong">{title}</div>
            <div className="mt-[3px] text-[11.5px] text-muted-3">{sub}</div>
          </div>
          <div className="flex w-[250px] items-center gap-2 rounded-[9px] border border-line-2 bg-white px-[13px] py-2 text-muted-3">
            <span className="inline-block h-[7px] w-[7px] rounded-full border-[1.5px] border-[#b6ac94]" />
            <span className="text-[12.5px]">Cari jamaah, paket, invoice…</span>
          </div>
          <div className="relative flex h-10 w-10 items-center justify-center rounded-[9px] border border-line-2 bg-white">
            <span className="inline-block h-4 w-4 rounded-t-[5px] border-[1.5px] border-[#8c8371]" />
            <span className="absolute right-[9px] top-2 h-2 w-2 rounded-full border-[1.5px] border-white bg-danger" />
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-7 pb-10 pt-[26px]">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
