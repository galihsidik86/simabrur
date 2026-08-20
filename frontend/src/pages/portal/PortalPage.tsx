import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { fmtShort, fmtFull, fmtDate } from '../../utils/format';
import { BackButton } from '../../components/BackButton';
import { AuthImage, downloadViaClient } from '../../components/AuthImage';
import { useInstallPrompt, setManifestForRoute } from '../../pwa';

interface GalleryPhoto { id: string; caption: string | null; createdAt: string }

/* ===== API portal (token terpisah dari staf) ===== */
const portalApi = axios.create({ baseURL: '/v1/portal' });
portalApi.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('safar.portal');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

interface PortalData {
  mabrur: { phone: string; initialPassword: string; appUrl: string; syncedAt: string } | null;
  profile: { name: string; regNumber: string; nik: string; passportNo: string | null; passportExpiry: string | null; mahram: string | null; branch: string };
  trip: {
    packageName: string; durationDays: number; departureDate: string; returnDate: string; daysLeft: number;
    groupName: string | null; roomType: string; roomNumber: string | null; muthawwif: string | null; tourLeader: string | null;
    airline: string | null; airlineCode: string | null; hotel: string | null;
  };
  progress: { documents: { verified: number; required: number; pct: number }; payment: { paid: number; total: number; pct: number } };
  actions: { type: string; title: string; detail: string; level: 'red' | 'amber'; target: string }[];
  payment: {
    invoiceId: string | null; invoiceNumber: string | null; vaNumber: string | null;
    total: number; paid: number; remaining: number;
    schedules: { termNo: number; label: string; amount: number; dueDate: string; status: string }[];
    receipts: { id: string; number: string; amount: number; issued_date: string }[];
  };
  documents: { type: string; name: string; status: string; note: string; optional: boolean }[];
  checklist: { id: string; item: string; isDone: boolean }[];
  jamaahId: string;
}

const TABS = [
  { key: 'beranda', label: 'Beranda', dot: 'oklch(0.5 0.09 165)' },
  { key: 'bayar', label: 'Bayar', dot: 'oklch(0.56 0.11 78)' },
  { key: 'dokumen', label: 'Dokumen', dot: 'oklch(0.52 0.09 245)' },
  { key: 'perjalanan', label: 'Perjalanan', dot: 'oklch(0.56 0.11 45)' },
  { key: 'profil', label: 'Profil', dot: 'oklch(0.46 0.02 265)' }
] as const;
type Tab = (typeof TABS)[number]['key'];

const ROOM: Record<string, string> = { quad: 'Quad', triple: 'Triple', double: 'Double' };

export function PortalPage() {
  const [authed, setAuthed] = useState(Boolean(sessionStorage.getItem('safar.portal')));
  useEffect(() => setManifestForRoute('/portal'), []);
  return authed ? <PortalApp onLogout={() => { sessionStorage.removeItem('safar.portal'); setAuthed(false); }} /> : <PortalLogin onLogin={() => setAuthed(true)} />;
}

function PortalInstallButton() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button type="button" onClick={install} className="mt-3 w-full cursor-pointer rounded-[10px] border border-primary bg-white py-2.5 text-[12.5px] font-semibold text-primary">
      ⤓ Pasang aplikasi di layar utama
    </button>
  );
}

