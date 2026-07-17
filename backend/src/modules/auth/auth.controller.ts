import type { Request, Response } from 'express';
import { ok } from '../../utils/http.js';
import { loginSchema, refreshSchema } from './auth.validation.js';
import { authService } from './auth.service.js';

export const authController = {
  async login(req: Request, res: Response) {
    const { email, password } = loginSchema.parse(req.body);
    ok(res, await authService.login(req, email, password));
  },

  async refresh(req: Request, res: Response) {
    const { refreshToken } = refreshSchema.parse(req.body);
    ok(res, await authService.refresh(refreshToken));
  },

  async logout(req: Request, res: Response) {
    const { refreshToken } = refreshSchema.parse(req.body);
    await authService.logout(req, refreshToken);
    ok(res, { loggedOut: true });
  },

  async me(req: Request, res: Response) {
    ok(res, await authService.me(req.user!.id));
  }
};
