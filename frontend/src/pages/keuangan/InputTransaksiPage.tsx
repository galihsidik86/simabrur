import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtFull, fmtShort, fmtDate } from '../../utils/format';
import { ACC_CLASS_COLOR } from './KeuanganPage';

/* ===== Tipe & konstanta (struktur mockup Input Transaksi.dc.html) ===== */
const TX_TYPES = [
  { key: 'terima', label: 'Terima Pembayaran', desc: 'Penerimaan dari jamaah', dot: 'oklch(0.55 0.09 245)' },
  { key: 'biaya', label: 'Pembayaran Biaya', desc: 'Ke vendor / operasional', dot: 'oklch(0.58 0.12 45)' },
  { key: 'pendapatan', label: 'Pengakuan Pendapatan', desc: 'Saat keberangkatan (PSAK 72)', dot: 'oklch(0.5 0.09 158)' },
  { key: 'komisi', label: 'Pengakuan Komisi', desc: 'Komisi agen mitra', dot: 'oklch(0.52 0.1 322)' }
] as const;
type TxType = (typeof TX_TYPES)[number]['key'];

const BIAYA_ACCOUNTS = [
  ['1-1400', 'Uang Muka Vendor'], ['5-1000', 'Beban Tiket Maskapai'], ['5-2000', 'Beban Hotel & Akomodasi'],
  ['5-3000', 'Beban Visa'], ['5-4000', 'Beban Katering / Konsumsi'], ['5-5000', 'Beban Transportasi & Handling'],
  ['5-6000', 'Beban Muthawwif / TL'], ['5-7000', 'Beban Perlengkapan Jamaah'], ['6-5000', 'Beban Administrasi & Umum']
] as const;

interface BankAccount { account_code: string; name: string; currency: string }
interface CostCenter { id: string; code: string; name: string }
interface Receivable { invoiceId: string; regNumber: string; name: string; remaining: number }
interface DocSchedule { id: string; label: string; amount: number; dueDate: string; status: string }
interface PreviewLine { code: string; name: string; debit: number; credit: number; foreign?: string }

const today = () => new Date().toISOString().slice(0, 10);

