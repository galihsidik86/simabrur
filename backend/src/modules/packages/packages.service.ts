import type { Request } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { packagesRepository } from './packages.repository.js';
import type {
  createPackageSchema,
  updatePackageSchema,
  createDepartureSchema,
  upsertCategorySchema,
  upsertHotelSchema,
  upsertAirlineSchema
} from './packages.validation.js';

type CreatePackageInput = z.infer<typeof createPackageSchema>;
type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
type CreateDepartureInput = z.infer<typeof createDepartureSchema>;
type CategoryInput = z.infer<typeof upsertCategorySchema>;
type HotelInput = z.infer<typeof upsertHotelSchema>;
type AirlineInput = z.infer<typeof upsertAirlineSchema>;

async function assertCategoryExists(code: string) {
  const found = await db('package_categories').where({ code }).first();
  if (!found) throw errors.badRequest(`Kategori "${code}" tidak dikenal — tambahkan dulu di Master Data`);
}

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
    await assertCategoryExists(input.category);
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
      await audit(req, { action: 'packages.create', entity: 'packages', entityId: pkg.id, newValues: input }, trx);
      return pkg;
    });
  },

  async update(req: Request, id: string, input: UpdatePackageInput) {
    const before = await db('packages').where({ id }).first();
    if (!before) throw errors.notFound('Paket tidak ditemukan');
    if (input.category !== undefined) await assertCategoryExists(input.category);

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
      await audit(req, { action: 'packages.update', entity: 'packages', entityId: id, oldValues: before, newValues: input }, trx);
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
  },

  // ===== Master data: kategori paket, hotel, maskapai =====
  categories() {
    return db('package_categories').select('id', 'code', 'label', 'sort').orderBy(['sort', 'label']);
  },

  async createCategory(req: Request, input: CategoryInput) {
    const dup = await db('package_categories').where({ code: input.code }).first();
    if (dup) throw errors.conflict(`Kode kategori "${input.code}" sudah ada`);
    const [row] = await db('package_categories').insert(input).returning('*');
    await audit(req, { action: 'master.category.create', entity: 'package_categories', entityId: row.id, newValues: input });
    return row;
  },

  async updateCategory(req: Request, id: string, input: CategoryInput) {
    const before = await db('package_categories').where({ id }).first();
    if (!before) throw errors.notFound('Kategori tidak ditemukan');
    const dup = await db('package_categories').where({ code: input.code }).whereNot({ id }).first();
    if (dup) throw errors.conflict(`Kode kategori "${input.code}" sudah dipakai`);
    // FK packages.category ON UPDATE CASCADE — ubah kode ikut memperbarui paket
    const [row] = await db('package_categories').where({ id }).update({ ...input, updated_at: db.fn.now() }).returning('*');
    await audit(req, { action: 'master.category.update', entity: 'package_categories', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteCategory(req: Request, id: string) {
    const before = await db('package_categories').where({ id }).first();
    if (!before) throw errors.notFound('Kategori tidak ditemukan');
    const used = await db('packages').where({ category: before.code }).count<{ count: string }[]>('id as count').first();
    if (Number(used?.count)) throw errors.conflict(`Kategori dipakai ${used?.count} paket — pindahkan paketnya dulu`);
    await db('package_categories').where({ id }).del();
    await audit(req, { action: 'master.category.delete', entity: 'package_categories', entityId: id, oldValues: before });
    return { deleted: true };
  },

  async createHotel(req: Request, input: HotelInput) {
    const [row] = await db('hotels').insert({ name: input.name, city: input.city, star: input.star }).returning('*');
    await audit(req, { action: 'master.hotel.create', entity: 'hotels', entityId: row.id, newValues: input });
    return row;
  },

  async updateHotel(req: Request, id: string, input: HotelInput) {
    const before = await db('hotels').where({ id }).first();
    if (!before) throw errors.notFound('Hotel tidak ditemukan');
    const [row] = await db('hotels')
      .where({ id })
      .update({ name: input.name, city: input.city, star: input.star, updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'master.hotel.update', entity: 'hotels', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteHotel(req: Request, id: string) {
    const before = await db('hotels').where({ id }).first();
    if (!before) throw errors.notFound('Hotel tidak ditemukan');
    const used = await db('packages').where({ hotel_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(used?.count)) throw errors.conflict(`Hotel dipakai ${used?.count} paket — ganti hotel paketnya dulu`);
    await db('hotels').where({ id }).del();
    await audit(req, { action: 'master.hotel.delete', entity: 'hotels', entityId: id, oldValues: before });
    return { deleted: true };
  },

  async createAirline(req: Request, input: AirlineInput) {
    const [row] = await db('airlines').insert({ name: input.name, iata_code: input.iataCode }).returning('*');
    await audit(req, { action: 'master.airline.create', entity: 'airlines', entityId: row.id, newValues: input });
    return row;
  },

  async updateAirline(req: Request, id: string, input: AirlineInput) {
    const before = await db('airlines').where({ id }).first();
    if (!before) throw errors.notFound('Maskapai tidak ditemukan');
    const [row] = await db('airlines')
      .where({ id })
      .update({ name: input.name, iata_code: input.iataCode, updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'master.airline.update', entity: 'airlines', entityId: id, oldValues: before, newValues: input });
    return row;
  },

  async deleteAirline(req: Request, id: string) {
    const before = await db('airlines').where({ id }).first();
    if (!before) throw errors.notFound('Maskapai tidak ditemukan');
    const used = await db('packages').where({ airline_id: id }).count<{ count: string }[]>('id as count').first();
    if (Number(used?.count)) throw errors.conflict(`Maskapai dipakai ${used?.count} paket — ganti maskapai paketnya dulu`);
    await db('airlines').where({ id }).del();
    await audit(req, { action: 'master.airline.delete', entity: 'airlines', entityId: id, oldValues: before });
    return { deleted: true };
  }
};
