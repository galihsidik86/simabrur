import type { Request, Response } from 'express';
import { ok, errors } from '../../utils/http.js';
import { jamaahService } from './jamaah.service.js';
import { createRegistrationSchema, listJamaahQuery, passportCheckQuery, updateJamaahSchema, verifyDocumentSchema, DOC_TYPES } from './jamaah.validation.js';

export const jamaahController = {
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
