import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtShort, fmtFull, fmtDate } from '../../utils/format';
import { ACC_CLASS_COLOR } from './KeuanganPage';

/* ===== Tipe ===== */
interface JournalEntry {
  id: string; journalNo: string; date: string; description: string; source: string;
  costCenter: string | null; total: number;
  lines: { accountCode: string; accountName: string; debit: number; credit: number; amountForeign: number | null }[];
}
interface JournalsData { entries: JournalEntry[]; kpi: { totalDebit: number; totalCredit: number; balanced: boolean; count: number } }
interface ReconData {
  bank: { code: string; name: string; bank: string | null; accountNo: string | null };
  ledgerBalance: number; statementBalance: number; difference: number;
  adjusted: { statement: number; ledger: number; balanced: boolean };
  adjustments: {
    depositsInTransit: { description: string; amount: number }[];
    bankOnlyIncome: { description: string; amount: number }[];
    bankOnlyCharges: { description: string; amount: number }[];
  };
  lines: { id: string; date: string; description: string; amount: number; source: string; status: string }[];
  matchedCount: number; totalCount: number;
}

const SOURCE_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  payment: { label: 'Pembayaran', color: 'oklch(0.45 0.06 245)', bg: 'oklch(0.95 0.03 245)' },
  expense: { label: 'Biaya', color: 'oklch(0.48 0.11 45)', bg: 'oklch(0.96 0.04 55)' },
  revenue: { label: 'Pendapatan', color: 'oklch(0.42 0.07 158)', bg: 'oklch(0.95 0.03 158)' },
  commission: { label: 'Komisi', color: 'oklch(0.45 0.1 322)', bg: 'oklch(0.96 0.03 322)' },
  manual: { label: 'Manual', color: 'oklch(0.4 0.02 265)', bg: '#eee9dc' },
  reconciliation: { label: 'Rekonsiliasi', color: 'oklch(0.4 0.02 265)', bg: '#eee9dc' }
};
const SRC_FILTERS = [['', 'Semua'], ['payment', 'Pembayaran'], ['expense', 'Biaya'], ['revenue', 'Pendapatan'], ['commission', 'Komisi'], ['manual', 'Manual']] as const;

