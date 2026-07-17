import type { Request, Response } from 'express';
import { ok } from '../../utils/http.js';
import { accountingService } from './accounting.service.js';
import {
  commissionTxSchema, expenseTxSchema, journalsQuery, manualJournalSchema,
  receiptTxSchema, reconciliationQuery, revenueTxSchema
} from './accounting.validation.js';

export const accountingController = {
  async accounts(_req: Request, res: Response) {
    ok(res, await accountingService.accounts());
  },
  async costCenters(_req: Request, res: Response) {
    ok(res, await accountingService.costCenters());
  },
  async journals(req: Request, res: Response) {
    const q = journalsQuery.parse(req.query);
    ok(res, await accountingService.journals(q));
  },
  async createManualJournal(req: Request, res: Response) {
    const input = manualJournalSchema.parse(req.body);
    ok(res, await accountingService.createManualJournal(req, input), undefined, 201);
  },
  async ledger(req: Request, res: Response) {
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    ok(res, await accountingService.ledger(String(req.params.code), { from, to }));
  },
  async txReceipt(req: Request, res: Response) {
    const input = receiptTxSchema.parse(req.body);
    const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
    const result = await accountingService.transactionReceipt(req, input, key);
    ok(res, result, undefined, result.idempotent ? 200 : 201);
  },
  async txExpense(req: Request, res: Response) {
    ok(res, await accountingService.transactionExpense(req, expenseTxSchema.parse(req.body)), undefined, 201);
  },
  async txRevenue(req: Request, res: Response) {
    ok(res, await accountingService.transactionRevenueRecognition(req, revenueTxSchema.parse(req.body)), undefined, 201);
  },
  async txCommission(req: Request, res: Response) {
    ok(res, await accountingService.transactionCommission(req, commissionTxSchema.parse(req.body)), undefined, 201);
  },
  async reconciliation(req: Request, res: Response) {
    const q = reconciliationQuery.parse(req.query);
    ok(res, await accountingService.reconciliation(q.bankAccountCode, q.month));
  },
  async matchStatementLine(req: Request, res: Response) {
    ok(res, await accountingService.matchStatementLine(req, String(req.params.id)));
  },
  async summary(_req: Request, res: Response) {
    ok(res, await accountingService.summary());
  }
};
