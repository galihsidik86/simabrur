import { db } from '../../config/db.js';

/**
 * Laporan keuangan — seluruhnya diagregasi dari journal_lines (satu sumber
 * kebenaran: jurnal yang selalu balance), struktur persis Laporan Keuangan.dc.html.
 */

interface AccountAgg {
  code: string;
  name: string;
  class: number;
  normal: 'debit' | 'credit';
  balance: number; // menurut saldo normal
}

async function aggregate(from?: string, to?: string): Promise<AccountAgg[]> {
  const rows: any[] = await db('journal_lines as l')
    .join('journals as j', 'j.id', 'l.journal_id')
    .join('accounts as a', 'a.id', 'l.account_id')
    .select('a.code', 'a.name', 'a.class', 'a.normal_balance')
    .sum({ debit: 'l.debit', credit: 'l.credit' })
    .modify((q) => {
      if (from) q.where('j.date', '>=', from);
      if (to) q.where('j.date', '<=', to);
    })
    .groupBy('a.code', 'a.name', 'a.class', 'a.normal_balance')
    .orderBy('a.code');
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    class: r.class,
    normal: r.normal_balance,
    balance: r.normal_balance === 'debit' ? Number(r.debit) - Number(r.credit) : Number(r.credit) - Number(r.debit)
  }));
}

const sum = (rows: AccountAgg[]) => rows.reduce((s, r) => s + r.balance, 0);

export interface ReportLine {
  label: string;
  code?: string;
  amount?: number;
  kind: 'head' | 'item' | 'total' | 'grand' | 'sub' | 'gap';
}

