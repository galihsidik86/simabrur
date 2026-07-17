import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { fmtFull, fmtDate } from '../../utils/format';
import { ACC_CLASS_COLOR } from './KeuanganPage';

interface Account {
  code: string; name: string; class: number; className: string; normalBalance: string;
  level: number; isPostable: boolean; highlighted: boolean; note: string | null; balance: number;
}
interface Ledger {
  account: { code: string; name: string; normalBalance: string };
  lines: { date: string; journalNo: string; description: string; debit: number; credit: number; balance: number }[];
  endingBalance: number;
}

export function CoaPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const { data: accounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data.data as Account[]
  });
  const { data: ledger } = useQuery({
    queryKey: ['ledger', selected],
    enabled: Boolean(selected),
    queryFn: async () => (await api.get(`/ledger/${selected}`)).data.data as Ledger
  });

  if (!accounts) return <div className="text-[12.5px] text-muted-2">Memuat bagan akun…</div>;
  const classes = [...new Set(accounts.map((a) => a.class))].sort();

  return (
    <div className="grid grid-cols-[1.2fr_1fr] gap-4 max-lg:grid-cols-1">
      {/* COA per kelas */}
      <div className="flex flex-col gap-4">
        {classes.map((cls) => {
          const rows = accounts.filter((a) => a.class === cls);
          return (
            <div key={cls} className="overflow-hidden rounded-card border border-line bg-card shadow-card">
              <div className="flex items-center gap-2.5 px-4 py-2.5 text-[12.5px] font-bold text-white" style={{ background: ACC_CLASS_COLOR[cls] }}>
                <span>{cls}</span><span>·</span><span>{rows[0].className.toUpperCase()}</span>
              </div>
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.code}
                      onClick={() => a.isPostable && setSelected(a.code)}
                      className={`border-t border-[#f6f1e6] ${a.isPostable ? 'cursor-pointer hover:bg-panel' : ''}`}
                      style={{
                        background: a.highlighted ? 'oklch(0.97 0.03 78)' : selected === a.code ? '#f6f1e6' : undefined
                      }}>
                      <td className="w-[80px] px-4 py-2 font-mono text-[11px] font-semibold" style={{ color: ACC_CLASS_COLOR[cls] }}>{a.code}</td>
                      <td className="px-2 py-2" style={{ paddingLeft: a.level === 1 ? 22 : 8, fontWeight: a.level === 0 ? 700 : 500 }}>
                        {a.name}
                        {a.note && <span className="ml-2 text-[10px] font-normal text-muted-4">{a.note}</span>}
                      </td>
                      <td className="w-[130px] px-4 py-2 text-right font-mono text-[11px]">
                        {a.isPostable ? fmtFull(a.balance) : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Buku besar */}
      <div className="h-fit rounded-card border border-line bg-card shadow-card lg:sticky lg:top-2">
        <div className="border-b border-line-3 px-5 py-3.5">
          <div className="text-[14px] font-semibold">Buku Besar</div>
          <div className="text-[11px] text-muted-3">
            {ledger ? <>Akun <span className="font-mono font-semibold">{ledger.account.code}</span> — {ledger.account.name}</> : 'Klik akun untuk melihat buku besarnya'}
          </div>
        </div>
        {ledger && (
          <>
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0">
                  <tr className="bg-thead text-left text-[9.5px] uppercase tracking-[0.4px] text-muted-3">
                    <th className="px-4 py-2 font-semibold">Tanggal</th><th className="px-2 py-2 font-semibold">Jurnal</th>
                    <th className="px-2 py-2 text-right font-semibold">Debit</th><th className="px-2 py-2 text-right font-semibold">Kredit</th>
                    <th className="px-4 py-2 text-right font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.lines.map((l, i) => (
                    <tr key={i} className="border-t border-[#f6f1e6]">
                      <td className="px-4 py-1.5 text-muted">{fmtDate(l.date)}</td>
                      <td className="px-2 py-1.5">
                        <div className="font-mono text-[10px]">{l.journalNo}</div>
                        <div className="max-w-[180px] truncate text-[10px] text-muted-3" title={l.description}>{l.description}</div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono">{l.debit ? l.debit.toLocaleString('id-ID') : ''}</td>
                      <td className="px-2 py-1.5 text-right font-mono">{l.credit ? l.credit.toLocaleString('id-ID') : ''}</td>
                      <td className="px-4 py-1.5 text-right font-mono font-semibold">{l.balance.toLocaleString('id-ID')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between border-t border-line-2 bg-panel px-5 py-3 text-[12px]">
              <span className="font-semibold">Saldo akhir ({ledger.account.normalBalance})</span>
              <span className="font-mono font-bold">{fmtFull(ledger.endingBalance)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
