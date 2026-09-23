import type { Request, Response } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { ok, errors } from '../../utils/http.js';
import { operationsService } from './operations.service.js';
import { paymentsService } from '../payments/payments.service.js';

/**
 * SEC-04: dulu `XLSX.utils.json_to_sheet` dari paket `xlsx` 0.18.5, yang punya advisory
 * HIGH tanpa versi perbaikan di registry npm. Diganti `exceljs`. Helper ini menjaga
 * bentuk pemakaian lama (array objek → satu sheet) supaya keenam cabang laporan di
 * `exportReport` tidak perlu ditulis ulang satu per satu.
 *
 * Kunci objek BARIS PERTAMA menentukan kolom — sama seperti perilaku `json_to_sheet`.
 */
type SheetRow = Record<string, unknown>;

/**
 * Sebagian sumber laporan (mis. `paymentsService.aging()`) mengembalikan kolom bertipe
 * `unknown`. Dulu itu lolos begitu saja karena `json_to_sheet` menerima `any`; di sini
 * nilainya dinormalkan secara eksplisit supaya tidak ada `[object Object]` menyelinap
 * ke dalam berkas Excel.
 */
function cell(value: unknown): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  return String(value);
}

function appendSheet(wb: ExcelJS.Workbook, name: string, rows: SheetRow[]): void {
  const ws = wb.addWorksheet(name);
  if (!rows.length) return; // laporan kosong tetap menghasilkan sheet, bukan error
  const headers = Object.keys(rows[0]);
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));
  ws.getRow(1).font = { bold: true };
  // Bentuk array: urutan mengikuti `headers`, jadi baris yang kebetulan punya kunci
  // berbeda (mis. baris TOTAL) tetap jatuh ke kolom yang benar.
  for (const row of rows) ws.addRow(headers.map((h) => cell(row[h])));
}

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
const phoneSchema = z.string().regex(/^08\d{8,13}$/, 'Format nomor HP: 08xxxxxxxxxx (tanpa spasi/strip)');
const staffSchema = z.object({
  groupId: z.string().uuid(),
  staffName: z.string().min(2),
  role: z.enum(['muthawwif', 'tour_leader']),
  phone: phoneSchema.nullish()
});
const updateStaffSchema = z.object({
  staffName: z.string().min(2).optional(),
  phone: phoneSchema.nullable().optional()
});
const createGroupSchema = z.object({
  departureId: z.string().uuid(),
  name: z.string().min(2).max(60),
  capacity: z.number().int().min(1).max(500).default(45)
});
const assignmentSchema = z.object({
  groupId: z.string().uuid().nullable().optional(),
  roomNumber: z.string().max(20).nullable().optional()
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
  async updateStaff(req: Request, res: Response) {
    ok(res, await operationsService.updateGroupStaff(req, String(req.params.id), updateStaffSchema.parse(req.body)));
  },
  async createGroup(req: Request, res: Response) {
    ok(res, await operationsService.createGroup(req, createGroupSchema.parse(req.body)), undefined, 201);
  },
  async assignRegistration(req: Request, res: Response) {
    ok(res, await operationsService.assignRegistration(req, String(req.params.id), assignmentSchema.parse(req.body)));
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
    // NEW-BE-02: laporan KEUANGAN (income-statement/balance-sheet/profit) hanya utk role
    // yang di NAV sidebar (AppShell) punya menu Laporan Keuangan — operasional TIDAK.
    // Laporan operasional (aging/compliance/readiness) tetap sesuai role rute ini.
    const FINANCIAL_REPORTS = new Set(['income-statement', 'balance-sheet', 'profit']);
    if (FINANCIAL_REPORTS.has(report) && !['keuangan', 'pimpinan', 'admin'].includes(req.user?.role ?? '')) {
      throw errors.forbidden();
    }
    const wb = new ExcelJS.Workbook();

    if (report === 'aging') {
      const { rows } = await paymentsService.aging();
      const data = rows.map((r) => ({
        'No. Registrasi': r.regNumber, Jamaah: r.name, Paket: r.packageName,
        Total: r.total, Terbayar: r.paid, Sisa: r.remaining,
        'Jatuh Tempo': r.nextDueDate ?? '', Umur: r.agingBucket, Status: r.status
      }));
      appendSheet(wb, 'Piutang Aging', data);
    } else if (report === 'compliance') {
      const { perDeparture } = await operationsService.documentCompliance();
      const data = perDeparture.map((d) => ({
        Paket: d.packageName, Keberangkatan: d.departureDate, Jamaah: d.jamaahCount,
        'Kelengkapan %': d.pct, Catatan: d.note
      }));
      appendSheet(wb, 'Kepatuhan Dokumen', data);
    } else if (report === 'readiness') {
      const { cards } = await operationsService.readiness();
      const data = cards.map((c) => ({
        Paket: c.packageName, Keberangkatan: c.departureDate, Jamaah: c.jamaahCount,
        'Skor %': c.score, 'Pelunasan %': c.metrics.paymentPct, 'Dokumen %': c.metrics.documentPct,
        Visa: `${c.metrics.visaIssued}/${c.jamaahCount}`, Tiket: `${c.metrics.ticketIssued}/${c.jamaahCount}`,
        Manifest: c.manifestStatus, Catatan: c.note
      }));
      appendSheet(wb, 'Kesiapan', data);
    } else if (report === 'income-statement') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const { lines } = await financeReportsService.incomeStatement();
      const data = lines.filter((l) => l.kind !== 'head').map((l) => ({ Kode: l.code ?? '', Uraian: l.label, Jumlah: l.amount ?? '' }));
      appendSheet(wb, 'Laba Rugi', data);
    } else if (report === 'balance-sheet') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const bs = await financeReportsService.balanceSheet();
      const rows = [...bs.assets.lines, ...bs.liabilitiesEquity.lines]
        .filter((l) => l.kind !== 'head')
        .map((l) => ({ Kode: (l as { code?: string }).code ?? '', Uraian: l.label, Jumlah: l.amount ?? '' }));
      appendSheet(wb, 'Neraca', rows);
    } else if (report === 'profit') {
      const { financeReportsService } = await import('../reports/finance.service.js');
      const { packages, total } = await financeReportsService.profitByPackage();
      const data = [
        ...packages.map((p) => ({ Paket: p.name, Jamaah: p.jamaah, Pendapatan: p.revenue, HPP: p.cogs, 'Laba Kotor': p.grossProfit, 'Margin %': p.margin })),
        { Paket: 'TOTAL', Jamaah: total.jamaah, Pendapatan: total.revenue, HPP: total.cogs, 'Laba Kotor': total.grossProfit, 'Margin %': total.margin }
      ];
      appendSheet(wb, 'Laba per Paket', data);
    } else {
      throw errors.badRequest('report harus salah satu dari: aging, compliance, readiness, income-statement, balance-sheet, profit');
    }

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    res
      .setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .setHeader('Content-Disposition', `attachment; filename="laporan-${report}.xlsx"`)
      .send(buf);
  }
};
