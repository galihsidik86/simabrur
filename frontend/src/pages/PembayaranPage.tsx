import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { fmtShort, fmtFull, fmtDate } from '../utils/format';

interface Row {
  invoiceId: string; invoiceNumber: string; regNumber: string; jamaahId: string; name: string;
  packageName: string; total: number; paid: number; remaining: number;
  nextDueDate: string | null; status: 'Lunas' | 'Terlambat' | 'Jatuh Tempo' | 'Terjadwal';
}
interface Kpi {
  totalReceivable: number; activeCount: number; dueThisWeek: number; dueThisWeekCount: number;
  collectedThisMonth: number; collectedThisMonthCount: number;
}

const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  Lunas: { color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  Terjadwal: { color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  'Jatuh Tempo': { color: 'oklch(0.5 0.13 28)', bg: 'oklch(0.96 0.04 30)' },
  Terlambat: { color: '#fff', bg: 'oklch(0.55 0.15 28)' }
};

export function PembayaranPage() {
  const { user } = useAuth();
  const [manage, setManage] = useState<Row | null>(null);
  const { data } = useQuery({
    queryKey: ['receivables'],
    queryFn: async () => (await api.get('/receivables')).data.data as { data: Row[]; kpi: Kpi }
  });

  const kpi = data?.kpi;
  const tiles = kpi
    ? [
        { label: 'Total Piutang Aktif', value: fmtShort(kpi.totalReceivable), sub: `${kpi.activeCount} jamaah belum lunas`, accent: 'oklch(0.56 0.11 45)' },
        { label: 'Jatuh Tempo Minggu Ini', value: fmtShort(kpi.dueThisWeek), sub: `${kpi.dueThisWeekCount} termin belum dibayar`, accent: 'oklch(0.62 0.11 78)' },
        { label: 'Terkumpul Bulan Ini', value: fmtShort(kpi.collectedThisMonth), sub: `${kpi.collectedThisMonthCount} pembayaran terverifikasi`, accent: 'oklch(0.5 0.09 165)' }
      ]
    : [];
  const canManage = user && ['admin', 'keuangan'].includes(user.role);

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

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line-3 px-5 py-4 text-[14px] font-semibold">Kartu Piutang Jamaah</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Jamaah</th>
              <th className="px-3 py-[11px] text-right font-semibold">Total Tagihan</th>
              <th className="px-3 py-[11px] text-right font-semibold">Terbayar</th>
              <th className="px-3 py-[11px] text-right font-semibold">Sisa</th>
              <th className="px-3 py-[11px] font-semibold">Jatuh Tempo</th>
              <th className="px-3 py-[11px] font-semibold">Status</th>
              <th className="px-5 py-[11px] font-semibold">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {data?.data.map((r) => {
              const pill = STATUS_PILL[r.status];
              return (
                <tr key={r.invoiceId} className="border-t border-line-3 hover:bg-panel">
                  <td className="px-5 py-[13px]">
                    <Link to={`/jamaah/${r.jamaahId}`} className="font-semibold hover:underline">{r.name}</Link>
                    <div className="font-mono text-[10.5px] text-muted-4">{r.regNumber}</div>
                  </td>
                  <td className="px-3 py-[13px] text-right font-mono">{fmtShort(r.total)}</td>
                  <td className="px-3 py-[13px] text-right font-mono text-[oklch(0.46_0.07_158)]">{fmtShort(r.paid)}</td>
                  <td className="px-3 py-[13px] text-right font-mono font-semibold">{fmtShort(r.remaining)}</td>
                  <td className="px-3 py-[13px] text-muted">{r.status === 'Lunas' ? 'Lunas' : r.nextDueDate ? fmtDate(r.nextDueDate) : '—'}</td>
                  <td className="px-3 py-[13px]">
                    <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold" style={{ color: pill.color, background: pill.bg }}>{r.status}</span>
                  </td>
                  <td className="px-5 py-[13px]">
                    <div className="flex gap-2">
                      <Link to={`/dokumen/invoice/${r.invoiceId}`} className="rounded-[7px] border border-line-2 bg-white px-2.5 py-1 text-[10.5px] font-semibold text-muted hover:bg-panel">Invoice</Link>
                      {canManage && (
                        <button onClick={() => setManage(r)} className="cursor-pointer rounded-[7px] bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-primary-deep">
                          Kelola
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {manage && <ManageModal row={manage} onClose={() => setManage(null)} />}
    </div>
  );
}

/* ===== Modal kelola pembayaran (catat + verifikasi + kwitansi) ===== */
interface DocSchedule { id: string; termNo: number; label: string; amount: number; dueDate: string; status: string }
interface PaymentRow { id: string; amount: number; method: string; status: string; paidAt: string; scheduleLabel: string | null; receiptId: string | null; receiptNumber: string | null }

function ManageModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const [scheduleId, setScheduleId] = useState('');
  const [amount, setAmount] = useState<number>(0);
  const [method, setMethod] = useState('va');
  const [reference, setReference] = useState('');
  const [idemKey] = useState(() => crypto.randomUUID());

  const { data: doc } = useQuery({
    queryKey: ['invoice-doc', row.invoiceId],
    queryFn: async () => (await api.get(`/invoices/${row.invoiceId}/document`)).data.data as { schedules: DocSchedule[] }
  });
  const { data: payments } = useQuery({
    queryKey: ['invoice-payments', row.invoiceId],
    queryFn: async () => (await api.get(`/invoices/${row.invoiceId}/payments`)).data.data as PaymentRow[]
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['receivables'] });
    qc.invalidateQueries({ queryKey: ['invoice-doc', row.invoiceId] });
    qc.invalidateQueries({ queryKey: ['invoice-payments', row.invoiceId] });
  };

  const record = useMutation({
    mutationFn: async () =>
      api.post(
        '/payments',
        { invoiceId: row.invoiceId, scheduleId: scheduleId || null, bankAccountCode: '1-1200', amount, method, reference: reference || null },
        { headers: { 'Idempotency-Key': idemKey } }
      ),
    onSuccess: refresh,
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });
  const verify = useMutation({
    mutationFn: async (paymentId: string) => api.patch(`/payments/${paymentId}/verify`),
    onSuccess: refresh,
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal verifikasi')
  });

  const unpaid = doc?.schedules.filter((s) => s.status === 'unpaid') ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-[640px] max-w-full overflow-y-auto rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Kelola Pembayaran</div>
        <div className="mt-0.5 text-[12px] text-muted-2">{row.name} · <span className="font-mono">{row.regNumber}</span> · {row.packageName}</div>

        {/* Jadwal termin */}
        <div className="mt-4 overflow-hidden rounded-[10px] border border-line-3">
          {doc?.schedules.map((s) => (
            <div key={s.id} className="flex items-center gap-3 border-b border-line-3 px-3.5 py-2 text-[12px] last:border-0">
              <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full text-[10px] font-bold"
                style={s.status === 'paid' ? { background: 'oklch(0.46 0.07 158)', color: '#fff' } : { background: '#f0eadc', color: '#8c8371' }}>
                {s.status === 'paid' ? '✓' : s.termNo || '•'}
              </span>
              <span className="flex-1 font-medium">{s.label}</span>
              <span className="text-muted-3">{fmtDate(s.dueDate)}</span>
              <span className="w-[90px] text-right font-mono font-semibold">{fmtShort(s.amount)}</span>
              <span className="w-[80px] text-right text-[10.5px] font-semibold" style={{ color: s.status === 'paid' ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.13 28)' }}>
                {s.status === 'paid' ? 'Lunas' : 'Belum'}
              </span>
            </div>
          ))}
        </div>

        {/* Pembayaran tercatat */}
        {payments && payments.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-[12.5px] font-semibold">Pembayaran Tercatat</div>
            <div className="flex flex-col gap-1.5">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-[9px] border border-line-3 bg-panel px-3.5 py-2 text-[12px]">
                  <span className="flex-1">{p.scheduleLabel ?? 'Pembayaran'} · {fmtDate(p.paidAt.slice(0, 10))}</span>
                  <span className="font-mono font-semibold">{fmtShort(p.amount)}</span>
                  {p.status === 'verified' ? (
                    p.receiptId ? (
                      <Link to={`/dokumen/kwitansi/${p.receiptId}`} className="text-[10.5px] font-semibold text-primary hover:underline">
                        {p.receiptNumber}
                      </Link>
                    ) : (
                      <span className="text-[10.5px] font-semibold text-[oklch(0.46_0.07_158)]">Terverifikasi</span>
                    )
                  ) : (
                    <button onClick={() => verify.mutate(p.id)} disabled={verify.isPending}
                      className="cursor-pointer rounded-[7px] bg-gold-bright px-2.5 py-1 text-[10.5px] font-semibold text-[#20180a] disabled:opacity-60">
                      Verifikasi
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Catat pembayaran baru */}
        {row.remaining > 0 && (
          <div className="mt-4 rounded-[10px] border border-line-3 bg-panel p-4">
            <div className="mb-3 text-[12.5px] font-semibold">Catat Pembayaran</div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="lbl">Termin</label>
                <select className="fld" value={scheduleId} onChange={(e) => {
                  setScheduleId(e.target.value);
                  const s = unpaid.find((x) => x.id === e.target.value);
                  if (s) setAmount(s.amount);
                }}>
                  <option value="">— pilih termin —</option>
                  {unpaid.map((s) => <option key={s.id} value={s.id}>{s.label} · {fmtFull(s.amount)} · tempo {fmtDate(s.dueDate)}</option>)}
                </select>
              </div>
              <div><label className="lbl">Jumlah (Rp)</label><input type="number" className="fld" value={amount || ''} onChange={(e) => setAmount(Number(e.target.value))} /></div>
              <div><label className="lbl">Metode</label>
                <select className="fld" value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="va">Transfer / VA</option><option value="transfer">Transfer Manual</option><option value="cash">Setor Tunai</option><option value="card">Kartu</option>
                </select></div>
              <div className="col-span-2"><label className="lbl">Referensi (opsional)</label><input className="fld" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. ref bank / VA" /></div>
            </div>
            <button onClick={() => amount > 0 && record.mutate()} disabled={record.isPending || amount <= 0}
              className="mt-3 cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
              {record.isPending ? 'Menyimpan…' : 'Simpan Pembayaran'}
            </button>
            <div className="mt-2 text-[10px] text-muted-3">Dicatat sebagai <b>Uang Muka Jamaah (2-1100)</b> — jurnal otomatis aktif pada Fase 5. Idempotency-Key melindungi dari input ganda.</div>
          </div>
        )}

        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Tutup</button>
        </div>
      </div>
    </div>
  );
}
