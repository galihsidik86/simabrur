import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { ZodError } from 'zod';
import { ApiError } from '../utils/http.js';
import { env } from '../config/env.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  // FE-04: MulterError tidak ditangani sebelumnya → jatuh ke 500 generik, dan retry
  // pengguna yang frustrasi bisa memicu pendaftaran ganda (NEW-BE-01). Batas file
  // berbeda per rute (dokumen jamaah 5 MB vs galeri 12 MB) — tebak dari URL.
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = req.originalUrl.includes('/gallery') ? 12 : 5;
      return res.status(400).json({ success: false, error: { code: 'FILE_TOO_LARGE', message: `Ukuran file maksimal ${maxMb} MB` } });
    }
    return res.status(400).json({ success: false, error: { code: 'UPLOAD_ERROR', message: err.message } });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Data tidak valid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      }
    });
  }
  // Unique-violation Postgres (23505) dari kondisi balapan (double-submit NIK,
  // termin, dll) → 409 Konflik, bukan 500. Semantik "duplikat" = konflik.
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505') {
    return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Data sudah ada / sedang diproses — coba lagi' } });
  }
  if (env.nodeEnv !== 'test') console.error(err);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
}
