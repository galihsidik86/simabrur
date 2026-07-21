import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { db } from './config/db.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { airlinesRoutes, departuresRoutes, hotelsRoutes, packageCategoriesRoutes, packagesRoutes } from './modules/packages/packages.routes.js';
import { documentsRoutes, jamaahRoutes, registrationsRoutes, UPLOAD_ROOT } from './modules/jamaah/jamaah.routes.js';
import { bankAccountsRoutes, invoicesRoutes, paymentsRoutes, receiptsRoutes, receivablesRoutes } from './modules/payments/payments.routes.js';
import { assignmentHandler, checklistsRoutes, groupStaffRoutes, manifestHandler, opsGroupsRoutes, reportsRoutes, ticketsRoutes, visasRoutes } from './modules/operations/operations.routes.js';
import {
  accountingSummaryRoutes, accountsRoutes, bankReconciliationsRoutes, costCentersRoutes,
  journalsRoutes, ledgerRoutes, transactionsRoutes
} from './modules/accounting/accounting.routes.js';
import { financeReportsRoutes } from './modules/reports/finance.routes.js';
import { portalRoutes } from './modules/portal/portal.routes.js';
import { auditLogsRoutes, rolesRoutes, usersRoutes } from './modules/admin/admin.routes.js';
import { agentsRoutes, commissionsRoutes, leadsRoutes } from './modules/marketing/marketing.routes.js';
import { mabrurRoutes } from './modules/mabrur/mabrur.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Frontend build (hasil `npm run build` root) disalin ke backend/public — same-origin. */
const PUBLIC_DIR = process.env.STATIC_DIR ?? path.resolve(__dirname, '../public');

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // di belakang reverse proxy (nginx / load balancer)

  // Security headers. CSP mengizinkan Google Fonts + inline style (Tailwind arbitrary values)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          scriptSrc: ["'self'"],
          connectSrc: ["'self'"]
        }
      },
      crossOriginResourcePolicy: { policy: 'same-site' }
    })
  );
  app.use(cors(env.corsOrigin ? { origin: env.corsOrigin.split(','), credentials: false } : {}));
  app.use(express.json({ limit: '2mb' }));

  // Respons API tidak boleh di-cache proxy/hosting (dynamic cache shared hosting
  // pernah menyajikan respons GET ber-otentikasi yang basi lintas token)
  app.use('/v1', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  // Rate limit endpoint publik yang sensitif (dimatikan saat test)
  if (!env.isTest) {
    const authLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan — coba lagi beberapa menit lagi' } }
    });
    app.use('/v1/auth/login', authLimiter);
    app.use('/v1/portal/login', authLimiter);
    app.use(
      '/v1/registrations',
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 30,
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req) => req.method === 'GET',
        message: { success: false, error: { code: 'RATE_LIMITED', message: 'Terlalu banyak pendaftaran dari alamat ini — coba lagi nanti' } }
      })
    );
  }

  app.use('/uploads', express.static(UPLOAD_ROOT));

  // Health + readiness (cek koneksi DB) — untuk container healthcheck / load balancer
  app.get('/v1/health', async (_req, res) => {
    try {
      await db.raw('select 1');
      res.json({ success: true, data: { status: 'ok', db: 'up' } });
    } catch {
      res.status(503).json({ success: false, error: { code: 'DB_DOWN', message: 'Database tidak terjangkau' } });
    }
  });
  app.use('/v1/auth', authRoutes);
  app.use('/v1/packages', packagesRoutes);
  app.use('/v1/departures', departuresRoutes);
  app.use('/v1/hotels', hotelsRoutes);
  app.use('/v1/airlines', airlinesRoutes);
  app.use('/v1/package-categories', packageCategoriesRoutes);
  app.use('/v1/jamaah', jamaahRoutes);
  app.use('/v1/registrations', registrationsRoutes);
  app.use('/v1/documents', documentsRoutes);
  app.use('/v1/invoices', invoicesRoutes);
  app.use('/v1/payments', paymentsRoutes);
  app.use('/v1/receivables', receivablesRoutes);
  app.use('/v1/receipts', receiptsRoutes);
  app.use('/v1/bank-accounts', bankAccountsRoutes);
  app.get('/v1/departures/:id/manifest', ...manifestHandler);
  app.patch('/v1/registrations/:id/assignment', ...assignmentHandler);
  app.use('/v1/groups', opsGroupsRoutes);
  app.use('/v1/visas', visasRoutes);
  app.use('/v1/tickets', ticketsRoutes);
  app.use('/v1/group-staff', groupStaffRoutes);
  app.use('/v1/checklists', checklistsRoutes);
  app.use('/v1/reports', financeReportsRoutes);
  app.use('/v1/reports', reportsRoutes);
  app.use('/v1/portal', portalRoutes);
  app.use('/v1/audit-logs', auditLogsRoutes);
  app.use('/v1/users', usersRoutes);
  app.use('/v1/roles', rolesRoutes);
  app.use('/v1/agents', agentsRoutes);
  app.use('/v1/leads', leadsRoutes);
  app.use('/v1/commissions', commissionsRoutes);
  app.use('/v1/mabrur', mabrurRoutes);
  app.use('/v1/search', searchRoutes);
  app.use('/v1/accounts', accountsRoutes);
  app.use('/v1/cost-centers', costCentersRoutes);
  app.use('/v1/journals', journalsRoutes);
  app.use('/v1/ledger', ledgerRoutes);
  app.use('/v1/transactions', transactionsRoutes);
  app.use('/v1/bank-reconciliations', bankReconciliationsRoutes);
  app.use('/v1/accounting', accountingSummaryRoutes);
  // Frontend build (produksi): file statis + SPA fallback utk route non-API
  if (fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) {
    app.use(express.static(PUBLIC_DIR, { maxAge: '1h', index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/v1') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
