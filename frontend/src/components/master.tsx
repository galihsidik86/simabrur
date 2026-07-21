import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

/** Perkakas bersama halaman master data (Paket & Keuangan) — gaya design token mockup. */

type ApiErr = { response?: { data?: { error?: { message?: string } } } };
export const errMsg = (e: unknown) => (e as ApiErr)?.response?.data?.error?.message ?? 'Gagal menyimpan';

export const TH =
  'border-b border-line-2 bg-thead px-2.5 py-2 text-left text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted-3';
export const TD = 'border-b border-line-3 px-2.5 py-[7px] text-[12.5px] text-ink-strong';
export const BTN_EDIT =
  'cursor-pointer rounded-[7px] border border-line-2 bg-white px-2 py-[3px] text-[11px] font-semibold text-muted hover:bg-panel';
export const BTN_DEL =
  'cursor-pointer rounded-[7px] border border-line-2 bg-white px-2 py-[3px] text-[11px] font-semibold text-danger hover:bg-danger-bg';
export const BTN_SAVE =
  'cursor-pointer rounded-[9px] bg-primary px-3.5 py-[7px] text-[12px] font-semibold text-white hover:bg-primary-deep disabled:opacity-60';
export const BTN_CANCEL =
  'cursor-pointer rounded-[9px] border border-line-2 bg-white px-3 py-[7px] text-[12px] font-semibold text-muted';

export function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-line bg-card p-5 shadow-card">
      <div className="font-display text-[17px] text-ink-strong">{title}</div>
      <div className="mb-3.5 mt-[2px] text-[11.5px] text-muted-3">{sub}</div>
      {children}
    </div>
  );
}

export function ErrorRow({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div className="mt-2 rounded-[9px] bg-danger-bg px-3 py-2 text-[11.5px] font-medium text-danger-deep">{msg}</div>;
}

/** Hook CRUD generik utk satu resource master. */
export function useCrud(resource: string, key: string) {
  const qc = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [key] });
    setEditingId(null);
    setError('');
  };
  const save = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      editingId ? api.put(`/${resource}/${editingId}`, payload) : api.post(`/${resource}`, payload),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(errMsg(e))
  });
  const remove = useMutation({
    mutationFn: async (id: string) => api.delete(`/${resource}/${id}`),
    onSuccess: invalidate,
    onError: (e: unknown) => setError(errMsg(e))
  });
  return { editingId, setEditingId, error, setError, save, remove };
}
