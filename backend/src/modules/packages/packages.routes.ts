import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { packagesController } from './packages.controller.js';

export const packagesRoutes = Router();
// Katalog paket dapat diakses publik (wizard pendaftaran); mutasi butuh role
packagesRoutes.get('/', packagesController.list);
packagesRoutes.post('/', requireAuth, requireRoles('marketing'), packagesController.create);
packagesRoutes.get('/:id/costs', requireAuth, requireRoles('marketing', 'keuangan', 'pimpinan'), packagesController.costs);
packagesRoutes.get('/:id', packagesController.detail);
packagesRoutes.put('/:id', requireAuth, requireRoles('marketing'), packagesController.update);

export const departuresRoutes = Router();
departuresRoutes.get('/', packagesController.departures);
departuresRoutes.post('/', requireAuth, requireRoles('marketing'), packagesController.createDeparture);
departuresRoutes.get('/:id/availability', packagesController.availability);

export const hotelsRoutes = Router();
hotelsRoutes.get('/', requireAuth, packagesController.hotels);

export const airlinesRoutes = Router();
airlinesRoutes.get('/', requireAuth, packagesController.airlines);
