import type { Request, Response } from 'express';
import { ok } from '../../utils/http.js';
import { paymentsService } from './payments.service.js';
import { createInvoiceSchema, createPaymentSchema, upsertBankAccountSchema } from './payments.validation.js';

export const paymentsController = {
  async createInvoice(req: Request, res: Response) {
    const { registrationId } = createInvoiceSchema.parse(req.body);
    ok(res, await paymentsService.createInvoice(req, registrationId), undefined, 201);
  },

  async createPayment(req: Request, res: Response) {
    const input = createPaymentSchema.parse(req.body);
    const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
    const { payment, idempotent } = await paymentsService.createPayment(req, input, key);
    ok(res, payment, undefined, idempotent ? 200 : 201);
  },

  async verifyPayment(req: Request, res: Response) {
    ok(res, await paymentsService.verifyPayment(req, String(req.params.id)));
  },

  async receivables(_req: Request, res: Response) {
    ok(res, await paymentsService.receivables());
  },

  async aging(_req: Request, res: Response) {
    ok(res, await paymentsService.aging());
  },

  async invoiceDocument(req: Request, res: Response) {
    ok(res, await paymentsService.invoiceDocument(String(req.params.id)));
  },

  async invoicePayments(req: Request, res: Response) {
    ok(res, await paymentsService.invoicePayments(String(req.params.id)));
  },

  async receiptDocument(req: Request, res: Response) {
    ok(res, await paymentsService.receiptDocument(String(req.params.id)));
  },

  async bankAccounts(_req: Request, res: Response) {
    ok(res, await paymentsService.bankAccounts());
  },

  async createBankAccount(req: Request, res: Response) {
    ok(res, await paymentsService.createBankAccount(req, upsertBankAccountSchema.parse(req.body)), undefined, 201);
  },
  async updateBankAccount(req: Request, res: Response) {
    ok(res, await paymentsService.updateBankAccount(req, String(req.params.id), upsertBankAccountSchema.parse(req.body)));
  },
  async deleteBankAccount(req: Request, res: Response) {
    ok(res, await paymentsService.deleteBankAccount(req, String(req.params.id)));
  }
};
