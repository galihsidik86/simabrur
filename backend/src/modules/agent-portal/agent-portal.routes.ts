import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ok, errors } from '../../utils/http.js';
import { agentPortalService, verifyAgentToken, type AgentClaims } from './agent-portal.service.js';

declare module 'express-serve-static-core' {
  interface Request {
    agent?: AgentClaims;
  }
}

/** Middleware portal agen — hanya menerima token ber-kind 'agent'. */
function requireAgent(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw errors.unauthorized('Login portal agen diperlukan');
  req.agent = verifyAgentToken(header.slice(7));
  next();
}

const loginSchema = z.object({
  phone: z.string().min(6, 'Nomor HP wajib diisi'),
  password: z.string().min(1, 'Password wajib diisi')
});
const changePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password baru minimal 8 karakter')
});
const leadSchema = z.object({
  name: z.string().min(2, 'Nama prospek minimal 2 karakter').max(120),
  phone: z.string().max(30).nullish()
});

export const agentPortalRoutes = Router();

agentPortalRoutes.post('/login', async (req, res) => {
  const { phone, password } = loginSchema.parse(req.body);
  ok(res, await agentPortalService.login(req, phone, password));
});

agentPortalRoutes.post('/change-password', requireAgent, async (req, res) => {
  const { oldPassword, newPassword } = changePasswordSchema.parse(req.body);
  ok(res, await agentPortalService.changePassword(req, req.agent!, oldPassword, newPassword));
});

agentPortalRoutes.get('/me', requireAgent, async (req, res) => ok(res, await agentPortalService.me(req.agent!)));
agentPortalRoutes.get('/summary', requireAgent, async (req, res) => ok(res, await agentPortalService.summary(req.agent!)));
agentPortalRoutes.get('/jamaah', requireAgent, async (req, res) => ok(res, await agentPortalService.jamaah(req.agent!)));
agentPortalRoutes.get('/commissions', requireAgent, async (req, res) => ok(res, await agentPortalService.commissions(req.agent!)));
agentPortalRoutes.get('/notifications', requireAgent, async (req, res) => ok(res, await agentPortalService.notifications(req.agent!)));
agentPortalRoutes.post('/notifications/read', requireAgent, async (req, res) => ok(res, await agentPortalService.markNotificationsRead(req.agent!)));
agentPortalRoutes.get('/leads', requireAgent, async (req, res) => ok(res, await agentPortalService.leads(req.agent!)));
agentPortalRoutes.post('/leads', requireAgent, async (req, res) => {
  const input = leadSchema.parse(req.body);
  ok(res, await agentPortalService.addLead(req, req.agent!, input), undefined, 201);
});
