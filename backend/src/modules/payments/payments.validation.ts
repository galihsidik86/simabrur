import { z } from 'zod';

export const createInvoiceSchema = z.object({
  registrationId: z.string().uuid()
});

export const createPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  scheduleId: z.string().uuid().nullish(),
  bankAccountCode: z.string().default('1-1200'),
  amount: z.number().positive(),
  method: z.enum(['va', 'transfer', 'cash', 'card']).default('va'),
  paidAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
  reference: z.string().max(100).nullish(),
  note: z.string().max(500).nullish()
});

export const rejectPaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Alasan penolakan minimal 3 karakter')
});

export const listRefundsQuery = z.object({
  status: z.enum(['pending', 'paid']).optional()
});

export const payRefundSchema = z.object({
  deduction: z.number().min(0),
  deductionReason: z.string().trim().min(3).max(300).nullish(),
  bankAccountCode: z.string().regex(/^\d-\d{4}$/, 'Kode akun rekening tidak valid'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  reference: z.string().max(100).nullish()
});

export const upsertBankAccountSchema = z.object({
  accountCode: z.string().regex(/^1-\d{4}$/, 'Kode akun bank harus kelas 1 (aset), format 1-NNNN'),
  name: z.string().min(2).max(120),
  bank: z.string().min(2).max(60).nullish(),
  accountNo: z.string().min(3).max(30).nullish(),
  currency: z.enum(['IDR', 'USD', 'SAR']).default('IDR')
});
