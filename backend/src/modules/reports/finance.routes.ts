import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { ok } from '../../utils/http.js';
import { financeReportsService } from './finance.service.js';

export const financeReportsRoutes = Router();

const KEU = ['keuangan', 'pimpinan'] as const;
const ALL_STAFF = ['keuangan', 'pimpinan', 'marketing', 'operasional'] as const;

financeReportsRoutes.get('/income-statement', requireAuth, requireRoles(...KEU), async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  ok(res, await financeReportsService.incomeStatement(from, to));
});

financeReportsRoutes.get('/balance-sheet', requireAuth, requireRoles(...KEU), async (req, res) => {
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
  ok(res, await financeReportsService.balanceSheet(asOf));
});

financeReportsRoutes.get('/profit-by-package', requireAuth, requireRoles(...KEU, 'marketing'), async (_req, res) => {
  ok(res, await financeReportsService.profitByPackage());
});

financeReportsRoutes.get('/dashboard', requireAuth, requireRoles(...ALL_STAFF), async (_req, res) => {
  ok(res, await financeReportsService.dashboard());
});
