import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { errors } from '../utils/http.js';

export interface AuthUser {
  id: string;
  role: string;
  branchId: string;
  name: string;
  email: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export function signAccessToken(user: AuthUser): string {
  return jwt.sign(user, env.jwt.accessSecret, { expiresIn: env.jwt.accessTtl } as jwt.SignOptions);
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw errors.unauthorized();
  let payload: AuthUser & jwt.JwtPayload & { kind?: string };
  try {
    payload = jwt.verify(header.slice(7), env.jwt.accessSecret) as AuthUser & jwt.JwtPayload & { kind?: string };
  } catch {
    throw errors.unauthorized('Token tidak valid atau kedaluwarsa');
  }
  // Token portal (jamaah) & portal agen ditandatangani kunci yang sama — TOLAK di
  // guard staf. Tanpa ini token portal lolos requireAuth dan (endpoint tanpa
  // requireRoles) bisa membaca data staf/jamaah lain via IDOR.
  if (payload.kind === 'portal' || payload.kind === 'agent') {
    throw errors.forbidden('Token portal tidak berlaku untuk endpoint staf');
  }
  req.user = { id: payload.id, role: payload.role, branchId: payload.branchId, name: payload.name, email: payload.email };
  next();
}

/**
 * Seperti `requireAuth`, tapi tak pernah menolak — dipakai pada endpoint PUBLIK yang
 * perlu tahu APAKAH pemanggil kebetulan staf ber-otentikasi (mis. DOM-04/SEC-05: staf
 * boleh mengganti dokumen verified, jalur anonim tidak). Token tak ada/tak
 * valid/portal/agen → `req.user` tetap kosong, request tetap lanjut (tidak 401).
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next();
  try {
    const payload = jwt.verify(header.slice(7), env.jwt.accessSecret) as AuthUser & jwt.JwtPayload & { kind?: string };
    if (payload.kind === 'portal' || payload.kind === 'agent') return next();
    req.user = { id: payload.id, role: payload.role, branchId: payload.branchId, name: payload.name, email: payload.email };
  } catch {
    // token anonim/tidak valid — biarkan lanjut sebagai request publik, jangan 401
  }
  next();
}
