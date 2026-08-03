import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtShort, fmtFull, fmtDate } from '../../utils/format';
import { useInstallPrompt, setManifestForRoute } from '../../pwa';

/* ===== API portal agen (token terpisah dari staf & portal jamaah) ===== */
const agenApi = axios.create({ baseURL: '/v1/portal-agen' });
agenApi.interceptors.request.use((c) => {
  const t = sessionStorage.getItem('safar.agen');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

const REG_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending_documents: { label: 'Dokumen', color: 'oklch(0.5 0.1 78)', bg: 'oklch(0.96 0.04 78)' },
  active: { label: 'Aktif', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  completed: { label: 'Selesai', color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  cancelled: { label: 'Batal', color: 'oklch(0.5 0.13 28)', bg: 'oklch(0.96 0.04 28)' }
};
const COMM_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'Menunggu', color: 'oklch(0.5 0.1 78)', bg: 'oklch(0.96 0.04 78)' },
  approved: { label: 'Disetujui', color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  paid: { label: 'Dibayar', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' }
};

type Tab = 'ringkasan' | 'jamaah' | 'komisi' | 'leads' | 'notif' | 'profil';

const NOTIF_ICON: Record<string, { icon: string; bg: string }> = {
  commission_paid: { icon: '💰', bg: 'oklch(0.95 0.03 158)' },
  commission_approved: { icon: '✅', bg: 'oklch(0.95 0.03 245)' },
  referral_registered: { icon: '🧑', bg: 'oklch(0.96 0.04 78)' },
  registration_active: { icon: '📄', bg: 'oklch(0.95 0.03 158)' }
};

export function AgenPortalPage() {
  const [authed, setAuthed] = useState(Boolean(sessionStorage.getItem('safar.agen')));
  const [mustChange, setMustChange] = useState(false);
  useEffect(() => setManifestForRoute('/portal-agen'), []);

  if (!authed) return <LoginScreen onLogin={(mc) => { setMustChange(mc); setAuthed(true); }} />;
  if (mustChange) return <ChangePassword forced onDone={() => setMustChange(false)} onLogout={() => { sessionStorage.removeItem('safar.agen'); setAuthed(false); }} />;
  return <Dashboard onLogout={() => { sessionStorage.removeItem('safar.agen'); setAuthed(false); }} />;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#efe8da]">
      <div className="mx-auto max-w-[480px] px-4 py-6">{children}</div>
    </div>
  );
}

function InstallButton({ variant = 'full' }: { variant?: 'full' | 'compact' }) {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  if (variant === 'compact') {
    return <button onClick={install} className="cursor-pointer rounded-[8px] border border-[#e6ddca] bg-white px-3 py-1.5 text-[11px] font-semibold text-[oklch(0.5_0.09_165)]">⤓ Pasang</button>;
  }
  return (
    <button onClick={install} className="mt-3 w-full cursor-pointer rounded-[9px] border border-[oklch(0.5_0.09_165)] bg-white px-4 py-2 text-[12.5px] font-semibold text-[oklch(0.5_0.09_165)]">
      ⤓ Pasang aplikasi di layar utama
    </button>
  );
}

function LoginScreen({ onLogin }: { onLogin: (mustChange: boolean) => void }) {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { data } = await axios.post('/v1/portal-agen/login', { phone, password });
      sessionStorage.setItem('safar.agen', data.data.token);
      onLogin(Boolean(data.data.mustChangePassword));
    } catch (err) {
      setError((err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal masuk');
    } finally { setBusy(false); }
  }

  return (
    <Shell>
      <div className="mt-10 rounded-[15px] bg-[#fffdf8] p-6 shadow-[0_4px_16px_-10px_rgba(60,50,20,0.3)]">
        <div className="mb-1 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-[9px] bg-[oklch(0.56_0.11_78)] font-display text-[16px] text-white">S</div>
          <div>
            <div className="font-display text-[17px] text-[#26221b] leading-none">Safar — Portal Agen</div>
            <div className="text-[10.5px] uppercase tracking-[1px] text-[#9a917d]">Mitra & Referral</div>
          </div>
        </div>
        <p className="mb-4 mt-2 text-[12px] text-[#6f6858]">Masuk dengan nomor HP & password yang diberikan kantor Safar.</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div><label className="lbl">Nomor HP</label><input className="fld font-mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="08xxxxxxxxxx" /></div>
          <div><label className="lbl">Password</label><input type="password" className="fld" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <div className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
          <button disabled={busy || !phone || !password} className="mt-1 cursor-pointer rounded-[9px] bg-[oklch(0.5_0.09_165)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">
            {busy ? 'Masuk…' : 'Masuk'}
          </button>
        </form>
        <div className="mt-4 text-[10.5px] text-[#9a917d]">Belum punya akses? Hubungi tim Marketing Safar untuk mengaktifkan portal agen Anda.</div>
        <InstallButton />
      </div>
    </Shell>
  );
}

function ChangePassword({ forced, onDone, onLogout }: { forced?: boolean; onDone: () => void; onLogout: () => void }) {
  const [oldPassword, setOld] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => agenApi.post('/change-password', { oldPassword, newPassword }),
    onSuccess: onDone,
    onError: (e) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal mengganti password')
  });
  const valid = oldPassword && newPassword.length >= 8 && newPassword === confirm;
  return (
    <Shell>
      <div className="mt-10 rounded-[15px] bg-[#fffdf8] p-6 shadow-[0_4px_16px_-10px_rgba(60,50,20,0.3)]">
        <div className="font-display text-[17px] text-[#26221b]">Ganti Password</div>
        {forced && <p className="mb-3 mt-1 text-[12px] text-[oklch(0.5_0.1_78)]">Untuk keamanan, ganti password awal Anda sebelum melanjutkan.</p>}
        <div className="mt-3 flex flex-col gap-3">
          <div><label className="lbl">Password lama</label><input type="password" className="fld" value={oldPassword} onChange={(e) => setOld(e.target.value)} /></div>
          <div><label className="lbl">Password baru (min 8 karakter)</label><input type="password" className="fld" value={newPassword} onChange={(e) => setNew(e.target.value)} /></div>
          <div><label className="lbl">Ulangi password baru</label><input type="password" className="fld" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          {error && <div className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
          <button disabled={!valid || save.isPending} onClick={() => save.mutate()} className="cursor-pointer rounded-[9px] bg-[oklch(0.5_0.09_165)] px-4 py-2.5 text-[13px] font-semibold text-white disabled:opacity-60">
            {save.isPending ? 'Menyimpan…' : 'Simpan Password'}
          </button>
          {forced && <button onClick={onLogout} className="cursor-pointer text-[11.5px] text-[#9a917d] hover:underline">Keluar</button>}
        </div>
      </div>
    </Shell>
  );
}

interface Me { name: string; code: string; referralCode: string; commissionPct: number; phone: string | null; email: string | null }
interface Summary { totalReferrals: number; activeReferrals: number; commissionPending: number; commissionApproved: number; commissionPaid: number; unreadNotifications: number }
interface NotifRow { id: string; type: string; title: string; body: string; readAt: string | null; createdAt: string }
interface JamaahRow { regNumber: string; jamaahName: string; packageName: string; departureDate: string; status: string; paymentPct: number }
interface CommRow { baseAmount: number; pct: number; amount: number; status: string; jamaahName: string; regNumber: string | null; paidAt: string | null; createdAt: string }
interface LeadRow { name: string; phone: string | null; source: string; status: string; createdAt: string }

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('ringkasan');
  const me = useQuery({ queryKey: ['agen-me'], queryFn: async () => (await agenApi.get('/me')).data.data as Me });
  const { data: summary } = useQuery({ queryKey: ['agen-summary'], queryFn: async () => (await agenApi.get('/summary')).data.data as Summary });
  const unread = summary?.unreadNotifications ?? 0;
  const label = (t: Tab) => (t === 'jamaah' ? 'Jamaah Saya' : t === 'notif' ? 'Notifikasi' : t);

  return (
    <Shell>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="font-display text-[18px] text-[#26221b] leading-tight">{me.data?.name ?? 'Portal Agen'}</div>
          <div className="text-[11px] text-[#6f6858]">Kode referral: <b className="font-mono">{me.data?.referralCode ?? '—'}</b> · komisi {me.data?.commissionPct ?? '—'}%</div>
        </div>
        <div className="flex items-center gap-2">
          <InstallButton variant="compact" />
          <button onClick={onLogout} className="cursor-pointer rounded-[8px] border border-[#e6ddca] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#6f6858]">Keluar</button>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto">
        {(['ringkasan', 'jamaah', 'komisi', 'leads', 'notif', 'profil'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="relative cursor-pointer whitespace-nowrap rounded-pill px-3 py-1.5 text-[12px] font-semibold capitalize"
            style={tab === t ? { background: 'oklch(0.5 0.09 165)', color: '#fff' } : { background: '#fffdf8', color: '#6f6858', border: '1px solid #e6ddca' }}>
            {label(t)}
            {t === 'notif' && unread > 0 && (
              <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[oklch(0.55_0.15_28)] px-1 text-[9px] font-bold text-white">{unread}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'ringkasan' && <RingkasanTab />}
      {tab === 'jamaah' && <JamaahTab />}
      {tab === 'komisi' && <KomisiTab />}
      {tab === 'leads' && <LeadsTab />}
      {tab === 'notif' && <NotifTab />}
      {tab === 'profil' && <ProfilTab me={me.data} />}
    </Shell>
  );
}

function NotifTab() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['agen-notif'], queryFn: async () => (await agenApi.get('/notifications')).data.data as NotifRow[] });
  // Tandai semua notifikasi terbaca saat tab dibuka → badge hilang
  useEffect(() => {
    agenApi.post('/notifications/read').then(() => qc.invalidateQueries({ queryKey: ['agen-summary'] })).catch(() => {});
  }, [qc]);
  if (!data) return <div className="text-[12px] text-[#8c8371]">Memuat…</div>;
  if (data.length === 0) return <Card><div className="text-[12px] text-[#8c8371]">Belum ada notifikasi.</div></Card>;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((n) => (
        <Card key={n.id}>
          <div className="flex items-start gap-2.5">
            <div className="mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full" style={{ background: NOTIF_ICON[n.type]?.bg ?? '#eee9dc' }}>
              {NOTIF_ICON[n.type]?.icon ?? '🔔'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-semibold text-[#26221b]">{n.title}</span>
                {!n.readAt && <span className="h-1.5 w-1.5 rounded-full bg-[oklch(0.55_0.15_28)]" />}
              </div>
              <div className="text-[11.5px] text-[#6f6858]">{n.body}</div>
              <div className="mt-0.5 text-[9.5px] text-[#a89e88]">{fmtDate(String(n.createdAt).slice(0, 10))}</div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-[13px] border border-[#e9e0cd] bg-[#fffdf8] p-4 shadow-[0_4px_16px_-12px_rgba(60,50,20,0.3)]">{children}</div>;
}

function RingkasanTab() {
  const { data: s } = useQuery({ queryKey: ['agen-summary'], queryFn: async () => (await agenApi.get('/summary')).data.data as Summary });
  if (!s) return <div className="text-[12px] text-[#8c8371]">Memuat…</div>;
  const tiles = [
    { label: 'Jamaah Referral', value: String(s.totalReferrals), sub: `${s.activeReferrals} aktif/berangkat`, accent: 'oklch(0.52 0.09 245)' },
    { label: 'Komisi Dibayar', value: fmtShort(s.commissionPaid), sub: 'sudah cair', accent: 'oklch(0.46 0.07 158)' },
    { label: 'Komisi Terutang', value: fmtShort(s.commissionApproved), sub: 'disetujui, menunggu bayar', accent: 'oklch(0.56 0.11 78)' },
    { label: 'Komisi Pending', value: fmtShort(s.commissionPending), sub: 'menunggu persetujuan', accent: 'oklch(0.5 0.02 265)' }
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-[13px] border border-[#e9e0cd] bg-[#fffdf8] p-3.5 shadow-[0_4px_16px_-12px_rgba(60,50,20,0.3)]" style={{ borderLeft: `4px solid ${t.accent}` }}>
          <div className="text-[10.5px] text-[#8c8371]">{t.label}</div>
          <div className="mt-1 font-mono text-[18px] font-semibold text-[#26221b]">{t.value}</div>
          <div className="text-[9.5px] text-[#a89e88]">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function JamaahTab() {
  const { data } = useQuery({ queryKey: ['agen-jamaah'], queryFn: async () => (await agenApi.get('/jamaah')).data.data as JamaahRow[] });
  if (!data) return <div className="text-[12px] text-[#8c8371]">Memuat…</div>;
  if (data.length === 0) return <Card><div className="text-[12px] text-[#8c8371]">Belum ada jamaah dari referral Anda.</div></Card>;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((r) => {
        const st = REG_STATUS[r.status] ?? { label: r.status, color: '#6f6858', bg: '#eee9dc' };
        return (
          <Card key={r.regNumber}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[13px] font-semibold text-[#26221b]">{r.jamaahName}</div>
                <div className="text-[11px] text-[#6f6858]">{r.packageName} · {fmtDate(String(r.departureDate).slice(0, 10))}</div>
                <div className="mt-0.5 font-mono text-[10px] text-[#a89e88]">{r.regNumber}</div>
              </div>
              <span className="rounded-pill px-2 py-[2px] text-[9.5px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
            </div>
            <div className="mt-2">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#efe8da]">
                <div className="h-full rounded-full" style={{ width: `${r.paymentPct}%`, background: 'oklch(0.5 0.09 165)' }} />
              </div>
              <div className="mt-1 text-[10px] text-[#8c8371]">Pembayaran {r.paymentPct}%</div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function KomisiTab() {
  const { data } = useQuery({ queryKey: ['agen-komisi'], queryFn: async () => (await agenApi.get('/commissions')).data.data as CommRow[] });
  if (!data) return <div className="text-[12px] text-[#8c8371]">Memuat…</div>;
  if (data.length === 0) return <Card><div className="text-[12px] text-[#8c8371]">Belum ada komisi.</div></Card>;
  return (
    <div className="flex flex-col gap-2.5">
      {data.map((c, i) => {
        const st = COMM_STATUS[c.status] ?? { label: c.status, color: '#6f6858', bg: '#eee9dc' };
        return (
          <Card key={i}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12.5px] font-semibold text-[#26221b]">{c.jamaahName}</div>
                <div className="text-[10.5px] text-[#8c8371]">{c.pct}% × {fmtShort(c.baseAmount)}{c.regNumber ? ` · ${c.regNumber}` : ''}</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[14px] font-bold text-[#26221b]">{fmtFull(c.amount)}</div>
                <span className="rounded-pill px-2 py-[1px] text-[9px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function LeadsTab() {
  const { data, refetch } = useQuery({ queryKey: ['agen-leads'], queryFn: async () => (await agenApi.get('/leads')).data.data as LeadRow[] });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');
  const add = useMutation({
    mutationFn: async () => agenApi.post('/leads', { name, phone: phone || null }),
    onSuccess: () => { setName(''); setPhone(''); setError(''); refetch(); },
    onError: (e) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menambah')
  });
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="mb-2 text-[12.5px] font-semibold text-[#26221b]">Tambah Prospek</div>
        <div className="flex flex-col gap-2">
          <input className="fld" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama prospek" />
          <input className="fld font-mono" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="No. HP (opsional)" />
          {error && <div className="text-[11px] font-medium text-danger-deep">{error}</div>}
          <button disabled={name.trim().length < 2 || add.isPending} onClick={() => add.mutate()}
            className="cursor-pointer rounded-[9px] bg-[oklch(0.5_0.09_165)] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {add.isPending ? 'Menyimpan…' : 'Kirim ke Marketing'}
          </button>
        </div>
      </Card>
      {data && data.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.map((l, i) => (
            <Card key={i}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[12.5px] font-semibold text-[#26221b]">{l.name}</div>
                  <div className="font-mono text-[10.5px] text-[#8c8371]">{l.phone ?? '—'}</div>
                </div>
                <span className="rounded-pill bg-[#eee9dc] px-2 py-[2px] text-[9.5px] font-semibold capitalize text-[#6f6858]">{l.status}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfilTab({ me }: { me?: Me }) {
  const [showChange, setShowChange] = useState(false);
  if (showChange) return <ChangePassword onDone={() => setShowChange(false)} onLogout={() => setShowChange(false)} />;
  return (
    <Card>
      <div className="flex flex-col gap-2 text-[12.5px]">
        <Row label="Nama" value={me?.name} />
        <Row label="Kode agen" value={me?.code} mono />
        <Row label="Kode referral" value={me?.referralCode} mono />
        <Row label="Komisi" value={me ? `${me.commissionPct}%` : ''} />
        <Row label="HP" value={me?.phone ?? '—'} mono />
        <Row label="Email" value={me?.email ?? '—'} />
      </div>
      <button onClick={() => setShowChange(true)} className="mt-4 cursor-pointer rounded-[9px] border border-[#e6ddca] bg-white px-4 py-2 text-[12px] font-semibold text-[#6f6858]">Ganti Password</button>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b border-[#f6f1e6] py-1 last:border-0">
      <span className="text-[#8c8371]">{label}</span>
      <span className={mono ? 'font-mono font-medium text-[#26221b]' : 'font-medium text-[#26221b]'}>{value ?? '—'}</span>
    </div>
  );
}
