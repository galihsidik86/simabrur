import type { Request, Response } from 'express';
import { ok, errors } from '../../utils/http.js';
import { loginSchema } from './auth.validation.js';
import { authService } from './auth.service.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';

/**
 * SEC-07: refresh token TIDAK pernah lagi melewati body respons maupun body request —
 * ia hanya hidup sebagai cookie `httpOnly` (lihat refresh-cookie.ts). Karena itu setiap
 * handler di bawah menyetel/membaca/menghapus cookie, dan `refreshToken` dibuang dari
 * payload yang dikirim ke browser.
 */
export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    const { refreshToken, ...payload } = await authService.login(req, email, password);
    setRefreshCookie(res, refreshToken);
    ok(res, payload);
  },

  async refresh(req: Request, res: Response) {
    const current = readRefreshCookie(req);
    // Tanpa cookie tidak ada yang bisa dirotasi. 401 (bukan 400) supaya klien
    // memperlakukannya sama dengan sesi kedaluwarsa dan langsung ke halaman login.
    if (!current) throw errors.unauthorized('Sesi berakhir, silakan login ulang');
    const { refreshToken, ...payload } = await authService.refresh(current);
    setRefreshCookie(res, refreshToken);
    ok(res, payload);
  },

  async logout(req: Request, res: Response) {
    const current = readRefreshCookie(req);
    // Idempoten: tanpa cookie pun tetap 200 dan cookie tetap dihapus, sehingga tombol
    // "Keluar" tidak pernah gagal hanya karena sesi server sudah lebih dulu berakhir.
    if (current) await authService.logout(req, current);
    clearRefreshCookie(res);
    ok(res, { loggedOut: true });
  },

  async me(req: Request, res: Response) {
    ok(res, await authService.me(req.user!.id));
  }
};
