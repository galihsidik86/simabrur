import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtDate } from '../utils/format';

interface Departure { id: string; departure_date: string; package_name: string }
interface ManifestRow {
  registrationId: string; regNumber: string; name: string;
  passportNo: string | null; passportExpiry: string | null; passportExpiringSoon: boolean;
  groupName: string | null;
  visa: { status: 'process' | 'biometric' | 'issued'; visaNo: string | null };
  ticket: { pnr: string | null; seat: string | null; status: string };
  room: string;
}
interface Manifest {
  departure: { id: string; packageName: string; departureDate: string; quota: number; seatsTaken: number };
  manifestStatus: string;
  groups: { id: string; name: string; muthawwif: string[]; tourLeader: string[] }[];
  rows: ManifestRow[];
}

const VISA_PILL: Record<string, { label: string; color: string; bg: string }> = {
  issued: { label: 'Terbit', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  process: { label: 'Proses', color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  biometric: { label: 'Biometrik', color: 'oklch(0.45 0.1 78)', bg: 'oklch(0.95 0.04 82)' }
};

export function OperasionalPage() {
  const { user } = useAuth();
  const [depId, setDepId] = useState<string>('');
  const [edit, setEdit] = useState<ManifestRow | null>(null);

  const { data: departures } = useQuery({
    queryKey: ['departures-list'],
    queryFn: async () => (await api.get('/departures')).data.data as Departure[]
  });
  const selected = depId || departures?.[0]?.id || '';

  const { data: m } = useQuery({
    queryKey: ['manifest', selected],
    enabled: Boolean(selected),
    queryFn: async () => (await api.get(`/departures/${selected}/manifest`)).data.data as Manifest
  });

  const canEdit = user && ['admin', 'operasional'].includes(user.role);
  const staffLine = m?.groups.length
    ? `Rombongan: ${m.groups.map((g) => g.name.replace('Grup ', '')).join(' & ')}` +
      ` · Muthawwif: ${[...new Set(m.groups.flatMap((g) => g.muthawwif))].join(', ') || '—'}` +
      ` · TL: ${[...new Set(m.groups.flatMap((g) => g.tourLeader))].join(', ') || '—'}`
    : 'Belum ada rombongan';

  return (
    <div>
      <div className="mb-[18px] flex items-center gap-3">
        <span className="text-[12.5px] text-muted-3">Keberangkatan:</span>
        <select className="fld !w-auto !py-2 text-[13px] font-semibold" value={selected} onChange={(e) => setDepId(e.target.value)}>
          {departures?.map((d) => (
            <option key={d.id} value={d.id}>{d.package_name} — {fmtDate(d.departure_date)}</option>
          ))}
        </select>
        {m && (
          <span
            className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold"
            style={m.manifestStatus === 'ready'
              ? { color: 'oklch(0.42 0.07 158)', background: 'oklch(0.95 0.03 158)' }
              : { color: '#8c8371', background: '#f2ecdf' }}
          >
            Manifest {m.manifestStatus === 'ready' ? 'Siap' : m.manifestStatus === 'sent' ? 'Terkirim' : 'Draft'}
          </span>
        )}
        <span className="ml-auto text-[11.5px] text-muted">
          {staffLine.split(' · ').map((part, i) => {
            const [k, v] = part.split(': ');
            return <span key={i}>{i > 0 && ' · '}{v ? <>{k}: <b>{v}</b></> : part}</span>;
          })}
        </span>
      </div>

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line-3 px-5 py-4 text-[14px] font-semibold">
          Manifest Keberangkatan <span className="text-[11px] font-normal text-muted-4">— data untuk pengajuan visa & maskapai</span>
        </div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Jamaah</th>
              <th className="px-3 py-[11px] font-semibold">No. Paspor</th>
              <th className="px-3 py-[11px] font-semibold">Berlaku s/d</th>
              <th className="px-3 py-[11px] font-semibold">Visa</th>
              <th className="px-3 py-[11px] font-semibold">Tiket</th>
              <th className="px-3 py-[11px] font-semibold">Kamar</th>
              {canEdit && <th className="px-5 py-[11px] font-semibold">Aksi</th>}
            </tr>
          </thead>
          <tbody>
            {m?.rows.map((r) => {
              const pill = VISA_PILL[r.visa.status];
              return (
                <tr key={r.registrationId} className="border-t border-line-3 hover:bg-panel">
                  <td className="px-5 py-3 font-semibold">{r.name}
                    <div className="font-mono text-[10px] font-normal text-muted-4">{r.regNumber}{r.groupName ? ` · ${r.groupName}` : ''}</div>
                  </td>
                  <td className="px-3 py-3 font-mono text-muted">{r.passportNo ?? '—'}</td>
                  <td className="px-3 py-3" style={{ color: r.passportExpiringSoon ? 'oklch(0.5 0.13 28)' : '#6f6858' }}>
                    {r.passportExpiry ? fmtDate(r.passportExpiry) : '—'}
                    {r.passportExpiringSoon && <span className="ml-1 text-[10px] font-semibold">⚠ perpanjang</span>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold" style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
                  </td>
                  <td className="px-3 py-3 font-mono text-muted">{r.ticket.pnr ?? '—'}</td>
                  <td className="px-3 py-3">{r.room}</td>
                  {canEdit && (
                    <td className="px-5 py-3">
                      <button onClick={() => setEdit(r)} className="cursor-pointer rounded-[7px] border border-line-2 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-muted hover:bg-panel">
                        Ubah
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {m && m.rows.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-6 text-muted-2">Belum ada jamaah pada keberangkatan ini.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {edit && <EditOpsModal row={edit} departureId={selected} onClose={() => setEdit(null)} />}
    </div>
  );
}

/* ===== Modal ubah visa/tiket (screen baru — gap, mengikuti design system) ===== */
function EditOpsModal({ row, departureId, onClose }: { row: ManifestRow; departureId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [visaStatus, setVisaStatus] = useState(row.visa.status);
  const [visaNo, setVisaNo] = useState(row.visa.visaNo ?? '');
  const [pnr, setPnr] = useState(row.ticket.pnr ?? '');
  const [seat, setSeat] = useState(row.ticket.seat ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      await api.post('/visas', { registrationId: row.registrationId, status: visaStatus, visaNo: visaNo || null });
      if (pnr) await api.post('/tickets', { registrationId: row.registrationId, pnr, seat: seat || null });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manifest', departureId] });
      onClose();
    },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[440px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Visa & Tiket</div>
        <div className="mt-0.5 text-[12px] text-muted-2">{row.name} · <span className="font-mono">{row.regNumber}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="lbl">Status Visa</label>
            <select className="fld" value={visaStatus} onChange={(e) => setVisaStatus(e.target.value as typeof visaStatus)}>
              <option value="process">Proses</option>
              <option value="biometric">Biometrik</option>
              <option value="issued">Terbit</option>
            </select>
          </div>
          <div><label className="lbl">No. Visa</label><input className="fld" value={visaNo} onChange={(e) => setVisaNo(e.target.value)} placeholder="V-xxxxxxxx" /></div>
          <div><label className="lbl">PNR / No. Tiket</label><input className="fld" value={pnr} onChange={(e) => setPnr(e.target.value)} placeholder="TK-0452" /></div>
          <div><label className="lbl">Kursi (opsional)</label><input className="fld" value={seat} onChange={(e) => setSeat(e.target.value)} placeholder="12A" /></div>
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
            {save.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </div>
    </div>
  );
}
