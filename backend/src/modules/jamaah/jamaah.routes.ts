import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { errors } from '../../utils/http.js';
import { jamaahController } from './jamaah.controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOAD_ROOT, String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${String(req.body.docType ?? 'DOC')}-${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // maks 5 MB (mockup wizard step 3)
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(errors.badRequest('Format file harus JPG/PNG/PDF'));
    cb(null, true);
  }
});

export const jamaahRoutes = Router();
jamaahRoutes.get('/', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), jamaahController.list);
jamaahRoutes.get('/:id', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), jamaahController.detail);
// Unggah dokumen dapat diakses publik: dipakai wizard pendaftaran sebelum jamaah punya akun
jamaahRoutes.post('/:id/documents', upload.single('file'), jamaahController.uploadDocument);

export const registrationsRoutes = Router();
registrationsRoutes.post('/', jamaahController.register); // publik (wizard)
registrationsRoutes.get('/passport-check', jamaahController.passportCheck); // publik (wizard step 3)

export const documentsRoutes = Router();
documentsRoutes.patch('/:id/verify', requireAuth, requireRoles('operasional'), jamaahController.verifyDocument);
