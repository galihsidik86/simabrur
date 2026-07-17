import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

interface UserRow { id: string; name: string; email: string; is_active: boolean; role: string; role_label: string; branch: string }
interface AuditRow {
  id: number; action: string; entity: string; entityId: string | null; user: string;
  newValues: unknown; createdAt: string; ip: string | null;
}

export function AdminPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  return (
    <div>
      <div className="mb-[18px] flex gap-2">
        {([['users', 'Pengguna & Role'], ['audit', 'Audit Log']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="cursor-pointer rounded-[8px] border px-3.5 py-[7px] text-[12.5px] font-semibold"
            style={tab === k
              ? { color: '#fff', background: 'var(--color-mod-sistem)', borderColor: 'var(--color-mod-sistem)' }
              : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'users' ? <UsersTab /> : <AuditTab />}
    </div>
  );
}

function UsersTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const { data: users } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get('/users')).data.data as UserRow[] });
  const toggle = useMutation({
    mutationFn: async (id: string) => api.patch(`/users/${id}/toggle-active`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] })
  });

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={() => setShowForm(true)} className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep">+ Tambah Pengguna</button>
      </div>
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Nama</th><th className="px-3 py-[11px] font-semibold">Email</th>
              <th className="px-3 py-[11px] font-semibold">Role</th><th className="px-3 py-[11px] font-semibold">Cabang</th>
              <th className="px-3 py-[11px] font-semibold">Status</th><th className="px-5 py-[11px] font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {users?.map((u) => (
              <tr key={u.id} className="border-t border-line-3">
                <td className="px-5 py-3 font-semibold">{u.name}</td>
                <td className="px-3 py-3 font-mono text-[11.5px] text-muted">{u.email}</td>
                <td className="px-3 py-3">{u.role_label}</td>
                <td className="px-3 py-3 text-muted">{u.branch}</td>
                <td className="px-3 py-3">
                  <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold"
                    style={u.is_active ? { color: 'oklch(0.42 0.07 158)', background: 'oklch(0.95 0.03 158)' } : { color: '#fff', background: 'oklch(0.55 0.15 28)' }}>
                    {u.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <button onClick={() => toggle.mutate(u.id)} disabled={toggle.isPending}
                    className="cursor-pointer rounded-[7px] border border-line-2 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-muted hover:bg-panel disabled:opacity-60">
                    {u.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && <UserFormModal onClose={() => setShowForm(false)} />}
    </div>
  );
}

function UserFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'operasional' });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: async () => api.post('/users', f),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });
  function submit(e: FormEvent) { e.preventDefault(); create.mutate(); }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-[420px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Tambah Pengguna</div>
        <div className="mt-4 flex flex-col gap-3">
          <div><label className="lbl">Nama</label><input className="fld" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
          <div><label className="lbl">Email</label><input type="email" className="fld" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></div>
          <div><label className="lbl">Password (min 8)</label><input type="password" className="fld" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></div>
          <div><label className="lbl">Role</label>
            <select className="fld" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {['admin', 'keuangan', 'operasional', 'marketing', 'pimpinan'].map((r) => <option key={r} value={r}>{r}</option>)}
            </select></div>
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
          <button type="submit" disabled={create.isPending} className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {create.isPending ? 'Menyimpan…' : 'Simpan'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AuditTab() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['audit-logs', q, page],
    queryFn: async () => (await api.get('/audit-logs', { params: { q: q || undefined, page, limit: 30 } })).data as { data: AuditRow[]; meta: { total: number } }
  });
  return (
    <div>
      <input className="fld mb-3 !w-[280px]" placeholder="Cari aksi / entitas / pengguna…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Waktu</th><th className="px-3 py-[11px] font-semibold">Aktor</th>
              <th className="px-3 py-[11px] font-semibold">Aksi</th><th className="px-3 py-[11px] font-semibold">Entitas</th>
              <th className="px-5 py-[11px] font-semibold">Detail</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((r) => (
              <tr key={r.id} className="border-t border-line-3 align-top">
                <td className="whitespace-nowrap px-5 py-2.5 font-mono text-[10.5px] text-muted">
                  {new Date(r.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-2.5 font-medium">{r.user}</td>
                <td className="px-3 py-2.5 font-mono text-[11px]">{r.action}</td>
                <td className="px-3 py-2.5 text-muted">{r.entity}</td>
                <td className="max-w-[320px] truncate px-5 py-2.5 font-mono text-[10px] text-muted-3" title={JSON.stringify(r.newValues)}>
                  {r.newValues ? JSON.stringify(r.newValues) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && (
        <div className="mt-2 flex items-center gap-3 text-[11.5px] text-muted-3">
          <span>{data.meta.total} entri</span>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="cursor-pointer rounded border border-line-2 bg-white px-2 py-0.5 disabled:opacity-40">‹</button>
          <span>hal {page}</span>
          <button disabled={page * 30 >= data.meta.total} onClick={() => setPage(page + 1)} className="cursor-pointer rounded border border-line-2 bg-white px-2 py-0.5 disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