export function InputTransaksiPage() {
  const qc = useQueryClient();
  const [tx, setTx] = useState<TxType>('terima');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Referensi
  const { data: banks } = useQuery({ queryKey: ['bank-accounts'], queryFn: async () => (await api.get('/bank-accounts')).data.data as BankAccount[] });
  const { data: ccs } = useQuery({ queryKey: ['cost-centers'], queryFn: async () => (await api.get('/cost-centers')).data.data as CostCenter[] });
  const { data: recv } = useQuery({ queryKey: ['receivables'], queryFn: async () => (await api.get('/receivables')).data.data as { data: Receivable[] } });

  // ---- state form Terima ----
  const [tInvoice, setTInvoice] = useState('');
  const [tSchedule, setTSchedule] = useState('');
  const [tBank, setTBank] = useState('1-1200');
  const [tMethod, setTMethod] = useState('va');
  const [tDate, setTDate] = useState(today());
  const [tAmount, setTAmount] = useState(25_000_000);
  const { data: tDoc } = useQuery({
    queryKey: ['invoice-doc', tInvoice],
    enabled: Boolean(tInvoice),
    queryFn: async () => (await api.get(`/invoices/${tInvoice}/document`)).data.data as { schedules: DocSchedule[] }
  });

  // ---- state form Biaya ----
  const [bVendor, setBVendor] = useState('Grand Al Massa Hotel');
  const [bCc, setBCc] = useState('');
  const [bBank, setBBank] = useState('1-1220');
  const [bKurs, setBKurs] = useState(4150);
  const [bSettle, setBSettle] = useState(false);
  const [bKursHutang, setBKursHutang] = useState(4100);
  const [bDate, setBDate] = useState(today());
  const [bLines, setBLines] = useState([
    { accountCode: '5-2000', amount: 45_000 },
    { accountCode: '5-4000', amount: 12_000 }
  ]);
  const bCurrency = banks?.find((b) => b.account_code === bBank)?.currency ?? 'IDR';
  const bRate = bCurrency === 'IDR' ? 1 : bKurs;

  // ---- state form Pendapatan ----
  const [pCc, setPCc] = useState('');
  const [pAccount, setPAccount] = useState<'4-1000' | '4-2000'>('4-1000');
  const [pDate, setPDate] = useState(today());
  const [pAmount, setPAmount] = useState(0);

  // ---- state form Komisi ----
  const [kAgent, setKAgent] = useState('Barokah Tour — BRKH-07');
  const [kCc, setKCc] = useState('');
  const [kDate, setKDate] = useState(today());
  const [kBase, setKBase] = useState(141_000_000);
  const [kPct, setKPct] = useState(3);
  const komisi = Math.round((kBase * kPct) / 100);

  /* ===== Preview jurnal (mencerminkan template engine) ===== */
  const preview: { desc: string; lines: PreviewLine[]; note: string } = useMemo(() => {
    const bankName = (code: string) => banks?.find((b) => b.account_code === code)?.name ?? code;
    if (tx === 'terima') {
      return {
        desc: 'Penerimaan pembayaran jamaah',
        lines: [
          { code: tBank, name: bankName(tBank), debit: tAmount, credit: 0 },
          { code: '2-1100', name: 'Uang Muka Jamaah', debit: 0, credit: tAmount }
        ],
        note: 'Dana jamaah dicatat sebagai LIABILITAS (akad wakalah) — bukan pendapatan.'
      };
    }
    if (tx === 'biaya') {
      const totalForeign = bLines.reduce((s, l) => s + (l.amount || 0), 0);
      const totalIdr = Math.round(totalForeign * bRate);
      if (bCurrency !== 'IDR' && bSettle && bKursHutang !== bRate) {
        const debtIdr = Math.round(totalForeign * bKursHutang);
        const diff = totalIdr - debtIdr;
        const lines: PreviewLine[] = [{ code: '2-1300', name: 'Hutang Vendor', debit: debtIdr, credit: 0, foreign: `${totalForeign.toLocaleString('id-ID')} ${bCurrency}` }];
        if (diff > 0) lines.push({ code: '7-1000', name: 'Rugi Selisih Kurs', debit: diff, credit: 0 });
        if (diff < 0) lines.push({ code: '7-1000', name: 'Laba Selisih Kurs', debit: 0, credit: -diff });
        lines.push({ code: bBank, name: bankName(bBank), debit: 0, credit: totalIdr, foreign: `${totalForeign.toLocaleString('id-ID')} ${bCurrency}` });
        return { desc: `Pelunasan hutang vendor — ${bVendor}`, lines, note: `Realisasi selisih kurs: hutang @${bKursHutang.toLocaleString('id-ID')} dibayar @${bRate.toLocaleString('id-ID')} → 7-1000.` };
      }
      return {
        desc: `Pembayaran biaya — ${bVendor}`,
        lines: [
          ...bLines.map((l) => ({
            code: l.accountCode,
            name: BIAYA_ACCOUNTS.find((a) => a[0] === l.accountCode)?.[1] ?? l.accountCode,
            debit: Math.round((l.amount || 0) * bRate), credit: 0,
            foreign: bCurrency !== 'IDR' ? `${(l.amount || 0).toLocaleString('id-ID')} ${bCurrency}` : undefined
          })),
          { code: bBank, name: bankName(bBank), debit: 0, credit: totalIdr, foreign: bCurrency !== 'IDR' ? `${totalForeign.toLocaleString('id-ID')} ${bCurrency}` : undefined }
        ],
        note: bCurrency !== 'IDR' ? `Transaksi valas dicatat pada IDR fungsional memakai kurs ${bRate.toLocaleString('id-ID')}.` : 'Biaya dibebankan per cost center keberangkatan.'
      };
    }
    if (tx === 'pendapatan') {
      return {
        desc: 'Pengakuan pendapatan (PSAK 72)',
        lines: [
          { code: '2-1100', name: 'Uang Muka Jamaah', debit: pAmount, credit: 0 },
          { code: pAccount, name: pAccount === '4-1000' ? 'Pendapatan Jasa Umrah' : 'Pendapatan Jasa Haji Khusus', debit: 0, credit: pAmount }
        ],
        note: 'Reclass Uang Muka Jamaah → Pendapatan saat penyelesaian jasa, diikuti pengakuan HPP.'
      };
    }
    return {
      desc: `Komisi agen — ${kAgent}`,
      lines: [
        { code: '6-2000', name: 'Beban Komisi Agen', debit: komisi, credit: 0 },
        { code: '2-1400', name: 'Hutang Komisi Agen', debit: 0, credit: komisi }
      ],
      note: 'Komisi diakui sebagai beban + hutang; dibayar terpisah dari kas.'
    };
  }, [tx, tBank, tAmount, banks, bLines, bRate, bCurrency, bSettle, bKursHutang, bVendor, bBank, pAmount, pAccount, kAgent, komisi]);

  const totalDebit = preview.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = preview.lines.reduce((s, l) => s + l.credit, 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  /* ===== Simpan & Posting ===== */
  const save = useMutation({
    mutationFn: async () => {
      setError(''); setSuccess('');
      if (tx === 'terima') {
        const { data } = await api.post('/transactions/receipt',
          { invoiceId: tInvoice, scheduleId: tSchedule || null, bankAccountCode: tBank, amount: tAmount, date: tDate, method: tMethod },
          { headers: { 'Idempotency-Key': crypto.randomUUID() } });
        return `Tersimpan — jurnal ${data.data.journal?.journalNo ?? ''} + kwitansi ${data.data.receipt?.number ?? ''}`;
      }
      if (tx === 'biaya') {
        const { data } = await api.post('/transactions/expense', {
          vendorName: bVendor, costCenterId: bCc || null, sourceBankCode: bBank,
          exchangeRate: bCurrency === 'IDR' ? null : bKurs,
          settleDebt: bCurrency !== 'IDR' && bSettle,
          exchangeRateAtRecognition: bSettle ? bKursHutang : null,
          date: bDate, lines: bLines.filter((l) => l.amount > 0)
        });
        return `Tersimpan — jurnal ${data.data.journal_no} (balance ✓)`;
      }
      if (tx === 'pendapatan') {
        const { data } = await api.post('/transactions/revenue-recognition', {
          costCenterId: pCc, revenueAccountCode: pAccount, amount: pAmount, date: pDate
        });
        return `Tersimpan — jurnal ${data.data.revenue.journal_no}`;
      }
      const { data } = await api.post('/transactions/commission', { agentName: kAgent, costCenterId: kCc || null, base: kBase, pct: kPct, date: kDate });
      return `Tersimpan — jurnal ${data.data.journal_no}`;
    },
    onSuccess: (msg) => {
      setSuccess(msg);
      qc.invalidateQueries();
    },
    onError: (e: unknown) => setError((e as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message ?? 'Gagal menyimpan')
  });

  const canSave = balanced && (tx !== 'terima' || Boolean(tInvoice)) && (tx !== 'pendapatan' || Boolean(pCc));
  const rowStyle = (on: boolean, dot: string) => on
    ? { borderColor: dot, background: '#fffdf8', boxShadow: 'var(--shadow-card)' }
    : { borderColor: '#e5dcc8', background: '#f7f2e8' };

  return (
    <div>
      {/* Selector 4 tipe */}
      <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
        {TX_TYPES.map((t) => (
          <button key={t.key} onClick={() => { setTx(t.key); setError(''); setSuccess(''); }}
            className="cursor-pointer rounded-[11px] border p-3.5 text-left" style={rowStyle(tx === t.key, t.dot)}>
            <span className="mb-1.5 block h-[9px] w-[9px] rounded-[3px]" style={{ background: t.dot }} />
            <div className="text-[12.5px] font-semibold">{t.label}</div>
            <div className="text-[10.5px] text-muted-3">{t.desc}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[1.35fr_1fr] gap-4 max-lg:grid-cols-1">
        {/* ===== FORM ===== */}
        <div className="rounded-card border border-line bg-card p-5 shadow-card">
          {tx === 'terima' && (
            <div className="grid grid-cols-2 gap-3.5">
              <div className="col-span-2">
                <label className="lbl">Jamaah / Invoice</label>
                <select className="fld" value={tInvoice} onChange={(e) => { setTInvoice(e.target.value); setTSchedule(''); }}>
                  <option value="">— pilih jamaah —</option>
                  {recv?.data.filter((r) => r.remaining > 0).map((r) => (
                    <option key={r.invoiceId} value={r.invoiceId}>{r.name} — {r.regNumber} (sisa {fmtShort(r.remaining)})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="lbl">Jenis Pembayaran / Termin</label>
                <select className="fld" value={tSchedule} onChange={(e) => {
                  setTSchedule(e.target.value);
                  const s = tDoc?.schedules.find((x) => x.id === e.target.value);
                  if (s) setTAmount(s.amount);
                }}>
                  <option value="">— pilih termin —</option>
                  {tDoc?.schedules.filter((s) => s.status === 'unpaid').map((s) => (
                    <option key={s.id} value={s.id}>{s.label} · {fmtFull(s.amount)} · tempo {fmtDate(s.dueDate)}</option>
                  ))}
                </select>
              </div>
              <div><label className="lbl">Tanggal Terima</label><input type="date" className="fld" value={tDate} onChange={(e) => setTDate(e.target.value)} /></div>
              <div>
                <label className="lbl">Rekening Tujuan</label>
                <select className="fld" value={tBank} onChange={(e) => setTBank(e.target.value)}>
                  {banks?.map((b) => <option key={b.account_code} value={b.account_code}>{b.account_code} {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Metode</label>
                <select className="fld" value={tMethod} onChange={(e) => setTMethod(e.target.value)}>
                  <option value="va">Transfer / VA</option><option value="cash">Setor Tunai</option><option value="card">Kartu</option><option value="transfer">Transfer Manual</option>
                </select>
              </div>
              <div><label className="lbl">Jumlah Diterima (Rp)</label><input type="number" className="fld font-mono" value={tAmount || ''} onChange={(e) => setTAmount(Number(e.target.value))} /></div>
            </div>
          )}

          {tx === 'biaya' && (
            <div className="grid grid-cols-2 gap-3.5">
              <div><label className="lbl">Vendor / Penerima</label><input className="fld" value={bVendor} onChange={(e) => setBVendor(e.target.value)} /></div>
              <div>
                <label className="lbl">Cost Center / Keberangkatan</label>
                <select className="fld" value={bCc} onChange={(e) => setBCc(e.target.value)}>
                  <option value="">Umum (non-CC)</option>
                  {ccs?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Rekening Sumber</label>
                <select className="fld" value={bBank} onChange={(e) => setBBank(e.target.value)}>
                  {banks?.map((b) => <option key={b.account_code} value={b.account_code}>{b.account_code} {b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Kurs {bCurrency === 'IDR' ? '(IDR = 1)' : `(Rp / ${bCurrency})`}</label>
                <input type="number" className="fld font-mono" value={bCurrency === 'IDR' ? 1 : bKurs} disabled={bCurrency === 'IDR'} onChange={(e) => setBKurs(Number(e.target.value))} />
              </div>
              {bCurrency !== 'IDR' && (
                <div className="col-span-2 flex items-center gap-3 rounded-[9px] bg-panel px-3.5 py-2.5">
                  <button type="button" onClick={() => setBSettle(!bSettle)}
                    className="relative h-5 w-9 cursor-pointer rounded-full transition-colors"
                    style={{ background: bSettle ? 'var(--color-primary)' : '#d9cfb9' }}>
                    <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: bSettle ? 18 : 2 }} />
                  </button>
                  <span className="text-[12px]">Pelunasan hutang vendor (realisasi selisih kurs → 7-1000)</span>
                  {bSettle && (
                    <input type="number" className="fld ml-auto !w-[130px] font-mono" title="Kurs saat pengakuan hutang" value={bKursHutang} onChange={(e) => setBKursHutang(Number(e.target.value))} />
                  )}
                </div>
              )}
              <div className="col-span-2">
                <label className="lbl">Rincian Biaya {bCurrency !== 'IDR' && `(dalam ${bCurrency})`}</label>
                <div className="flex flex-col gap-2">
                  {bLines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <select className="fld flex-1" value={l.accountCode} disabled={bSettle}
                        onChange={(e) => setBLines(bLines.map((x, j) => (j === i ? { ...x, accountCode: e.target.value } : x)))}>
                        {BIAYA_ACCOUNTS.map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}
                      </select>
                      <input type="number" className="fld !w-[150px] font-mono" value={l.amount || ''}
                        onChange={(e) => setBLines(bLines.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                      {bLines.length > 1 && !bSettle && (
                        <button type="button" onClick={() => setBLines(bLines.filter((_, j) => j !== i))}
                          className="cursor-pointer rounded-[9px] border border-line-2 px-3 text-[12px] text-danger-deep">×</button>
                      )}
                    </div>
                  ))}
                </div>
                {!bSettle && (
                  <button type="button" onClick={() => setBLines([...bLines, { accountCode: '5-3000', amount: 0 }])}
                    className="mt-2 cursor-pointer text-[11.5px] font-semibold text-primary hover:underline">+ Tambah baris akun</button>
                )}
              </div>
              <div><label className="lbl">Tanggal</label><input type="date" className="fld" value={bDate} onChange={(e) => setBDate(e.target.value)} /></div>
              <div className="flex items-end justify-end pb-1 text-[12.5px]">
                Total dibayar: <span className="ml-2 font-mono font-bold">{fmtFull(Math.round(bLines.reduce((s, l) => s + (l.amount || 0), 0) * bRate))}</span>
              </div>
            </div>
          )}

          {tx === 'pendapatan' && (
            <div className="grid grid-cols-2 gap-3.5">
              <div className="col-span-2">
                <label className="lbl">Keberangkatan / Cost Center</label>
                <select className="fld" value={pCc} onChange={(e) => setPCc(e.target.value)}>
                  <option value="">— pilih keberangkatan —</option>
                  {ccs?.filter((c) => c.code.startsWith('CC-')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="lbl">Akun Pendapatan</label>
                <select className="fld" value={pAccount} onChange={(e) => setPAccount(e.target.value as typeof pAccount)}>
                  <option value="4-1000">4-1000 Pendapatan Jasa Umrah</option>
                  <option value="4-2000">4-2000 Pendapatan Jasa Haji Khusus</option>
                </select>
              </div>
              <div><label className="lbl">Tanggal Penyelesaian Jasa</label><input type="date" className="fld" value={pDate} onChange={(e) => setPDate(e.target.value)} /></div>
              <div className="col-span-2"><label className="lbl">Nilai Pendapatan Diakui (Rp)</label><input type="number" className="fld font-mono" value={pAmount || ''} onChange={(e) => setPAmount(Number(e.target.value))} /></div>
              <div className="col-span-2 rounded-[9px] bg-[oklch(0.97_0.02_158)] px-3.5 py-2.5 text-[11px] leading-relaxed text-[oklch(0.4_0.06_158)]">
                <b>PSAK 72:</b> pendapatan diakui saat kewajiban jasa terpenuhi (keberangkatan) — reclass Uang Muka Jamaah → Pendapatan, diikuti pengakuan HPP dari Uang Muka Vendor.
              </div>
            </div>
          )}

          {tx === 'komisi' && (
            <div className="grid grid-cols-2 gap-3.5">
              <div><label className="lbl">Agen / Mitra</label><input className="fld" value={kAgent} onChange={(e) => setKAgent(e.target.value)} /></div>
              <div>
                <label className="lbl">Terkait Keberangkatan</label>
                <select className="fld" value={kCc} onChange={(e) => setKCc(e.target.value)}>
                  <option value="">MKT — Umum</option>
                  {ccs?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div><label className="lbl">Tanggal</label><input type="date" className="fld" value={kDate} onChange={(e) => setKDate(e.target.value)} /></div>
              <div><label className="lbl">Dasar Komisi / Omzet (Rp)</label><input type="number" className="fld font-mono" value={kBase || ''} onChange={(e) => setKBase(Number(e.target.value))} /></div>
              <div><label className="lbl">Persentase Komisi (%)</label><input type="number" step="0.5" className="fld font-mono" value={kPct || ''} onChange={(e) => setKPct(Number(e.target.value))} /></div>
              <div className="flex items-end">
                <div className="w-full rounded-[9px] px-3.5 py-2.5 text-[12px]" style={{ background: 'oklch(0.96 0.03 322)', color: 'oklch(0.4 0.1 322)' }}>
                  Komisi terhitung: <b className="font-mono">{fmtFull(komisi)}</b>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== PREVIEW JURNAL (panel gelap mockup) ===== */}
        <div className="h-fit rounded-card p-5 text-[#e8e0cf] shadow-float lg:sticky lg:top-2" style={{ background: '#16211b' }}>
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[16px]">Preview Jurnal</span>
            <span className="font-mono text-[10.5px] text-[#9fb0a4]">JV-2026-xxxx · {fmtDate(today())}</span>
          </div>
          <div className="mt-1 text-[11px] text-[#9fb0a4]">{preview.desc}</div>

          <table className="mt-3 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-b border-white/15 text-left text-[9.5px] uppercase tracking-[0.5px] text-[#9fb0a4]">
                <th className="py-1.5 font-semibold">Akun</th>
                <th className="py-1.5 text-right font-semibold">Debit</th>
                <th className="py-1.5 text-right font-semibold">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((l, i) => (
                <tr key={i} className="border-b border-white/[0.07]">
                  <td className="py-2" style={{ paddingLeft: l.credit > 0 ? 14 : 0 }}>
                    <span className="font-mono text-[10px] font-semibold" style={{ color: ACC_CLASS_COLOR[Number(l.code[0])] }}>{l.code}</span>
                    <span className="ml-1.5">{l.name}</span>
                    {l.foreign && <div className="font-mono text-[9px] text-[#9fb0a4]">{l.foreign}</div>}
                  </td>
                  <td className="py-2 text-right font-mono">{l.debit ? l.debit.toLocaleString('id-ID') : ''}</td>
                  <td className="py-2 text-right font-mono">{l.credit ? l.credit.toLocaleString('id-ID') : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-[11px] font-semibold">
                <td className="py-2">
                  {balanced
                    ? <span style={{ color: 'oklch(0.72 0.09 158)' }}>● Seimbang</span>
                    : <span style={{ color: '#c3a24f' }}>○ Isi jumlah</span>}
                </td>
                <td className="py-2 text-right font-mono">{totalDebit.toLocaleString('id-ID')}</td>
                <td className="py-2 text-right font-mono">{totalCredit.toLocaleString('id-ID')}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-2 text-[10px] leading-relaxed text-[#9fb0a4]">{preview.note}</div>

          {error && <div className="mt-3 rounded-[8px] bg-[oklch(0.3_0.08_28)] px-3 py-2 text-[11px] text-[oklch(0.85_0.06_30)]">{error}</div>}
          {success && <div className="mt-3 rounded-[8px] bg-[oklch(0.3_0.05_158)] px-3 py-2 text-[11px] text-[oklch(0.85_0.05_158)]">{success}</div>}

          <div className="mt-4 flex gap-2">
            <button onClick={() => canSave && save.mutate()} disabled={!canSave || save.isPending}
              className="flex-1 rounded-[9px] px-4 py-2.5 text-[13px] font-bold text-[#20180a]"
              style={{ background: canSave ? 'oklch(0.62 0.11 78)' : 'oklch(0.4 0.03 78)', cursor: canSave ? 'pointer' : 'not-allowed' }}>
              {save.isPending ? 'Memposting…' : 'Simpan & Posting'}
            </button>
            <button onClick={() => { setError(''); setSuccess(''); }}
              className="cursor-pointer rounded-[9px] border border-white/20 px-4 py-2.5 text-[13px] font-semibold text-[#e8e0cf]">
              Batal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
