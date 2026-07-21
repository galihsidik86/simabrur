import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { BTN_CANCEL, BTN_DEL, BTN_EDIT, BTN_SAVE, ErrorRow, Panel, TD, TH, useCrud } from '../components/master';

/**
 * Master data modul Paket: kategori paket, hotel, maskapai (CRUD).
 * Screen baru — tidak ada di mockup; mengikuti design system (§2 PLAN.md).
 */

interface Kategori { id: string; code: string; label: string; sort: number }
interface Hotel { id: string; name: string; city: string; star: number }
interface Maskapai { id: string; name: string; iata_code: string }

export function MasterPaketPage() {
  const { user } = useAuth();
  const canManage = !!user && ['admin', 'marketing'].includes(user.role);
  return (
    <div dir="ltr" className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
      <KategoriPanel canManage={canManage} />
      <HotelPanel canManage={canManage} />
      <MaskapaiPanel canManage={canManage} />
    </div>
  );
}

// ===== Kategori Paket =====
function KategoriPanel({ canManage }: { canManage: boolean }) {
  const { data } = useQuery({
    queryKey: ['package-categories'],
    queryFn: async () => (await api.get('/package-categories')).data.data as Kategori[]
  });
  const crud = useCrud('package-categories', 'package-categories');
  const [f, setF] = useState({ code: '', label: '', sort: 0 });
  const startEdit = (k: Kategori) => {
    crud.setEditingId(k.id);
    setF({ code: k.code, label: k.label, sort: k.sort });
  };
  const reset = () => {
    crud.setEditingId(null);
    crud.setError('');
    setF({ code: '', label: '', sort: 0 });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    crud.save.mutate({ code: f.code, label: f.label, sort: Number(f.sort) }, { onSuccess: () => setF({ code: '', label: '', sort: 0 }) });
  };
  return (
    <Panel title="Kategori Paket" sub="Dipakai kartu paket, tab wizard & laporan per paket">
      <table className="w-full border-collapse">
        <thead><tr><th className={TH}>Kode</th><th className={TH}>Label</th><th className={TH}>Urut</th>{canManage && <th className={TH} />}</tr></thead>
        <tbody>
          {data?.map((k) => (
            <tr key={k.id}>
              <td className={`${TD} font-mono text-[11.5px]`}>{k.code}</td>
              <td className={TD}>{k.label}</td>
              <td className={`${TD} font-mono`}>{k.sort}</td>
              {canManage && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button className={BTN_EDIT} onClick={() => startEdit(k)}>Edit</button>{' '}
                  <button
                    className={BTN_DEL}
                    onClick={() => window.confirm(`Hapus kategori "${k.label}"?`) && crud.remove.mutate(k.id)}
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
            {crud.editingId ? 'Edit kategori' : 'Tambah kategori'}
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2.5">
            <div><label className="lbl">Kode</label>
              <input className="fld" placeholder="mis. premium" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} required /></div>
            <div><label className="lbl">Urutan</label>
              <input className="fld" type="number" min={0} value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} /></div>
            <div className="col-span-2"><label className="lbl">Label</label>
              <input className="fld" placeholder="mis. Premium" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} required /></div>
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

// ===== Hotel =====
function HotelPanel({ canManage }: { canManage: boolean }) {
  const { data } = useQuery({ queryKey: ['hotels'], queryFn: async () => (await api.get('/hotels')).data.data as Hotel[] });
  const crud = useCrud('hotels', 'hotels');
  const [f, setF] = useState({ name: '', city: '', star: 3 });
  const startEdit = (h: Hotel) => {
    crud.setEditingId(h.id);
    setF({ name: h.name, city: h.city, star: h.star });
  };
  const reset = () => {
    crud.setEditingId(null);
    crud.setError('');
    setF({ name: '', city: '', star: 3 });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    crud.save.mutate({ name: f.name, city: f.city, star: Number(f.star) }, { onSuccess: () => setF({ name: '', city: '', star: 3 }) });
  };
  return (
    <Panel title="Hotel" sub="Pilihan hotel pada paket & manifest">
      <table className="w-full border-collapse">
        <thead><tr><th className={TH}>Nama</th><th className={TH}>Kota</th><th className={TH}>★</th>{canManage && <th className={TH} />}</tr></thead>
        <tbody>
          {data?.map((h) => (
            <tr key={h.id}>
              <td className={TD}>{h.name}</td>
              <td className={TD}>{h.city}</td>
              <td className={`${TD} font-mono`}>{h.star}</td>
              {canManage && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button className={BTN_EDIT} onClick={() => startEdit(h)}>Edit</button>{' '}
                  <button className={BTN_DEL} onClick={() => window.confirm(`Hapus hotel "${h.name}"?`) && crud.remove.mutate(h.id)}>Hapus</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={submit} className="mt-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-3">
            {crud.editingId ? 'Edit hotel' : 'Tambah hotel'}
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2.5">
            <div className="col-span-2"><label className="lbl">Nama Hotel</label>
              <input className="fld" placeholder="mis. Grand Makkah" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
            <div><label className="lbl">Kota</label>
              <input className="fld" placeholder="mis. Makkah" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} required /></div>
            <div><label className="lbl">Bintang</label>
              <select className="fld" value={f.star} onChange={(e) => setF({ ...f, star: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5].map((s) => <option key={s} value={s}>{s}★</option>)}
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

// ===== Maskapai =====
function MaskapaiPanel({ canManage }: { canManage: boolean }) {
  const { data } = useQuery({ queryKey: ['airlines'], queryFn: async () => (await api.get('/airlines')).data.data as Maskapai[] });
  const crud = useCrud('airlines', 'airlines');
  const [f, setF] = useState({ name: '', iataCode: '' });
  const startEdit = (a: Maskapai) => {
    crud.setEditingId(a.id);
    setF({ name: a.name, iataCode: a.iata_code });
  };
  const reset = () => {
    crud.setEditingId(null);
    crud.setError('');
    setF({ name: '', iataCode: '' });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    crud.save.mutate({ name: f.name, iataCode: f.iataCode }, { onSuccess: () => setF({ name: '', iataCode: '' }) });
  };
  return (
    <Panel title="Maskapai" sub="Pilihan maskapai pada paket & tiket">
      <table className="w-full border-collapse">
        <thead><tr><th className={TH}>Nama</th><th className={TH}>IATA</th>{canManage && <th className={TH} />}</tr></thead>
        <tbody>
          {data?.map((a) => (
            <tr key={a.id}>
              <td className={TD}>{a.name}</td>
              <td className={`${TD} font-mono`}>{a.iata_code}</td>
              {canManage && (
                <td className={`${TD} whitespace-nowrap text-right`}>
                  <button className={BTN_EDIT} onClick={() => startEdit(a)}>Edit</button>{' '}
                  <button className={BTN_DEL} onClick={() => window.confirm(`Hapus maskapai "${a.name}"?`) && crud.remove.mutate(a.id)}>Hapus</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <form onSubmit={submit} className="mt-3.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-3">
            {crud.editingId ? 'Edit maskapai' : 'Tambah maskapai'}
          </div>
          <div className="grid grid-cols-[1fr_88px] gap-2.5">
            <div><label className="lbl">Nama Maskapai</label>
              <input className="fld" placeholder="mis. Garuda Indonesia" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
            <div><label className="lbl">Kode IATA</label>
              <input className="fld font-mono uppercase" placeholder="GA" maxLength={3} value={f.iataCode} onChange={(e) => setF({ ...f, iataCode: e.target.value.toUpperCase() })} required /></div>
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
