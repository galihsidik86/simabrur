import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtShort, fmtDate } from '../utils/format';

interface AgentRow {
  id: string; name: string; code: string; referralCode: string; commissionPct: number; isActive: boolean;
  leads: number; converted: number; conversionPct: number; commissionTotal: number; commissionPending: number;
}
interface Kpi { activeAgents: number; totalLeads: number; avgConversionPct: number; commissionOwed: number; agentsWithPending: number }
interface CommissionRow {
  id: string; agentName: string; agentCode: string; regNumber: string; jamaahName: string;
  baseAmount: number; pct: number; amount: number; status: string; journalNo: string | null; createdAt: string;
}

export function MarketingPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['agents'],
    queryFn: async () => (await api.get('/agents')).data.data as { agents: AgentRow[]; kpi: Kpi }
  });
  const { data: pending } = useQuery({
    queryKey: ['commissions-pending'],
    queryFn: async () => (await api.get('/commissions', { params: { status: 'pending' } })).data.data as CommissionRow[]
  });
  const approve = useMutation({
    mutationFn: async (id: string) => api.post(`/commissions/${id}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] });
      qc.invalidateQueries({ queryKey: ['commissions-pending'] });
    },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyetujui')
  });

  const kpi = data?.kpi;
  const tiles = kpi
    ? [
        { label: 'Agen Aktif', value: String(kpi.activeAgents), sub: 'mitra referral terdaftar', accent: 'oklch(0.50 0.10 322)' },
        { label: 'Leads dari Referral', value: kpi.totalLeads.toLocaleString('id-ID'), sub: `Konversi rata-rata ${kpi.avgConversionPct}%`, accent: 'oklch(0.52 0.09 245)' },
        { label: 'Komisi Terhutang', value: fmtShort(kpi.commissionOwed), sub: `Akun 2-1400 · ${kpi.agentsWithPending} agen menunggu persetujuan`, accent: 'oklch(0.56 0.09 78)' }
      ]
    : [];
  const canApprove = user && ['admin', 'marketing', 'keuangan'].includes(user.role);
  const canManage = user && ['admin', 'marketing'].includes(user.role);

  return (
    <div>
      <div className="mb-[18px] grid grid-cols-3 gap-4 max-md:grid-cols-1">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-card border border-line bg-card p-[18px] shadow-card" style={{ borderLeft: `4px solid ${t.accent}` }}>
            <div className="text-xs text-muted-3">{t.label}</div>
            <div className="mt-2 font-mono text-[23px] font-semibold">{t.value}</div>
            <div className="mt-[3px] text-[11px] text-muted-4">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Kinerja agen (replika tabel mockup) */}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-line-3 px-5 py-4">
          <span className="text-[14px] font-semibold">Kinerja Agen & Komisi</span>
          {canManage && (
            <button onClick={() => setShowForm(true)} className="cursor-pointer rounded-[9px] bg-primary px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-primary-deep">
              + Registrasi Agen
            </button>
          )}
        </div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Agen</th>
              <th className="px-3 py-[11px] font-semibold">Kode Referral</th>
              <th className="px-3 py-[11px] text-right font-semibold">Leads</th>
              <th className="px-3 py-[11px] text-right font-semibold">Konversi</th>
              <th className="px-3 py-[11px] text-right font-semibold">Jamaah</th>
              <th className="px-5 py-[11px] text-right font-semibold">Komisi</th>
            </tr>
          </thead>
          <tbody>
            {data?.agents.map((a) => (
              <tr key={a.id} className="border-t border-line-3 hover:bg-panel">
                <td className="px-5 py-3 font-semibold">{a.name}
                  {a.commissionPending > 0 && <span className="ml-2 rounded-pill bg-[oklch(0.95_0.04_82)] px-2 py-[2px] text-[9.5px] font-semibold text-[oklch(0.45_0.1_78)]">komisi menunggu</span>}
                </td>
                <td className="px-3 py-3 font-mono text-primary">{a.referralCode}</td>
                <td className="px-3 py-3 text-right font-mono">{a.leads}</td>
                <td className="px-3 py-3 text-right font-mono">{a.conversionPct}%</td>
                <td className="px-3 py-3 text-right font-mono">{a.converted}</td>
                <td className="px-5 py-3 text-right font-mono font-semibold">{fmtShort(a.commissionTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Komisi menunggu persetujuan */}
      {pending && pending.length > 0 && (
        <div className="mt-4 overflow-hidden rounded-card border border-line bg-card shadow-card">
          <div className="border-b border-line-3 px-5 py-4 text-[14px] font-semibold">
            Komisi Menunggu Persetujuan <span className="text-[11px] font-normal text-muted-4">— disetujui → jurnal Dr 6-2000 · Cr 2-1400</span>
          </div>
          <table className="w-full border-collapse text-[12.5px]">
            <tbody>
              {pending.map((c) => (
                <tr key={c.id} className="border-t border-line-3">
                  <td className="px-5 py-3">
                    <span className="font-semibold">{c.agentName}</span>
                    <span className="ml-2 font-mono text-[10.5px] text-muted-4">{c.agentCode}</span>
                  </td>
                  <td className="px-3 py-3">{c.jamaahName} <span className="font-mono text-[10.5px] text-muted-4">{c.regNumber}</span></td>
                  <td className="px-3 py-3 text-right font-mono text-[11px] text-muted">{c.pct}% × {fmtShort(c.baseAmount)}</td>
                  <td className="px-3 py-3 text-right font-mono font-bold">{fmtShort(c.amount)}</td>
                  <td className="px-3 py-3 text-muted-3">{fmtDate(c.createdAt.slice(0, 10))}</td>
                  <td className="px-5 py-3 text-right">
                    {canApprove && (
                      <button onClick={() => approve.mutate(c.id)} disabled={approve.isPending}
                        className="cursor-pointer rounded-[8px] bg-gold-bright px-3 py-1.5 text-[11px] font-bold text-[#20180a] disabled:opacity-60">
                        Setujui & Posting
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <div className="border-t border-line-3 px-5 py-2.5 text-[12px] font-medium text-danger-deep">{error}</div>}
        </div>
      )}

      {showForm && <AgentFormModal onClose={() => setShowForm(false)} />}
    </div>
  );
}

function AgentFormModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: '', code: '', phone: '', commissionPct: 3 });
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: async () => api.post('/agents', { name: f.name, code: f.code, phone: f.phone || null, commissionPct: Number(f.commissionPct) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['agents'] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });
  function submit(e: FormEvent) { e.preventDefault(); create.mutate(); }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="w-[420px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Registrasi Agen / Mitra</div>
        <div className="mt-4 flex flex-col gap-3">
          <div><label className="lbl">Nama Agen / Mitra</label><input className="fld" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Barokah Tour" required /></div>
          <div><label className="lbl">Kode Referral (unik)</label><input className="fld font-mono" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="BRKH-07" required /></div>
          <div><label className="lbl">No. HP (opsional)</label><input className="fld" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
          <div><label className="lbl">Persentase Komisi (%)</label><input type="number" step="0.5" min="0.5" max="100" className="fld font-mono" value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: Number(e.target.value) })} required /></div>
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
          <button type="submit" disabled={create.isPending} className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">
            {create.isPending ? 'Menyimpan…' : 'Simpan Agen'}
          </button>
        </div>
      </form>
    </div>
  );
}
