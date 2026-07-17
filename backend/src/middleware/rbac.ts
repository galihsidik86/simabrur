import type { NextFunction, Request, Response } from 'express';
import { errors } from '../utils/http.js';

/**
 * Otorisasi per-endpoint berbasis role (lihat tabel RBAC Handoff Developer).
 * `admin` selalu lolos. Contoh: router.post('/', requireRoles('keuangan'), ...)
 */
export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw errors.unauthorized();
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    throw errors.forbidden();
  };
}
