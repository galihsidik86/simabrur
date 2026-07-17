import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtFull, fmtDate } from '../../utils/format';
import { DocShell, DocHeader } from './DocShell';

interface Doc {
  number: string; issuedDate: string; receivedFrom: string; amount: number;
  terbilang: string; description: string; method: string;
  summary: { total: number; paid: number; remaining: number };
}

function DotLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-[11.5px]">
      <span className="w-[140px] flex-none text-muted-2">{label}</span>
      <span className="flex-1 border-b border-dotted border-[#b6ac94] pb-1 font-medium">{children}</span>
    </div>
  );
}

export function KwitansiDoc() {
  const { id } = useParams<{ id: string }>();
  const { data: d, isLoading } = useQuery({
    queryKey: ['receipt-document', id],
    queryFn: async () => (await api.get(`/receipts/${id}/document`)).data.data as Doc
  });

  if (isLoading || !d) return <div className="p-10 text-center text-[13px] text-muted-2">Memuat kwitansi…</div>;

  return (
    <DocShell>
      <DocHeader
        right={
          <>
            <div className="font-display text-[30px] leading-none text-gold">KWITANSI</div>
            <div className="mt-2 font-mono text-[13px] font-semibold">{d.number}</div>
            <div className="mt-1 text-[10px] text-muted-2">{fmtDate(d.issuedDate, 'long')}</div>
          </>
        }
      />

      <div className="mt-7 flex flex-col gap-4">
        <DotLine label="Telah terima dari">{d.receivedFrom}</DotLine>
        <div className="flex items-baseline gap-3 text-[11.5px]">
          <span className="w-[140px] flex-none text-muted-2">Uang sejumlah</span>
          <span className="rounded-[9px] border border-[oklch(0.85_0.07_82)] bg-[oklch(0.96_0.04_82)] px-4 py-2 font-mono text-[17px] font-bold text-[oklch(0.42_0.09_78)]">
            {fmtFull(d.amount)}
          </span>
        </div>
        <DotLine label="Terbilang"><i>"{d.terbilang}"</i></DotLine>
        <DotLine label="Untuk pembayaran">{d.description}</DotLine>
        <DotLine label="Metode">{d.method}</DotLine>
      </div>

      <div className="mt-7 grid grid-cols-[1fr_auto] items-end gap-8">
        <div className="h-fit w-[300px] rounded-[10px] border border-line-2 bg-panel p-4 text-[11px]">
          <div className="flex justify-between py-0.5"><span className="text-muted-2">Total tagihan</span><span className="font-mono font-semibold">{fmtFull(d.summary.total)}</span></div>
          <div className="flex justify-between py-0.5"><span className="text-muted-2">Total terbayar</span><span className="font-mono font-semibold text-[oklch(0.42_0.07_158)]">{fmtFull(d.summary.paid)}</span></div>
          <div className="flex justify-between border-t border-line-2 pt-1.5"><span className="font-semibold">Sisa</span><span className="font-mono font-bold">{fmtFull(d.summary.remaining)}</span></div>
        </div>
        <div className="text-center text-[10.5px]">
          <div>Jakarta, {fmtDate(d.issuedDate, 'long')}</div>
          <div className="mx-auto my-3 flex h-[74px] w-[74px] items-center justify-center rounded-full border-2 border-dashed border-[#b6ac94] text-[8.5px] uppercase tracking-[1px] text-muted-3">
            Stempel
          </div>
          <div className="font-semibold">Penerima / Kasir</div>
        </div>
      </div>

      <div className="mt-8 border-t border-line-3 pt-3 text-center font-mono text-[9px] text-muted-3">
        Jurnal otomatis: Dr Bank BSI · Cr Uang Muka Jamaah (2-1100)
      </div>
    </DocShell>
  );
}
