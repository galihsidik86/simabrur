import { db } from '../../config/db.js';
import { escapeLike } from '../../utils/like.js';

export const jamaahRepository = {
  /** Daftar jamaah utk tabel admin: registrasi + paket + agregat dokumen. */
  async list(opts: { tab: string; q?: string; status?: string; identityPending?: boolean; page: number; limit: number }) {
    const base = db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .modify((qb) => {
        if (opts.q) {
          // DOM-07: escape wildcard ILIKE agar "_"/"%" tidak dicocokkan sebagai pola.
          const like = `%${escapeLike(opts.q)}%`;
          qb.where((w) => w.whereILike('j.full_name', like).orWhereILike('r.reg_number', like));
        }
        if (opts.tab === 'lunas') qb.where('r.payment_scheme', 'lunas');
        if (opts.tab === 'dokumen') {
          // Belum lengkap: dokumen wajib (5 jenis, NKH opsional) yang terverifikasi < 5
          qb.whereRaw(
            `(select count(*) from documents dd
              where dd.jamaah_id = j.id and dd.status = 'verified' and dd.doc_type <> 'NKH') < 5`
          );
        }
        // G (putaran 3): filter status registrasi & menunggu konfirmasi identitas.
        // Tanpa filter → tampilkan SEMUA status (termasuk cancelled), tak berubah.
        if (opts.status) qb.where('r.status', opts.status);
        if (opts.identityPending) qb.where('r.identity_confirmation_required', true);
      });

    const [{ count }] = await base.clone().count({ count: '*' });
    const rows = await base
      .clone()
      .leftJoin('invoices as i', 'i.registration_id', 'r.id')
      .leftJoin(
        db('payments').select('invoice_id').sum('amount as paid').where('status', 'verified').groupBy('invoice_id').as('pp'),
        'pp.invoice_id',
        'i.id'
      )
      .select(
        'r.id as registration_id',
        'r.reg_number',
        'r.status as registration_status',
        'r.identity_confirmation_required',
        'r.payment_scheme',
        'r.room_type',
        'j.id as jamaah_id',
        'j.full_name',
        'j.gender',
        'j.birth_date',
        'j.birth_place',
        'p.name as package_name',
        'p.type as package_type',
        'd.departure_date',
        'i.id as invoice_id',
        'i.total_amount',
        'pp.paid'
      )
      .orderBy('r.reg_number')
      .limit(opts.limit)
      .offset((opts.page - 1) * opts.limit);

    const ids = rows.map((r: { jamaah_id: string }) => r.jamaah_id);
    const docs = ids.length ? await db('documents').whereIn('jamaah_id', ids) : [];
    return { rows, docs, total: Number(count) };
  },

  async detail(jamaahId: string) {
    const jamaah = await db('jamaah').where({ id: jamaahId }).first();
    if (!jamaah) return null;
    const registrations = await db('registrations as r')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .leftJoin('groups as g', 'g.id', 'r.group_id')
      // DOM-03: invoice.total_amount = sumber kebenaran (dibekukan saat terbit).
      // Harga paket bisa berubah setelah registrasi; jangan hitung ulang dari harga terkini.
      .leftJoin('invoices as i', 'i.registration_id', 'r.id')
      .select(
        'r.*',
        'p.name as package_name',
        'p.base_price',
        'p.triple_upcharge',
        'p.double_upcharge',
        'd.departure_date',
        'd.return_date',
        'g.name as group_name',
        'i.total_amount as invoice_total_amount'
      )
      .where('r.jamaah_id', jamaahId)
      .orderBy('d.departure_date', 'desc');
    const documents = await db('documents').where({ jamaah_id: jamaahId }).orderBy('doc_type');
    return { jamaah, registrations, documents };
  },

  documentById(id: string) {
    return db('documents').where({ id }).first();
  }
};
