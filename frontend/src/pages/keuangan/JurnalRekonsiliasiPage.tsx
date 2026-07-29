import { useState, type ReactNode } from 'react';
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
interface ReconLine {
  id: string; date: string; description: string; amount: number; lineType: string;
  source: string; status: 'matched' | 'unmatched';
  suggestion: { journalLineId: string; journalNo: string } | null;
}
interface BankOnlyItem { id: string; description: string; amount: number; lineType: string; postable: boolean }
interface BookOnlyItem { id: string; description: string; amount: number; journalNo: string }
interface ReconSession {
  id: string; period: string; statementDate: string; openingBalance: number; closingBalance: number;
  status: 'draft' | 'completed'; reconciledAt: string | null; reconciledBy: string | null; reconciledDiff: number | null;
}
interface ReconData {
  bank: { code: string; name: string; bank: string | null; accountNo: string | null; currency: string };
  session: ReconSession | null;
  ledgerBalance: number; statementBalance: number | null; difference: number | null;
  expectedDiff: number; unexplained: number | null; balanced: boolean; canFinalize: boolean;
  adjusted: { ledger: number; statement: number };
  adjustments: {
    bankOnlyIncome: BankOnlyItem[]; bankOnlyCharges: BankOnlyItem[];
    depositsInTransit: BookOnlyItem[]; outstanding: BookOnlyItem[];
  };
  lines: ReconLine[]; bookOnly: BookOnlyItem[];
  matchedCount: number; totalCount: number; unmatchedCount: number;
}
const LINE_TYPE_LABEL: Record<string, string> = {
  setoran: 'Setoran', penarikan: 'Penarikan', jasa_giro: 'Jasa giro', biaya_adm: 'Biaya adm',
  pajak_giro: 'Pajak giro', transfer: 'Transfer', lain: 'Lain'
};
const lastDayOfMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
};

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
  const [err, setErr] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  const { data: banks } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => (await api.get('/bank-accounts')).data.data as BankAccountOpt[]
  });
  const activeCode = bankCode || banks?.[0]?.account_code || '';
  const key = ['reconciliation', activeCode, month];
  const { data: d } = useQuery({
    queryKey: key,
    enabled: !!activeCode,
    queryFn: async () => (await api.get('/bank-reconciliations', { params: { bankAccountCode: activeCode, month } })).data.data as ReconData
  });

  const errMsg = (e: unknown) => (e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Terjadi kesalahan';
  const mut = <T,>(fn: (v: T) => Promise<unknown>) =>
    useMutation({
      mutationFn: fn,
      onMutate: () => setErr(''),
      onSuccess: () => qc.invalidateQueries({ queryKey: key }),
      onError: (e) => setErr(errMsg(e))
    });

  const match = mut<{ lineId: string; journalLineId?: string }>((v) =>
    api.post(`/bank-reconciliations/lines/${v.lineId}/match`, { journalLineId: v.journalLineId }));
  const adjust = mut<string>((lineId) => api.post(`/bank-reconciliations/lines/${lineId}/adjust`));
  const finalize = mut<string>((id) => api.post(`/bank-reconciliations/${id}/finalize`));

  if (!d) return <div className="text-[12.5px] text-muted-2">Memuat rekonsiliasi…</div>;

  const s = d.session;
  const locked = s?.status === 'completed';
  const sel = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <select className="fld !w-auto !py-2 font-semibold" value={activeCode} onChange={(e) => { setBankCode(e.target.value); setErr(''); }}>
        {banks?.map((b) => (
          <option key={b.account_code} value={b.account_code}>
            {b.account_code} · {b.name}{b.currency !== 'IDR' ? ` · ${b.currency}` : ''}
          </option>
        ))}
      </select>
      <input type="month" className="fld !w-[160px] !py-2" value={month} onChange={(e) => { setMonth(e.target.value); setErr(''); }} />
      {(d.bank.bank || d.bank.accountNo) && <span className="text-[11.5px] text-muted-2">{d.bank.bank} {d.bank.accountNo}</span>}
    </div>
  );

  // Belum ada sesi → form mulai rekonsiliasi
  if (!s) {
    return (
      <div>
        {sel}
        {err && <ErrBar msg={err} />}
        <StartReconciliation bankCode={activeCode} month={month} ledgerBalance={d.ledgerBalance}
          onDone={() => qc.invalidateQueries({ queryKey: key })} onError={setErr} />
      </div>
    );
  }

  const money = (n: number | null) => (n == null ? '—' : fmtFull(n));
  const tiles = [
    { label: 'Saldo Buku Besar', value: money(d.ledgerBalance), sub: `Akun ${d.bank.code} · s/d ${fmtDate(s.statementDate)}`, accent: 'oklch(0.52 0.08 165)' },
    { label: 'Saldo Rekening Koran', value: money(d.statementBalance), sub: 'diinput dari lembar bank', accent: 'oklch(0.52 0.09 245)' },
    { label: 'Selisih (Koran − Buku)', value: money(d.difference), sub: `${d.unmatchedCount} mutasi belum tercocok`, accent: 'oklch(0.56 0.11 78)' },
    {
      label: 'Selisih Tak Terjelaskan',
      value: d.balanced ? 'Rp 0' : money(d.unexplained),
      sub: d.balanced ? 'terjelaskan penuh ✓' : 'PERLU DITELUSURI',
      accent: d.balanced ? 'oklch(0.46 0.07 158)' : 'oklch(0.55 0.15 28)'
    }
  ];

  return (
    <div>
      {sel}
      {err && <ErrBar msg={err} />}

      {/* Bar status sesi */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-card border border-line bg-panel px-4 py-3">
        <span className="rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold"
          style={locked ? { background: 'oklch(0.95 0.03 158)', color: 'oklch(0.42 0.07 158)' } : { background: 'oklch(0.96 0.04 78)', color: 'oklch(0.5 0.1 78)' }}>
          {locked ? '● Selesai & terkunci' : '● Draft'}
        </span>
        <span className="text-[11.5px] text-muted-2">Periode {s.period} · cut-off {fmtDate(s.statementDate)} · saldo koran <b className="font-mono">{fmtFull(s.closingBalance)}</b></span>
        {locked && s.reconciledBy && (
          <span className="text-[11px] text-muted-3">Direkonsiliasi oleh {s.reconciledBy}{s.reconciledAt ? ` · ${fmtDate(s.reconciledAt)}` : ''}{s.reconciledDiff != null ? ` · sisa timing ${fmtFull(s.reconciledDiff)}` : ''}</span>
        )}
        <div className="ml-auto flex gap-2">
          {!locked && (
            <>
              <button onClick={() => setShowEdit(true)} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted">Ubah saldo/tanggal</button>
              <button onClick={() => setShowAdd(true)} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted">+ Mutasi</button>
              <button onClick={() => setShowImport(true)} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-3 py-1.5 text-[11.5px] font-semibold text-muted">Impor CSV</button>
              <button onClick={() => finalize.mutate(s.id)} disabled={!d.canFinalize || finalize.isPending}
                className="cursor-pointer rounded-[9px] bg-primary px-3.5 py-1.5 text-[11.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                title={d.canFinalize ? '' : 'Selesaikan setelah selisih terjelaskan & semua item bank diposting'}>
                Selesaikan Rekonsiliasi
              </button>
            </>
          )}
        </div>
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

      {/* Penyesuaian */}
      <div className="mb-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="mb-1 text-[12.5px] font-semibold">Item bank belum dibukukan</div>
          <div className="mb-2 text-[10.5px] text-muted-3">Ada di rekening koran, belum di buku besar — posting agar buku menyusul.</div>
          {[...d.adjustments.bankOnlyIncome, ...d.adjustments.bankOnlyCharges].map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-t border-[#f6f1e6] py-1.5 first:border-0 text-[11.5px]">
              <span className="rounded-pill bg-panel px-2 py-[2px] text-[9.5px] font-semibold text-muted-2">{LINE_TYPE_LABEL[a.lineType] ?? a.lineType}</span>
              <span className="text-muted">{a.description}</span>
              <span className="ml-auto font-mono" style={{ color: a.amount >= 0 ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.13 28)' }}>{fmtFull(a.amount)}</span>
              {!locked && a.postable && (
                <button onClick={() => adjust.mutate(a.id)} disabled={adjust.isPending}
                  className="cursor-pointer rounded-pill bg-primary px-2.5 py-[3px] text-[10px] font-semibold text-white disabled:opacity-50">Posting</button>
              )}
              {!locked && !a.postable && <span className="text-[10px] text-muted-4">cocokkan ke jurnal</span>}
            </div>
          ))}
          {d.adjustments.bankOnlyIncome.length + d.adjustments.bankOnlyCharges.length === 0 && (
            <div className="py-1.5 text-[11.5px] text-muted-3">Tidak ada — semua mutasi koran sudah dibukukan.</div>
          )}
        </div>
        <div className="rounded-card border border-line bg-card p-4 shadow-card">
          <div className="mb-1 text-[12.5px] font-semibold">Belum masuk koran (timing)</div>
          <div className="mb-2 text-[10.5px] text-muted-3">Sudah di buku besar, belum tampil di rekening koran — item pendamai, tak perlu jurnal.</div>
          {[...d.adjustments.depositsInTransit, ...d.adjustments.outstanding].map((a) => (
            <div key={a.id} className="flex items-center gap-2 border-t border-[#f6f1e6] py-1.5 first:border-0 text-[11.5px]">
              <span className="text-muted">{a.description}</span>
              <span className="font-mono text-[10px] text-muted-4">{a.journalNo}</span>
              <span className="ml-auto font-mono" style={{ color: a.amount >= 0 ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.13 28)' }}>{fmtFull(a.amount)}</span>
            </div>
          ))}
          {d.adjustments.depositsInTransit.length + d.adjustments.outstanding.length === 0 && (
            <div className="py-1.5 text-[11.5px] text-muted-3">Tidak ada item timing.</div>
          )}
        </div>
      </div>

      {/* Pencocokan mutasi */}
      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="flex items-center justify-between border-b border-line-3 px-5 py-3.5">
          <span className="text-[14px] font-semibold">Pencocokan Mutasi Rekening Koran</span>
          <span className="text-[11.5px] text-muted-2">{d.matchedCount} dari {d.totalCount} mutasi tercocok</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
                <th className="px-5 py-[11px] font-semibold">Tanggal</th><th className="px-3 py-[11px] font-semibold">Keterangan</th>
                <th className="px-3 py-[11px] font-semibold">Tipe</th><th className="px-3 py-[11px] font-semibold">Cocok dgn</th>
                <th className="px-3 py-[11px] text-right font-semibold">Nominal</th><th className="px-5 py-[11px] font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map((l) => (
                <tr key={l.id} className="border-t border-line-3">
                  <td className="whitespace-nowrap px-5 py-3 text-muted">{fmtDate(l.date)}</td>
                  <td className="px-3 py-3 font-medium">{l.description}</td>
                  <td className="px-3 py-3"><span className="rounded-pill bg-panel px-2 py-[2px] text-[9.5px] font-semibold text-muted-2">{LINE_TYPE_LABEL[l.lineType] ?? l.lineType}</span></td>
                  <td className="px-3 py-3 font-mono text-[11px] text-muted-2">{l.status === 'matched' ? l.source : '—'}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-mono font-semibold" style={{ color: l.amount >= 0 ? 'oklch(0.46 0.07 158)' : 'oklch(0.5 0.13 28)' }}>
                    {l.amount >= 0 ? '+' : '−'}{fmtFull(Math.abs(l.amount)).slice(3)}
                  </td>
                  <td className="px-5 py-3">
                    {l.status === 'matched' ? (
                      locked
                        ? <span className="rounded-pill bg-[oklch(0.95_0.03_158)] px-2.5 py-[3px] text-[10.5px] font-semibold text-[oklch(0.42_0.07_158)]">✓ Cocok</span>
                        : <button onClick={() => match.mutate({ lineId: l.id })} disabled={match.isPending}
                            className="cursor-pointer rounded-pill bg-[oklch(0.95_0.03_158)] px-2.5 py-[3px] text-[10.5px] font-semibold text-[oklch(0.42_0.07_158)]" title="Batalkan pencocokan">✓ Cocok · batalkan</button>
                    ) : locked ? (
                      <span className="text-[10.5px] text-muted-4">belum tercocok</span>
                    ) : l.suggestion ? (
                      <button onClick={() => match.mutate({ lineId: l.id, journalLineId: l.suggestion!.journalLineId })} disabled={match.isPending}
                        className="cursor-pointer rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold text-white" style={{ background: 'oklch(0.58 0.12 45)' }}
                        title={`Cocokkan ke jurnal ${l.suggestion.journalNo}`}>
                        Cocokkan → {l.suggestion.journalNo}
                      </button>
                    ) : ['jasa_giro', 'biaya_adm', 'pajak_giro'].includes(l.lineType) ? (
                      <button onClick={() => adjust.mutate(l.id)} disabled={adjust.isPending}
                        className="cursor-pointer rounded-pill bg-primary px-2.5 py-[3px] text-[10.5px] font-semibold text-white disabled:opacity-50">Posting</button>
                    ) : (
                      <span className="text-[10.5px] text-muted-4">tak ada padanan</span>
                    )}
                  </td>
                </tr>
              ))}
              {d.lines.length === 0 && <tr><td colSpan={6} className="px-5 py-6 text-muted-2">Belum ada mutasi rekening koran. Tambah manual atau impor CSV.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showEdit && <EditSessionModal data={d} month={month} onClose={() => setShowEdit(false)} onDone={() => { setShowEdit(false); qc.invalidateQueries({ queryKey: key }); }} onError={setErr} />}
      {showAdd && <AddLineModal sessionId={s.id} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); qc.invalidateQueries({ queryKey: key }); }} onError={setErr} />}
      {showImport && <ImportModal sessionId={s.id} onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); qc.invalidateQueries({ queryKey: key }); }} onError={setErr} />}
    </div>
  );
}

