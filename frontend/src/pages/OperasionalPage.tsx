import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtDate } from '../utils/format';

interface Departure { id: string; departure_date: string; package_name: string }
interface ManifestRow {
  registrationId: string; regNumber: string; name: string;
  passportNo: string | null; passportExpiry: string | null; passportExpiringSoon: boolean;
  groupName: string | null; groupId: string | null;
  visa: { status: 'process' | 'biometric' | 'issued'; visaNo: string | null };
  ticket: { pnr: string | null; seat: string | null; status: string };
  room: string;
}
interface StaffRow { id: string; staffName: string; role: 'muthawwif' | 'tour_leader'; phone: string | null }
interface GroupRow {
  id: string; name: string; capacity: number; memberCount: number;
  mabrurGroupId: string | null; mabrurSyncedAt: string | null;
  staff: StaffRow[]; muthawwif: string[]; tourLeader: string[];
}
interface Manifest {
  departure: { id: string; packageName: string; departureDate: string; quota: number; seatsTaken: number };
  manifestStatus: string;
  groups: GroupRow[];
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
  const [showGroups, setShowGroups] = useState(false);

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
        {canEdit && (
          <button onClick={() => setShowGroups(true)}
            className="cursor-pointer rounded-[9px] bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-deep">
            Kelola Rombongan
          </button>
        )}
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

      {edit && <EditOpsModal row={edit} departureId={selected} groups={m?.groups ?? []} onClose={() => setEdit(null)} />}
      {showGroups && m && <RombonganModal departureId={selected} groups={m.groups} onClose={() => setShowGroups(false)} />}
    </div>
  );
}

