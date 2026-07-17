import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../../config/env.js';
import { errors } from '../../utils/http.js';
import { signAccessToken, type AuthUser } from '../../middleware/auth.js';
import { audit } from '../../middleware/audit.js';
import { authRepository, type UserRow } from './auth.repository.js';

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function toAuthUser(u: UserRow): AuthUser {
  return { id: u.id, role: u.role_name, branchId: u.branch_id, name: u.name, email: u.email };
}

function publicUser(u: UserRow) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role_name,
    roleLabel: u.role_label,
    permissions: u.permissions,
    branch: u.branch_name
  };
}

async function issueTokens(user: UserRow) {
  const accessToken = signAccessToken(toAuthUser(user));
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const expiresAt = new Date(Date.now() + env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
  await authRepository.insertRefreshToken(user.id, sha256(refreshToken), expiresAt);
  return { accessToken, refreshToken };
}

export const authService = {
  async login(req: Request, email: string, password: string) {
    const user = await authRepository.findUserByEmail(email);
    if (!user || !user.is_active) throw errors.unauthorized('Email atau password salah');
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) throw errors.unauthorized('Email atau password salah');

    const tokens = await issueTokens(user);
    await audit(req, { action: 'auth.login', entity: 'users', entityId: user.id });
    return { ...tokens, user: publicUser(user) };
  },

  /** Rotasi refresh token: token lama langsung dicabut, terbit pasangan baru. */
  async refresh(refreshToken: string) {
    const hash = sha256(refreshToken);
    const row = await authRepository.findRefreshToken(hash);
    if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
      throw errors.unauthorized('Sesi berakhir, silakan login ulang');
    }
    const user = await authRepository.findUserById(row.user_id);
    if (!user || !user.is_active) throw errors.unauthorized('Akun tidak aktif');

    await authRepository.revokeRefreshToken(hash);
    const tokens = await issueTokens(user);
    return { ...tokens, user: publicUser(user) };
  },

  async logout(req: Request, refreshToken: string) {
    await authRepository.revokeRefreshToken(sha256(refreshToken));
    await audit(req, { action: 'auth.logout', entity: 'users', entityId: req.user?.id });
  },

  async me(userId: string) {
    const user = await authRepository.findUserById(userId);
    if (!user) throw errors.notFound('Pengguna tidak ditemukan');
    return publicUser(user);
  }
};