function ErrBar({ msg }: { msg: string }) {
  return <div className="mb-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{msg}</div>;
}

function StartReconciliation({ bankCode, month, ledgerBalance, onDone, onError }: {
  bankCode: string; month: string; ledgerBalance: number; onDone: () => void; onError: (m: string) => void;
}) {
  const [statementDate, setStatementDate] = useState(lastDayOfMonth(month));
  const [closing, setClosing] = useState('');
  const open = useMutation({
    mutationFn: async () => api.post('/bank-reconciliations', {
      bankAccountCode: bankCode, period: month, statementDate, closingBalance: Number(closing)
    }),
    onSuccess: onDone,
    onError: (e) => onError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal membuka sesi')
  });
  return (
    <div className="rounded-card border border-line bg-card p-6 shadow-card">
      <div className="font-display text-[17px] text-ink-strong">Mulai Rekonsiliasi {month}</div>
      <p className="mt-1 mb-4 max-w-[560px] text-[12px] text-muted-2">
        Masukkan <b>saldo akhir dari lembar rekening koran</b> bank (angka riil dari bank), lalu sistem
        membandingkannya dengan saldo buku besar untuk menemukan selisih. Saldo buku besar akun {bankCode} saat ini
        <b className="font-mono"> {fmtFull(ledgerBalance)}</b>.
      </p>
      <div className="grid max-w-[520px] grid-cols-2 gap-3">
        <div><label className="lbl">Tanggal cut-off koran</label><input type="date" className="fld" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
        <div><label className="lbl">Saldo akhir rekening koran (Rp)</label><input type="number" className="fld font-mono" placeholder="mis. 83477000" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
      </div>
      <button onClick={() => closing !== '' && open.mutate()} disabled={closing === '' || open.isPending}
        className="mt-4 cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
        {open.isPending ? 'Membuka…' : 'Buka Sesi Rekonsiliasi'}
      </button>
    </div>
  );
}

