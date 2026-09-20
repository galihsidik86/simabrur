import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authController } from './auth.controller.js';

export const authRoutes = Router();

authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
// NEW-FE-02: TANPA requireAuth — refresh token di body ADALAH kredensialnya. Access
// token bisa sudah kedaluwarsa/dihapus di klien sebelum request terkirim; menuntut
// requireAuth membuat logout gagal 401 dan sesi server tak pernah dicabut.
authRoutes.post('/logout', authController.logout);
authRoutes.get('/me', requireAuth, authController.me);
