import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { accountingController } from './accounting.controller.js';

const KEU = ['keuangan', 'pimpinan'] as const;

export const accountsRoutes = Router();
accountsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.accounts);

export const costCentersRoutes = Router();
costCentersRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.costCenters);
// B (putaran 3): saldo 1-1400/2-1100 per cost center — dipakai UI form HPP.
costCentersRoutes.get('/:id/balances', requireAuth, requireRoles(...KEU), accountingController.costCenterBalances);

export const journalsRoutes = Router();
journalsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.journals);
journalsRoutes.post('/', requireAuth, requireRoles('keuangan'), accountingController.createManualJournal);
// C (rekomendasi N-3): balik jurnal manual — hanya keuangan, alasan wajib.
journalsRoutes.post('/:id/reverse', requireAuth, requireRoles('keuangan'), accountingController.reverseJournal);

export const ledgerRoutes = Router();
ledgerRoutes.get('/:code', requireAuth, requireRoles(...KEU), accountingController.ledger);

export const transactionsRoutes = Router();
transactionsRoutes.post('/receipt', requireAuth, requireRoles('keuangan'), accountingController.txReceipt);
transactionsRoutes.post('/expense', requireAuth, requireRoles('keuangan'), accountingController.txExpense);
transactionsRoutes.post('/revenue-recognition', requireAuth, requireRoles('keuangan'), accountingController.txRevenue);
transactionsRoutes.post('/commission', requireAuth, requireRoles('keuangan'), accountingController.txCommission);

export const bankReconciliationsRoutes = Router();
bankReconciliationsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.reconciliation);
bankReconciliationsRoutes.post('/', requireAuth, requireRoles('keuangan'), accountingController.openReconciliation);
// Operasi per-baris mutasi koran (definisikan sebelum '/:id/...' agar tak bentrok)
bankReconciliationsRoutes.post('/lines/:lineId/match', requireAuth, requireRoles('keuangan'), accountingController.matchStatementLine);
bankReconciliationsRoutes.post('/lines/:lineId/adjust', requireAuth, requireRoles('keuangan'), accountingController.postAdjustment);
// Operasi sesi
bankReconciliationsRoutes.post('/:id/lines', requireAuth, requireRoles('keuangan'), accountingController.addStatementLine);
bankReconciliationsRoutes.post('/:id/import', requireAuth, requireRoles('keuangan'), accountingController.importStatementLines);
bankReconciliationsRoutes.post('/:id/finalize', requireAuth, requireRoles('keuangan'), accountingController.finalizeReconciliation);

export const accountingSummaryRoutes = Router();
accountingSummaryRoutes.get('/summary', requireAuth, requireRoles(...KEU), accountingController.summary);

// Master data vendor: baca role keuangan/pimpinan, mutasi khusus keuangan
export const vendorsRoutes = Router();
vendorsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.vendors);
vendorsRoutes.post('/', requireAuth, requireRoles('keuangan'), accountingController.createVendor);
vendorsRoutes.put('/:id', requireAuth, requireRoles('keuangan'), accountingController.updateVendor);
vendorsRoutes.delete('/:id', requireAuth, requireRoles('keuangan'), accountingController.deleteVendor);

// B (putaran 3): tagihan vendor (dari alokasi HPP > saldo 1-1400) — baca keuangan/pimpinan.
export const vendorBillsRoutes = Router();
vendorBillsRoutes.get('/', requireAuth, requireRoles(...KEU), accountingController.vendorBills);
// Tugas lanjutan putaran 3: pembatalan tagihan vendor — hanya keuangan, alasan wajib.
vendorBillsRoutes.patch('/:id/void', requireAuth, requireRoles('keuangan'), accountingController.voidVendorBill);
