import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { ok } from '../../utils/http.js';
import { mabrurService } from './mabrur.service.js';

/** Integrasi Mabrur — sinkron rombongan, kredensial, status lapangan. */
export const mabrurRoutes = Router();

mabrurRoutes.post('/groups/:id/sync', requireAuth, requireRoles('operasional'), async (req, res) => {
  ok(res, await mabrurService.syncGroup(req, String(req.params.id)));
});

mabrurRoutes.get('/groups/:id/credentials', requireAuth, requireRoles('operasional'), async (req, res) => {
  ok(res, await mabrurService.groupCredentials(String(req.params.id)));
});

mabrurRoutes.get('/groups/:id/status', requireAuth, requireRoles('operasional', 'pimpinan'), async (req, res) => {
  ok(res, await mabrurService.groupFieldStatus(String(req.params.id)));
});