/* ===== Modal ubah visa/tiket/rombongan (screen baru — gap, mengikuti design system) ===== */
function EditOpsModal({ row, departureId, groups, onClose }: { row: ManifestRow; departureId: string; groups: GroupRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [visaStatus, setVisaStatus] = useState(row.visa.status);
  const [visaNo, setVisaNo] = useState(row.visa.visaNo ?? '');
  const [pnr, setPnr] = useState(row.ticket.pnr ?? '');
  const [seat, setSeat] = useState(row.ticket.seat ?? '');
  const [groupId, setGroupId] = useState(row.groupId ?? '');
  const [roomNumber, setRoomNumber] = useState(() => /\d+$/.exec(row.room)?.[0] ?? '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: async () => {
      await api.post('/visas', { registrationId: row.registrationId, status: visaStatus, visaNo: visaNo || null });
      if (pnr) await api.post('/tickets', { registrationId: row.registrationId, pnr, seat: seat || null });
      await api.patch(`/registrations/${row.registrationId}/assignment`, { groupId: groupId || null, roomNumber: roomNumber || null });
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
          <div>
            <label className="lbl">Rombongan</label>
            <select className="fld" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">— tanpa rombongan —</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.memberCount}/{g.capacity})</option>)}
            </select>
          </div>
          <div><label className="lbl">No. Kamar</label><input className="fld" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="511" /></div>
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

/* ===== Modal kelola rombongan & petugas (prasyarat sinkron Mabrur) ===== */
function RombonganModal({ departureId, groups, onClose }: { departureId: string; groups: GroupRow[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [newGroup, setNewGroup] = useState({ name: '', capacity: 20 });
  const [staffForm, setStaffForm] = useState<{ groupId: string; staffName: string; role: 'muthawwif' | 'tour_leader'; phone: string } | null>(null);
  const [phoneEdit, setPhoneEdit] = useState<Record<string, string>>({});

  const refresh = () => qc.invalidateQueries({ queryKey: ['manifest', departureId] });
  const onErr = (e: unknown) =>
    setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan');

  const createGroup = useMutation({
    mutationFn: async () => api.post('/groups', { departureId, name: newGroup.name, capacity: Number(newGroup.capacity) }),
    onSuccess: () => { setNewGroup({ name: '', capacity: 20 }); setError(''); refresh(); },
    onError: onErr
  });
  const addStaff = useMutation({
    mutationFn: async () =>
      api.post('/group-staff', { groupId: staffForm!.groupId, staffName: staffForm!.staffName, role: staffForm!.role, phone: staffForm!.phone || null }),
    onSuccess: () => { setStaffForm(null); setError(''); refresh(); },
    onError: onErr
  });
  const savePhone = useMutation({
    mutationFn: async (staff: StaffRow) => api.patch(`/group-staff/${staff.id}`, { phone: phoneEdit[staff.id] || null }),
    onSuccess: () => { setError(''); refresh(); },
    onError: onErr
  });

  interface SyncSummary {
    created: number; updated: number; schedules: number;
    conflicts: { phone: string; message?: string }[];
    skipped: { name: string; reason: string }[];
  }
  const [syncResult, setSyncResult] = useState<Record<string, SyncSummary>>({});
  const [showCreds, setShowCreds] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ name: string; phone: string; initialPassword: string }[]>([]);

  const syncMabrur = useMutation({
    mutationFn: async (groupId: string) => (await api.post(`/mabrur/groups/${groupId}/sync`)).data.data as SyncSummary & { groupId: string },
    onSuccess: (d, groupId) => { setError(''); setSyncResult({ ...syncResult, [groupId]: d }); refresh(); },
    onError: onErr
  });
  const loadCreds = useMutation({
    mutationFn: async (groupId: string) => (await api.get(`/mabrur/groups/${groupId}/credentials`)).data.data,
    onSuccess: (d, groupId) => { setCreds(d); setShowCreds(groupId); },
    onError: onErr
  });

  const ROLE_LABEL = { muthawwif: 'Muthawwif', tour_leader: 'Tour Leader' } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[88vh] w-[640px] max-w-full overflow-y-auto rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Kelola Rombongan</div>
        <div className="mt-0.5 text-[11.5px] text-muted-3">
          Nomor HP muthawwif/TL <b>wajib</b> untuk sinkron ke aplikasi lapangan Mabrur (penerima notifikasi SOS).
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-[11px] border border-line-3 bg-panel p-3.5">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{g.name}</span>
                {g.mabrurSyncedAt && (
                  <span className="rounded-pill bg-[oklch(0.95_0.03_158)] px-2 py-[2px] text-[9.5px] font-semibold text-[oklch(0.42_0.07_158)]">
                    ✓ Mabrur {new Date(g.mabrurSyncedAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <span className="ml-auto font-mono text-[11px] text-muted-2">{g.memberCount}/{g.capacity} jamaah</span>
                <button onClick={() => syncMabrur.mutate(g.id)} disabled={syncMabrur.isPending}
                  className="cursor-pointer rounded-[8px] bg-gold-bright px-2.5 py-1 text-[10.5px] font-bold text-[#20180a] disabled:opacity-60">
                  {syncMabrur.isPending ? 'Sinkron…' : g.mabrurSyncedAt ? 'Sinkron Ulang' : 'Sinkron ke Mabrur'}
                </button>
              </div>
              {syncResult[g.id] && (
                <div className="mt-2 rounded-[8px] border border-[oklch(0.9_0.03_158)] bg-[oklch(0.97_0.02_158)] px-3 py-2 text-[11px] text-[#3a5a45]">
                  Tersinkron: <b>{syncResult[g.id].created} akun baru</b> · {syncResult[g.id].updated} diperbarui · {syncResult[g.id].schedules} agenda
                  {syncResult[g.id].conflicts.length > 0 && (
                    <div className="mt-1 text-danger-deep">Konflik: {syncResult[g.id].conflicts.map((c) => `${c.phone} (${c.message})`).join('; ')}</div>
                  )}
                  {syncResult[g.id].skipped.length > 0 && (
                    <div className="mt-1 text-[oklch(0.45_0.1_78)]">Dilewati: {syncResult[g.id].skipped.map((s) => `${s.name} — ${s.reason}`).join('; ')}</div>
                  )}
                  <button onClick={() => loadCreds.mutate(g.id)} className="mt-1 cursor-pointer font-semibold text-primary hover:underline">
                    Lihat kredensial awal →
                  </button>
                </div>
              )}
              {showCreds === g.id && (
                <div className="mt-2 overflow-hidden rounded-[8px] border border-line-2 bg-white">
                  <table className="w-full text-[11px]">
                    <thead><tr className="bg-thead text-left text-[9.5px] uppercase text-muted-3">
                      <th className="px-3 py-1.5 font-semibold">Nama</th><th className="px-3 py-1.5 font-semibold">No. HP (login)</th><th className="px-3 py-1.5 font-semibold">Password awal</th>
                    </tr></thead>
                    <tbody>
                      {creds.map((c) => (
                        <tr key={c.phone} className="border-t border-line-3">
                          <td className="px-3 py-1.5 font-medium">{c.name}</td>
                          <td className="px-3 py-1.5 font-mono">{c.phone}</td>
                          <td className="px-3 py-1.5 font-mono font-bold">{c.initialPassword}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="px-3 py-1.5 text-[9.5px] text-muted-3">Jamaah juga melihat kredensialnya sendiri di portal. Sarankan ganti password setelah login pertama.</div>
                </div>
              )}
              <div className="mt-2 flex flex-col gap-1.5">
                {g.staff.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-[12px]">
                    <span className="w-[86px] flex-none rounded-pill bg-thead px-2 py-[2px] text-center text-[10px] font-semibold text-muted-2">
                      {ROLE_LABEL[s.role]}
                    </span>
                    <span className="flex-1 font-medium">{s.staffName}</span>
                    <input
                      className="fld !w-[150px] !py-1.5 font-mono !text-[11.5px]"
                      placeholder="08xxxxxxxxxx"
                      value={phoneEdit[s.id] ?? s.phone ?? ''}
                      onChange={(e) => setPhoneEdit({ ...phoneEdit, [s.id]: e.target.value.replace(/\D/g, '') })}
                    />
                    <button
                      onClick={() => savePhone.mutate(s)}
                      disabled={savePhone.isPending || (phoneEdit[s.id] ?? s.phone ?? '') === (s.phone ?? '')}
                      className="cursor-pointer rounded-[7px] border border-line-2 bg-white px-2 py-1 text-[10.5px] font-semibold text-muted disabled:opacity-40">
                      Simpan
                    </button>
                    {!s.phone && !(phoneEdit[s.id]?.length) && (
                      <span className="text-[10px] font-semibold text-danger-deep">HP kosong</span>
                    )}
                  </div>
                ))}
                {g.staff.length === 0 && <div className="text-[11px] text-muted-3">Belum ada petugas.</div>}
              </div>
              {staffForm?.groupId === g.id ? (
                <div className="mt-2 flex items-end gap-2">
                  <select className="fld !w-[120px] !py-1.5 !text-[11.5px]" value={staffForm.role}
                    onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value as 'muthawwif' | 'tour_leader' })}>
                    <option value="muthawwif">Muthawwif</option>
                    <option value="tour_leader">Tour Leader</option>
                  </select>
                  <input className="fld flex-1 !py-1.5 !text-[11.5px]" placeholder="Nama petugas" value={staffForm.staffName}
                    onChange={(e) => setStaffForm({ ...staffForm, staffName: e.target.value })} />
                  <input className="fld !w-[140px] !py-1.5 font-mono !text-[11.5px]" placeholder="08xxxxxxxxxx" value={staffForm.phone}
                    onChange={(e) => setStaffForm({ ...staffForm, phone: e.target.value.replace(/\D/g, '') })} />
                  <button onClick={() => staffForm.staffName.length >= 2 && addStaff.mutate()} disabled={addStaff.isPending}
                    className="cursor-pointer rounded-[8px] bg-primary px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-60">
                    Tambah
                  </button>
                </div>
              ) : (
                <button onClick={() => setStaffForm({ groupId: g.id, staffName: '', role: 'muthawwif', phone: '' })}
                  className="mt-2 cursor-pointer text-[11px] font-semibold text-primary hover:underline">
                  + Tambah petugas
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Rombongan baru */}
        <div className="mt-4 flex items-end gap-2 rounded-[11px] border border-line-3 p-3.5">
          <div className="flex-1"><label className="lbl">Rombongan Baru</label>
            <input className="fld" placeholder="mis. Grup C" value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} /></div>
          <div><label className="lbl">Kapasitas</label>
            <input type="number" min={1} className="fld !w-[90px]" value={newGroup.capacity} onChange={(e) => setNewGroup({ ...newGroup, capacity: Number(e.target.value) })} /></div>
          <button onClick={() => newGroup.name.length >= 2 && createGroup.mutate()} disabled={createGroup.isPending}
            className="cursor-pointer rounded-[9px] bg-primary px-3.5 py-[11px] text-[12px] font-semibold text-white disabled:opacity-60">
            + Buat
          </button>
        </div>

        <div className="mt-2 text-[10.5px] text-muted-3">
          Tetapkan jamaah ke rombongan lewat tombol <b>Ubah</b> pada baris manifest (pilihan Rombongan &amp; No. Kamar).
        </div>

        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Tutup</button>
        </div>
      </div>
    </div>
  );
}
