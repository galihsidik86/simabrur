import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtShort, fmtDate } from '../utils/format';

interface Dashboard {
  kpi: {
    omzetThisMonth: number; omzetDeltaPct: number | null; jamaahActive: number; jamaahNewThisMonth: number;
    avgMargin: number; cashAndBank: number; bankCount: number;
  };
  cashflow: { month: string; cashIn: number; revenue: number }[];
  profitByPackage: { packageId: string; name: string; jamaah: number; revenue: number; grossProfit: number; margin: number }[];
  upcoming: { name: string; date: string; quota: number; seatsTaken: number; pct: number; status: string }[];
}

const UP_STATUS: Record<string, { color: string; bg: string; bar: string }> = {
  Full: { color: '#fff', bg: 'oklch(0.55 0.15 28)', bar: 'oklch(0.55 0.15 28)' },
  'Hampir penuh': { color: 'oklch(0.45 0.12 55)', bg: 'oklch(0.94 0.05 70)', bar: 'oklch(0.62 0.11 78)' },
  Terbuka: { color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)', bar: 'oklch(0.5 0.09 165)' }
};

export function DashboardPage() {
  const { data: d } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/reports/dashboard')).data.data as Dashboard
  });
  if (!d) return <div className="text-[12.5px] text-muted-2">Memuat dashboard…</div>;

  const kpis = [
    {
      label: 'Penerimaan Bulan Ini', value: fmtShort(d.kpi.omzetThisMonth),
      sub: 'kas masuk dari jamaah',
      delta: d.kpi.omzetDeltaPct != null ? `${d.kpi.omzetDeltaPct >= 0 ? '+' : ''}${d.kpi.omzetDeltaPct}%` : '—'
    },
    { label: 'Jamaah Aktif', value: d.kpi.jamaahActive.toLocaleString('id-ID'), sub: `+${d.kpi.jamaahNewThisMonth} pendaftaran bulan ini`, delta: d.kpi.jamaahNewThisMonth > 0 ? `+${d.kpi.jamaahNewThisMonth}` : '—' },
    { label: 'Margin Rata-rata', value: `${d.kpi.avgMargin}%`, sub: 'laba kotor per paket (cost center)', delta: 'YTD' },
    { label: 'Kas & Bank', value: fmtShort(d.kpi.cashAndBank), sub: 'IDR + USD + SAR (ekuiv.)', delta: `${d.kpi.bankCount} rek.` }
  ];

  const maxBar = Math.max(1, ...d.cashflow.flatMap((c) => [c.cashIn, c.revenue]));

  return (
    <div>
      {/* KPI */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-card border border-line bg-card p-[18px] shadow-card">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-3">{k.label}</span>
              <span className="rounded-pill bg-success-bg px-[7px] py-[2px] text-[11px] font-semibold text-success">{k.delta}</span>
            </div>
            <div className="mt-2.5 font-mono text-[25px] font-semibold text-ink-strong">{k.value}</div>
            <div className="mt-[3px] text-[11px] text-muted-4">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-[1.7fr_1fr] gap-4 max-lg:grid-cols-1">
        {/* Chart arus kas vs pendapatan diakui */}
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold">Arus Kas & Pengakuan Pendapatan</span>
            <div className="flex gap-4 text-[11px] text-muted-2">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[oklch(0.5_0.09_165)]" />Penerimaan Kas</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-[3px] bg-[oklch(0.62_0.11_78)]" />Pendapatan Diakui</span>
            </div>
          </div>
          <div className="mt-5 flex h-[186px] items-end gap-5 border-b border-line-3 pb-0">
            {d.cashflow.map((c) => (
              <div key={c.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div className="flex h-full items-end gap-[5px]">
                  <div className="w-4 rounded-t-[4px] bg-[oklch(0.5_0.09_165)]" style={{ height: `${Math.round((c.cashIn / maxBar) * 100)}%` }} title={fmtShort(c.cashIn)} />
                  <div className="w-4 rounded-t-[4px] bg-[oklch(0.62_0.11_78)]" style={{ height: `${Math.round((c.revenue / maxBar) * 100)}%` }} title={fmtShort(c.revenue)} />
                </div>
                <span className="text-[11px] text-muted-3">{c.month}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Keberangkatan mendatang */}
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          <div className="mb-3.5 text-[14px] font-semibold">Keberangkatan Mendatang</div>
          <div className="flex flex-col gap-3">
            {d.upcoming.map((u) => {
              const st = UP_STATUS[u.status];
              return (
                <div key={u.name + u.date}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[12.5px] font-semibold">{u.name}</span>
                      <div className="text-[10.5px] text-muted-4">{fmtDate(u.date, 'long')}</div>
                    </div>
                    <span className="rounded-pill px-2 py-[3px] text-[10.5px] font-semibold" style={{ color: st.color, background: st.bg }}>{u.status}</span>
                  </div>
                  <div className="mt-1.5 h-[7px] overflow-hidden rounded-md bg-track">
                    <div className="h-full" style={{ width: `${Math.min(u.pct, 100)}%`, background: st.bar }} />
                  </div>
                  <div className="mt-1 font-mono text-[10.5px] text-muted-3">{u.seatsTaken} / {u.quota} kursi terisi</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Profitabilitas per paket */}
      <div className="mt-4 rounded-card border border-line bg-card p-5 shadow-card">
        <div className="mb-3.5 text-[14px] font-semibold">Profitabilitas per Paket <span className="text-[11px] font-normal text-muted-4">(dari jurnal pengakuan pendapatan)</span></div>
        {d.profitByPackage.length === 0 ? (
          <div className="text-[12px] text-muted-2">Belum ada pengakuan pendapatan — posting via Keuangan → Input Transaksi.</div>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
                <th className="py-1.5 font-semibold">Paket</th>
                <th className="py-1.5 text-right font-semibold">Jamaah</th>
                <th className="py-1.5 text-right font-semibold">Pendapatan</th>
                <th className="py-1.5 text-right font-semibold">Laba Kotor</th>
                <th className="py-1.5 text-right font-semibold">Margin</th>
              </tr>
            </thead>
            <tbody>
              {d.profitByPackage.map((p) => (
                <tr key={p.packageId} className="border-t border-line-3">
                  <td className="py-2.5 font-semibold">{p.name}</td>
                  <td className="py-2.5 text-right font-mono">{p.jamaah}</td>
                  <td className="py-2.5 text-right font-mono">{fmtShort(p.revenue)}</td>
                  <td className="py-2.5 text-right font-mono">{fmtShort(p.grossProfit)}</td>
                  <td className="py-2.5 text-right">
                    <span className="rounded-pill bg-success-bg px-2 py-[2px] font-mono text-[11.5px] font-semibold text-success">{p.margin}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