function EditSessionModal({ data, month, onClose, onDone, onError }: {
  data: ReconData; month: string; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const s = data.session!;
  const [statementDate, setStatementDate] = useState(String(s.statementDate).slice(0, 10));
  const [closing, setClosing] = useState(String(s.closingBalance));
  const save = useMutation({
    mutationFn: async () => api.post('/bank-reconciliations', {
      bankAccountCode: data.bank.code, period: month, statementDate, closingBalance: Number(closing)
    }),
    onSuccess: onDone,
    onError: (e) => onError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });
  return (
    <Modal title="Ubah Saldo & Tanggal Koran" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="lbl">Tanggal cut-off</label><input type="date" className="fld" value={statementDate} onChange={(e) => setStatementDate(e.target.value)} /></div>
        <div><label className="lbl">Saldo akhir koran (Rp)</label><input type="number" className="fld font-mono" value={closing} onChange={(e) => setClosing(e.target.value)} /></div>
      </div>
      <ModalActions onClose={onClose} onSave={() => save.mutate()} saving={save.isPending} />
    </Modal>
  );
}

function AddLineModal({ sessionId, onClose, onDone, onError }: {
  sessionId: string; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState({ lineDate: '', description: '', amount: '', lineType: 'setoran' });
  const add = useMutation({
    mutationFn: async () => api.post(`/bank-reconciliations/${sessionId}/lines`, {
      lineDate: f.lineDate, description: f.description, amount: Number(f.amount), lineType: f.lineType
    }),
    onSuccess: onDone,
    onError: (e) => onError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menambah')
  });
  const valid = f.lineDate && f.description.length >= 2 && f.amount !== '' && Number(f.amount) !== 0;
  return (
    <Modal title="Tambah Mutasi Rekening Koran" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="lbl">Tanggal</label><input type="date" className="fld" value={f.lineDate} onChange={(e) => setF({ ...f, lineDate: e.target.value })} /></div>
        <div><label className="lbl">Tipe</label>
          <select className="fld" value={f.lineType} onChange={(e) => setF({ ...f, lineType: e.target.value })}>
            {Object.entries(LINE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="col-span-2"><label className="lbl">Keterangan</label><input className="fld" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="mis. Setoran tunai jamaah" /></div>
        <div className="col-span-2"><label className="lbl">Nominal (Rp — negatif untuk uang keluar)</label><input type="number" className="fld font-mono" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="mis. 500000 atau -185000" /></div>
      </div>
      <ModalActions onClose={onClose} onSave={() => valid && add.mutate()} saving={add.isPending} disabled={!valid} />
    </Modal>
  );
}

function ImportModal({ sessionId, onClose, onDone, onError }: {
  sessionId: string; onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const parse = () => text.split('\n').map((ln) => ln.trim()).filter(Boolean).map((ln) => {
    const [lineDate, description, amount, lineType, externalRef] = ln.split(',').map((x) => x.trim());
    return { lineDate, description, amount: Number(amount), lineType: lineType || 'lain', externalRef: externalRef || null };
  }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.lineDate) && r.description && !Number.isNaN(r.amount) && r.amount !== 0);
  const rows = parse();
  const imp = useMutation({
    mutationFn: async () => api.post(`/bank-reconciliations/${sessionId}/import`, { rows }),
    onSuccess: onDone,
    onError: (e) => onError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal impor')
  });
  return (
    <Modal title="Impor Mutasi (CSV)" onClose={onClose}>
      <p className="mb-2 text-[11.5px] text-muted-2">Format per baris: <code className="font-mono text-[11px]">tanggal,keterangan,nominal[,tipe[,ref]]</code>. Contoh:</p>
      <pre className="mb-2 overflow-x-auto rounded-[8px] bg-panel p-2 text-[10.5px] text-muted-2">2026-07-05,Setoran tunai,500000,setoran{'\n'}2026-07-31,Jasa giro,62000,jasa_giro,GIRO-07</pre>
      <textarea className="fld h-40 w-full font-mono !text-[11px]" value={text} onChange={(e) => setText(e.target.value)} placeholder="Tempel baris CSV di sini…" />
      <div className="mt-1 text-[11px] text-muted-3">{rows.length} baris valid terbaca.</div>
      <ModalActions onClose={onClose} onSave={() => rows.length > 0 && imp.mutate()} saving={imp.isPending} disabled={rows.length === 0} saveLabel={`Impor ${rows.length} baris`} />
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[560px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div className="mb-4 font-display text-[18px] text-ink-strong">{title}</div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onClose, onSave, saving, disabled, saveLabel }: {
  onClose: () => void; onSave: () => void; saving: boolean; disabled?: boolean; saveLabel?: string;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <button onClick={onClose} className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted">Batal</button>
      <button onClick={onSave} disabled={saving || disabled}
        className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
        {saving ? 'Menyimpan…' : (saveLabel ?? 'Simpan')}
      </button>
    </div>
  );
}
