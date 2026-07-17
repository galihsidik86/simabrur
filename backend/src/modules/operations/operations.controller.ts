import type { Request, Response } from 'express';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { ok, errors } from '../../utils/http.js';
import { operationsService } from './operations.service.js';
import { paymentsService } from '../payments/payments.service.js';

const visaSchema = z.object({
  registrationId: z.string().uuid(),
  status: z.enum(['process', 'biometric', 'issued']),
  visaNo: z.string().max(30).nullish()
});
const ticketSchema = z.object({
  registrationId: z.string().uuid(),
  pnr: z.string().min(2).max(20),
  seat: z.string().max(10).nullish()
});
const staffSchema = z.object({
  groupId: z.string().uuid(),
  staffName: z.string().min(2),
  role: z.enum(['muthawwif', 'tour_leader'])
});
const checklistSchema = z.object({ isDone: z.boolean() });

export const operationsController = {
  async manifest(req: Request, res: Response) {
    ok(res, await operationsService.manifest(String(req.params.id)));
  },
  async upsertVisa(req: Request, res: Response) {
    ok(res, await operationsService.upsertVisa(req, visaSchema.parse(req.body)), undefined, 201);
  },
  async upsertTicket(req: Request, res: Response) {
    ok(res, await operationsService.upsertTicket(req, ticketSchema.parse(req.body)), undefined, 201);
  },
  async assignStaff(req: Request, res: Response) {
    ok(res, await operationsService.assignGroupStaff(req, staffSchema.parse(req.body)), undefined, 201);
  },
  async checklists(req: Request, res: Response) {
    const registrationId = req.query.registrationId;
    if (typeof registrationId !== 'string') throw errors.badRequest('registrationId wajib diisi');
    ok(res, await operationsService.checklists(registrationId));
  },
  async toggleChecklist(req: Request, res: Response) {
    const { isDone } = checklistSchema.parse(req.body);
    ok(res, await operationsService.toggleChecklist(req, String(req.params.id), isDone));
  },
  async documentCompliance(req: Request, res: Response) {
    const departureId = typeof req.query.departureId === 'string' ? req.query.departureId : undefined;
    ok(res, await operationsService.documentCompliance(departureId));
  },
  async readiness(_req: Request, res: Response) {
    ok(res, await operationsService.readiness());
  },

  /** Ekspor Excel: aging / compliance / readiness. */
  async exportReport(req: Request, res: Response) {
    const report = String(req.query.report ?? '');
    const wb = XLSX.utils.book_new();

    if (report === 'aging') {
      const { rows } = await paymentsService.aging();
      const data = rows.map((r) => ({
        'No. Registrasi': r.regNumber, Jamaah: r.name, Paket: r.packageName,
        Total: r.total, Terbayar: r.paid, Sisa: r.remaining,
        'Jatuh Tempo': r.nextDueDate ?? '', Umur: r.agingBucket, Status: r.status
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Piutang Aging');
    } else if (report === 'compliance') {
      const { perDeparture } = await operationsService.documentCompliance();
      const data = perDeparture.map((d) => ({
        Paket: d.packageName, Keberangkatan: d.departureDate, Jamaah: d.jamaahCount,
        'Kelengkapan %': d.pct, Catatan: d.note
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Kepatuhan Dokumen');
    } else if (report === 'readiness') {
      const { cards } = await operationsService.readiness();
      const data = cards.map((c) => ({
        Paket: c.packageName, Keberangkatan: c.departureDate, Jamaah: c.jamaahCount,
        'Skor %': c.score, 'Pelunasan %': c.metrics.paymentPct, 'Dokumen %': c.metrics.documentPct,
        Visa: `${c.metrics.visaIssued}/${c.jamaahCount}`, Tiket: `${c.metrics.ticketIssued}/${c.jamaahCount}`,
        Manifest: c.manifestStatus, Catatan: c.note
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Kesiapan');
    } else if (report === 'income-statement') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const { lines } = await financeReportsService.incomeStatement();
      const data = lines.filter((l) => l.kind !== 'head').map((l) => ({ Kode: l.code ?? '', Uraian: l.label, Jumlah: l.amount ?? '' }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Laba Rugi');
    } else if (report === 'balance-sheet') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const bs = await financeReportsService.balanceSheet();
      const rows = [...bs.assets.lines, ...bs.liabilitiesEquity.lines]
        .filter((l) => l.kind !== 'head')
        .map((l) => ({ Kode: (l as { code?: string }).code ?? '', Uraian: l.label, Jumlah: l.amount ?? '' }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Neraca');
    } else if (report === 'profit') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const { packages, total } = await financeReportsService.profitByPackage();
      const data = [
        ...packages.map((p) => ({ Paket: p.name, Jamaah: p.jamaah, Pendapatan: p.revenue, HPP: p.cogs, 'Laba Kotor': p.grossProfit, 'Margin %': p.margin })),
        { Paket: 'TOTAL', Jamaah: total.jamaah, Pendapatan: total.revenue, HPP: total.cogs, 'Laba Kotor': total.grossProfit, 'Margin %': total.margin }
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Laba per Paket');
    } else {
      throw errors.badRequest('report harus salah satu dari: aging, compliance, readiness, income-statement, balance-sheet, profit');
    }

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="laporan-${report}.xlsx"`)
      .send(buf);
  }
};
