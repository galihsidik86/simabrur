import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireAuth } from '../../middleware/auth.js';
import { requireRoles } from '../../middleware/rbac.js';
import { errors } from '../../utils/http.js';
import { db } from '../../config/db.js';
import { jamaahController } from './jamaah.controller.js';
import { DOC_TYPES } from './jamaah.validation.js';
import { UPLOAD_ROOT } from './storage.js';

export { UPLOAD_ROOT } from './storage.js';

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.pdf']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storage = multer.diskStorage({
  // destination & filename dijalankan multer SEBELUM controller — semua validasi
  // path HARUS di sini agar tidak ada file tertulis di luar uploads/ (path traversal).
  destination: (req, _file, cb) => {
    const id = String(req.params.id);
    if (!UUID_RE.test(id)) return cb(errors.badRequest('ID jamaah tidak valid'), '');
    // Pastikan jamaah ada SEBELUM menulis — hindari file yatim & tulisan untuk id acak
    db('jamaah')
      .where({ id })
      .first()
      .then((j) => {
        if (!j) return cb(errors.notFound('Jamaah tidak ditemukan'), '');
        const dir = path.join(UPLOAD_ROOT, id);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      })
      .catch((e) => cb(e as Error, ''));
  },
  filename: (req, file, cb) => {
    const docType = String(req.body.docType ?? '');
    // Allow-list divalidasi DI SINI (bukan hanya di controller) — docType masuk ke
    // nama file; '../..' pada docType bisa keluar dari direktori uploads.
    if (!DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number])) {
      return cb(errors.badRequest(`docType harus salah satu dari: ${DOC_TYPES.join(', ')}`), '');
    }
    const ext = path.extname(file.originalname).toLowerCase();
    // Sisipkan komponen acak → nama file tidak dapat ditebak/di-enumerasi
    cb(null, `${docType}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
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
jamaahRoutes.patch('/:id', requireAuth, requireRoles('operasional'), jamaahController.updateProfile);
// Unggah dokumen dapat diakses publik: dipakai wizard pendaftaran sebelum jamaah punya akun
jamaahRoutes.post('/:id/documents', upload.single('file'), jamaahController.uploadDocument);

export const registrationsRoutes = Router();
registrationsRoutes.post('/', jamaahController.register); // publik (wizard)
registrationsRoutes.get('/passport-check', jamaahController.passportCheck); // publik (wizard step 3)

export const documentsRoutes = Router();
documentsRoutes.patch('/:id/verify', requireAuth, requireRoles('operasional'), jamaahController.verifyDocument);
// Berkas dokumen (paspor/KTP = PII) hanya lewat endpoint ber-otentikasi + RBAC —
// bukan statis publik. Nama file acak tidak lagi bisa ditebak dari luar.
documentsRoutes.get('/:id/file', requireAuth, requireRoles('operasional', 'marketing', 'keuangan', 'pimpinan'), jamaahController.documentFile);
