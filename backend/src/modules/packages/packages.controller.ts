import type { Request, Response } from 'express';
import { ok } from '../../utils/http.js';
import { packagesService } from './packages.service.js';
import { packagesRepository } from './packages.repository.js';
import { createDepartureSchema, createPackageSchema, listPackagesQuery, updatePackageSchema } from './packages.validation.js';

export const packagesController = {
  async list(req: Request, res: Response) {
    const q = listPackagesQuery.parse(req.query);
    ok(res, await packagesService.list(q));
  },
  async detail(req: Request, res: Response) {
    ok(res, await packagesService.detail(String(req.params.id)));
  },
  async costs(req: Request, res: Response) {
    const rows = await packagesRepository.costs(String(req.params.id));
    ok(res, rows.map((c) => ({ id: c.id, component: c.component, amount: Number(c.amount) })));
  },
  async create(req: Request, res: Response) {
    ok(res, await packagesService.create(req, createPackageSchema.parse(req.body)), undefined, 201);
  },
  async update(req: Request, res: Response) {
    ok(res, await packagesService.update(req, String(req.params.id), updatePackageSchema.parse(req.body)));
  },
  async departures(req: Request, res: Response) {
    ok(res, await packagesRepository.departures(typeof req.query.packageId === "string" ? req.query.packageId : undefined));
  },
  async createDeparture(req: Request, res: Response) {
    ok(res, await packagesService.createDeparture(req, createDepartureSchema.parse(req.body)), undefined, 201);
  },
  async availability(req: Request, res: Response) {
    ok(res, await packagesService.availability(String(req.params.id)));
  },
  async hotels(_req: Request, res: Response) {
    ok(res, await packagesRepository.hotels());
  },
  async airlines(_req: Request, res: Response) {
    ok(res, await packagesRepository.airlines());
  }
};
