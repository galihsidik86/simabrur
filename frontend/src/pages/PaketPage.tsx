import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtShort, fmtDate } from '../utils/format';

interface PaketRow {
  id: string;
  code: string;
  name: string;
  type: 'umrah' | 'haji';
  category: string;
  durationDays: number;
  basePrice: number;
  hotel: string | null;
  airline: string | null;
  isActive: boolean;
  departure: { id: string; date: string; quota: number; seatsTaken: number; seatsLeft: number; status: string } | null;
}

/** Gradient header kartu — persis nilai mockup, keyed per kode paket seed. */
const GRADIENTS: Record<string, string> = {
  'UMR-REG-9': 'linear-gradient(135deg,oklch(0.5 0.09 165),oklch(0.42 0.08 175))',
  'UMR-PLUS-TR': 'linear-gradient(135deg,oklch(0.52 0.09 245),oklch(0.44 0.08 255))',
  'UMR-VIP-12': 'linear-gradient(135deg,oklch(0.50 0.10 322),oklch(0.42 0.09 330))',
  'HAJ-FURODA-27': 'linear-gradient(135deg,oklch(0.46 0.07 158),oklch(0.4 0.06 165))',
  'UMR-PLUS-AQ': 'linear-gradient(135deg,oklch(0.56 0.11 45),oklch(0.48 0.10 40))',
  'UMR-REG-AT': 'linear-gradient(135deg,oklch(0.56 0.09 78),oklch(0.5 0.09 88))'
};
const CATEGORY_GRADIENT: Record<string, string> = {
  reguler: GRADIENTS['UMR-REG-9'],
  plus: GRADIENTS['UMR-PLUS-TR'],
  vip: GRADIENTS['UMR-VIP-12'],
  khusus: GRADIENTS['HAJ-FURODA-27']
};

const CATEGORY_LABEL: Record<string, string> = { reguler: 'Reguler', plus: 'Plus', vip: 'VIP', khusus: 'Khusus' };
// Kategori baru dari Master Data: label kapitalisasi kode, gradient default hijau
const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);
const DEFAULT_GRADIENT = GRADIENTS['UMR-REG-9'];

function paketStatus(p: PaketRow): { label: string; color: string } {
  if (!p.isActive || p.departure?.status === 'closed') return { label: 'Ditutup', color: 'oklch(0.5 0.15 28)' };
  if (!p.departure) return { label: 'Belum Ada Jadwal', color: '#8c8371' };
  const ratio = p.departure.seatsTaken / p.departure.quota;
  if (ratio >= 1) return { label: 'Penuh', color: 'oklch(0.5 0.15 28)' };
  if (ratio >= 0.8) return { label: 'Hampir Penuh', color: 'oklch(0.45 0.12 55)' };
  return { label: 'Terbuka', color: 'oklch(0.42 0.07 158)' };
}

const TABS = [
  { key: 'semua', label: 'Semua' },
  { key: 'umrah', label: 'Umrah' },
  { key: 'haji', label: 'Haji' },
  { key: 'ditutup', label: 'Ditutup' }
] as const;

