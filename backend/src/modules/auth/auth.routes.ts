import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { authController } from './auth.controller.js';

export const authRoutes = Router();

authRoutes.post('/login', authController.login);
authRoutes.post('/refresh', authController.refresh);
authRoutes.post('/logout', requireAuth, authController.logout);
authRoutes.get('/me', requireAuth, authController.me);
