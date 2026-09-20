import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../api/client';
import { useAuth } from '../../store/auth';
import { FINANCE_WRITE_ROLES, hasRole } from '../../routes/access';
import { refundStatusPill, type RefundDto, type RefundStatus } from '../../api/refunds';
import { fmtFull, fmtDate, todayWib } from '../../utils/format';
import { ACC_CLASS_COLOR } from '../keuangan/KeuanganPage';

const FILTERS: { key: RefundStatus; label: string }[] = [
  { key: 'pending', label: 'Menunggu Pembayaran' },
  { key: 'paid', label: 'Sudah Dibayar' }
];
const PILL_CLASS = 'rounded-pill px-2.5 py-[3px] text-[10.5px] font-semibold';

/** Query yang berubah setelah refund dibayar (jurnal Dr 2-1100 / Cr Bank / Cr 4-9000). */
const PAY_AFFECTED_QUERIES = [
  'refunds', 'jamaah-detail', 'accounting-summary', 'journals', 'ledger', 'accounts', 'bank-accounts',
  'income-statement', 'balance-sheet', 'profit-by-package', 'dashboard'
] as const;

/* ===== Tab Refund Pembatalan (keuangan/admin bayar, pimpinan read-only) ===== */
export function RefundTab() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState<RefundStatus>('pending');
  const [paying, setPaying] = useState<RefundDto | null>(null);
  const [notice, setNotice] = useState('');
  const canPay = hasRole(user?.role, FINANCE_WRITE_ROLES);

  const { data, error, isLoading } = useQuery({
    queryKey: ['refunds', status],
    queryFn: async () => (await api.get('/refunds', { params: { status } })).data.data as RefundDto[]
  });

  const handlePaid = (dto: RefundDto) => {
    setPaying(null);
    setNotice(`Refund ${dto.regNumber} dibayar ${fmtFull(dto.refundAmount)}${dto.journalNumber ? ` — jurnal ${dto.journalNumber}` : ''}.`);
    PAY_AFFECTED_QUERIES.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
  };

  return (
    <div>
      <div className="mb-[18px] flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => {
          const on = f.key === status;
          return (
            <button key={f.key} onClick={() => { setStatus(f.key); setNotice(''); }}
              className="cursor-pointer rounded-[8px] border px-3.5 py-[7px] text-[12.5px] font-semibold"
              style={on
                ? { color: '#fff', background: 'var(--color-primary)', borderColor: 'var(--color-primary)' }
                : { color: '#6f6858', background: '#fff', borderColor: '#e6ddca' }}>
              {f.label}
            </button>
          );
        })}
        {!canPay && <span className="ml-auto text-[11px] text-muted-3">Mode baca — pembayaran refund dilakukan oleh Keuangan.</span>}
      </div>

      {notice && <div role="status" className="mb-4 rounded-[9px] bg-success-bg px-3 py-2 text-[12px] font-medium text-success">{notice}</div>}

      <div className="overflow-hidden rounded-card border border-line bg-card shadow-card">
        <div className="border-b border-line-3 px-5 py-4">
          <div className="text-[14px] font-semibold">Refund Pembatalan</div>
          <div className="text-[11px] text-muted-3">
            Dana terverifikasi jamaah yang dibatalkan masih tercatat di Uang Muka Jamaah (2-1100) sampai refund dibayar. Potongan diakui sebagai pendapatan pembatalan (4-9000).
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-thead text-left text-[10.5px] uppercase tracking-[0.4px] text-muted-3">
                <th className="px-5 py-[11px] font-semibold">Jamaah</th>
                <th className="px-3 py-[11px] font-semibold">Paket</th>
                <th className="px-3 py-[11px] font-semibold">Pembatalan</th>
                <th className="px-3 py-[11px] text-right font-semibold">Terbayar</th>
                <th className="px-3 py-[11px] text-right font-semibold">Potongan</th>
                <th className="px-3 py-[11px] text-right font-semibold">Refund</th>
                <th className="px-3 py-[11px] font-semibold">Status</th>
                <th className="px-5 py-[11px] font-semibold">{status === 'paid' ? 'Pembayaran' : 'Aksi'}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-5 py-6 text-muted-2">Memuat daftar refund…</td></tr>}
              {!data && error && (
                <tr><td colSpan={8} className="px-5 py-4">
                  <div role="alert" className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">
                    Gagal memuat refund: {apiErrorMessage(error, 'terjadi kesalahan, coba muat ulang halaman')}
                  </div>
                </td></tr>
              )}
              {data?.map((r) => (
                <RefundRow key={r.id} r={r} canPay={canPay} onPay={() => { setNotice(''); setPaying(r); }} />
              ))}
              {data && data.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-6 text-muted-2">
                  {status === 'pending' ? 'Tidak ada refund yang menunggu pembayaran.' : 'Belum ada refund yang dibayar.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {paying && <PayRefundModal refund={paying} onClose={() => setPaying(null)} onPaid={handlePaid} />}
    </div>
  );
}

