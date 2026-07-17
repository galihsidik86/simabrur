import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { fmtDate, fmtShort } from '../utils/format';

interface JamaahRow {
  registrationId: string;
  regNumber: string;
  jamaahId: string;
  name: string;
  gender: 'L' | 'P';
  age: number | null;
  city: string;
  packageName: string;
  departureDate: string;
  paymentScheme: 'dp' | 'cicil' | 'lunas';
  registrationStatus: string;
  docs: { type: string; status: 'verified' | 'pending' | 'rejected' | 'missing' }[];
  docsComplete: boolean;
  totalAmount: number | null;
  paidAmount: number;
  paidPct: number;
}

/** Warna badge dokumen — dMap mockup (ok/wait/bad). */
const DOC_STYLE: Record<string, { color: string; bg: string; border: string; title: string }> = {
  verified: { color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.94 0.04 158)', border: 'oklch(0.85 0.06 158)', title: 'Terverifikasi' },
  pending: { color: 'oklch(0.48 0.03 90)', bg: '#f2ecdf', border: '#e2d8c2', title: 'Menunggu verifikasi' },
  missing: { color: '#b0a68f', bg: '#faf7f0', border: '#e9e0cd', title: 'Belum diunggah' },
  rejected: { color: 'oklch(0.5 0.15 28)', bg: 'oklch(0.95 0.05 30)', border: 'oklch(0.85 0.08 30)', title: 'Ditolak / bermasalah' }
};

const SCHEME_PILL: Record<string, { label: string; color: string; bg: string }> = {
  lunas: { label: 'Lunas', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  cicil: { label: 'Cicilan', color: 'oklch(0.45 0.10 78)', bg: 'oklch(0.95 0.04 82)' },
  dp: { label: 'DP', color: 'oklch(0.5 0.13 28)', bg: 'oklch(0.96 0.04 30)' }
};

const TABS = [
  { key: 'semua', label: 'Semua Jamaah' },
  { key: 'dokumen', label: 'Dokumen Belum Lengkap' },
  { key: 'lunas', label: 'Lunas' }
] as const;

export function JamaahPage() {
  const [tab, setTab] = useState('semua');
  const [q, setQ] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['jamaah', tab, q],
    queryFn: async () => (await api.get('/jamaah', { params: { tab, q: q || undefined, limit: 50 } })).data as {
      data: JamaahRow[];
      meta: { total: number };
    }
  });

  return (
    <div>
      <div className="mb-[18px] flex items-center gap-2">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="cursor-pointer rounded-[8px] border px-3.5 py-[7px] text-[12.5px] font-semibold"
              style={
                on
                  ? { color: '#fff', background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
                  : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }
              }
            >
              {t.label}
            </button>
          );
        })}
        <input
          className="fld ml-auto !w-[240px]"
          placeholder="Cari nama / no. registrasi…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <a
          href="/daftar"
          target="_blank"
          rel="noreferrer"
          className="rounded-[9px] bg-primary px-4 py-[9px] text-[13px] font-semibold text-white hover:bg-primary-deep"
        >
          + Pendaftaran Baru
        </a>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-3 font-semibold">No. Registrasi</th>
              <th className="px-3 py-3 font-semibold">Jamaah</th>
              <th className="px-3 py-3 font-semibold">Paket</th>
              <th className="px-3 py-3 font-semibold">Kelengkapan Dokumen</th>
              <th className="px-3 py-3 font-semibold">Pembayaran</th>
              <th className="px-5 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-5 py-6 text-muted-2">Memuat data jamaah…</td></tr>
            )}
            {data?.data.map((j) => {
              const pill = SCHEME_PILL[j.paymentScheme];
              return (
                <tr key={j.registrationId} className="border-t border-line-3 hover:bg-panel">
                  <td className="px-5 py-[13px] font-mono text-[11.5px] text-muted">
                    <Link to={`/jamaah/${j.jamaahId}`} className="hover:underline">{j.regNumber}</Link>
                  </td>
                  <td className="px-3 py-[13px]">
                    <Link to={`/jamaah/${j.jamaahId}`} className="font-semibold text-ink hover:underline">{j.name}</Link>
                    <div className="text-[10.5px] text-muted-4">
                      {j.gender} · {j.age != null ? `${j.age} th` : '—'} · {j.city}
                    </div>
                  </td>
                  <td className="px-3 py-[13px]">
                    {j.packageName}
                    <div className="text-[10.5px] text-muted-4">{fmtDate(j.departureDate)}</div>
                  </td>
                  <td className="px-3 py-[13px]">
                    <div className="flex gap-1">
                      {j.docs.map((d) => {
                        const s = DOC_STYLE[d.status];
                        return (
                          <span
                            key={d.type}
                            title={`${d.type} — ${s.title}`}
                            className="flex h-[22px] w-6 items-center justify-center rounded-[5px] border text-[8px] font-bold"
                            style={{ color: s.color, background: s.bg, borderColor: s.border }}
                          >
                            {d.type}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="w-[150px] px-3 py-[13px]">
                    <div className="mb-1 flex justify-between text-[10.5px]">
                      <span className="text-muted-4">{j.paidPct}%</span>
                      <span className="font-mono text-muted">{j.paidAmount ? fmtShort(j.paidAmount) : '—'}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-md bg-track">
                      <div
                        className="h-full"
                        style={{
                          width: `${j.paidPct}%`,
                          background: j.paidPct >= 100 ? 'oklch(0.5 0.09 165)' : j.paidPct >= 50 ? 'oklch(0.62 0.11 78)' : 'oklch(0.6 0.13 40)'
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-5 py-[13px]">
                    <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold" style={{ color: pill.color, background: pill.bg }}>
                      {pill.label}
                    </span>
                  </td>
                </tr>
              );
            })}
            {data && data.data.length === 0 && (
              <tr><td colSpan={6} className="px-5 py-6 text-muted-2">Tidak ada data.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {data && <div className="mt-2 text-[11px] text-muted-3">{data.meta.total} pendaftaran</div>}
    </div>
  );
}
