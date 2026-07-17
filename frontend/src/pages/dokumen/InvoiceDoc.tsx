import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtFull, fmtDate } from '../../utils/format';
import { DocShell, DocHeader } from './DocShell';

interface Doc {
  number: string; issuedDate: string; dueDate: string; vaNumber: string;
  billTo: { name: string; regNumber: string; address: string | null; phone: string | null };
  trip: { packageName: string; durationDays: number; departureDate: string; groupName: string | null; roomType: string; roomNumber: string | null };
  items: { description: string; detail: string; qty: number; price: number; amount: number }[];
  schedules: { termNo: number; label: string; amount: number; dueDate: string; status: string }[];
  subtotal: number; paid: number; remaining: number;
}

const ROOM: Record<string, string> = { quad: 'Quad', triple: 'Triple', double: 'Double' };

export function InvoiceDoc() {
  const { id } = useParams<{ id: string }>();
  const { data: d, isLoading } = useQuery({
    queryKey: ['invoice-document', id],
    queryFn: async () => (await api.get(`/invoices/${id}/document`)).data.data as Doc
  });

  if (isLoading || !d) return <div className="p-10 text-center text-[13px] text-muted-2">Memuat invoice…</div>;

  return (
    <DocShell>
      <DocHeader
        right={
          <>
            <div className="font-display text-[30px] leading-none text-[oklch(0.42_0.08_172)]">INVOICE</div>
            <div className="mt-2 font-mono text-[13px] font-semibold">{d.number}</div>
            <div className="mt-1 text-[10px] text-muted-2">Tanggal terbit: {fmtDate(d.issuedDate, 'long')}</div>
            <div className="text-[10px] text-muted-2">Jatuh tempo: <b className="text-danger-deep">{fmtDate(d.dueDate, 'long')}</b></div>
          </>
        }
      />

      <div className="mt-5 grid grid-cols-2 gap-6">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.6px] text-muted-3">Ditagihkan Kepada</div>
          <div className="mt-1.5 text-[13px] font-bold">{d.billTo.name}</div>
          <div className="mt-0.5 text-[10.5px] leading-relaxed text-muted">
            No. Registrasi <span className="font-mono font-semibold">{d.billTo.regNumber}</span><br />
            {d.billTo.address ?? '—'}<br />
            {d.billTo.phone ?? ''}
          </div>
        </div>
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-[0.6px] text-muted-3">Detail Keberangkatan</div>
          <div className="mt-1.5 text-[10.5px] leading-relaxed text-muted">
            <b className="text-[12px] text-ink">{d.trip.packageName} — {d.trip.durationDays} Hari</b><br />
            Keberangkatan {fmtDate(d.trip.departureDate, 'long')}<br />
            {d.trip.groupName ? `${d.trip.groupName} · ` : ''}Kamar {ROOM[d.trip.roomType]}{d.trip.roomNumber ? ` (${d.trip.roomNumber})` : ''}
          </div>
        </div>
      </div>

      {/* Line items */}
      <table className="mt-6 w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-[#16211b] text-left text-[9.5px] uppercase tracking-[0.5px] text-[#f3eee2]">
            <th className="px-3 py-2 font-semibold">Deskripsi</th>
            <th className="px-3 py-2 text-center font-semibold">Qty</th>
            <th className="px-3 py-2 text-right font-semibold">Harga Satuan</th>
            <th className="px-3 py-2 text-right font-semibold">Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((it) => (
            <tr key={it.description} className="border-b border-line-3">
              <td className="px-3 py-2.5">
                <div className="font-semibold">{it.description}</div>
                <div className="text-[9.5px] text-muted-3">{it.detail}</div>
              </td>
              <td className="px-3 py-2.5 text-center font-mono">{it.qty}</td>
              <td className="px-3 py-2.5 text-right font-mono">{fmtFull(it.price)}</td>
              <td className="px-3 py-2.5 text-right font-mono font-semibold">{fmtFull(it.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 grid grid-cols-[1.3fr_1fr] gap-6">
        {/* Riwayat & jadwal pembayaran */}
        <div>
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.6px] text-muted-3">Riwayat & Jadwal Pembayaran</div>
          <table className="w-full border-collapse text-[10.5px]">
            <thead>
              <tr className="border-b border-line-2 text-left text-[9px] uppercase text-muted-3">
                <th className="py-1.5 font-semibold">Termin</th><th className="py-1.5 font-semibold">Jatuh Tempo</th>
                <th className="py-1.5 text-right font-semibold">Jumlah</th><th className="py-1.5 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.schedules.map((s) => (
                <tr key={s.label} className="border-b border-line-3">
                  <td className="py-1.5 font-medium">{s.label}</td>
                  <td className="py-1.5 text-muted">{fmtDate(s.dueDate)}</td>
                  <td className="py-1.5 text-right font-mono">{fmtFull(s.amount)}</td>
                  <td className="py-1.5 text-right font-semibold" style={{ color: s.status === 'paid' ? 'oklch(0.42 0.07 158)' : 'oklch(0.5 0.14 28)' }}>
                    {s.status === 'paid' ? 'Lunas' : 'Belum'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Totals */}
        <div className="h-fit rounded-[10px] border border-line-2 bg-panel p-4 text-[11.5px]">
          <div className="flex justify-between py-1"><span className="text-muted-2">Subtotal</span><span className="font-mono font-semibold">{fmtFull(d.subtotal)}</span></div>
          <div className="flex justify-between py-1"><span className="text-muted-2">Sudah dibayar</span><span className="font-mono font-semibold text-[oklch(0.42_0.07_158)]">− {fmtFull(d.paid)}</span></div>
          <div className="mt-1 flex justify-between border-t-2 border-[#16211b] pt-2 text-[13px]">
            <span className="font-bold">Sisa Tagihan</span>
            <span className="font-mono font-bold text-danger-deep">{fmtFull(d.remaining)}</span>
          </div>
        </div>
      </div>

      {/* Instruksi pembayaran */}
      <div className="mt-5 rounded-[10px] border border-[oklch(0.85_0.04_245)] bg-[oklch(0.97_0.02_245)] p-4">
        <div className="text-[9.5px] font-bold uppercase tracking-[0.6px] text-[oklch(0.45_0.06_245)]">Instruksi Pembayaran</div>
        <div className="mt-1.5 text-[11px] leading-relaxed text-[#3a3428]">
          BSI Virtual Account <span className="font-mono text-[13px] font-bold">{d.vaNumber}</span> a.n. <b>PT Safar Barokah Wisata</b><br />
          <span className="text-[10px] text-muted-2">
            Dana yang diterima dicatat sebagai <b>Uang Muka Jamaah</b> (akad wakalah/ijarah) dan diakui sebagai pendapatan sesuai <b>PSAK 72</b> saat penyelenggaraan perjalanan.
          </span>
        </div>
      </div>

      {/* Tanda tangan */}
      <div className="mt-8 flex justify-end text-center text-[10.5px]">
        <div>
          <div>Jakarta, {fmtDate(d.issuedDate, 'long')}</div>
          <div className="mt-14 font-semibold">Divisi Keuangan</div>
        </div>
      </div>
    </DocShell>
  );
}
