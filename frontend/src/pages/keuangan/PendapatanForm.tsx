import { fmtFull } from '../../utils/format';
import {
  HPP_ACCOUNTS, REVENUE_ACCOUNTS, alignAllocation, newRowUid,
  type CostCenterBalances, type HppAllocationRow, type HppComponent, type RevenueAccountCode
} from './transaksi';

/**
 * Form "Pengakuan Pendapatan" (PSAK 72) + komponen HPP.
 * Presentational: seluruh state dipegang InputTransaksiPage (dipakai juga untuk
 * pratinjau jurnal & payload POST /transactions/revenue-recognition).
 */

interface CostCenter { id: string; code: string; name: string }
interface Vendor { id: string; name: string; type: string }

export interface PendapatanState {
  costCenterId: string;
  revenueAccountCode: RevenueAccountCode;
  date: string;
  amount: number;
  hpp: HppComponent[];
}

export const emptyHppRow = (): HppComponent => ({ uid: newRowUid(), accountCode: '5-2000', amount: 0, vendorId: '', dueDate: '' });

interface Props {
  state: PendapatanState;
  onChange: (next: PendapatanState) => void;
  costCenters: CostCenter[] | undefined;
  vendors: Vendor[] | undefined;
  balances: CostCenterBalances | undefined;
  isBalancesLoading: boolean;
  allocation: readonly HppAllocationRow[];
}

