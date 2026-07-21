import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { BTN_CANCEL, BTN_DEL, BTN_EDIT, BTN_SAVE, ErrorRow, Panel, TD, TH, useCrud } from '../components/master';
import { fmtShort } from '../utils/format';

/**
 * Master data modul Keuangan: vendor & rekening bank (CRUD).
 * Saldo rekening TIDAK bisa diedit — hanya bergerak lewat jurnal (aturan §4 PLAN.md).
 */

interface Vendor { id: string; name: string; type: string }
interface Rekening {
  id: string; account_code: string; name: string; bank: string | null;
  account_no: string | null; currency: string; balance: string;
}

const VENDOR_TYPES = [
  ['hotel', 'Hotel'], ['airline', 'Maskapai'], ['visa', 'Visa'],
  ['catering', 'Katering'], ['transport', 'Transport'], ['other', 'Lainnya']
] as const;
const vendorTypeLabel = (t: string) => VENDOR_TYPES.find(([k]) => k === t)?.[1] ?? t;

export function MasterKeuanganPage() {
  const { user } = useAuth();
  const canManage = !!user && ['admin', 'keuangan'].includes(user.role);
  return (
    <div dir="ltr" className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <VendorPanel canManage={canManage} />
      <RekeningPanel canManage={canManage} />
    </div>
  );
}

