import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ok, errors } from '../../utils/http.js';
import { portalService, verifyPortalToken, type PortalClaims } from './portal.service.js';
import { galleryService } from '../gallery/gallery.service.js';
import { sendPhotoFile, pickUrl, zipEntriesFor, streamZip } from '../gallery/gallery.controller.js';

declare module 'express-serve-static-core' {
  interface Request {
    portal?: PortalClaims;
  }
}

function requirePortal(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw errors.unauthorized('Login portal diperlukan');
  req.portal = verifyPortalToken(header.slice(7));
  next();
}

const loginSchema = z.object({
  regNumber: z.string().min(6, 'Nomor registrasi wajib diisi'),
  nik: z.string().regex(/^\d{16}$/, 'NIK harus 16 digit')
});

export const portalRoutes = Router();

portalRoutes.post('/login', async (req, res) => {
  const { regNumber, nik } = loginSchema.parse(req.body);
  ok(res, await portalService.login(req, regNumber, nik));
});

portalRoutes.get('/me', requirePortal, async (req, res) => {
  ok(res, await portalService.me(req.portal!));
});

portalRoutes.get('/invoice-document', requirePortal, async (req, res) => {
  ok(res, await portalService.invoiceDocument(req.portal!));
});

portalRoutes.get('/receipts/:id/document', requirePortal, async (req, res) => {
  ok(res, await portalService.receiptDocument(req.portal!, String(req.params.id)));
});

/* ===== Galeri foto rombongan — hanya keberangkatan milik token ===== */
portalRoutes.get('/gallery', requirePortal, async (req, res) => {
  const departureId = await portalService.departureIdFor(req.portal!);
  ok(res, await galleryService.listByDeparture(departureId));
});

// Serve satu foto — WAJIB milik keberangkatan token (cegah jamaah rombongan lain
// mengakses foto via tebak-id). getPhoto dengan departureId menolak lintas-rombongan.
portalRoutes.get('/gallery/:photoId/file', requirePortal, async (req, res) => {
  const departureId = await portalService.departureIdFor(req.portal!);
  const photo = await galleryService.getPhoto(String(req.params.photoId), departureId);
  sendPhotoFile(res, pickUrl(photo, req.query.variant));
});

// Unduh semua foto rombongan sebagai satu ZIP.
portalRoutes.get('/gallery.zip', requirePortal, async (req, res) => {
  const departureId = await portalService.departureIdFor(req.portal!);
  const photos = await galleryService.listByDeparture(departureId);
  if (photos.length === 0) throw errors.notFound('Belum ada foto pada rombongan Anda');
  await streamZip(res, zipEntriesFor(photos), 'galeri-rombongan.zip');
});
