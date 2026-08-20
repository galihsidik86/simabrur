import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { errors } from '../../utils/http.js';
import { db } from '../../config/db.js';
import { UPLOAD_ROOT } from '../jamaah/storage.js';
import { galleryController } from './gallery.controller.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storage = multer.diskStorage({
  // Semua validasi path di sini — dijalankan multer SEBELUM controller — agar tak
  // ada file tertulis di luar uploads/gallery/ (path traversal / departure fiktif).
  destination: (req, _file, cb) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return cb(errors.badRequest('ID keberangkatan tidak valid'), '');
    db('departures')
      .where({ id })
      .first()
      .then((dep) => {
        if (!dep) return cb(errors.notFound('Keberangkatan tidak ditemukan'), '');
        const dir = path.join(UPLOAD_ROOT, 'gallery', id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      })
      .catch((e) => cb(e as Error, ''));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    // Nama acak → tak bisa dienumerasi dari luar
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 30 }, // maks 12 MB/foto, 30 foto/permintaan
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(errors.badRequest('Format foto harus JPG/PNG/WEBP'));
    cb(null, true);
  }
});

/** Endpoint per-keberangkatan (dipasang di /v1/departures/:id/gallery, mergeParams). */
export const departureGalleryRoutes = Router({ mergeParams: true });
departureGalleryRoutes.get('/', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), galleryController.list);
departureGalleryRoutes.get('/zip', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), galleryController.zip);
departureGalleryRoutes.post('/', requireAuth, requireRoles('operasional'), upload.array('files', 30), galleryController.upload);

/** Endpoint per-foto (dipasang di /v1/gallery). */
export const galleryRoutes = Router();
galleryRoutes.get('/:photoId/file', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), galleryController.file);
galleryRoutes.delete('/:photoId', requireAuth, requireRoles('operasional'), galleryController.remove);