function RefundRow({ r, canPay, onPay }: { r: RefundDto; canPay: boolean; onPay: () => void }) {
  const pill = refundStatusPill(r.status);
  return (
    <tr className="border-t border-line-3 align-top hover:bg-panel">
      <td className="px-5 py-[13px]">
        <span className="font-semibold">{r.jamaahName}</span>
        <div className="font-mono text-[10.5px] text-muted-4">{r.regNumber}</div>
      </td>
      <td className="px-3 py-[13px]">
        {r.packageName}
        <div className="text-[10.5px] text-muted-4">
          {fmtDate(r.departureDate)}{r.costCenterCode && <> · <span className="font-mono">{r.costCenterCode}</span></>}
        </div>
      </td>
      <td className="max-w-[220px] px-3 py-[13px]">
        <span className="text-muted">{r.cancelledAt ? fmtDate(r.cancelledAt) : '—'}</span>
        {r.cancelReason && <div className="text-[10.5px] text-muted-3">{r.cancelReason}</div>}
      </td>
      <td className="px-3 py-[13px] text-right font-mono">{fmtFull(r.paidTotal)}</td>
      <td className="px-3 py-[13px] text-right">
        <span className="font-mono">{r.deduction ? fmtFull(r.deduction) : '—'}</span>
        {r.deductionReason && <div className="text-[10.5px] text-muted-3">{r.deductionReason}</div>}
      </td>
      <td className="px-3 py-[13px] text-right font-mono font-semibold">{fmtFull(r.refundAmount)}</td>
      <td className="px-3 py-[13px]">
        <span className={`${PILL_CLASS} whitespace-nowrap`} style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
      </td>
      <td className="px-5 py-[13px]">
        {r.status === 'paid' ? (
          <div className="whitespace-nowrap text-[11px] text-muted">
            {r.paidAt ? fmtDate(r.paidAt) : '—'}
            {r.journalNumber && <div className="font-mono text-[10.5px] text-primary">{r.journalNumber}</div>}
            {r.bankAccountCode && <div className="font-mono text-[10px] text-muted-4">{r.bankAccountCode}</div>}
            {r.receiptNumber && (
              <a href={`/dokumen/refund/${r.id}`} target="_blank" rel="noreferrer"
                className="mt-0.5 inline-block text-[10.5px] font-semibold text-primary hover:underline">
                Kwitansi <span className="font-mono">{r.receiptNumber}</span>
              </a>
            )}
          </div>
        ) : canPay ? (
          <button onClick={onPay}
            className="cursor-pointer whitespace-nowrap rounded-[7px] bg-primary px-2.5 py-1 text-[10.5px] font-semibold text-white hover:bg-primary-deep">
            Bayar refund
          </button>
        ) : (
          <span className="text-[11px] text-muted-4">—</span>
        )}
      </td>
    </tr>
  );
}

/* ===== Modal bayar refund ===== */
interface BankAccount { account_code: string; name: string; currency: string }
interface PreviewLine { code: string; name: string; debit: number; credit: number }

const LIABILITY_ACCOUNT = { code: '2-1100', name: 'Uang Muka Jamaah' };
const CANCELLATION_INCOME_ACCOUNT = { code: '4-9000', name: 'Pendapatan Lain-lain' };
const DEFAULT_BANK_CODE = '1-1200';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface PayForm { deduction: number; deductionReason: string; bankAccountCode: string; date: string }