export function PendapatanForm({ state, onChange, costCenters, vendors, balances, isBalancesLoading, allocation }: Props) {
  const rowAllocation = alignAllocation(state.hpp, allocation);
  const totalHpp = state.hpp.reduce((s, r) => s + (r.amount || 0), 0);
  const totalAllocated = allocation.reduce((s, c) => s + c.allocated, 0);
  const totalExcess = allocation.reduce((s, c) => s + c.excess, 0);

  const patch = (next: Partial<PendapatanState>) => onChange({ ...state, ...next });
  const patchRow = (i: number, next: Partial<HppComponent>) =>
    patch({ hpp: state.hpp.map((r, j) => (j === i ? { ...r, ...next } : r)) });

  const balanceValue = (n: number | undefined) => (state.costCenterId && n != null ? fmtFull(n) : isBalancesLoading ? 'Memuat…' : '—');

  return (
    <div className="grid grid-cols-2 gap-3.5">
      <div className="col-span-2">
        <label className="lbl" htmlFor="pendapatan-cc">Keberangkatan / Cost Center</label>
        <select id="pendapatan-cc" className="fld" value={state.costCenterId} onChange={(e) => patch({ costCenterId: e.target.value })}>
          <option value="">— pilih keberangkatan —</option>
          {costCenters?.filter((c) => c.code.startsWith('CC-')).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Saldo cost center terpilih — dasar alokasi HPP & batas pengakuan pendapatan. */}
      <div className="col-span-2 grid grid-cols-2 gap-2.5">
        <div className="rounded-[9px] border border-line-3 bg-panel px-3.5 py-2.5">
          <div className="text-[10.5px] text-muted-3">Uang Muka Vendor (1-1400)</div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold">{balanceValue(balances?.vendorAdvance1400)}</div>
          <div className="text-[10px] text-muted-4">dasar alokasi HPP</div>
        </div>
        <div className="rounded-[9px] border border-line-3 bg-panel px-3.5 py-2.5">
          <div className="text-[10.5px] text-muted-3">Uang Muka Jamaah (2-1100)</div>
          <div className="mt-0.5 font-mono text-[14px] font-semibold">{balanceValue(balances?.liability2100)}</div>
          <div className="text-[10px] text-muted-4">batas pendapatan yang bisa diakui</div>
        </div>
      </div>

      <div>
        <label className="lbl" htmlFor="pendapatan-akun">Akun Pendapatan</label>
        <select id="pendapatan-akun" className="fld" value={state.revenueAccountCode}
          onChange={(e) => patch({ revenueAccountCode: e.target.value as RevenueAccountCode })}>
          {REVENUE_ACCOUNTS.map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}
        </select>
      </div>
      <div>
        <label className="lbl" htmlFor="pendapatan-tanggal">Tanggal Penyelesaian Jasa</label>
        <input id="pendapatan-tanggal" type="date" className="fld" value={state.date} onChange={(e) => patch({ date: e.target.value })} />
      </div>
      <div className="col-span-2">
        <label className="lbl" htmlFor="pendapatan-nilai">Nilai Pendapatan Diakui (Rp)</label>
        <input id="pendapatan-nilai" type="number" className="fld font-mono" value={state.amount || ''}
          onChange={(e) => patch({ amount: Number(e.target.value) })} />
      </div>

      {/* Komponen HPP — dialokasikan pro-rata ke saldo 1-1400; kelebihan jadi hutang vendor. */}
      <div className="col-span-2">
        <label className="lbl">Komponen HPP (opsional)</label>
        <div className="flex flex-col gap-2.5">
          {state.hpp.map((row, i) => {
            const alloc = rowAllocation[i];
            const hasExcess = (alloc?.excess ?? 0) > 0;
            const vendorMissing = hasExcess && !row.vendorId;
            return (
              // R3TS-04: kunci stabil per baris — baris HPP bisa dihapus di tengah.
              <div key={row.uid} className="rounded-[9px] border border-line-3 bg-panel p-2.5">
                <div className="flex gap-2">
                  <select className="fld flex-1" value={row.accountCode} onChange={(e) => patchRow(i, { accountCode: e.target.value })}>
                    {HPP_ACCOUNTS.map(([code, name]) => <option key={code} value={code}>{code} {name}</option>)}
                  </select>
                  <input type="number" className="fld !w-[150px] font-mono" placeholder="0" value={row.amount || ''}
                    onChange={(e) => patchRow(i, { amount: Number(e.target.value) })} />
                  {state.hpp.length > 1 && (
                    <button type="button" onClick={() => patch({ hpp: state.hpp.filter((_, j) => j !== i) })}
                      className="cursor-pointer rounded-[9px] border border-line-2 bg-card px-3 text-[12px] text-danger-deep">×</button>
                  )}
                </div>

                {alloc && (
                  <div className="mt-1.5 flex flex-wrap gap-x-3 text-[10.5px] text-muted-2">
                    <span>Dari 1-1400: <b className="font-mono">{fmtFull(alloc.allocated)}</b></span>
                    {hasExcess && (
                      <span style={{ color: 'oklch(0.5 0.13 28)' }}>
                        Hutang vendor 2-1300: <b className="font-mono">{fmtFull(alloc.excess)}</b>
                      </span>
                    )}
                  </div>
                )}

                {hasExcess && (
                  <div className="mt-2 grid grid-cols-[1fr_150px] gap-2">
                    <div>
                      <label className="lbl !mb-1">Vendor penagih (wajib)</label>
                      <select className="fld" value={row.vendorId} onChange={(e) => patchRow(i, { vendorId: e.target.value })}
                        style={vendorMissing ? { borderColor: 'var(--color-danger)' } : undefined}>
                        <option value="">— pilih vendor —</option>
                        {vendors?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="lbl !mb-1">Jatuh tempo</label>
                      <input type="date" className="fld" value={row.dueDate} onChange={(e) => patchRow(i, { dueDate: e.target.value })} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button type="button" onClick={() => patch({ hpp: [...state.hpp, emptyHppRow()] })}
          className="mt-2 cursor-pointer text-[11.5px] font-semibold text-primary hover:underline">
          + Tambah komponen HPP
        </button>
      </div>

      {allocation.length > 0 && (
        <div className="col-span-2 flex flex-wrap justify-between gap-x-4 gap-y-1 rounded-[9px] bg-panel px-3.5 py-2.5 text-[11.5px]">
          <span>Total HPP: <b className="font-mono">{fmtFull(totalHpp)}</b></span>
          <span>Dibayar dari 1-1400: <b className="font-mono">{fmtFull(totalAllocated)}</b></span>
          <span style={totalExcess > 0 ? { color: 'oklch(0.5 0.13 28)' } : undefined}>
            Jadi hutang vendor: <b className="font-mono">{fmtFull(totalExcess)}</b>
          </span>
        </div>
      )}

      <div className="col-span-2 rounded-[9px] bg-[oklch(0.97_0.02_158)] px-3.5 py-2.5 text-[11px] leading-relaxed text-[oklch(0.4_0.06_158)]">
        <b>PSAK 72:</b> pendapatan diakui saat kewajiban jasa terpenuhi (keberangkatan) — reclass Uang Muka Jamaah → Pendapatan,
        diikuti pengakuan HPP. Saldo Uang Muka Vendor dialokasikan pro-rata ke tiap komponen; kelebihannya dicatat sebagai
        hutang vendor (2-1300) dan terbit tagihan vendor yang dilunasi lewat Pembayaran Biaya.
      </div>
    </div>
  );
}
