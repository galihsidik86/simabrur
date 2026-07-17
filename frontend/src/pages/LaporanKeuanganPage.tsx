import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtFull, fmtDate } from '../utils/format';

interface Line { label: string; code?: string; amount?: number; kind: string }
interface IncomeStatement { period: { from: string; to: string }; lines: Line[] }
interface BalanceSheet {
  asOf: string;
  assets: { lines: Line[]; total: number };
  liabilitiesEquity: { lines: Line[]; total: number };
  balanced: boolean;
}
interface ProfitPkg {
  packages: { packageId: string; name: string; jamaah: number; revenue: number; cogs: number; grossProfit: number; margin: number }[];
  total: { jamaah: number; revenue: number; cogs: number; grossProfit: number; margin: number };
}

function amountText(n?: number) {
  if (n == null) return '';
  return n < 0 ? `(${fmtFull(Math.abs(n))})` : fmtFull(n);
}

function ReportRow({ l }: { l: Line }) {
  if (l.kind === 'head') {
    return (
      <div className="mt-3 border-b-2 border-[oklch(0.46_0.07_158)] pb-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[oklch(0.46_0.07_158)]">
        {l.label}
      </div>
    );
  }
  const grand = l.kind === 'grand';
  const total = l.kind === 'total' || l.kind === 'sub';
  return (
    <div
      className={`flex justify-between py-[5px] text-[12px] ${grand ? 'mt-1 rounded-[7px] bg-success-bg px-2.5 py-2 font-bold' : total ? 'border-t border-line-2 font-semibold' : ''}`}
      style={{ paddingLeft: l.kind === 'item' ? 14 : undefined }}
    >
      <span>
        {l.code && <span className="mr-2 font-mono text-[10.5px] text-muted-4">{l.code}</span>}
        {l.label}
      </span>
      <span className="font-mono" style={{ color: (l.amount ?? 0) < 0 ? 'oklch(0.5 0.14 28)' : undefined }}>
        {amountText(l.amount)}
      </span>
    </div>
  );
}

