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