export const financeReportsService = {
  /** Laporan Laba Rugi periode (default YTD). */
  async incomeStatement(from?: string, to?: string) {
    const year = (to ?? new Date().toISOString().slice(0, 10)).slice(0, 4);
    const f = from ?? `${year}-01-01`;
    const t = to ?? new Date().toISOString().slice(0, 10);
    const agg = await aggregate(f, t);

    const revenue = agg.filter((a) => a.class === 4);
    const cogs = agg.filter((a) => a.class === 5);
    const opex = agg.filter((a) => a.class === 6);
    const other = agg.filter((a) => a.class === 7);

    const totalRevenue = sum(revenue);
    const totalCogs = sum(cogs);
    const grossProfit = totalRevenue - totalCogs;
    const totalOpex = sum(opex);
    const operatingProfit = grossProfit - totalOpex;
    // Kelas 7: 7-1000 normal kredit (laba kurs; negatif = rugi), 7-2000 normal debit (beban)
    const totalOther = other.reduce((s, a) => s + (a.normal === 'credit' ? a.balance : -a.balance), 0);
    const netIncome = operatingProfit + totalOther;

    const lines: ReportLine[] = [
      { label: 'Pendapatan Usaha', kind: 'head' },
      ...revenue.map((a) => ({ label: a.name, code: a.code, amount: a.balance, kind: 'item' as const })),
      { label: 'Total Pendapatan', amount: totalRevenue, kind: 'total' },
      { label: 'Beban Pokok Jasa (HPP)', kind: 'head' },
      ...cogs.map((a) => ({ label: a.name, code: a.code, amount: a.balance, kind: 'item' as const })),
      { label: 'Total HPP', amount: totalCogs, kind: 'total' },
      { label: 'Laba Kotor', amount: grossProfit, kind: 'grand' },
      { label: 'Beban Operasional', kind: 'head' },
      ...opex.map((a) => ({ label: a.name, code: a.code, amount: a.balance, kind: 'item' as const })),
      { label: 'Total Beban Operasional', amount: totalOpex, kind: 'total' },
      { label: 'Laba Usaha', amount: operatingProfit, kind: 'sub' },
      { label: 'Pendapatan & Beban Lain', kind: 'head' },
      ...other.map((a) => ({
        label: a.name, code: a.code,
        amount: a.normal === 'credit' ? a.balance : -a.balance,
        kind: 'item' as const
      })),
      { label: 'Total Lain-lain', amount: totalOther, kind: 'total' },
      { label: 'Laba Bersih', amount: netIncome, kind: 'grand' }
    ];
    return { period: { from: f, to: t }, lines, netIncome };
  },

  /** Neraca per tanggal (kumulatif). Laba tahun berjalan dihitung dari kelas 4-7. */
  async balanceSheet(asOf?: string) {
    const t = asOf ?? new Date().toISOString().slice(0, 10);
    const agg = await aggregate(undefined, t);

    const current = agg.filter((a) => a.class === 1 && a.code < '1-2000');
    const fixed = agg.filter((a) => a.class === 1 && a.code >= '1-2000');
    const liabilities = agg.filter((a) => a.class === 2);
    const equity = agg.filter((a) => a.class === 3);
    const pnl = agg.filter((a) => a.class >= 4);
    const netIncome = pnl.reduce((s, a) => {
      if (a.class === 4) return s + a.balance;
      if (a.class === 5 || a.class === 6) return s - a.balance;
      return s + (a.normal === 'credit' ? a.balance : -a.balance);
    }, 0);

    // Akun kontra (akumulasi penyusutan) tampil negatif
    const fixedAdj = fixed.map((a) => (a.code === '1-2200' ? { ...a, balance: -Math.abs(a.balance) } : a));
    const totalCurrent = sum(current);
    const totalFixed = fixedAdj.reduce((s, a) => s + a.balance, 0);
    const totalAssets = totalCurrent + totalFixed;
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity) + netIncome;

    const item = (a: AccountAgg) => ({ label: a.name, code: a.code, amount: a.balance, kind: 'item' as const });
    return {
      asOf: t,
      assets: {
        lines: [
          { label: 'Aset Lancar', kind: 'head' as const },
          ...current.map(item),
          { label: 'Total Aset Lancar', amount: totalCurrent, kind: 'total' as const },
          { label: 'Aset Tetap', kind: 'head' as const },
          ...fixedAdj.map(item),
          { label: 'Total Aset Tetap', amount: totalFixed, kind: 'total' as const },
          { label: 'TOTAL ASET', amount: totalAssets, kind: 'grand' as const }
        ],
        total: totalAssets
      },
      liabilitiesEquity: {
        lines: [
          { label: 'Liabilitas', kind: 'head' as const },
          ...liabilities.map(item),
          { label: 'Total Liabilitas', amount: totalLiabilities, kind: 'total' as const },
          { label: 'Ekuitas', kind: 'head' as const },
          ...equity.map(item),
          { label: 'Laba (Rugi) Tahun Berjalan', amount: netIncome, kind: 'item' as const },
          { label: 'Total Ekuitas', amount: totalEquity, kind: 'total' as const },
          { label: 'TOTAL LIABILITAS + EKUITAS', amount: totalLiabilities + totalEquity, kind: 'grand' as const }
        ],
        total: totalLiabilities + totalEquity
      },
      balanced: totalAssets === totalLiabilities + totalEquity
    };
  },

  /** Laba Rugi per Paket (agregasi cost center → paket). */
  async profitByPackage() {
    const rows: any[] = await db('journal_lines as l')
      .join('journals as j', 'j.id', 'l.journal_id')
      .join('accounts as a', 'a.id', 'l.account_id')
      .join('cost_centers as cc', 'cc.id', 'j.cost_center_id')
      .leftJoin('departures as d', 'd.id', 'cc.departure_id')
      .leftJoin('packages as p', 'p.id', 'd.package_id')
      .select('p.id as package_id', 'p.name as package_name', 'a.class')
      .sum({ debit: 'l.debit', credit: 'l.credit' })
      .whereIn('a.class', [4, 5])
      .whereNotNull('p.id')
      .groupBy('p.id', 'p.name', 'a.class');

    const jamaahCounts: any[] = await db('registrations as r')
      .join('departures as d', 'd.id', 'r.departure_id')
      .select('d.package_id')
      .count({ n: '*' })
      .groupBy('d.package_id');
    const countMap = new Map(jamaahCounts.map((r) => [r.package_id, Number(r.n)]));

    const map = new Map<string, { name: string; revenue: number; cogs: number }>();
    for (const r of rows) {
      const e = map.get(r.package_id) ?? { name: r.package_name, revenue: 0, cogs: 0 };
      if (r.class === 4) e.revenue += Number(r.credit) - Number(r.debit);
      if (r.class === 5) e.cogs += Number(r.debit) - Number(r.credit);
      map.set(r.package_id, e);
    }
    const packages = [...map.entries()].map(([id, e]) => ({
      packageId: id,
      name: e.name,
      jamaah: countMap.get(id) ?? 0,
      revenue: e.revenue,
      cogs: e.cogs,
      grossProfit: e.revenue - e.cogs,
      margin: e.revenue ? Math.round(((e.revenue - e.cogs) / e.revenue) * 1000) / 10 : 0
    }));
    const total = {
      jamaah: packages.reduce((s, p) => s + p.jamaah, 0),
      revenue: packages.reduce((s, p) => s + p.revenue, 0),
      cogs: packages.reduce((s, p) => s + p.cogs, 0),
      grossProfit: packages.reduce((s, p) => s + p.grossProfit, 0)
    };
    return {
      packages,
      total: { ...total, margin: total.revenue ? Math.round((total.grossProfit / total.revenue) * 1000) / 10 : 0 }
    };
  },

  /** Data Dashboard Eksekutif (replika mockup, dihitung dari data nyata). */
  async dashboard() {
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = today.slice(0, 7);

    // KPI: penerimaan kas bulan ini (jurnal payment) vs bulan lalu
    const monthly: any[] = await db('journal_lines as l')
      .join('journals as j', 'j.id', 'l.journal_id')
      .join('accounts as a', 'a.id', 'l.account_id')
      .select(db.raw(`to_char(j.date, 'YYYY-MM') as month`))
      .sum({ amount: 'l.credit' })
      .where('a.code', '2-1100')
      .where('j.source', 'payment')
      .groupByRaw(`to_char(j.date, 'YYYY-MM')`)
      .orderBy('month');
    const cashIn = new Map(monthly.map((m) => [m.month, Number(m.amount)]));

    const revMonthly: any[] = await db('journal_lines as l')
      .join('journals as j', 'j.id', 'l.journal_id')
      .join('accounts as a', 'a.id', 'l.account_id')
      .select(db.raw(`to_char(j.date, 'YYYY-MM') as month`))
      .sum({ amount: 'l.credit' })
      .where('a.class', 4)
      .groupByRaw(`to_char(j.date, 'YYYY-MM')`);
    const revIn = new Map(revMonthly.map((m) => [m.month, Number(m.amount)]));

    // 6 bulan terakhir untuk chart
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }
    const cashflow = months.map((m) => ({
      month: new Date(m + '-01').toLocaleDateString('id-ID', { month: 'short' }),
      cashIn: cashIn.get(m) ?? 0,
      revenue: revIn.get(m) ?? 0
    }));

    const prevMonth = months[4];
    const omzet = cashIn.get(thisMonth) ?? 0;
    const omzetPrev = cashIn.get(prevMonth) ?? 0;

    const [{ nActive }] = await db('registrations').whereNot('status', 'cancelled').count({ nActive: '*' });
    const [{ nNew }] = await db('registrations').whereRaw(`to_char(created_at, 'YYYY-MM') = ?`, [thisMonth]).count({ nNew: '*' });

    // Saldo bank_accounts sudah dalam IDR fungsional (journal engine mencatat IDR) — jumlahkan langsung
    const banks = await db('bank_accounts');
    const cashTotal = banks.reduce((s, b) => s + Number(b.balance), 0);

    const profit = await this.profitByPackage();

    const upcoming: any[] = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('p.name', 'd.departure_date', 'd.quota', 'd.seats_taken')
      .where('d.status', 'open')
      .where('d.departure_date', '>=', today)
      .orderBy('d.departure_date')
      .limit(4);

    return {
      kpi: {
        omzetThisMonth: omzet,
        omzetDeltaPct: omzetPrev ? Math.round(((omzet - omzetPrev) / omzetPrev) * 1000) / 10 : null,
        jamaahActive: Number(nActive),
        jamaahNewThisMonth: Number(nNew),
        avgMargin: profit.total.margin,
        cashAndBank: cashTotal,
        bankCount: banks.length
      },
      cashflow,
      profitByPackage: profit.packages,
      upcoming: upcoming.map((u) => ({
        name: u.name,
        date: u.departure_date,
        quota: u.quota,
        seatsTaken: u.seats_taken,
        pct: Math.round((u.seats_taken / u.quota) * 100),
        status: u.seats_taken >= u.quota ? 'Full' : u.seats_taken / u.quota >= 0.8 ? 'Hampir penuh' : 'Terbuka'
      }))
    };
  }
};
