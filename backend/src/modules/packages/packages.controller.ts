import type { Request, Response } from 'express';
import { ok } from '../../utils/http.js';
import { packagesService } from './packages.service.js';
import { packagesRepository } from './packages.repository.js';
import {
  createDepartureSchema,
  createPackageSchema,
  listPackagesQuery,
  updatePackageSchema,
  upsertAirlineSchema,
  upsertCategorySchema,
  upsertHotelSchema
} from './packages.validation.js';

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
  },

  // ===== Master data: kategori paket, hotel, maskapai =====
  async categories(_req: Request, res: Response) {
    ok(res, await packagesService.categories());
  },
  async createCategory(req: Request, res: Response) {
    ok(res, await packagesService.createCategory(req, upsertCategorySchema.parse(req.body)), undefined, 201);
  },
  async updateCategory(req: Request, res: Response) {
    ok(res, await packagesService.updateCategory(req, String(req.params.id), upsertCategorySchema.parse(req.body)));
  },
  async deleteCategory(req: Request, res: Response) {
    ok(res, await packagesService.deleteCategory(req, String(req.params.id)));
  },
  async createHotel(req: Request, res: Response) {
    ok(res, await packagesService.createHotel(req, upsertHotelSchema.parse(req.body)), undefined, 201);
  },
  async updateHotel(req: Request, res: Response) {
    ok(res, await packagesService.updateHotel(req, String(req.params.id), upsertHotelSchema.parse(req.body)));
  },
  async deleteHotel(req: Request, res: Response) {
    ok(res, await packagesService.deleteHotel(req, String(req.params.id)));
  },
  async createAirline(req: Request, res: Response) {
    ok(res, await packagesService.createAirline(req, upsertAirlineSchema.parse(req.body)), undefined, 201);
  },
  async updateAirline(req: Request, res: Response) {
    ok(res, await packagesService.updateAirline(req, String(req.params.id), upsertAirlineSchema.parse(req.body)));
  },
  async deleteAirline(req: Request, res: Response) {
    ok(res, await packagesService.deleteAirline(req, String(req.params.id)));
  }
};
