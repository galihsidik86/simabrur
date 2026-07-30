import path from 'node:path';
import type { Request, Response } from 'express';
import { ok, errors } from '../../utils/http.js';
import { db } from '../../config/db.js';
import { jamaahService } from './jamaah.service.js';
import { resolveUploadPath } from './storage.js';
import { createRegistrationSchema, listJamaahQuery, passportCheckQuery, updateJamaahSchema, verifyDocumentSchema, DOC_TYPES } from './jamaah.validation.js';

const CONTENT_TYPE: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg'
};

export const jamaahController = {
  async documentFile(req: Request, res: Response) {
    const doc = await db('documents').where({ id: String(req.params.id) }).first();
    if (!doc) throw errors.notFound('Dokumen tidak ditemukan');
    const abs = resolveUploadPath(String(doc.file_url));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', CONTENT_TYPE[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
    res.sendFile(abs);
  },
  async list(req: Request, res: Response) {
    const q = listJamaahQuery.parse(req.query);
    const { data, total } = await jamaahService.list(q);
    ok(res, data, { page: q.page, limit: q.limit, total });
  },

  async detail(req: Request, res: Response) {
    ok(res, await jamaahService.detail(String(req.params.id)));
  },

  async updateProfile(req: Request, res: Response) {
    const input = updateJamaahSchema.parse(req.body);
    ok(res, await jamaahService.updateProfile(req, String(req.params.id), input));
  },

  async register(req: Request, res: Response) {
    const input = createRegistrationSchema.parse(req.body);
    ok(res, await jamaahService.register(req, input), undefined, 201);
  },

  async passportCheck(req: Request, res: Response) {
    const q = passportCheckQuery.parse(req.query);
    ok(res, await jamaahService.passportCheck(q.departureId, q.expiry));
  },
  /** Validasi kode referral agen (publik — wizard step bayar). */
  async agentCheck(req: Request, res: Response) {
    const code = typeof req.query.code === 'string' ? req.query.code.trim().toUpperCase() : '';
    if (!code) return ok(res, { found: false });
    const agent = await db('agents').whereRaw('upper(referral_code) = ?', [code]).andWhere('is_active', true).first();
    ok(res, agent ? { found: true, agentName: agent.name, code: agent.code } : { found: false });
  },

  async uploadDocument(req: Request, res: Response) {
    const docType = String(req.body.docType ?? '');
    if (!DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number])) {
      throw errors.badRequest(`docType harus salah satu dari: ${DOC_TYPES.join(', ')}`);
    }
    if (!req.file) throw errors.badRequest('File dokumen wajib dilampirkan (field "file")');
    const fileUrl = `/uploads/${String(req.params.id)}/${req.file.filename}`;
    ok(res, await jamaahService.uploadDocument(req, String(req.params.id), docType, fileUrl), undefined, 201);
  },

  async verifyDocument(req: Request, res: Response) {
    const input = verifyDocumentSchema.parse(req.body);
    ok(res, await jamaahService.verifyDocument(req, String(req.params.id), input.status, input.note));
  }
};