export function LaporanKeuanganPage() {
  const [tab, setTab] = useState<'lr' | 'neraca' | 'paket'>('lr');

  async function download(report: string) {
    const res = await api.get('/reports/export', { params: { report }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-${report}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const exportKey = tab === 'lr' ? 'income-statement' : tab === 'neraca' ? 'balance-sheet' : 'profit';

  return (
    <div>
      <div className="mb-[18px] flex items-center gap-2">
        {([['lr', 'Laba Rugi'], ['neraca', 'Neraca'], ['paket', 'Laba Rugi per Paket']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold"
            style={tab === k ? { borderColor: 'var(--color-primary)', color: 'var(--color-ink-strong)' } : { borderColor: 'transparent', color: '#8c8371' }}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11.5px] text-muted-3">PT Safar Barokah Wisata · dalam Rupiah</span>
        <button onClick={() => download(exportKey)} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3.5 py-2 text-[12px] font-semibold text-muted hover:bg-panel">Ekspor Excel</button>
        <button onClick={() => window.print()} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3.5 py-2 text-[12px] font-semibold text-muted hover:bg-panel">Ekspor PDF</button>
      </div>

      {tab === 'lr' && <TabLabaRugi />}
      {tab === 'neraca' && <TabNeraca />}
      {tab === 'paket' && <TabPerPaket />}
    </div>
  );
}

function TabLabaRugi() {
  const { data } = useQuery({
    queryKey: ['income-statement'],
    queryFn: async () => (await api.get('/reports/income-statement')).data.data as IncomeStatement
  });
  if (!data) return <Loading />;
  return (
    <div className="mx-auto max-w-[640px] rounded-card border border-line bg-card p-6 shadow-card">
      <div className="text-center">
        <div className="font-display text-[19px] text-ink-strong">Laporan Laba Rugi</div>
        <div className="text-[11.5px] text-muted-3">{fmtDate(data.period.from, 'long')} – {fmtDate(data.period.to, 'long')}</div>
      </div>
      <div className="mt-4">{data.lines.map((l, i) => <ReportRow key={i} l={l} />)}</div>
    </div>
  );
}

function TabNeraca() {
  const { data } = useQuery({
    queryKey: ['balance-sheet'],
    queryFn: async () => (await api.get('/reports/balance-sheet')).data.data as BalanceSheet
  });
  if (!data) return <Loading />;
  return (
    <div className="rounded-card border border-line bg-card p-6 shadow-card">
      <div className="text-center">
        <div className="font-display text-[19px] text-ink-strong">Neraca (Laporan Posisi Keuangan)</div>
        <div className="text-[11.5px] text-muted-3">Per {fmtDate(data.asOf, 'long')}</div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-8 max-md:grid-cols-1">
        <div>{data.assets.lines.map((l, i) => <ReportRow key={i} l={l} />)}</div>
        <div>{data.liabilitiesEquity.lines.map((l, i) => <ReportRow key={i} l={l} />)}</div>
      </div>
      <div className="mt-5 rounded-[9px] px-4 py-2.5 text-center text-[12px] font-semibold"
        style={data.balanced ? { background: 'oklch(0.95 0.03 158)', color: 'oklch(0.4 0.07 158)' } : { background: 'oklch(0.96 0.04 30)', color: 'oklch(0.48 0.13 28)' }}>
        {data.balanced ? '✓ Neraca seimbang — Total Aset = Total Liabilitas + Ekuitas' : '⚠ Neraca TIDAK seimbang — periksa jurnal'}
      </div>
    </div>
  );
}

function TabPerPaket() {
  const { data } = useQuery({
    queryKey: ['profit-by-package'],
    queryFn: async () => (await api.get('/reports/profit-by-package')).data.data as ProfitPkg
  });
  if (!data) return <Loading />;
  if (data.packages.length === 0) {
    return <div className="text-[12.5px] text-muted-2">Belum ada pengakuan pendapatan per cost center — posting via Keuangan → Input Transaksi.</div>;
  }
  const rows: [string, (p: ProfitPkg['packages'][0] | ProfitPkg['total']) => string, boolean][] = [
    ['Jumlah Jamaah', (p) => String(p.jamaah), false],
    ['Pendapatan', (p) => fmtFull(p.revenue), false],
    ['HPP (beban langsung)', (p) => `(${fmtFull(p.cogs).slice(3)})`, false],
    ['Laba Kotor', (p) => fmtFull(p.grossProfit), true],
    ['Margin Kotor', (p) => `${p.margin}%`, false]
  ];
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card p-6 shadow-card">
      <div className="mb-4 text-center">
        <div className="font-display text-[19px] text-ink-strong">Laba Rugi per Paket</div>
        <div className="text-[11.5px] text-muted-3">Cost center per keberangkatan · YTD</div>
      </div>
      <table className="w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="bg-thead text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
            <th className="px-4 py-2.5 text-left font-semibold">Uraian</th>
            {data.packages.map((p) => <th key={p.packageId} className="px-4 py-2.5 text-right font-semibold">{p.name}</th>)}
            <th className="px-4 py-2.5 text-right font-semibold">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, fn, highlight]) => (
            <tr key={label} className="border-t border-line-3" style={highlight ? { background: 'oklch(0.97 0.02 158)', fontWeight: 700 } : {}}>
              <td className="px-4 py-2.5 font-medium">{label}</td>
              {data.packages.map((p) => (
                <td key={p.packageId} className="px-4 py-2.5 text-right font-mono">{fn(p)}</td>
              ))}
              <td className="px-4 py-2.5 text-right font-mono font-semibold" style={label === 'Margin Kotor' ? { color: 'oklch(0.46 0.07 158)' } : {}}>{fn(data.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Loading() {
  return <div className="text-[12.5px] text-muted-2">Memuat laporan…</div>;
}
