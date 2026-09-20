import { z } from 'zod';

const lineSchema = z.object({
  accountCode: z.string().regex(/^\d-\d{4}$/),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  amountForeign: z.number().nullish()
});

export const manualJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(3),
  costCenterId: z.string().uuid().nullish(),
  lines: z.array(lineSchema).min(2)
});

export const receiptTxSchema = z.object({
  invoiceId: z.string().uuid(),
  scheduleId: z.string().uuid().nullish(),
  bankAccountCode: z.string().regex(/^\d-\d{4}$/).default('1-1200'),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  method: z.enum(['va', 'transfer', 'cash', 'card']).default('va')
});

export const expenseTxSchema = z.object({
  vendorId: z.string().uuid().nullish(),
  vendorName: z.string().max(120).nullish(),
  costCenterId: z.string().uuid().nullish(),
  sourceBankCode: z.string().regex(/^\d-\d{4}$/),
  exchangeRate: z.number().positive().nullish(),
  settleDebt: z.boolean().default(false),
  exchangeRateAtRecognition: z.number().positive().nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  description: z.string().max(300).nullish(),
  // B (putaran 3): vendorBillId opsional per baris — pelunasan tagihan vendor
  // tercatat (hanya berlaku utk baris akun 2-1300, divalidasi di service).
  lines: z.array(z.object({
    accountCode: z.string().regex(/^\d-\d{4}$/),
    amount: z.number().positive(),
    vendorBillId: z.string().uuid().nullish()
  })).min(1)
});

export const revenueTxSchema = z.object({
  costCenterId: z.string().uuid(),
  revenueAccountCode: z.enum(['4-1000', '4-2000', '4-3000']),
  amount: z.number().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  // B (putaran 3): vendorId per komponen — wajib HANYA bila komponen ini melebihi
  // saldo 1-1400 yang tersedia (divalidasi di service, bukan di sini karena
  // tergantung saldo runtime); dueDate opsional per komponen, jatuh balik ke
  // dueDate top-level bila kosong.
  hpp: z.array(z.object({
    accountCode: z.string().regex(/^5-\d{4}$/),
    amount: z.number().positive(),
    vendorId: z.string().uuid().nullish(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()
  })).nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()
});

export const commissionTxSchema = z.object({
  agentId: z.string().uuid(),
  costCenterId: z.string().uuid().nullish(),
  base: z.number().positive(),
  pct: z.number().positive().max(30),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()
});

export const journalsQuery = z.object({
  source: z.enum(['payment', 'expense', 'revenue', 'commission', 'manual', 'reconciliation', 'refund']).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional()
});

export const reconciliationQuery = z.object({
  bankAccountCode: z.string().regex(/^\d-\d{4}$/).default('1-1200'),
  month: z.string().regex(/^\d{4}-\d{2}$/)
});

const LINE_TYPES = ['setoran', 'penarikan', 'jasa_giro', 'biaya_adm', 'pajak_giro', 'transfer', 'lain'] as const;

export const openReconciliationSchema = z.object({
  bankAccountCode: z.string().regex(/^\d-\d{4}$/),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingBalance: z.number().nullish(),
  closingBalance: z.number()
});

export const statementLineSchema = z.object({
  lineDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(2).max(200),
  amount: z.number().refine((n) => n !== 0, 'Nominal tidak boleh 0'),
  lineType: z.enum(LINE_TYPES).default('lain'),
  externalRef: z.string().max(120).nullish()
});

export const importStatementSchema = z.object({
  rows: z.array(statementLineSchema).min(1).max(1000)
});

export const matchLineSchema = z.object({
  journalLineId: z.string().uuid().nullish()
});

export const upsertVendorSchema = z.object({
  name: z.string().min(2).max(120),
  type: z.enum(['hotel', 'airline', 'visa', 'catering', 'transport', 'other']).default('other')
});

export const vendorBillsQuery = z.object({
  status: z.enum(['unpaid', 'paid', 'void']).optional(),
  costCenterId: z.string().uuid().optional()
});

export const voidVendorBillSchema = z.object({
  reason: z.string().trim().min(5, 'Alasan pembatalan minimal 5 karakter').max(300)
});

// C — balik jurnal manual (rekomendasi N-3).
export const reverseJournalSchema = z.object({
  reason: z.string().trim().min(5, 'Alasan pembalikan minimal 5 karakter'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish()
});