export function PaketPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<string>('semua');
  const [showForm, setShowForm] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['packages'],
    queryFn: async () => (await api.get('/packages')).data.data as PaketRow[]
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    if (tab === 'umrah' || tab === 'haji') return all.filter((p) => p.type === tab);
    if (tab === 'ditutup') return all.filter((p) => paketStatus(p).label === 'Ditutup' || paketStatus(p).label === 'Penuh');
    return all;
  }, [data, tab]);

  const canManage = user && ['admin', 'marketing'].includes(user.role);

  return (
    <div>
      <div className="mb-[18px] flex items-center justify-between">
        <div className="flex gap-2">
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
        </div>
        {canManage && (
          <button
            onClick={() => setShowForm(true)}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-[9px] text-[13px] font-semibold text-white hover:bg-primary-deep"
          >
            + Tambah Paket
          </button>
        )}
      </div>

      {isLoading && <div className="text-[12.5px] text-muted-2">Memuat paket…</div>}

      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1">
        {rows.map((p) => {
          const st = paketStatus(p);
          const pct = p.departure ? Math.round((p.departure.seatsTaken / p.departure.quota) * 100) : 0;
          const barColor = pct >= 100 ? 'oklch(0.55 0.15 28)' : pct >= 80 ? 'oklch(0.62 0.11 78)' : 'oklch(0.5 0.09 165)';
          return (
            <div key={p.id} className="overflow-hidden rounded-card border border-line bg-card shadow-card">
              <div
                className="relative flex h-24 items-end p-4"
                style={{ background: GRADIENTS[p.code] ?? CATEGORY_GRADIENT[p.category] ?? DEFAULT_GRADIENT }}
              >
                <span
                  className="absolute right-3 top-3 rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold"
                  style={{ color: st.color, background: 'rgba(255,255,255,0.92)' }}
                >
                  {st.label}
                </span>
                <div>
                  <div className="text-[10px] uppercase tracking-[1px] text-white/85">
                    {p.type === 'haji' ? 'Haji' : 'Umrah'} {categoryLabel(p.category)}
                  </div>
                  <div className="font-display text-[19px] text-white">{p.name}</div>
                </div>
              </div>
              <div className="p-4">
                <div className="font-mono text-xl font-semibold text-ink-strong">{fmtShort(p.basePrice)}</div>
                <div className="mb-3 text-[11px] text-muted-4">/ jamaah · {p.durationDays} hari</div>
                <div className="flex flex-col gap-1.5 text-[11.5px] text-muted">
                  <div className="flex justify-between"><span className="text-muted-4">Hotel</span><span className="font-medium">{p.hotel ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-4">Maskapai</span><span className="font-medium">{p.airline ?? '—'}</span></div>
                  <div className="flex justify-between">
                    <span className="text-muted-4">Keberangkatan</span>
                    <span className="font-medium">{p.departure ? fmtDate(p.departure.date) : '—'}</span>
                  </div>
                </div>
                {p.departure && (
                  <div className="mt-[13px] border-t border-line-3 pt-[13px]">
                    <div className="mb-[5px] flex justify-between text-[11px]">
                      <span className="text-muted-4">Kuota terisi</span>
                      <span className="font-mono font-semibold">{p.departure.seatsTaken} / {p.departure.quota}</span>
                    </div>
                    <div className="h-[7px] overflow-hidden rounded-md bg-track">
                      <div className="h-full" style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {showForm && <PaketFormModal onClose={() => setShowForm(false)} />}
    </div>
  );
}

// ===== Form Tambah Paket (screen baru — mengikuti design system, tidak ada di mockup) =====
function PaketFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: hotels } = useQuery({ queryKey: ['hotels'], queryFn: async () => (await api.get('/hotels')).data.data as { id: string; name: string; star: number }[] });
  const { data: airlines } = useQuery({ queryKey: ['airlines'], queryFn: async () => (await api.get('/airlines')).data.data as { id: string; name: string }[] });
  const { data: categories } = useQuery({
    queryKey: ['package-categories'],
    queryFn: async () => (await api.get('/package-categories')).data.data as { id: string; code: string; label: string }[]
  });

  const [f, setF] = useState({
    code: '', name: '', type: 'umrah', category: 'reguler', durationDays: 9,
    basePrice: 30000000, hotelId: '', airlineId: '', departureDate: '', quota: 40
  });
  const [error, setError] = useState('');

  const create = useMutation({
    mutationFn: async () =>
      api.post('/packages', {
        code: f.code, name: f.name, type: f.type, category: f.category,
        durationDays: Number(f.durationDays), basePrice: Number(f.basePrice),
        hotelId: f.hotelId || null, airlineId: f.airlineId || null,
        departure: f.departureDate ? { departureDate: f.departureDate, quota: Number(f.quota) } : null
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packages'] });
      onClose();
    },
    onError: (e: unknown) =>
      setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Tambah Paket</div>
        <div className="mt-4 grid grid-cols-2 gap-3.5">
          <div><label className="lbl">Kode Paket</label><input className="fld" value={f.code} onChange={set('code')} placeholder="UMR-XXX-9" required /></div>
          <div><label className="lbl">Nama Paket</label><input className="fld" value={f.name} onChange={set('name')} placeholder="Reguler 9 Hari" required /></div>
          <div><label className="lbl">Jenis</label>
            <select className="fld" value={f.type} onChange={set('type')}><option value="umrah">Umrah</option><option value="haji">Haji</option></select></div>
          <div><label className="lbl">Kategori</label>
            <select className="fld" value={f.category} onChange={set('category')}>
              {(categories ?? [{ id: '0', code: 'reguler', label: 'Reguler' }]).map((c) => (
                <option key={c.id} value={c.code}>{c.label}</option>
              ))}
            </select></div>
          <div><label className="lbl">Durasi (hari)</label><input type="number" min={1} className="fld" value={f.durationDays} onChange={set('durationDays')} required /></div>
          <div><label className="lbl">Harga Dasar (Rp)</label><input type="number" min={0} className="fld" value={f.basePrice} onChange={set('basePrice')} required /></div>
          <div><label className="lbl">Hotel</label>
            <select className="fld" value={f.hotelId} onChange={set('hotelId')}>
              <option value="">— pilih —</option>
              {hotels?.map((h) => <option key={h.id} value={h.id}>{h.name} ⭐{h.star}</option>)}
            </select></div>
          <div><label className="lbl">Maskapai</label>
            <select className="fld" value={f.airlineId} onChange={set('airlineId')}>
              <option value="">— pilih —</option>
              {airlines?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></div>
          <div><label className="lbl">Tgl Keberangkatan Pertama</label><input type="date" className="fld" value={f.departureDate} onChange={set('departureDate')} /></div>
          <div><label className="lbl">Kuota</label><input type="number" min={1} className="fld" value={f.quota} onChange={set('quota')} /></div>
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
          <button type="submit" disabled={create.isPending} className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
            {create.isPending ? 'Menyimpan…' : 'Simpan Paket'}
          </button>
        </div>
      </form>
    </div>
  );
}