/* ===== Login ===== */
function PortalLogin({ onLogin }: { onLogin: () => void }) {
  const [regNumber, setRegNumber] = useState('UMR-2026-0418');
  const [nik, setNik] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await axios.post('/v1/portal/login', { regNumber, nik });
      sessionStorage.setItem('safar.portal', data.data.token);
      onLogin();
    } catch (err: unknown) {
      setError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal masuk');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6" style={{ background: 'radial-gradient(circle at 30% 20%, #e7ddc9, #d5cab4)' }}>
      <form onSubmit={submit} className="w-[380px] max-w-full rounded-[24px] bg-card p-7 shadow-float">
        <div className="mb-4">
          <BackButton fallback="/login" />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-gold font-display text-[22px] text-[#20180a]">S</div>
          <div>
            <div className="font-display text-[20px] leading-none text-ink-strong">Portal Jamaah</div>
            <div className="mt-1 text-[10.5px] uppercase tracking-[1px] text-muted-3">Safar · Umrah & Haji</div>
          </div>
        </div>
        <div className="mt-5">
          <label className="lbl">Nomor Registrasi</label>
          <input className="fld font-mono" value={regNumber} onChange={(e) => setRegNumber(e.target.value)} placeholder="UMR-2026-0418" />
        </div>
        <div className="mt-3">
          <label className="lbl">NIK (16 digit)</label>
          <input className="fld font-mono" value={nik} onChange={(e) => setNik(e.target.value)} maxLength={16} placeholder="31750xxxxxxxxxxx" />
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <button type="submit" disabled={busy}
          className="mt-5 w-full cursor-pointer rounded-[10px] bg-primary py-3 text-[13.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
          {busy ? 'Memproses…' : 'Masuk Portal'}
        </button>
        <div className="mt-4 text-center text-[11px] text-muted-3">
          Nomor registrasi ada di invoice / kwitansi Anda. <Link to="/daftar" className="font-semibold text-primary">Belum terdaftar?</Link>
        </div>
        <PortalInstallButton />
      </form>
    </div>
  );
}

/* ===== App (frame ponsel + 5 tab) ===== */
function PortalApp({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('beranda');
  const qc = useQueryClient();
  const { data: d, isError } = useQuery({
    queryKey: ['portal-me'],
    queryFn: async () => (await portalApi.get('/me')).data.data as PortalData
  });
  if (isError) { onLogout(); return null; }
  if (!d) return <div className="flex min-h-screen items-center justify-center text-[13px] text-muted-2">Memuat portal…</div>;

  const dark = tab === 'beranda';

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: 'radial-gradient(circle at 30% 20%, #e7ddc9, #d5cab4)' }}>
      {/* Frame ponsel (mockup Portal Jamaah) */}
      <div className="flex h-[860px] w-[404px] max-w-full flex-col overflow-hidden rounded-[46px] border-[8px] border-[#1c1a16] bg-[#f3eee2] shadow-float">
        {/* Status bar + header */}
        <div className="flex-none px-5 pt-3" style={dark ? { background: 'linear-gradient(135deg,oklch(0.44 0.08 175),oklch(0.5 0.09 165))', color: '#fff' } : { background: '#f3eee2' }}>
          <div className="flex items-center justify-between text-[11px] font-semibold">
            <span>9:41</span>
            <span className={dark ? 'text-white/70' : 'text-muted-3'}>Safar</span>
          </div>
          <div className="flex items-center justify-between pb-3 pt-3">
            <div>
              <div className={`text-[11px] ${dark ? 'text-white/75' : 'text-muted-3'}`}>Assalamu'alaikum,</div>
              <div className="text-[16px] font-bold">{d.profile.name}</div>
            </div>
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full" style={{ background: dark ? 'rgba(255,255,255,0.15)' : '#fff' }}>
              <span className={`inline-block h-3.5 w-3.5 rounded-t-[4px] border-[1.5px] ${dark ? 'border-white/80' : 'border-[#8c8371]'}`} />
              {d.actions.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full border border-white bg-danger" />}
            </div>
          </div>
        </div>

        {/* Konten */}
        <div className="flex-1 overflow-y-auto">
          {tab === 'beranda' && <TabBeranda d={d} go={setTab} />}
          {tab === 'bayar' && <TabBayar d={d} />}
          {tab === 'dokumen' && <TabDokumen d={d} onUploaded={() => qc.invalidateQueries({ queryKey: ['portal-me'] })} />}
          {tab === 'perjalanan' && <TabPerjalanan d={d} />}
          {tab === 'profil' && <TabProfil d={d} onLogout={onLogout} />}
        </div>

        {/* Bottom nav */}
        <div className="flex flex-none border-t border-line-2 bg-card px-1 py-2">
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button key={t.key} onClick={() => setTab(t.key)} className="flex flex-1 cursor-pointer flex-col items-center gap-1 py-1">
                <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: on ? t.dot : '#d8cdb5' }} />
                <span className="text-[10px]" style={{ color: on ? '#2c281f' : '#a89e88', fontWeight: on ? 700 : 500 }}>{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ===== Tab Beranda ===== */
function TabBeranda({ d, go }: { d: PortalData; go: (t: Tab) => void }) {
  return (
    <div>
      {/* Hero countdown (lanjutan gradient header) */}
      <div className="px-5 pb-5 pt-1 text-white" style={{ background: 'linear-gradient(135deg,oklch(0.44 0.08 175),oklch(0.5 0.09 165))' }}>
        <div className="rounded-[16px] bg-white/10 p-4">
          <div className="text-[11px] uppercase tracking-[0.6px] text-white/70">Perjalanan Anda</div>
          <div className="mt-1 font-display text-[20px]">{d.trip.packageName}</div>
          <div className="text-[11.5px] text-white/85">{fmtDate(d.trip.departureDate, 'long')} · {d.trip.durationDays} hari</div>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <span className="font-mono text-[34px] font-semibold leading-none">{d.trip.daysLeft}</span>
              <span className="ml-1.5 text-[12px] text-white/85">hari lagi</span>
            </div>
            <span className="font-mono text-[10.5px] text-white/75">{d.profile.regNumber}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4">
        {/* Progress */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Dokumen', pct: d.progress.documents.pct, sub: `${d.progress.documents.verified} dari ${d.progress.documents.required} terverifikasi`, color: 'oklch(0.52 0.09 245)' },
            { label: 'Pembayaran', pct: d.progress.payment.pct, sub: `${fmtShort(d.progress.payment.paid)} / ${fmtShort(d.progress.payment.total)}`, color: 'oklch(0.56 0.11 78)' }
          ].map((p) => (
            <div key={p.label} className="rounded-[14px] border border-line bg-card p-3.5 shadow-card">
              <div className="flex justify-between text-[11.5px]"><span className="font-semibold">{p.label}</span><span className="font-mono font-bold" style={{ color: p.color }}>{p.pct}%</span></div>
              <div className="mt-2 h-[7px] overflow-hidden rounded-md bg-track"><div className="h-full" style={{ width: `${p.pct}%`, background: p.color }} /></div>
              <div className="mt-1.5 text-[10px] text-muted-3">{p.sub}</div>
            </div>
          ))}
        </div>

        {/* Perlu tindakan */}
        {d.actions.length > 0 && (
          <div className="rounded-[14px] border border-line bg-card p-3.5 shadow-card">
            <div className="mb-2.5 text-[12.5px] font-bold">Perlu Tindakan</div>
            <div className="flex flex-col gap-2">
              {d.actions.map((a, i) => (
                <button key={i} onClick={() => go(a.target as Tab)} className="flex cursor-pointer items-center gap-3 rounded-[10px] p-2.5 text-left"
                  style={{ background: a.level === 'red' ? 'oklch(0.96 0.04 30)' : 'oklch(0.96 0.04 82)' }}>
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] text-[13px] font-bold text-white"
                    style={{ background: a.level === 'red' ? 'oklch(0.55 0.15 28)' : 'oklch(0.62 0.11 78)' }}>!</span>
                  <div className="flex-1">
                    <div className="text-[12px] font-semibold">{a.title}</div>
                    <div className="text-[10.5px] text-muted-2">{a.detail}</div>
                  </div>
                  <span className="text-muted-3">›</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Aplikasi lapangan Mabrur */}
        {d.mabrur && (
          <div className="rounded-[14px] p-3.5 text-white shadow-card" style={{ background: 'linear-gradient(135deg,#8B2E2E,#6E2424)' }}>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/15 font-display text-[15px]">M</span>
              <div>
                <div className="text-[12.5px] font-bold">Aplikasi Pendamping Mabrur</div>
                <div className="text-[10px] text-white/75">Panduan ibadah, peta miqat & SOS selama di tanah suci</div>
              </div>
            </div>
            <div className="mt-2.5 rounded-[10px] bg-white/10 px-3 py-2.5 text-[11.5px]">
              <div className="flex justify-between py-0.5"><span className="text-white/75">Login (No. HP)</span><span className="font-mono font-bold">{d.mabrur.phone}</span></div>
              <div className="flex justify-between py-0.5"><span className="text-white/75">Password awal</span><span className="font-mono font-bold tracking-[2px]">{d.mabrur.initialPassword}</span></div>
            </div>
            <div className="mt-2 text-[10px] leading-relaxed text-white/75">
              Unduh aplikasi dari petugas rombongan atau <span className="font-semibold text-white">{d.mabrur.appUrl.replace('https://', '')}</span>.
              Segera ganti password setelah login pertama (menu Profil).
            </div>
          </div>
        )}

        {/* Rombongan */}
        <div className="rounded-[14px] border border-line bg-card p-3.5 shadow-card">
          <div className="mb-2.5 text-[12.5px] font-bold">Rombongan Anda</div>
          {[
            ['Rombongan', d.trip.groupName ?? 'Belum ditentukan'],
            ['Muthawwif', d.trip.muthawwif ?? '—'],
            ['Tour Leader', d.trip.tourLeader ?? '—'],
            ['Tipe Kamar', `${ROOM[d.trip.roomType]}${d.trip.roomNumber ? ` · Kamar ${d.trip.roomNumber}` : ''}`]
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-line-3 py-2 text-[12px] last:border-0">
              <span className="text-muted-2">{k}</span><span className="font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ===== Tab Bayar ===== */
function TabBayar({ d }: { d: PortalData }) {
  const p = d.payment;
  const next = p.schedules.find((s) => s.status === 'unpaid');
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        <div className="flex justify-between text-[12px]"><span className="text-muted-2">Total tagihan</span><span className="font-mono font-bold">{fmtShort(p.total)}</span></div>
        <div className="mt-1 flex justify-between text-[12px]"><span className="text-muted-2">Sudah terbayar</span><span className="font-mono font-bold text-[oklch(0.46_0.07_158)]">{fmtShort(p.paid)}</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-md bg-track"><div className="h-full bg-gold-bright" style={{ width: `${d.progress.payment.pct}%` }} /></div>
        <div className="mt-1.5 flex justify-between text-[11px]">
          <span className="text-muted-3">{d.progress.payment.pct}%</span>
          <span>Sisa <b className="font-mono">{fmtShort(p.remaining)}</b></span>
        </div>
      </div>

      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        <div className="mb-2.5 text-[12.5px] font-bold">Jadwal Termin</div>
        <div className="flex flex-col">
          {p.schedules.map((s) => {
            const overdue = s.status === 'unpaid' && s.dueDate < new Date().toISOString().slice(0, 10);
            return (
              <div key={s.termNo + s.label} className="flex items-center gap-3 border-b border-line-3 py-2.5 last:border-0">
                <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11px] font-bold"
                  style={s.status === 'paid' ? { background: 'oklch(0.46 0.07 158)', color: '#fff' } : { background: '#f0eadc', color: '#8c8371' }}>
                  {s.status === 'paid' ? '✓' : s.termNo || '•'}
                </span>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold">{s.label}</div>
                  <div className="text-[10.5px] text-muted-3">{fmtDate(s.dueDate, 'long')}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-[12px] font-bold">{fmtShort(s.amount)}</div>
                  <div className="text-[10px] font-semibold" style={{ color: s.status === 'paid' ? 'oklch(0.46 0.07 158)' : overdue ? 'oklch(0.55 0.15 28)' : 'oklch(0.5 0.1 78)' }}>
                    {s.status === 'paid' ? 'Lunas' : overdue ? 'Jatuh Tempo' : 'Terjadwal'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {next && p.vaNumber && (
        <div className="rounded-[14px] p-4 text-center text-[#20180a]" style={{ background: 'oklch(0.62 0.11 78)' }}>
          <div className="text-[13px] font-bold">Bayar {next.label} — {fmtShort(next.amount)}</div>
          <div className="mt-1 text-[11px]">BSI Virtual Account</div>
          <div className="font-mono text-[16px] font-bold tracking-wide">{p.vaNumber}</div>
          <div className="mt-1 text-[9.5px] opacity-80">a.n. PT Safar Barokah Wisata</div>
        </div>
      )}
      <div className="text-center text-[10px] leading-relaxed text-muted-3">
        Pembayaran dicatat sebagai <b>Uang Muka Jamaah</b> (amanah) hingga keberangkatan — PSAK 72.
      </div>
    </div>
  );
}

/* ===== Tab Dokumen ===== */
function TabDokumen({ d, onUploaded }: { d: PortalData; onUploaded: () => void }) {
  const [error, setError] = useState('');
  const upload = useMutation({
    mutationFn: async ({ type, file }: { type: string; file: File }) => {
      const fd = new FormData();
      fd.append('docType', type);
      fd.append('file', file);
      await axios.post(`/v1/jamaah/${d.jamaahId}/documents`, fd);
    },
    onSuccess: onUploaded,
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal mengunggah')
  });

  const STATUS: Record<string, { label: string; color: string; bg: string }> = {
    verified: { label: 'Terverifikasi', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
    pending: { label: 'Menunggu', color: 'oklch(0.48 0.03 90)', bg: '#f2ecdf' },
    rejected: { label: 'Ditolak', color: '#fff', bg: 'oklch(0.55 0.15 28)' },
    missing: { label: 'Belum diunggah', color: 'oklch(0.45 0.1 78)', bg: 'oklch(0.95 0.04 82)' }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="text-[11.5px] leading-relaxed text-muted-2">
        {d.progress.documents.verified} dari {d.progress.documents.required} dokumen wajib terverifikasi. Lengkapi sebelum keberangkatan.
      </div>
      {error && <div className="rounded-[9px] bg-danger-bg px-3 py-2 text-[11.5px] font-medium text-danger-deep">{error}</div>}
      <div className="flex flex-col gap-2">
        {d.documents.map((doc) => {
          const st = STATUS[doc.status];
          const uploadable = doc.status === 'missing' || doc.status === 'rejected';
          return (
            <label key={doc.type}
              className={`flex items-center gap-3 rounded-[12px] border border-line bg-card p-3 shadow-card ${uploadable ? 'cursor-pointer' : ''}`}>
              <span className="flex h-[30px] w-[38px] flex-none items-center justify-center rounded-[7px] text-[9px] font-bold"
                style={doc.status === 'verified' ? { background: 'oklch(0.46 0.07 158)', color: '#fff' } : { background: '#f0eadc', color: '#8c8371' }}>
                {doc.type}
              </span>
              <div className="flex-1">
                <div className="text-[12px] font-semibold">{doc.name}{doc.optional && <span className="ml-1 text-[9.5px] font-normal text-muted-4">(opsional)</span>}</div>
                <div className="text-[10px] text-muted-3">{doc.note}</div>
              </div>
              <span className="rounded-pill px-2 py-[3px] text-[9.5px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
              {uploadable && (
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                  onChange={(e) => e.target.files?.[0] && upload.mutate({ type: doc.type, file: e.target.files[0] })} />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Tab Perjalanan ===== */
function TabPerjalanan({ d }: { d: PortalData }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Penerbangan */}
      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        <div className="mb-2.5 text-[12.5px] font-bold">Penerbangan</div>
        {[
          { label: 'Keberangkatan', date: d.trip.departureDate, route: 'CGK → JED' },
          { label: 'Kepulangan', date: d.trip.returnDate, route: 'JED → CGK' }
        ].map((f) => (
          <div key={f.label} className="mb-2 flex items-center gap-3 rounded-[10px] border border-line-3 bg-panel p-3 last:mb-0">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] font-mono text-[11px] font-bold text-white" style={{ background: 'oklch(0.56 0.11 45)' }}>
              {d.trip.airlineCode ?? '✈'}
            </span>
            <div className="flex-1">
              <div className="text-[12px] font-semibold">{f.label} · {fmtDate(f.date)}</div>
              <div className="text-[10.5px] text-muted-3">{f.route} · {d.trip.airline ?? '—'}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Akomodasi */}
      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        <div className="mb-2.5 text-[12.5px] font-bold">Akomodasi</div>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[9px] font-display text-[15px] text-white" style={{ background: 'oklch(0.5 0.09 165)' }}>
            {d.trip.hotel?.[0] ?? 'H'}
          </span>
          <div>
            <div className="text-[12px] font-semibold">{d.trip.hotel ?? 'Hotel menyusul'}</div>
            <div className="text-[10.5px] text-muted-3">{d.trip.durationDays} hari · kamar {ROOM[d.trip.roomType]}</div>
          </div>
        </div>
      </div>

      {/* Checklist */}
      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        <div className="mb-2.5 text-[12.5px] font-bold">Checklist Perlengkapan</div>
        <div className="flex flex-col">
          {d.checklist.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b border-line-3 py-2 last:border-0">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-[6px] text-[10px] font-bold"
                style={c.isDone ? { background: 'oklch(0.46 0.07 158)', color: '#fff' } : { background: '#f0eadc', color: '#b0a68f' }}>
                {c.isDone ? '✓' : ''}
              </span>
              <span className="flex-1 text-[12px]">{c.item}</span>
              <span className="text-[10px] font-semibold" style={{ color: c.isDone ? 'oklch(0.46 0.07 158)' : '#a89e88' }}>
                {c.isDone ? 'Diterima' : 'Belum diambil'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Galeri foto rombongan */}
      <TabGaleri groupName={d.trip.groupName} />
    </div>
  );
}

/* ===== Galeri foto rombongan (dalam tab Perjalanan) ===== */
function TabGaleri({ groupName }: { groupName: string | null }) {
  const [lightbox, setLightbox] = useState<GalleryPhoto | null>(null);
  const [zipping, setZipping] = useState(false);
  const { data: photos, isLoading } = useQuery({
    queryKey: ['portal-gallery'],
    queryFn: async () => (await portalApi.get('/gallery')).data.data as GalleryPhoto[]
  });

  async function downloadAll() {
    setZipping(true);
    try {
      await downloadViaClient(portalApi, '/gallery.zip', 'galeri-rombongan.zip');
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="text-[12.5px] font-bold">Galeri Foto Rombongan</div>
        {photos && photos.length > 0 && (
          <button onClick={downloadAll} disabled={zipping}
            className="cursor-pointer rounded-[8px] bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white disabled:opacity-60">
            {zipping ? 'Menyiapkan…' : `⤓ Unduh Semua (${photos.length})`}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="py-6 text-center text-[11.5px] text-muted-3">Memuat galeri…</div>
      ) : !photos || photos.length === 0 ? (
        <div className="rounded-[10px] bg-panel py-7 text-center text-[11.5px] text-muted-3">
          Belum ada foto untuk rombongan {groupName ?? 'Anda'}.<br />Foto akan muncul di sini setelah dibagikan petugas.
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {photos.map((p) => (
            <button key={p.id} onClick={() => setLightbox(p)} className="relative aspect-square cursor-pointer overflow-hidden rounded-[8px]">
              <AuthImage client={portalApi} src={`/gallery/${p.id}/file`} alt={p.caption ?? 'Foto rombongan'}
                className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {lightbox && <GaleriLightbox photo={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function GaleriLightbox({ photo, onClose }: { photo: GalleryPhoto; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const ext = 'jpg';
      await downloadViaClient(portalApi, `/gallery/${photo.id}/file`, `${(photo.caption || 'foto-rombongan').replace(/[^\w-]+/g, '-')}.${ext}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <AuthImage client={portalApi} src={`/gallery/${photo.id}/file`} alt={photo.caption ?? 'Foto rombongan'}
        className="max-h-[70vh] max-w-full rounded-[12px] object-contain" style={{ background: 'transparent' }} />
      {photo.caption && <div className="mt-3 max-w-full text-center text-[12px] text-white/90">{photo.caption}</div>}
      <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
        <button onClick={save} disabled={busy}
          className="cursor-pointer rounded-[10px] bg-white px-4 py-2 text-[12.5px] font-semibold text-ink-strong disabled:opacity-60">
          {busy ? 'Mengunduh…' : '⤓ Unduh Foto'}
        </button>
        <button onClick={onClose} className="cursor-pointer rounded-[10px] border border-white/40 px-4 py-2 text-[12.5px] font-semibold text-white">Tutup</button>
      </div>
    </div>
  );
}

/* ===== Tab Profil ===== */
function TabProfil({ d, onLogout }: { d: PortalData; onLogout: () => void }) {
  const [showInvoice, setShowInvoice] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="rounded-[14px] border border-line bg-card p-4 shadow-card">
        {[
          ['Nama (paspor)', d.profile.name.toUpperCase()],
          ['No. Registrasi', d.profile.regNumber],
          ['NIK', d.profile.nik],
          ['No. Paspor', d.profile.passportNo ?? '—'],
          ['Paspor s/d', d.profile.passportExpiry ? fmtDate(d.profile.passportExpiry, 'long') : '—'],
          ['Mahram', d.profile.mahram ?? '—'],
          ['Cabang', d.profile.branch]
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line-3 py-2 text-[12px] last:border-0">
            <span className="text-muted-2">{k}</span><span className="font-semibold">{v}</span>
          </div>
        ))}
      </div>

      <div className="rounded-[14px] border border-line bg-card shadow-card">
        <button onClick={() => setShowInvoice(true)} className="flex w-full cursor-pointer items-center justify-between border-b border-line-3 px-4 py-3 text-[12.5px] font-semibold">
          Unduh invoice & kwitansi <span className="text-muted-3">›</span>
        </button>
        <div className="px-4 py-3 text-[11px] text-muted-3">
          Bantuan & CS: 0811-2200-345 · info@safarwisata.co.id
        </div>
      </div>

      <button onClick={onLogout} className="cursor-pointer rounded-[12px] border border-[oklch(0.85_0.08_30)] bg-danger-bg py-3 text-[12.5px] font-bold text-danger-deep">
        Keluar
      </button>

      {showInvoice && <PortalInvoiceSheet d={d} onClose={() => setShowInvoice(false)} />}
    </div>
  );
}

/* ===== Sheet ringkasan invoice + kwitansi (portal) ===== */
function PortalInvoiceSheet({ d, onClose }: { d: PortalData; onClose: () => void }) {
  const { data: inv } = useQuery({
    queryKey: ['portal-invoice'],
    queryFn: async () => (await portalApi.get('/invoice-document')).data.data as {
      number: string; vaNumber: string; subtotal: number; paid: number; remaining: number;
      items: { description: string; amount: number }[];
    }
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[80vh] w-[404px] max-w-full overflow-y-auto rounded-t-[24px] bg-card p-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-2" />
        <div className="font-display text-[17px] text-ink-strong">Invoice & Kwitansi</div>
        {inv ? (
          <>
            <div className="mt-3 rounded-[12px] border border-line-3 bg-panel p-3.5 text-[12px]">
              <div className="flex justify-between"><span className="text-muted-2">Invoice</span><span className="font-mono font-semibold">{inv.number}</span></div>
              {inv.items.map((it) => (
                <div key={it.description} className="mt-1 flex justify-between"><span>{it.description}</span><span className="font-mono">{fmtFull(it.amount)}</span></div>
              ))}
              <div className="mt-2 flex justify-between border-t border-line-2 pt-2"><span className="font-semibold">Sisa tagihan</span><span className="font-mono font-bold text-danger-deep">{fmtFull(inv.remaining)}</span></div>
              <div className="mt-2 text-[10.5px] text-muted-3">VA BSI: <span className="font-mono font-semibold">{inv.vaNumber}</span></div>
            </div>
            <div className="mt-3 text-[12.5px] font-semibold">Kwitansi</div>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {d.payment.receipts.map((r) => (
                <div key={r.id} className="flex justify-between rounded-[9px] border border-line-3 px-3 py-2 text-[11.5px]">
                  <span className="font-mono">{r.number}</span>
                  <span className="text-muted-3">{fmtDate(r.issued_date)}</span>
                  <span className="font-mono font-semibold">{fmtShort(Number(r.amount))}</span>
                </div>
              ))}
              {d.payment.receipts.length === 0 && <div className="text-[11px] text-muted-3">Belum ada kwitansi.</div>}
            </div>
            <div className="mt-3 text-[10px] leading-relaxed text-muted-3">
              Cetakan resmi (A4) dapat diminta ke kantor cabang, atau unduh dari staf keuangan.
            </div>
          </>
        ) : (
          <div className="mt-4 text-[12px] text-muted-2">Memuat…</div>
        )}
        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-[10px] border border-line-2 py-2.5 text-[12.5px] font-semibold text-muted">Tutup</button>
      </div>
    </div>
  );
}