// ===== Vendor =====
function VendorPanel({ canManage }: { canManage: boolean }) {
  const { data } = useQuery({ queryKey: ['vendors'], queryFn: async () => (await api.get('/vendors')).data.data as Vendor[] });
  const crud = useCrud('vendors', 'vendors');
  const [f, setF] = useState({ name: '', type: 'other' });
  const startEdit = (v: Vendor) => {
    crud.setEditingId(v.id);
    setF({ name: v.name, type: v.type });
  };
  const reset = () => {
    crud.setEditingId(null);
    crud.setError('');
    setF({ name: '', type: 'other' });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    crud.save.mutate({ name: f.name, type: f.type }, { onSuccess: () => setF({ name: '', type: 'other' }) });
  };
  return (
    <Panel title="Vendor" sub="Mitra biaya: hotel, maskapai, visa, katering, transport — dipakai Input Transaksi & tagihan">
      <table className="w-full border-collapse">
        <thead><tr><th className={TH}>Nama</th><th className={TH}>Jenis</th>{canManage && <th className={TH} />}</tr></thead>
        <tbody>
          {data?.map((v) => (
            <tr key={v.id}>
              <td className={TD}>{v.name}</td>
              <td className={TD}>{vendorTypeLabel(v.type)}</td>
              {canManage && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button className={BTN_EDIT} onClick={() => startEdit(v)}>Edit</button>{' '}
                  <button className={BTN_DEL} onClick={() => window.confirm(`Hapus vendor "${v.name}"?`) && crud.remove.mutate(v.id)}>Hapus</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={submit} className="mt-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-3">
            {crud.editingId ? 'Edit vendor' : 'Tambah vendor'}
          </div>
          <div className="grid grid-cols-[1fr_150px] gap-2.5">
            <div><label className="lbl">Nama Vendor</label>
              <input className="fld" placeholder="mis. Grand Al Massa Hotel" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
            <div><label className="lbl">Jenis</label>
              <select className="fld" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {VENDOR_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select></div>
          </div>
          <ErrorRow msg={crud.error} />
          <div className="mt-2.5 flex justify-end gap-2">
            {crud.editingId && <button type="button" className={BTN_CANCEL} onClick={reset}>Batal</button>}
            <button type="submit" className={BTN_SAVE} disabled={crud.save.isPending}>
              {crud.editingId ? 'Simpan Perubahan' : '+ Tambah'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

// ===== Rekening Bank =====
function RekeningPanel({ canManage }: { canManage: boolean }) {
  const { data } = useQuery({
    queryKey: ['bank-accounts'],
    queryFn: async () => (await api.get('/bank-accounts')).data.data as Rekening[]
  });
  const crud = useCrud('bank-accounts', 'bank-accounts');
  const empty = { accountCode: '', name: '', bank: '', accountNo: '', currency: 'IDR' };
  const [f, setF] = useState(empty);
  const startEdit = (r: Rekening) => {
    crud.setEditingId(r.id);
    setF({ accountCode: r.account_code, name: r.name, bank: r.bank ?? '', accountNo: r.account_no ?? '', currency: r.currency });
  };
  const reset = () => {
    crud.setEditingId(null);
    crud.setError('');
    setF(empty);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    crud.save.mutate(
      { accountCode: f.accountCode, name: f.name, bank: f.bank || null, accountNo: f.accountNo || null, currency: f.currency },
      { onSuccess: () => setF(empty) }
    );
  };
  return (
    <Panel title="Rekening Bank" sub="Terikat akun COA kelas 1 — saldo hanya bergerak lewat jurnal, tidak bisa diedit di sini">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={TH}>Akun</th><th className={TH}>Nama</th><th className={TH}>Bank / No.</th>
            <th className={`${TH} text-right`}>Saldo</th>{canManage && <th className={TH} />}
          </tr>
        </thead>
        <tbody>
          {data?.map((r) => (
            <tr key={r.id}>
              <td className={`${TD} font-mono text-[11.5px]`}>{r.account_code}</td>
              <td className={TD}>{r.name}</td>
              <td className={TD}>
                {r.bank ?? '—'}
                {r.account_no && <span className="ml-1 font-mono text-[11px] text-muted-3">{r.account_no}</span>}
              </td>
              <td className={`${TD} whitespace-nowrap text-right font-mono`}>
                {r.currency !== 'IDR' && <span className="mr-1 text-[10.5px] text-muted-3">{r.currency}</span>}
                {fmtShort(Number(r.balance))}
              </td>
              {canManage && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button className={BTN_EDIT} onClick={() => startEdit(r)}>Edit</button>{' '}
                  <button
                    className={BTN_DEL}
                    onClick={() => window.confirm(`Hapus rekening "${r.name}"?`) && crud.remove.mutate(r.id)}
                  >
                    Hapus
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={submit} className="mt-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-3">
            {crud.editingId ? 'Edit rekening' : 'Tambah rekening'}
          </div>
          <div className="grid grid-cols-[110px_1fr_90px] gap-2.5">
            <div><label className="lbl">Kode Akun</label>
              <input className="fld font-mono" placeholder="1-1230" value={f.accountCode} onChange={(e) => setF({ ...f, accountCode: e.target.value })} required /></div>
            <div><label className="lbl">Nama Rekening</label>
              <input className="fld" placeholder="mis. Bank Mandiri Operasional" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
            <div><label className="lbl">Mata Uang</label>
              <select className="fld" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {['IDR', 'USD', 'SAR'].map((c) => <option key={c} value={c}>{c}</option>)}
              </select></div>
            <div className="col-span-3 grid grid-cols-[1fr_170px] gap-2.5">
              <div><label className="lbl">Nama Bank</label>
                <input className="fld" placeholder="mis. Bank Mandiri" value={f.bank} onChange={(e) => setF({ ...f, bank: e.target.value })} /></div>
              <div><label className="lbl">No. Rekening</label>
                <input className="fld font-mono" placeholder="1230009911" value={f.accountNo} onChange={(e) => setF({ ...f, accountNo: e.target.value })} /></div>
            </div>
          </div>
          <div className="mt-1.5 text-[10.5px] text-muted-3">
            Kode akun harus sudah ada di Bagan Akun (kelas 1 — aset). Rekening baru bersaldo 0.
          </div>
          <ErrorRow msg={crud.error} />
          <div className="mt-2.5 flex justify-end gap-2">
            {crud.editingId && <button type="button" className={BTN_CANCEL} onClick={reset}>Batal</button>}
            <button type="submit" className={BTN_SAVE} disabled={crud.save.isPending}>
              {crud.editingId ? 'Simpan Perubahan' : '+ Tambah'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}
