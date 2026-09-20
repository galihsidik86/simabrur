import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../api/client';
import { fmtFull, fmtDate } from '../../utils/format';
import {
  VOID_REASON_MAX, VOID_REASON_MIN, accountName, canVoidBill, vendorBillStatusPill, type VendorBill
} from './transaksi';

/**
 * Daftar tagihan vendor per cost center (dari kelebihan HPP di atas saldo 1-1400)
 * + aksi "Batalkan tagihan" (`PATCH /v1/vendor-bills/:id/void`).
 * Tagihan yang sudah dibatalkan/lunas tetap tampil (dengan badge) tapi tidak bisa
 * dipilih untuk pelunasan — penyaringannya di InputTransaksiPage.
 */

const PILL_CLASS = 'rounded-pill px-2 py-[2px] text-[9.5px] font-semibold';

interface Props {
  bills: VendorBill[];
  canWrite: boolean;
  isLoading: boolean;
  onVoided: (bill: VendorBill, journalNo: string) => void;
}

export function VendorBillsPanel({ bills, canWrite, isLoading, onVoided }: Props) {
  const [voidTarget, setVoidTarget] = useState<VendorBill | null>(null);

  return (
    <div className="col-span-2">
      <label className="lbl">Tagihan Vendor (hutang 2-1300 dari pengakuan HPP)</label>
      <div className="rounded-[9px] border border-line-3 bg-panel p-2.5">
        {isLoading && <div className="py-1 text-[11.5px] text-muted-3">Memuat tagihan vendor…</div>}
        {!isLoading && bills.length === 0 && (
          <div className="py-1 text-[11.5px] text-muted-3">
            Belum ada tagihan vendor{' '}untuk filter ini — tagihan terbit saat komponen HPP melebihi saldo Uang Muka Vendor.
          </div>
        )}
        {bills.map((b) => {
          const pill = vendorBillStatusPill(b.status);
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-line-3 py-1.5 text-[11.5px] first:border-0">
              <span className="font-semibold">{b.vendorName}</span>
              <span className="font-mono text-[10px] text-muted-4">{b.accountCode ?? '—'}</span>
              <span className={PILL_CLASS} style={{ color: pill.color, background: pill.bg }}>{pill.label}</span>
              {b.costCenterCode && <span className="font-mono text-[10px] text-muted-4">{b.costCenterCode}</span>}
              <span className="text-muted-2">
                {fmtFull(b.amount)}
                {b.paidAmount > 0 && <> · dibayar {fmtFull(b.paidAmount)}</>}
                {b.status === 'unpaid' && <> · <b className="font-mono">sisa {fmtFull(b.remaining)}</b></>}
                {b.dueDate && <> · tempo {fmtDate(b.dueDate)}</>}
              </span>
              {canWrite && canVoidBill(b) && (
                <button type="button" onClick={() => setVoidTarget(b)}
                  className="ml-auto cursor-pointer rounded-[7px] border border-[oklch(0.85_0.08_30)] bg-danger-bg px-2.5 py-1 text-[10.5px] font-semibold text-danger-deep">
                  Batalkan tagihan
                </button>
              )}
              {canWrite && b.status === 'unpaid' && b.paidAmount > 0 && (
                <span className="ml-auto text-[10px] text-muted-4" title="Tagihan yang sudah dibayar sebagian tidak bisa dibatalkan">
                  sudah dibayar sebagian — tak bisa dibatalkan
                </span>
              )}
            </div>
          );
        })}
      </div>

      {canWrite && voidTarget && (
        <VoidVendorBillModal bill={voidTarget} onClose={() => setVoidTarget(null)}
          onVoided={(journalNo) => { const b = voidTarget; setVoidTarget(null); onVoided(b, journalNo); }} />
      )}
    </div>
  );
}

function VoidVendorBillModal({ bill, onClose, onVoided }: {
  bill: VendorBill; onClose: () => void; onVoided: (journalNo: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const trimmed = reason.trim();
  const isValid = trimmed.length >= VOID_REASON_MIN && trimmed.length <= VOID_REASON_MAX;

  const voidBill = useMutation({
    mutationFn: async () =>
      (await api.patch(`/vendor-bills/${bill.id}/void`, { reason: trimmed })).data.data as { id: string; status: 'void'; journalNo: string },
    onMutate: () => setError(''),
    onSuccess: (dto) => onVoided(dto.journalNo),
    onError: (e) => setError(apiErrorMessage(e, 'Gagal membatalkan tagihan vendor'))
  });
  const close = () => { if (!voidBill.isPending) onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="void-bill-title" onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-full rounded-[15px] bg-card p-6 shadow-float">
        <div id="void-bill-title" className="font-display text-[19px] text-ink-strong">Batalkan Tagihan Vendor</div>
        <div className="mt-0.5 text-[12px] text-muted-2">
          {bill.vendorName} · <b className="font-mono">{fmtFull(bill.amount)}</b>
          {bill.accountCode && <> · {bill.accountCode} {accountName(bill.accountCode)}</>}
          {bill.costCenterCode && <> · <span className="font-mono">{bill.costCenterCode}</span></>}
        </div>

        <div className="mt-4 rounded-[9px] bg-danger-bg px-3.5 py-2.5 text-[11.5px] leading-relaxed text-danger-deep">
          <div className="font-semibold">Dampak pembatalan:</div>
          <ul className="mt-1 list-disc pl-4">
            <li>Hutang vendor (2-1300) sebesar <b className="font-mono">{fmtFull(bill.amount)}</b> dihapus.</li>
            <li>HPP berkurang lewat jurnal balik: <span className="font-mono">Dr 2-1300 · Cr {bill.accountCode ?? 'akun HPP'}</span>, di cost center yang sama.</li>
            <li>Tagihan tidak bisa dipilih lagi untuk pelunasan.</li>
          </ul>
          <div className="mt-1">Hanya tagihan yang belum dibayar sama sekali yang bisa dibatalkan.</div>
        </div>

        <div className="mt-4">
          <label className="lbl" htmlFor="void-reason">Alasan pembatalan</label>
          <textarea id="void-reason" className="fld h-20" value={reason} onChange={(e) => setReason(e.target.value)}
            maxLength={VOID_REASON_MAX} placeholder="Mis. salah input vendor, tagihan dibatalkan vendor" disabled={voidBill.isPending} />
          <div className="mt-1 text-[10.5px] text-muted-3">
            Minimal {VOID_REASON_MIN} karakter (maks {VOID_REASON_MAX}) · tercatat di audit log.
          </div>
        </div>

        {error && <div role="alert" className="mt-3 rounded-[9px] bg-danger-bg px-3 py-2 text-[12px] font-medium text-danger-deep">{error}</div>}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={close} disabled={voidBill.isPending}
            className="cursor-pointer rounded-[9px] border border-line-2 bg-white px-4 py-2 text-[12.5px] font-semibold text-muted disabled:opacity-60">
            Kembali
          </button>
          <button onClick={() => isValid && voidBill.mutate()} disabled={!isValid || voidBill.isPending}
            className="cursor-pointer rounded-[9px] bg-danger px-4 py-2 text-[12.5px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
            {voidBill.isPending ? 'Membatalkan…' : 'Batalkan tagihan'}
          </button>
        </div>
      </div>
    </div>
  );
}
