import type { Request } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { packagesRepository } from './packages.repository.js';
import type { createPackageSchema, updatePackageSchema, createDepartureSchema } from './packages.validation.js';

type CreatePackageInput = z.infer<typeof createPackageSchema>;
type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
type CreateDepartureInput = z.infer<typeof createDepartureSchema>;

function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Setiap keberangkatan = cost center (PLAN.md §4.5). Aman bila tabel M6 belum ada. */
async function createCostCenterFor(trx: Knex, departureId: string, pkgCode: string, pkgName: string, departureDate: string) {
  const month = new Date(departureDate).toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
  await trx('cost_centers')
    .insert({ departure_id: departureId, code: `CC-${pkgCode}-${departureDate.replaceAll('-', '').slice(2, 6)}`, name: `${pkgName} — ${month}` })
    .onConflict('departure_id')
    .ignore();
}

export const packagesService = {
  async list(filter: { type?: string; status?: string }) {
    const rows = await packagesRepository.list(filter);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      category: r.category,
      durationDays: r.duration_days,
      basePrice: Number(r.base_price),
      tripleUpcharge: Number(r.triple_upcharge),
      doubleUpcharge: Number(r.double_upcharge),
      hotel: r.hotel_name ? `${r.hotel_name} ⭐${r.hotel_star}` : null,
      airline: r.airline_name,
      isActive: r.is_active,
      departure: r.departure_id
        ? {
            id: r.departure_id,
            date: r.departure_date,
            quota: r.quota,
            seatsTaken: r.seats_taken,
            seatsLeft: r.quota - r.seats_taken,
            status: r.departure_status
          }
        : null
    }));
  },

  async detail(id: string) {
    const pkg = await packagesRepository.byId(id);
    if (!pkg) throw errors.notFound('Paket tidak ditemukan');
    const [costs, departures] = await Promise.all([
      packagesRepository.costs(id),
      packagesRepository.departures(id)
    ]);
    return {
      ...pkg,
      base_price: Number(pkg.base_price),
      costs: costs.map((c) => ({ id: c.id, component: c.component, amount: Number(c.amount) })),
      totalHpp: costs.reduce((s, c) => s + Number(c.amount), 0),
      departures: departures.map((d) => ({
        id: d.id,
        departureDate: d.departure_date,
        returnDate: d.return_date,
        quota: d.quota,
        seatsTaken: d.seats_taken,
        status: d.status
      }))
    };
  },

  async create(req: Request, input: CreatePackageInput) {
    return db.transaction(async (trx) => {
      const [pkg] = await trx('packages')
        .insert({
          code: input.code,
          name: input.name,
          type: input.type,
          category: input.category,
          duration_days: input.durationDays,
          base_price: input.basePrice,
          triple_upcharge: input.tripleUpcharge,
          double_upcharge: input.doubleUpcharge,
          hotel_id: input.hotelId ?? null,
          airline_id: input.airlineId ?? null
        })
        .returning('*');

      if (input.costs.length) {
        await trx('package_costs').insert(
          input.costs.map((c) => ({ package_id: pkg.id, component: c.component, amount: c.amount }))
        );
      }
      if (input.departure) {
        const [dep] = await trx('departures')
          .insert({
            package_id: pkg.id,
            departure_date: input.departure.departureDate,
            return_date: addDays(input.departure.departureDate, input.durationDays),
            quota: input.departure.quota
          })
          .returning('*');
        await createCostCenterFor(trx, dep.id, pkg.code, pkg.name, input.departure.departureDate);
      }
      await audit(req, { action: 'packages.create', entity: 'packages', entityId: pkg.id, newValues: input });
      return pkg;
    });
  },

  async update(req: Request, id: string, input: UpdatePackageInput) {
    const before = await db('packages').where({ id }).first();
    if (!before) throw errors.notFound('Paket tidak ditemukan');

    return db.transaction(async (trx) => {
      const [pkg] = await trx('packages')
        .where({ id })
        .update({
          ...(input.code !== undefined && { code: input.code }),
          ...(input.name !== undefined && { name: input.name }),
          ...(input.type !== undefined && { type: input.type }),
          ...(input.category !== undefined && { category: input.category }),
          ...(input.durationDays !== undefined && { duration_days: input.durationDays }),
          ...(input.basePrice !== undefined && { base_price: input.basePrice }),
          ...(input.tripleUpcharge !== undefined && { triple_upcharge: input.tripleUpcharge }),
          ...(input.doubleUpcharge !== undefined && { double_upcharge: input.doubleUpcharge }),
          ...(input.hotelId !== undefined && { hotel_id: input.hotelId }),
          ...(input.airlineId !== undefined && { airline_id: input.airlineId }),
          updated_at: trx.fn.now()
        })
        .returning('*');

      if (input.costs) {
        await trx('package_costs').where({ package_id: id }).del();
        if (input.costs.length) {
          await trx('package_costs').insert(
            input.costs.map((c) => ({ package_id: id, component: c.component, amount: c.amount }))
          );
        }
      }
      await audit(req, { action: 'packages.update', entity: 'packages', entityId: id, oldValues: before, newValues: input });
      return pkg;
    });
  },

  async createDeparture(req: Request, input: CreateDepartureInput) {
    const pkg = await db('packages').where({ id: input.packageId }).first();
    if (!pkg) throw errors.notFound('Paket tidak ditemukan');
    const dep = await db.transaction(async (trx) => {
      const [row] = await trx('departures')
        .insert({
          package_id: input.packageId,
          departure_date: input.departureDate,
          return_date: addDays(input.departureDate, pkg.duration_days),
          quota: input.quota
        })
        .returning('*');
      await createCostCenterFor(trx, row.id, pkg.code, pkg.name, input.departureDate);
      return row;
    });
    await audit(req, { action: 'departures.create', entity: 'departures', entityId: dep.id, newValues: input });
    return dep;
  },

  async availability(departureId: string) {
    const d = await packagesRepository.departureById(departureId);
    if (!d) throw errors.notFound('Jadwal keberangkatan tidak ditemukan');
    return {
      departureId: d.id,
      packageName: d.package_name,
      departureDate: d.departure_date,
      quota: d.quota,
      seatsTaken: d.seats_taken,
      seatsLeft: d.quota - d.seats_taken,
      status: d.status
    };
  }
};
