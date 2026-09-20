import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../api/client';
import type { RefundReceiptDoc } from '../../api/refunds';
import { fmtFull, fmtDate } from '../../utils/format';
import { DocShell, DocHeader, DotLine } from './DocShell';

/**
 * Kwitansi refund pembatalan (A4 printable) — `GET /v1/refunds/:id/receipt`.
 * Gaya identik KwitansiDoc (kwitansi pembayaran) supaya kedua dokumen tampak satu keluarga.
 */
export function KwitansiRefundDoc() {
  const { id } = useParams<{ id: string }>();
  const { data: d, isLoading, error } = useQuery({
    queryKey: ['refund-receipt', id],
    queryFn: async () => (await api.get(`/refunds/${id}/receipt`)).data.data as RefundReceiptDoc
  });

  if (isLoading) return <div className="p-10 text-center text-[13px] text-muted-2">Memuat kwitansi refund…</div>;
  if (!d) {
    return (
      <div role="alert" className="p-10 text-center text-[13px] text-danger-deep">
        {apiErrorMessage(error, 'Kwitansi refund tidak ditemukan / belum dibayar.')}
      </div>
    );
  }

  const bank = d.bankAccount;
  const summary: [string, number, string?][] = [
    ['Total pembayaran terverifikasi', d.paidTotal],
    ['Potongan pembatalan', d.deduction, 'oklch(0.5 0.13 28)'],
    ['Dikembalikan ke jamaah', d.refundAmount]
  ];

  return (
    <DocShell>
      <DocHeader
        right={
          <>
            <div className="font-display text-[30px] leading-none text-gold">KWITANSI REFUND</div>
            <div className="mt-2 font-mono text-[13px] font-semibold">{d.receiptNumber}</div>
            <div className="mt-1 text-[10px] text-muted-2">{fmtDate(d.issuedDate, 'long')}</div>
          </>
        }
      />

      <div className="mt-7 flex flex-col gap-4">
        <DotLine label="Telah dibayarkan kepada">{d.jamaahName}</DotLine>
        <div className="flex items-baseline gap-3 text-[11.5px]">
          <span className="w-[140px] flex-none text-muted-2">Uang sejumlah</span>
          <span className="rounded-[9px] border border-[oklch(0.85_0.07_82)] bg-[oklch(0.96_0.04_82)] px-4 py-2 font-mono text-[17px] font-bold text-[oklch(0.42_0.09_78)]">
            {fmtFull(d.refundAmount)}
          </span>
        </div>
        <DotLine label="Terbilang"><i>"{d.amountInWords}"</i></DotLine>
        <DotLine label="Untuk pengembalian">
          Pembatalan pendaftaran <span className="font-mono">{d.regNumber}</span> — {d.packageName} ({fmtDate(d.departureDate)})
        </DotLine>
        <DotLine label="Alasan pembatalan">
          {d.cancelReason ?? '—'}{d.cancelledAt ? ` · ${fmtDate(d.cancelledAt, 'long')}` : ''}
        </DotLine>
        <DotLine label="Dibayarkan via">
          {bank ? <>{bank.name} <span className="font-mono text-[10.5px] text-muted-2">{bank.code}</span>{bank.bank ? ` · ${bank.bank}` : ''}{bank.accountNo ? ` ${bank.accountNo}` : ''}</> : '—'}
        </DotLine>
        {d.reference && <DotLine label="Referensi">{d.reference}</DotLine>}
      </div>

      <div className="mt-7 grid grid-cols-[1fr_auto] items-end gap-8">
        <div className="h-fit w-[300px] rounded-[10px] border border-line-2 bg-panel p-4 text-[11px]">
          {summary.map(([label, value, color], i) => (
            <div key={label} className={i === summary.length - 1 ? 'flex justify-between border-t border-line-2 pt-1.5' : 'flex justify-between py-0.5'}>
              <span className={i === summary.length - 1 ? 'font-semibold' : 'text-muted-2'}>{label}</span>
              <span className={`font-mono ${i === summary.length - 1 ? 'font-bold' : 'font-semibold'}`} style={color ? { color } : undefined}>
                {i === 1 && value > 0 ? `− ${fmtFull(value)}` : fmtFull(value)}
              </span>
            </div>
          ))}
          {d.deductionReason && (
            <div className="mt-1.5 border-t border-line-2 pt-1.5 text-[10px] leading-relaxed text-muted-2">
              Alasan potongan: {d.deductionReason}
            </div>
          )}
        </div>
        <div className="text-center text-[10.5px]">
          <div>Jakarta, {fmtDate(d.issuedDate, 'long')}</div>
          <div className="mx-auto my-3 flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-dashed border-[#b6ac94] text-[8.5px] uppercase tracking-[1px] text-muted-3">
            Stempel
          </div>
          <div className="font-semibold">Divisi Keuangan</div>
          {d.paidByName && <div className="mt-0.5 text-[9.5px] text-muted-2">{d.paidByName}</div>}
        </div>
      </div>

      <div className="mt-8 border-t border-line-3 pt-3 text-center font-mono text-[9px] text-muted-3">
        Jurnal otomatis: Dr Uang Muka Jamaah (2-1100) · Cr Bank · Cr Pendapatan Lain-lain (4-9000)
        {d.journalNumber ? ` · ${d.journalNumber}` : ''}
      </div>
    </DocShell>
  );
}
