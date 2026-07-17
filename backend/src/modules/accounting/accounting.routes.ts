import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { accountingController } from './accounting.controller.js';

const KEU = ['keuangan', 'pimpinan'] as const;

export const accountsRoutes = Router();
accountsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.accounts);

export const costCentersRoutes = Router();
costCentersRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.costCenters);

export const journalsRoutes = Router();
journalsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.journals);
journalsRoutes.post('/', requireAuth, requireRoles('keuangan'), accountingController.createManualJournal);

export const ledgerRoutes = Router();
ledgerRoutes.get('/:code', requireAuth, requireRoles(...KEU), accountingController.ledger);

export const transactionsRoutes = Router();
transactionsRoutes.post('/receipt', requireAuth, requireRoles('keuangan'), accountingController.txReceipt);
transactionsRoutes.post('/expense', requireAuth, requireRoles('keuangan'), accountingController.txExpense);
transactionsRoutes.post('/revenue-recognition', requireAuth, requireRoles('keuangan'), accountingController.txRevenue);
transactionsRoutes.post('/commission', requireAuth, requireRoles('keuangan'), accountingController.txCommission);

export const bankReconciliationsRoutes = Router();
bankReconciliationsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.reconciliation);
bankReconciliationsRoutes.post('/:id/match', requireAuth, requireRoles('keuangan'), accountingController.matchStatementLine);

export const accountingSummaryRoutes = Router();
accountingSummaryRoutes.get('/summary', requireAuth, requireRoles(...KEU), accountingController.summary);
