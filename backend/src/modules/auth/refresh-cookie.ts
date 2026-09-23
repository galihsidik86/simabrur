import type { Request, Response } from 'express';
import { env } from '../../config/env.js';

/**
 * SEC-07: refresh token dipindah dari `localStorage` ke cookie `httpOnly`.
 *
 * Di `localStorage`, satu celah XSS mana pun cukup untuk membaca refresh token dan
 * memakainya berhari-hari dari mesin lain — jauh lebih berbahaya daripada access token
 * yang berumur pendek. Cookie `httpOnly` tidak bisa dibaca JavaScript sama sekali.
 *
 * Atribut dipilih seketat mungkin karena frontend dan API SELALU same-origin
 * (produksi: hasil build disalin ke `backend/public`; dev: proxy Vite `/v1` → :3001):
 * - `httpOnly` — tidak terjangkau `document.cookie`.
 * - `sameSite: 'strict'` — tidak ikut terkirim pada request lintas situs, jadi endpoint
 *   rotasi/logout tidak bisa dipicu dari situs lain (proteksi CSRF).
 * - `path: '/v1/auth'` — cookie HANYA dikirim ke endpoint auth; ratusan request API lain
 *   tidak perlu ikut membawa kredensial berumur panjang ini.
 * - `secure` hanya di produksi, supaya dev di `http://localhost` tetap jalan.
 */
export const REFRESH_COOKIE = 'safar.refresh';

const COOKIE_PATH = '/v1/auth';

function baseOptions() {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    path: COOKIE_PATH,
    secure: env.nodeEnv === 'production'
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    maxAge: env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000
  });
}

/** Atributnya harus sama persis dengan saat diset, kalau tidak browser tidak menghapusnya. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}

export function readRefreshCookie(req: Request): string {
  const raw = req.cookies?.[REFRESH_COOKIE];
  return typeof raw === 'string' ? raw : '';
}
