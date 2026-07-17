import { db } from '../../config/db.js';

export const packagesRepository = {
  /** Daftar paket + hotel/maskapai + jadwal terdekat (untuk kartu paket). */
  list(filter: { type?: string; status?: string }) {
    const q = db('packages as p')
      .leftJoin('hotels as h', 'h.id', 'p.hotel_id')
      .leftJoin('airlines as a', 'a.id', 'p.airline_id')
      .leftJoin(
        db('departures')
          .select('package_id')
          .min('departure_date as next_departure')
          .groupBy('package_id')
          .as('nd'),
        'nd.package_id',
        'p.id'
      )
      .leftJoin('departures as d', function () {
        this.on('d.package_id', 'p.id').andOn('d.departure_date', 'nd.next_departure');
      })
      .select(
        'p.*',
        'h.name as hotel_name',
        'h.star as hotel_star',
        'a.name as airline_name',
        'd.id as departure_id',
        'd.departure_date',
        'd.quota',
        'd.seats_taken',
        'd.status as departure_status'
      )
      .orderBy('d.departure_date', 'asc');
    if (filter.type) q.where('p.type', filter.type);
    if (filter.status === 'aktif') q.where('p.is_active', true);
    if (filter.status === 'ditutup') q.where('p.is_active', false);
    return q;
  },

  byId(id: string) {
    return db('packages as p')
      .leftJoin('hotels as h', 'h.id', 'p.hotel_id')
      .leftJoin('airlines as a', 'a.id', 'p.airline_id')
      .select('p.*', 'h.name as hotel_name', 'h.star as hotel_star', 'a.name as airline_name')
      .where('p.id', id)
      .first();
  },

  costs(packageId: string) {
    return db('package_costs').where({ package_id: packageId }).orderBy('amount', 'desc');
  },

  departures(packageId?: string) {
    const q = db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('d.*', 'p.name as package_name', 'p.type as package_type', 'p.code as package_code')
      .orderBy('d.departure_date');
    if (packageId) q.where('d.package_id', packageId);
    return q;
  },

  departureById(id: string) {
    return db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('d.*', 'p.name as package_name', 'p.type as package_type', 'p.base_price', 'p.triple_upcharge', 'p.double_upcharge')
      .where('d.id', id)
      .first();
  },

  hotels() {
    return db('hotels').orderBy('name');
  },

  airlines() {
    return db('airlines').orderBy('name');
  }
};
