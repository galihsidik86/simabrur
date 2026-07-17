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
  try {
    const payload = jwt.verify(header.slice(7), env.jwt.accessSecret) as AuthUser & jwt.JwtPayload;
    req.user = { id: payload.id, role: payload.role, branchId: payload.branchId, name: payload.name, email: payload.email };
    next();
  } catch {
    throw errors.unauthorized('Token tidak valid atau kedaluwarsa');
  }
}
