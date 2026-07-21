import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/http.js';
import { env } from '../config/env.js';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan' } });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
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
