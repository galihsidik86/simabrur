import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtShort, fmtDate } from '../../utils/format';

/** Skala warna kelas akun (identik mockup COA/Jurnal/Input Transaksi). */
export const ACC_CLASS_COLOR: Record<number, string> = {
  1: 'oklch(0.52 0.08 165)', 2: 'oklch(0.52 0.09 245)', 3: 'oklch(0.46 0.02 265)',
  4: 'oklch(0.46 0.07 158)', 5: 'oklch(0.56 0.09 78)', 6: 'oklch(0.56 0.11 45)', 7: 'oklch(0.5 0.1 322)'
};

const TABS = [
  { to: '/keuangan', label: 'Ringkasan', end: true },
  { to: '/keuangan/input', label: 'Input Transaksi' },
  { to: '/keuangan/jurnal', label: 'Jurnal & Rekonsiliasi' },
  { to: '/keuangan/coa', label: 'Bagan Akun' }
];

export function KeuanganLayout() {
  return (
    <div>
      <div className="mb-[18px] flex gap-1 border-b border-line-2">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className="border-b-2 px-3.5 py-2 text-[13px] font-semibold"
            style={({ isActive }) => isActive
              ? { borderColor: 'var(--color-primary)', color: 'var(--color-ink-strong)' }
              : { borderColor: 'transparent', color: '#8c8371' }}>
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}

/* ===== Ringkasan (replika view Keuangan di Aplikasi Travel.dc.html) ===== */
interface Summary {
  kpi: { liabilitasJamaah: number; revenueYtd: number; grossProfitYtd: number };
  ccProfit: { costCenterId: string; name: string; revenue: number; cogs: number; grossProfit: number; margin: number }[];
  journalFeed: {
    id: string; journalNo: string; date: string; description: string; source: string; total: number;
    lines: { accountCode: string; accountName: string; debit: number; credit: number }[];
  }[];
}

export function KeuanganRingkasan() {
  const { data } = useQuery({
    queryKey: ['accounting-summary'],
    queryFn: async () => (await api.get('/accounting/summary')).data.data as Summary
  });
  if (!data) return <div className="text-[12.5px] text-muted-2">Memuat ringkasan…</div>;

  const margin = data.kpi.revenueYtd ? Math.round((data.kpi.grossProfitYtd / data.kpi.revenueYtd) * 100) : 0;
  const tiles = [
    { label: 'Uang Muka Jamaah (Liabilitas)', value: fmtShort(data.kpi.liabilitasJamaah), sub: 'Akun 2-1100 · dana belum diakui', accent: 'oklch(0.52 0.09 245)' },
    { label: 'Pendapatan Diakui (YTD)', value: fmtShort(data.kpi.revenueYtd), sub: 'PSAK 72 · atas keberangkatan', accent: 'oklch(0.46 0.07 158)' },
    { label: 'Laba Kotor (YTD)', value: fmtShort(data.kpi.grossProfitYtd), sub: `Margin ${margin}%`, accent: 'oklch(0.56 0.09 78)' }
  ];

  return (
    <div>
      <div className="mb-[18px] grid grid-cols-3 gap-4 max-md:grid-cols-1">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-card border border-line bg-card p-[18px] shadow-card" style={{ borderLeft: `4px solid ${t.accent}` }}>
            <div className="text-xs text-muted-3">{t.label}</div>
            <div className="mt-2 font-mono text-[23px] font-semibold">{t.value}</div>
            <div className="mt-[3px] text-[11px] text-muted-4">{t.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <div className="mb-3.5 text-[14px] font-semibold">
            Laba-Rugi per Keberangkatan <span className="text-[11px] font-normal text-muted-4">(cost center)</span>
          </div>
          <div className="flex flex-col gap-3">
            {data.ccProfit.map((c) => (
              <div key={c.costCenterId} className="rounded-[10px] border border-line-3 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12.5px] font-semibold">{c.name}</span>
                  <span className="font-mono text-[11px] font-semibold">{c.margin}%</span>
                </div>
                <div className="flex gap-4 text-[11.5px]">
                  <div><div className="text-[10px] text-muted-4">Pendapatan</div><div className="font-mono font-semibold">{fmtShort(c.revenue)}</div></div>
                  <div><div className="text-[10px] text-muted-4">HPP</div><div className="font-mono font-semibold">{fmtShort(c.cogs)}</div></div>
                  <div className="ml-auto text-right"><div className="text-[10px] text-muted-4">Laba Kotor</div><div className="font-mono font-semibold text-[oklch(0.46_0.07_158)]">{fmtShort(c.grossProfit)}</div></div>
                </div>
              </div>
            ))}
            {data.ccProfit.length === 0 && (
              <div className="text-[12px] text-muted-2">Belum ada pengakuan pendapatan — jalankan transaksi "Pengakuan Pendapatan" di Input Transaksi.</div>
            )}
          </div>
        </div>

        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <div className="mb-3.5 text-[14px] font-semibold">Jurnal Otomatis Terbaru</div>
          <div className="flex flex-col gap-2.5">
            {data.journalFeed.map((j) => (
              <div key={j.id} className="flex gap-3 border-b border-line-3 pb-2.5 last:border-0">
                <span className="w-[62px] flex-none font-mono text-[10.5px] text-muted-4">{fmtDate(j.date)}</span>
                <div className="flex-1">
                  <div className="text-[12px] font-medium">{j.description}</div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-2">
                    Dr {j.lines.filter((l) => l.debit > 0).map((l) => l.accountName).join(', ')} · Cr {j.lines.filter((l) => l.credit > 0).map((l) => l.accountName).join(', ')}
                  </div>
                </div>
                <span className="font-mono text-[11.5px] font-semibold">{fmtShort(j.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
