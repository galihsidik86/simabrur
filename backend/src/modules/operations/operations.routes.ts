import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { operationsController } from './operations.controller.js';

export const visasRoutes = Router();
visasRoutes.post('/', requireAuth, requireRoles('operasional'), operationsController.upsertVisa);

export const ticketsRoutes = Router();
ticketsRoutes.post('/', requireAuth, requireRoles('operasional'), operationsController.upsertTicket);

export const groupStaffRoutes = Router();
groupStaffRoutes.post('/', requireAuth, requireRoles('operasional'), operationsController.assignStaff);
groupStaffRoutes.patch('/:id', requireAuth, requireRoles('operasional'), operationsController.updateStaff);

export const opsGroupsRoutes = Router();
opsGroupsRoutes.post('/', requireAuth, requireRoles('operasional'), operationsController.createGroup);

/** PATCH /registrations/:id/assignment — dipasang di app.ts (router registrations publik utk wizard). */
export const assignmentHandler = [requireAuth, requireRoles('operasional'), operationsController.assignRegistration] as const;

export const checklistsRoutes = Router();
checklistsRoutes.get('/', requireAuth, requireRoles('operasional', 'pimpinan'), operationsController.checklists);
checklistsRoutes.patch('/:id', requireAuth, requireRoles('operasional'), operationsController.toggleChecklist);

export const reportsRoutes = Router();
reportsRoutes.get('/document-compliance', requireAuth, requireRoles('operasional', 'pimpinan', 'keuangan'), operationsController.documentCompliance);
reportsRoutes.get('/readiness', requireAuth, requireRoles('operasional', 'pimpinan'), operationsController.readiness);
reportsRoutes.get('/export', requireAuth, requireRoles('operasional', 'pimpinan', 'keuangan'), operationsController.exportReport);

/** GET /departures/:id/manifest — dipasang pada router departures. */
export const manifestHandler = [requireAuth, requireRoles('operasional', 'pimpinan'), operationsController.manifest] as const;