/** Validasi klien = kontrak `POST /refunds/:id/pay`. Mengembalikan pesan pertama yang gagal, atau null. */
function validatePayForm(f: PayForm, paidTotal: number): string | null {
  if (!Number.isFinite(f.deduction) || f.deduction < 0) return 'Potongan tidak boleh negatif.';
  if (!Number.isInteger(f.deduction)) return 'Potongan harus dalam rupiah bulat.';
  if (f.deduction > paidTotal) return `Potongan maksimal ${fmtFull(paidTotal)} (total terbayar).`;
  if (f.deduction > 0 && f.deductionReason.trim().length < 3) return 'Alasan potongan minimal 3 karakter.';
  if (!f.bankAccountCode) return 'Pilih rekening bank IDR.';
  if (!DATE_PATTERN.test(f.date)) return 'Tanggal pembayaran wajib diisi.';
  return null;
}

function PayRefundModal({ refund, onClose, onPaid }: { refund: RefundDto; onClose: () => void; onPaid: (dto: RefundDto) => void }) {
  const [deduction, setDeduction] = useState(0);
  const [deductionReason, setDeductionReason] = useState('');
  const [bankCode, setBankCode] = useState('');
  const [date, setDate] = useState(todayWib);
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  // Satu key = satu pembayaran refund. Retry setelah gagal memakai key yang sama; key baru hanya setelah sukses (pola FE-01).
  const [idemKey, setIdemKey] = useState(() => crypto.randomUUID());

  const { data: banks, isLoading: banksLoading } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => (await api.get('/bank-accounts')).data.data as BankAccount[]
  });
  const idrBanks = banks?.filter((b) => b.currency === 'IDR') ?? [];
  const activeBank = idrBanks.some((b) => b.account_code === bankCode)
    ? bankCode
    : (idrBanks.find((b) => b.account_code === DEFAULT_BANK_CODE) ?? idrBanks[0])?.account_code ?? '';
  const bankName = idrBanks.find((b) => b.account_code === activeBank)?.name ?? activeBank;

  const refundAmount = refund.paidTotal - deduction;
  const validationError = validatePayForm({ deduction, deductionReason, bankAccountCode: activeBank, date }, refund.paidTotal);

  const pay = useMutation({
    mutationFn: async () =>
      (await api.post(
        `/refunds/${refund.id}/pay`,
        {
          deduction,
          deductionReason: deduction > 0 ? deductionReason.trim() : undefined,
          bankAccountCode: activeBank,
          date,
          reference: reference.trim() || undefined
        },
        { headers: { 'Idempotency-Key': idemKey } }
      )).data.data as RefundDto,
    onMutate: () => setError(''),
    onSuccess: (dto) => {
      setIdemKey(crypto.randomUUID());
      onPaid(dto);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Gagal membayar refund'))
  });
  const close = () => { if (!pay.isPending) onClose(); };

  const lines: PreviewLine[] = [
    { ...LIABILITY_ACCOUNT, debit: refund.paidTotal, credit: 0 },
    ...(refundAmount > 0 ? [{ code: activeBank || 'Bank', name: bankName || 'Rekening bank', debit: 0, credit: refundAmount }] : []),
    ...(deduction > 0 ? [{ ...CANCELLATION_INCOME_ACCOUNT, debit: 0, credit: deduction }] : [])
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="pay-refund-title" onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-[860px] max-w-full overflow-y-auto rounded-[15px] bg-card p-6 shadow-float">
        <div id="pay-refund-title" className="font-display text-[19px] text-ink-strong">Bayar Refund</div>
        <div className="mt-0.5 text-[12px] text-muted-2">
          {refund.jamaahName} · <span className="font-mono">{refund.regNumber}</span> · {refund.packageName} · {fmtDate(refund.departureDate)}
        </div>
        {refund.cancelReason && <div className="mt-1 text-[11px] text-muted-3">Alasan pembatalan: {refund.cancelReason}</div>}

        <div className="mt-4 grid grid-cols-[1.2fr_1fr] gap-4 max-md:grid-cols-1">
          <div className="grid h-fit grid-cols-2 gap-3.5">
            <div className="col-span-2 rounded-[9px] bg-panel px-3.5 py-2.5 text-[12px]">
              Total pembayaran terverifikasi: <span className="ml-1 font-mono font-bold">{fmtFull(refund.paidTotal)}</span>
            </div>
            <div>
              <label className="lbl" htmlFor="refund-deduction">Potongan (Rp)</label>
              <input id="refund-deduction" type="number" min={0} max={refund.paidTotal} className="fld font-mono"
                value={deduction || ''} placeholder="0" onChange={(e) => setDeduction(Number(e.target.value))} />
            </div>
            <div>
              <label className="lbl" htmlFor="refund-date">Tanggal Bayar</label>
              <input id="refund-date" type="date" className="fld" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="col-span-2">
              <label className="lbl" htmlFor="refund-deduction-reason">Alasan Potongan {deduction > 0 ? '(wajib)' : '(bila ada potongan)'}</label>
              <input id="refund-deduction-reason" className="fld" value={deductionReason} disabled={deduction <= 0}
                onChange={(e) => setDeductionReason(e.target.value)} placeholder="Mis. biaya visa & tiket yang sudah terbit" />
            </div>
            <div className="col-span-2">
              <label className="lbl" htmlFor="refund-bank">Rekening Sumber (IDR)</label>
              <select id="refund-bank" className="fld" value={activeBank} onChange={(e) => setBankCode(e.target.value)}>
                {idrBanks.length === 0 && <option value="">{banksLoading ? 'Memuat rekening…' : '— belum ada rekening IDR —'}</option>}
                {idrBanks.map((b) => <option key={b.account_code} value={b.account_code}>{b.account_code} {b.name}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="lbl" htmlFor="refund-reference">Referensi (opsional)</label>
              <input id="refund-reference" className="fld" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="No. ref transfer bank" />
            </div>
            <div className="col-span-2 flex items-center justify-between rounded-[9px] bg-panel px-3.5 py-2.5 text-[12.5px]">
              <span>Dikembalikan ke jamaah</span>
              <span className="font-mono font-bold">{fmtFull(refundAmount)}</span>
            </div>
          </div>

          <JournalPreview lines={lines} date={date} regNumber={refund.regNumber} costCenterCode={refund.costCenterCode} />
        </div>

        {validationError && !error && <div className="mt-3 text-[11.5px] font-medium text-danger-deep">{validationError}</div>}
        {error && <div role="alert" className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={close} disabled={pay.isPending}
            className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60">
            Tutup
          </button>
          <button onClick={() => !validationError && pay.mutate()} disabled={Boolean(validationError) || pay.isPending}
            className="cursor-pointer rounded-[9px] bg-primary px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60">
            {pay.isPending ? 'Memposting…' : `Bayar refund ${fmtFull(Math.max(refundAmount, 0))}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Pratinjau jurnal ringkas — gaya panel gelap "Preview Jurnal" di InputTransaksiPage. */
function JournalPreview({ lines, date, regNumber, costCenterCode }: {
  lines: PreviewLine[]; date: string; regNumber: string; costCenterCode: string | null;
}) {
  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0 && lines.every((l) => l.debit >= 0 && l.credit >= 0);
  return (
    <div className="h-fit rounded-card p-5 text-[#e8e0cf] shadow-float" style={{ background: '#16211b' }}>
      <div className="flex items-baseline justify-between">
        <span className="font-display text-[16px]">Preview Jurnal</span>
        <span className="font-mono text-[10.5px] text-[#9fb0a4]">JV-xxxx · {DATE_PATTERN.test(date) ? fmtDate(date) : '—'}</span>
      </div>
      <div className="mt-1 text-[11px] text-[#9fb0a4]">Pembayaran refund pembatalan — {regNumber}</div>
      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-b border-white/15 text-left text-[9.5px] uppercase tracking-[0.5px] text-[#9fb0a4]">
            <th className="py-1.5 font-semibold">Akun</th>
            <th className="py-1.5 text-right font-semibold">Debit</th>
            <th className="py-1.5 text-right font-semibold">Kredit</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.code} className="border-b border-white/[0.07]">
              <td className="py-2" style={{ paddingLeft: l.credit !== 0 ? 14 : 0 }}>
                <span className="font-mono text-[10px] font-semibold" style={{ color: ACC_CLASS_COLOR[Number(l.code[0])] }}>{l.code}</span>
                <span className="ml-1.5">{l.name}</span>
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
                : <span style={{ color: '#c3a24f' }}>○ Periksa potongan</span>}
            </td>
            <td className="py-2 text-right font-mono">{totalDebit.toLocaleString('id-ID')}</td>
            <td className="py-2 text-right font-mono">{totalCredit.toLocaleString('id-ID')}</td>
          </tr>
        </tfoot>
      </table>
      <div className="mt-2 text-[10px] leading-relaxed text-[#9fb0a4]">
        Cost center {costCenterCode ? <span className="font-mono">{costCenterCode}</span> : 'keberangkatan'}. Baris bernilai nol tidak dijurnal; potongan diakui sebagai pendapatan pembatalan.
      </div>
    </div>
  );
}
