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
  if (env.nodeEnv !== 'test') console.error(err);
  return res.status(500).json({ success: false, error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
}
