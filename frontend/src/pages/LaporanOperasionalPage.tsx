import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtShort, fmtDate } from '../utils/format';

/* ===== Tipe ===== */
interface AgingData {
  buckets: Record<'belum' | 'd30' | 'd60' | 'd90', { label: string; amount: number; count: number }>;
  rows: { regNumber: string; name: string; packageName: string; total: number; paid: number; remaining: number; nextDueDate: string | null; agingBucket: string }[];
}
interface ComplianceData {
  tiles: { complete: number; pendingDocs: number; passportIssues: number; totalActive: number };
  perDeparture: { departureId: string; packageName: string; departureDate: string; jamaahCount: number; pct: number; note: string }[];
  matrix: { jamaahId: string; name: string; cells: { type: string; status: 'ok' | 'no' | 'bad' }[]; rowStatus: string }[] | null;
}
interface ReadinessData {
  tiles: { activeDepartures: number; visaIssued: number; visaTotal: number; manifestReady: number; manifestTotal: number };
  cards: {
    departureId: string; packageName: string; departureDate: string; jamaahCount: number; score: number;
    level: 'green' | 'gold' | 'red';
    metrics: { paymentPct: number; documentPct: number; visaIssued: number; ticketIssued: number; visaPct: number; ticketPct: number };
    manifestStatus: string; note: string;
  }[];
}

const LEVEL_COLOR = { green: 'oklch(0.46 0.07 158)', gold: 'oklch(0.55 0.1 78)', red: 'oklch(0.55 0.15 28)' };
const BUCKET_STYLE: Record<string, { label: string; color: string }> = {
  belum: { label: 'Belum tempo', color: 'oklch(0.42 0.07 158)' },
  d30: { label: '1–30 hari', color: 'oklch(0.55 0.1 78)' },
  d60: { label: '31–60 hari', color: 'oklch(0.55 0.12 45)' },
  d90: { label: '> 60 hari', color: 'oklch(0.55 0.15 28)' }
};

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-card border border-line bg-card p-[18px] shadow-card" style={{ borderLeft: `4px solid ${accent}` }}>
      <div className="text-xs text-muted-3">{label}</div>
      <div className="mt-2 font-mono text-[23px] font-semibold">{value}</div>
      <div className="mt-[3px] text-[11px] text-muted-4">{sub}</div>
    </div>
  );
}

