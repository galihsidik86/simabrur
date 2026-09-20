import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { paymentsController } from './payments.controller.js';

export const invoicesRoutes = Router();
invoicesRoutes.post('/', requireAuth, requireRoles('keuangan'), paymentsController.createInvoice);
invoicesRoutes.get('/:id/document', requireAuth, paymentsController.invoiceDocument);
invoicesRoutes.get('/:id/payments', requireAuth, requireRoles('keuangan', 'pimpinan'), paymentsController.invoicePayments);

export const paymentsRoutes = Router();
paymentsRoutes.post('/', requireAuth, requireRoles('keuangan'), paymentsController.createPayment);
paymentsRoutes.patch('/:id/verify', requireAuth, requireRoles('keuangan'), paymentsController.verifyPayment);
paymentsRoutes.patch('/:id/reject', requireAuth, requireRoles('keuangan'), paymentsController.rejectPayment);

export const refundsRoutes = Router();
refundsRoutes.get('/', requireAuth, requireRoles('keuangan', 'pimpinan'), paymentsController.listRefunds);
refundsRoutes.post('/:id/pay', requireAuth, requireRoles('keuangan'), paymentsController.payRefund);
// A (putaran 3): kwitansi refund — keuangan, pimpinan, operasional, marketing (admin lolos otomatis).
refundsRoutes.get(
  '/:id/receipt',
  requireAuth,
  requireRoles('keuangan', 'pimpinan', 'operasional', 'marketing'),
  paymentsController.refundReceipt
);

export const receivablesRoutes = Router();
receivablesRoutes.get('/', requireAuth, requireRoles('keuangan', 'pimpinan', 'marketing'), paymentsController.receivables);
receivablesRoutes.get('/aging', requireAuth, requireRoles('keuangan', 'pimpinan', 'operasional'), paymentsController.aging);

export const receiptsRoutes = Router();
receiptsRoutes.get('/:id/document', requireAuth, paymentsController.receiptDocument);

export const bankAccountsRoutes = Router();
bankAccountsRoutes.get('/', requireAuth, requireRoles('keuangan', 'pimpinan'), paymentsController.bankAccounts);
bankAccountsRoutes.post('/', requireAuth, requireRoles('keuangan'), paymentsController.createBankAccount);
bankAccountsRoutes.put('/:id', requireAuth, requireRoles('keuangan'), paymentsController.updateBankAccount);
bankAccountsRoutes.delete('/:id', requireAuth, requireRoles('keuangan'), paymentsController.deleteBankAccount);