export function JurnalRekonsiliasiPage() {
  const [tab, setTab] = useState<'jurnal' | 'rekon'>('jurnal');
  return (
    <div>
      <div className="mb-4 flex gap-2">
        {([['jurnal', 'Jurnal Umum'], ['rekon', 'Rekonsiliasi Bank']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className="cursor-pointer rounded-[8px] border px-3.5 py-[7px] text-[12.5px] font-semibold"
            style={tab === k
              ? { color: '#fff', background: 'oklch(0.46 0.07 158)', borderColor: 'oklch(0.46 0.07 158)' }
              : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'jurnal' ? <JurnalUmum /> : <RekonBank />}
    </div>
  );
}

/* ===== Sub-tab 1: Jurnal Umum ===== */
function JurnalUmum() {
  const [source, setSource] = useState('');
  const [month, setMonth] = useState('');
  const [showManual, setShowManual] = useState(false);
  const { data } = useQuery({
    queryKey: ['journals', source, month],
    queryFn: async () =>
      (await api.get('/journals', { params: { source: source || undefined, month: month || undefined } })).data.data as JournalsData
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SRC_FILTERS.map(([k, label]) => (
          <button key={k} onClick={() => setSource(k)}
            className="cursor-pointer rounded-pill border px-3 py-[5px] text-[11.5px] font-semibold"
            style={source === k
              ? { color: '#fff', background: 'oklch(0.46 0.07 158)', borderColor: 'oklch(0.46 0.07 158)' }
              : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }}>
            {label}
          </button>
        ))}
        <input type="month" className="fld !w-[160px] !py-1.5" value={month} onChange={(e) => setMonth(e.target.value)} />
        <button onClick={() => setShowManual(true)}
          className="ml-auto cursor-pointer rounded-[9px] bg-[oklch(0.46_0.07_158)] px-3.5 py-2 text-[12px] font-semibold text-white">
          + Jurnal Manual
        </button>
      </div>

      {data && (
        <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
          {[
            ['Total Debit', fmtShort(data.kpi.totalDebit), 'periode terpilih'],
            ['Total Kredit', fmtShort(data.kpi.totalCredit), 'periode terpilih'],
            ['Status', data.kpi.balanced ? '● Seimbang' : '● TIDAK SEIMBANG', 'Σdebit = Σkredit'],
            ['Jumlah Entri', String(data.kpi.count), 'jurnal']
          ].map(([label, value, sub], i) => (
            <div key={label} className="rounded-card border border-line bg-card p-4 shadow-card">
              <div className="text-[11px] text-muted-3">{label}</div>
              <div className="mt-1.5 font-mono text-[19px] font-semibold" style={i === 2 ? { color: data.kpi.balanced ? 'oklch(0.46 0.07 158)' : 'oklch(0.55 0.15 28)' } : {}}>{value}</div>
              <div className="text-[10px] text-muted-4">{sub}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {data?.entries.map((j) => {
          const badge = SOURCE_BADGE[j.source];
          return (
            <div key={j.id} className="rounded-card border border-line bg-card shadow-card">
              <div className="flex items-center gap-3 border-b border-line-3 px-4 py-2.5">
                <span className="font-mono text-[11.5px] font-semibold">{j.journalNo}</span>
                <span className="text-[11px] text-muted-3">{fmtDate(j.date)}</span>
                <span className="text-[12.5px] font-medium">{j.description}</span>
                {j.costCenter && <span className="font-mono text-[10px] text-muted-4">CC: {j.costCenter}</span>}
                <span className="ml-auto rounded-pill px-2.5 py-[3px] text-[10px] font-semibold" style={{ color: badge.color, background: badge.bg }}>
                  {badge.label}
                </span>
              </div>
              <table className="w-full border-collapse text-[11.5px]">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i} className="border-b border-[#f6f1e6] last:border-0">
                      <td className="px-4 py-1.5" style={{ paddingLeft: l.credit > 0 ? 30 : 16 }}>
                        <span className="font-mono text-[10.5px] font-semibold" style={{ color: ACC_CLASS_COLOR[Number(l.accountCode[0])] }}>{l.accountCode}</span>
                        <span className="ml-2">{l.accountName}</span>
                      </td>
                      <td className="w-[130px] px-4 py-1.5 text-right font-mono">{l.debit ? l.debit.toLocaleString('id-ID') : ''}</td>
                      <td className="w-[130px] px-4 py-1.5 text-right font-mono">{l.credit ? l.credit.toLocaleString('id-ID') : ''}</td>
                    </tr>
                  ))}
                  <tr className="bg-panel text-[11px] font-semibold">
                    <td className="px-4 py-1.5 text-[oklch(0.46_0.07_158)]">● Balanced</td>
                    <td className="px-4 py-1.5 text-right font-mono">{j.total.toLocaleString('id-ID')}</td>
                    <td className="px-4 py-1.5 text-right font-mono">{j.total.toLocaleString('id-ID')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
        {data && data.entries.length === 0 && <div className="text-[12.5px] text-muted-2">Tidak ada jurnal pada filter ini.</div>}
      </div>

      {showManual && <ManualJournalModal onClose={() => setShowManual(false)} />}
    </div>
  );
}

/* ===== Modal Jurnal Manual ===== */
function ManualJournalModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState([
    { accountCode: '', debit: 0, credit: 0 },
    { accountCode: '', debit: 0, credit: 0 }
  ]);
  const [error, setError] = useState('');
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data.data as { code: string; name: string; isPostable: boolean }[]
  });

  const totalDebit = rows.reduce((s, r) => s + (r.debit || 0), 0);
  const totalCredit = rows.reduce((s, r) => s + (r.credit || 0), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0 && rows.every((r) => r.accountCode);

  const save = useMutation({
    mutationFn: async () => api.post('/journals', { date, description, lines: rows }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['journals'] }); onClose(); },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[620px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="font-display text-[19px] text-ink-strong">Jurnal Manual</div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div><label className="lbl">Tanggal</label><input type="date" className="fld" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><label className="lbl">Deskripsi</label><input className="fld" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="mis. Biaya administrasi bank" /></div>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <select className="fld flex-1" value={r.accountCode} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, accountCode: e.target.value } : x)))}>
                <option value="">— akun —</option>
                {accounts?.filter((a) => a.isPostable).map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
              </select>
              <input type="number" placeholder="Debit" className="fld !w-[130px] font-mono" value={r.debit || ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, debit: Number(e.target.value), credit: 0 } : x)))} />
              <input type="number" placeholder="Kredit" className="fld !w-[130px] font-mono" value={r.credit || ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, credit: Number(e.target.value), debit: 0 } : x)))} />
              {rows.length > 2 && (
                <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="cursor-pointer rounded-[9px] border border-line-2 px-3 text-danger-deep">×</button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button onClick={() => setRows([...rows, { accountCode: '', debit: 0, credit: 0 }])} className="cursor-pointer text-[11.5px] font-semibold text-primary hover:underline">+ Tambah baris</button>
          <span className="text-[11.5px] font-semibold" style={{ color: balanced ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.1 78)' }}>
            {balanced ? '● Seimbang' : `Dr ${fmtFull(totalDebit)} / Cr ${fmtFull(totalCredit)}`}
          </span>
        </div>
        {error && <div className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
          <button onClick={() => balanced && description.length >= 3 && save.mutate()} disabled={!balanced || description.length < 3 || save.isPending}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {save.isPending ? 'Menyimpan…' : 'Posting Jurnal'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ===== Sub-tab 2: Rekonsiliasi Bank ===== */
interface BankAccountOpt { account_code: string; name: string; currency: string }

function RekonBank() {
  const qc = useQueryClient();
  const [month, setMonth] = useState('2026-06');
  const [bankCode, setBankCode] = useState('');
  const { data: banks } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => (await api.get('/bank-accounts')).data.data as BankAccountOpt[]
  });
  // Rekening aktif = pilihan pengguna, atau rekening pertama begitu daftar termuat.
  const activeCode = bankCode || banks?.[0]?.account_code || '';
  const { data: d } = useQuery({
    queryKey: ['reconciliation', activeCode, month],
    enabled: !!activeCode,
    queryFn: async () => (await api.get('/bank-reconciliations', { params: { bankAccountCode: activeCode, month } })).data.data as ReconData
  });
  const match = useMutation({
    mutationFn: async (id: string) => api.post(`/bank-reconciliations/${id}/match`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reconciliation', activeCode, month] })
  });
  if (!d) return <div className="text-[12.5px] text-muted-2">Memuat rekonsiliasi…</div>;

  const tiles = [
    { label: 'Saldo Buku Besar', value: fmtFull(d.ledgerBalance), sub: `Akun ${d.bank.code}`, accent: 'oklch(0.52 0.08 165)' },
    { label: 'Saldo Rekening Koran', value: fmtFull(d.statementBalance), sub: `${d.bank.bank ?? ''} ${d.bank.accountNo ?? ''}`, accent: 'oklch(0.52 0.09 245)' },
    { label: 'Selisih', value: fmtFull(Math.abs(d.difference)), sub: `${d.totalCount - d.matchedCount} item belum tercocok`, accent: 'oklch(0.55 0.15 28)' },
    { label: 'Setelah Penyesuaian', value: d.adjusted.balanced ? 'Rp 0' : fmtFull(Math.abs(d.adjusted.statement - d.adjusted.ledger)), sub: d.adjusted.balanced ? 'Rekonsiliasi seimbang ✓' : 'BELUM seimbang', accent: d.adjusted.balanced ? 'oklch(0.46 0.07 158)' : 'oklch(0.55 0.15 28)' }
  ];

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <select className="fld !w-auto !py-2 font-semibold" value={activeCode} onChange={(e) => setBankCode(e.target.value)}>
          {banks?.map((b) => (
            <option key={b.account_code} value={b.account_code}>
              {b.account_code} · {b.name}{b.currency !== 'IDR' ? ` · ${b.currency}` : ''}
            </option>
          ))}
        </select>
        {(d.bank.bank || d.bank.accountNo) && (
          <span className="text-[11.5px] text-muted-2">{d.bank.bank} {d.bank.accountNo}</span>
        )}
        <input type="month" className="fld !w-[160px] !py-2" value={month} onChange={(e) => setMonth(e.target.value)} />
      </div>

      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-card border border-line bg-card p-4 shadow-card" style={{ borderLeft: `4px solid ${t.accent}` }}>
            <div className="text-[11px] text-muted-3">{t.label}</div>
            <div className="mt-1.5 font-mono text-[17px] font-semibold">{t.value}</div>
            <div className="text-[10px] text-muted-4">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* Skedul penyesuaian dua sisi */}
      <div className="mb-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="mb-2 text-[12.5px] font-semibold">Saldo per Rekening Koran</div>
          <AdjRow label="Saldo rekening koran" amount={d.statementBalance} bold />
          {d.adjustments.depositsInTransit.map((a) => <AdjRow key={a.description} label={`(−) ${a.description}`} amount={-a.amount} />)}
          <AdjRow label="Saldo disesuaikan" amount={d.adjusted.statement} bold topline />
        </div>
        <div className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="mb-2 text-[12.5px] font-semibold">Saldo per Buku Besar</div>
          <AdjRow label="Saldo buku besar" amount={d.ledgerBalance} bold />
          {d.adjustments.bankOnlyIncome.map((a) => <AdjRow key={a.description} label={`(+) ${a.description} (belum dicatat)`} amount={a.amount} />)}
          {d.adjustments.bankOnlyCharges.map((a) => <AdjRow key={a.description} label={`(−) ${a.description} (belum dicatat)`} amount={a.amount} />)}
          <AdjRow label="Saldo disesuaikan" amount={d.adjusted.ledger} bold topline />
        </div>
      </div>

      {/* Pencocokan mutasi */}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-line-3 px-5 py-3.5">
          <span className="text-[14px] font-semibold">Pencocokan Mutasi</span>
          <span className="text-[11.5px] text-muted-2">{d.matchedCount} dari {d.totalCount} mutasi tercocok</span>
        </div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
              <th className="px-5 py-[11px] font-semibold">Tanggal</th><th className="px-3 py-[11px] font-semibold">Keterangan</th>
              <th className="px-3 py-[11px] font-semibold">Sumber</th><th className="px-3 py-[11px] text-right font-semibold">Nominal</th>
              <th className="px-5 py-[11px] font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-t border-line-3">
                <td className="px-5 py-3 text-muted">{fmtDate(l.date)}</td>
                <td className="px-3 py-3 font-medium">{l.description}</td>
                <td className="px-3 py-3 font-mono text-[11px] text-muted-2">{l.source}</td>
                <td className="px-3 py-3 text-right font-mono font-semibold" style={{ color: l.amount >= 0 ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.13 28)' }}>
                  {l.amount >= 0 ? '+' : '−'}{fmtFull(Math.abs(l.amount)).slice(3)}
                </td>
                <td className="px-5 py-3">
                  {l.status === 'matched' ? (
                    <button onClick={() => match.mutate(l.id)}
                      className="cursor-pointer rounded-pill bg-[oklch(0.95_0.03_158)] px-2.5 py-[3px] text-[10.5px] font-semibold text-[oklch(0.42_0.07_158)]">
                      ✓ Cocok
                    </button>
                  ) : (
                    <button onClick={() => match.mutate(l.id)} disabled={match.isPending}
                      className="cursor-pointer rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold text-white"
                      style={{ background: 'oklch(0.58 0.12 45)' }}>
                      Cocokkan
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {d.lines.length === 0 && <tr><td colSpan={5} className="px-5 py-6 text-muted-2">Tidak ada mutasi pada periode ini.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdjRow({ label, amount, bold, topline }: { label: string; amount: number; bold?: boolean; topline?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-[11.5px] ${topline ? 'mt-1 border-t border-line-2 pt-1.5' : ''}`}>
      <span className={bold ? 'font-semibold' : 'text-muted'}>{label}</span>
      <span className={`font-mono ${bold ? 'font-bold' : ''}`}>{fmtFull(amount)}</span>
    </div>
  );
}