export function LaporanOperasionalPage() {
  const [tab, setTab] = useState<'piutang' | 'dokumen' | 'kesiapan'>('piutang');
  const [depId, setDepId] = useState('');

  async function download(report: string) {
    const res = await api.get('/reports/export', { params: { report }, responseType: 'blob' });
    const url = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-${report}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const exportKey = tab === 'piutang' ? 'aging' : tab === 'dokumen' ? 'compliance' : 'readiness';

  return (
    <div>
      <div className="mb-[18px] flex items-center gap-2">
        {([['piutang', 'Piutang (Aging)'], ['dokumen', 'Kepatuhan Dokumen'], ['kesiapan', 'Kesiapan Keberangkatan']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="cursor-pointer border-b-2 px-3 py-2 text-[13px] font-semibold"
            style={tab === k ? { borderColor: 'var(--color-primary)', color: 'var(--color-ink-strong)' } : { borderColor: 'transparent', color: '#8c8371' }}>
            {label}
          </button>
        ))}
        <button onClick={() => download(exportKey)}
          className="ml-auto cursor-pointer rounded-[9px] border border-line-2 bg-white px-3.5 py-2 text-[12px] font-semibold text-muted hover:bg-panel">
          Ekspor Excel
        </button>
        <button onClick={() => window.print()}
          className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3.5 py-2 text-[12px] font-semibold text-muted hover:bg-panel">
          Ekspor PDF
        </button>
      </div>

      {tab === 'piutang' && <TabPiutang />}
      {tab === 'dokumen' && <TabDokumen depId={depId} setDepId={setDepId} />}
      {tab === 'kesiapan' && <TabKesiapan />}
    </div>
  );
}

/* ===== Tab 1: Piutang Aging ===== */
function TabPiutang() {
  const { data } = useQuery({
    queryKey: ['report-aging'],
    queryFn: async () => (await api.get('/receivables/aging')).data.data as AgingData
  });
  if (!data) return <Loading />;
  const order = ['belum', 'd30', 'd60', 'd90'] as const;
  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        {order.map((k) => (
          <Tile key={k} label={data.buckets[k].label} value={fmtShort(data.buckets[k].amount)}
            sub={`${data.buckets[k].count} jamaah${k === 'd90' ? ' · tindak lanjut' : ''}`} accent={BUCKET_STYLE[k].color} />
        ))}
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line-3 px-5 py-4 text-[14px] font-semibold">Rincian Piutang Jamaah</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Jamaah</th><th className="px-3 py-[11px] font-semibold">Paket</th>
              <th className="px-3 py-[11px] text-right font-semibold">Total</th><th className="px-3 py-[11px] text-right font-semibold">Terbayar</th>
              <th className="px-3 py-[11px] text-right font-semibold">Sisa</th><th className="px-3 py-[11px] font-semibold">Jatuh Tempo</th>
              <th className="px-5 py-[11px] font-semibold">Umur</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const b = BUCKET_STYLE[r.agingBucket];
              return (
                <tr key={r.regNumber} className="border-t border-line-3">
                  <td className="px-5 py-3"><span className="font-semibold">{r.name}</span><div className="font-mono text-[10px] text-muted-4">{r.regNumber}</div></td>
                  <td className="px-3 py-3">{r.packageName}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtShort(r.total)}</td>
                  <td className="px-3 py-3 text-right font-mono text-[oklch(0.46_0.07_158)]">{fmtShort(r.paid)}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{fmtShort(r.remaining)}</td>
                  <td className="px-3 py-3 text-muted">{r.nextDueDate ? fmtDate(r.nextDueDate) : '—'}</td>
                  <td className="px-5 py-3">
                    <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold"
                      style={{ color: r.agingBucket === 'belum' ? b.color : '#fff', background: r.agingBucket === 'belum' ? 'oklch(0.95 0.03 158)' : b.color }}>
                      {b.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ===== Tab 2: Kepatuhan Dokumen ===== */
const DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'];
const CHIP: Record<string, { text: string; color: string; bg: string; title: string }> = {
  ok: { text: '✓', color: '#fff', bg: 'oklch(0.52 0.08 165)', title: 'Terverifikasi' },
  no: { text: '·', color: '#8c8371', bg: '#f0eadc', title: 'Belum diunggah' },
  bad: { text: '!', color: '#fff', bg: 'oklch(0.55 0.15 28)', title: 'Bermasalah / kedaluwarsa' }
};

function TabDokumen({ depId, setDepId }: { depId: string; setDepId: (v: string) => void }) {
  const { data } = useQuery({
    queryKey: ['report-compliance', depId],
    queryFn: async () => (await api.get('/reports/document-compliance', { params: depId ? { departureId: depId } : {} })).data.data as ComplianceData
  });
  if (!data) return <Loading />;
  const t = data.tiles;
  const selected = data.perDeparture.find((d) => d.departureId === depId);
  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Tile label="Lengkap & Terverifikasi" value={String(t.complete)} sub={`${t.totalActive ? Math.round((t.complete / t.totalActive) * 100) : 0}% jamaah aktif`} accent="oklch(0.46 0.07 158)" />
        <Tile label="Dokumen Pending" value={String(t.pendingDocs)} sub="menunggu unggah / verifikasi" accent="oklch(0.55 0.1 78)" />
        <Tile label="Paspor < 7 Bulan" value={String(t.passportIssues)} sub="perlu perpanjangan" accent="oklch(0.55 0.15 28)" />
        <Tile label="Total Jamaah Aktif" value={String(t.totalActive)} sub={`${data.perDeparture.length} keberangkatan`} accent="oklch(0.46 0.02 265)" />
      </div>

      <div className="mb-4 rounded-card border border-line bg-card p-5 shadow-card">
        <div className="mb-3 text-[14px] font-semibold">Kelengkapan Dokumen per Keberangkatan</div>
        <div className="flex flex-col gap-3">
          {data.perDeparture.map((d) => (
            <button key={d.departureId} onClick={() => setDepId(d.departureId)} className="cursor-pointer text-left">
              <div className="mb-1 flex justify-between text-[12px]">
                <span className={depId === d.departureId ? 'font-bold' : 'font-medium'}>
                  {d.packageName} · {fmtDate(d.departureDate)} <span className="text-muted-4">({d.jamaahCount} jamaah)</span>
                </span>
                <span className="font-mono font-semibold">{d.pct}% <span className="font-sans text-[10.5px] font-normal text-muted-3">— {d.note}</span></span>
              </div>
              <div className="h-2 overflow-hidden rounded-md bg-track">
                <div className="h-full" style={{ width: `${d.pct}%`, background: d.pct >= 90 ? 'oklch(0.5 0.09 165)' : d.pct >= 75 ? 'oklch(0.62 0.11 78)' : 'oklch(0.55 0.15 28)' }} />
              </div>
            </button>
          ))}
        </div>
        <div className="mt-2 text-[10.5px] text-muted-3">Klik keberangkatan untuk melihat matriks dokumen per jamaah.</div>
      </div>

      {data.matrix && selected && (
        <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
          <div className="border-b border-line-3 px-5 py-4 text-[14px] font-semibold">
            Matriks Dokumen — {selected.packageName} ({fmtDate(selected.departureDate)})
          </div>
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
                <th className="px-5 py-[11px] font-semibold">Jamaah</th>
                {DOC_TYPES.map((d) => <th key={d} className="px-2 py-[11px] text-center font-semibold">{d}</th>)}
                <th className="px-5 py-[11px] font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((m) => (
                <tr key={m.jamaahId} className="border-t border-line-3">
                  <td className="px-5 py-2.5 font-semibold">{m.name}</td>
                  {m.cells.map((c) => {
                    const chip = CHIP[c.status];
                    return (
                      <td key={c.type} className="px-2 py-2.5 text-center">
                        <span title={`${c.type} — ${chip.title}`} className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-[5px] text-[11px] font-bold"
                          style={{ color: chip.color, background: chip.bg }}>
                          {chip.text}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-5 py-2.5">
                    <span className="text-[11px] font-semibold"
                      style={{ color: m.rowStatus === 'Lengkap' ? 'oklch(0.46 0.07 158)' : m.rowStatus === 'Perlu tindakan' ? 'oklch(0.55 0.15 28)' : 'oklch(0.5 0.1 78)' }}>
                      {m.rowStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-5 border-t border-line-3 px-5 py-3 text-[10.5px] text-muted-2">
            <span><span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-[oklch(0.52_0.08_165)] text-[9px] font-bold text-white">✓</span>Terverifikasi</span>
            <span><span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-track text-[9px] font-bold text-muted-2">·</span>Belum diunggah</span>
            <span><span className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-[4px] bg-[oklch(0.55_0.15_28)] text-[9px] font-bold text-white">!</span>Bermasalah / kedaluwarsa</span>
          </div>
        </div>
      )}
    </>
  );
}

/* ===== Tab 3: Kesiapan Keberangkatan ===== */
function TabKesiapan() {
  const { data } = useQuery({
    queryKey: ['report-readiness'],
    queryFn: async () => (await api.get('/reports/readiness')).data.data as ReadinessData
  });
  if (!data) return <Loading />;
  const t = data.tiles;
  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Tile label="Keberangkatan Aktif" value={String(t.activeDepartures)} sub="dengan jamaah terdaftar" accent="oklch(0.46 0.02 265)" />
        <Tile label="Visa Terbit" value={`${t.visaIssued}/${t.visaTotal}`} sub={`${t.visaTotal - t.visaIssued} dalam proses`} accent="oklch(0.52 0.09 245)" />
        <Tile label="Manifest Siap" value={`${t.manifestReady}/${t.manifestTotal}`} sub="siap dikirim ke provider" accent="oklch(0.46 0.07 158)" />
        <Tile label="Tiket Terbit" value={String(data.cards.reduce((s, c) => s + c.metrics.ticketIssued, 0))} sub="PNR final" accent="oklch(0.56 0.11 45)" />
      </div>
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {data.cards.map((c) => (
          <div key={c.departureId} className="rounded-card border border-line bg-card p-5 shadow-card">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13.5px] font-semibold">{c.packageName}</div>
                <div className="text-[11px] text-muted-3">{fmtDate(c.departureDate, 'long')} · {c.jamaahCount} jamaah</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[30px] font-semibold leading-none" style={{ color: LEVEL_COLOR[c.level] }}>{c.score}%</div>
                <div className="text-[10px] uppercase tracking-[0.5px] text-muted-3">kesiapan</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {[
                ['Pelunasan', c.metrics.paymentPct, `${c.metrics.paymentPct}%`],
                ['Dokumen', c.metrics.documentPct, `${c.metrics.documentPct}%`],
                ['Visa', c.metrics.visaPct, `${c.metrics.visaIssued}/${c.jamaahCount}`],
                ['Tiket', c.metrics.ticketPct, `${c.metrics.ticketIssued}/${c.jamaahCount}`]
              ].map(([label, pct, text]) => (
                <div key={label as string}>
                  <div className="text-[10px] text-muted-3">{label}</div>
                  <div className="font-mono text-[12.5px] font-semibold">{text}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-md bg-track">
                    <div className="h-full" style={{ width: `${pct}%`, background: Number(pct) >= 90 ? 'oklch(0.5 0.09 165)' : Number(pct) >= 70 ? 'oklch(0.62 0.11 78)' : 'oklch(0.55 0.15 28)' }} />
                  </div>
                </div>
              ))}
            </div>
            {c.note && (
              <div className="mt-3 rounded-[8px] px-3 py-2 text-[11px]"
                style={c.level === 'red' ? { background: 'oklch(0.96 0.04 30)', color: 'oklch(0.48 0.13 28)' } : { background: '#faf7f0', color: '#6f6858' }}>
                {c.note}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Loading() {
  return <div className="text-[12.5px] text-muted-2">Memuat laporan…</div>;
}
