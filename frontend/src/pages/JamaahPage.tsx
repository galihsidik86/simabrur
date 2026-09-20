import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { IDENTITY_PENDING_PILL, REG_STATUS_FILTERS, regStatusPill, type RegistrationStatus } from '../api/registrations';
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
  identityConfirmationRequired: boolean;
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

const PILL_CLASS = 'rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold';

export function JamaahPage() {
  const [params] = useSearchParams();
  const initialTab = TABS.some((t) => t.key === params.get('tab')) ? (params.get('tab') as string) : 'semua';
  const [tab, setTab] = useState(initialTab);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | RegistrationStatus>('');
  const [identityPending, setIdentityPending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['jamaah', tab, q, status, identityPending],
    queryFn: async () =>
      (await api.get('/jamaah', {
        params: {
          tab,
          q: q || undefined,
          status: status || undefined,
          // Kirim HANYA saat aktif: backend memakai z.coerce.boolean(), sehingga
          // string "false" pun akan terbaca true.
          identityPending: identityPending ? true : undefined,
          limit: 50
        }
      })).data as {
        data: JamaahRow[];
        meta: { total: number };
      }
  });

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
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

      {/* Filter status registrasi & konfirmasi identitas (kontrak GET /v1/jamaah). */}
      <div className="mb-[18px] flex flex-wrap items-center gap-2">
        <label className="text-[11.5px] font-semibold text-muted" htmlFor="jamaah-status">Status</label>
        <select id="jamaah-status" className="fld !w-[200px] !py-1.5 !text-[12px]" value={status}
          onChange={(e) => setStatus(e.target.value as '' | RegistrationStatus)}>
          {REG_STATUS_FILTERS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
        <button
          onClick={() => setIdentityPending(!identityPending)}
          aria-pressed={identityPending}
          className="cursor-pointer rounded-pill border px-3 py-[5px] text-[11.5px] font-semibold"
          style={identityPending
            ? { color: '#fff', background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
            : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }}
        >
          Menunggu konfirmasi identitas
        </button>
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
              const reg = regStatusPill(j.registrationStatus);
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
                    {j.identityConfirmationRequired && (
                      <div className="mt-1">
                        <span className={PILL_CLASS} style={{ color: IDENTITY_PENDING_PILL.color, background: IDENTITY_PENDING_PILL.bg }}
                          title="Login Portal Jamaah ditahan sampai petugas mengonfirmasi identitas pendaftar.">
                          {IDENTITY_PENDING_PILL.label}
                        </span>
                      </div>
                    )}
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
                    <div className="flex flex-col items-start gap-1">
                      <span className={PILL_CLASS} style={{ color: reg.color, background: reg.bg }}>{reg.label}</span>
                      <span className={PILL_CLASS} style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
                    </div>
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
