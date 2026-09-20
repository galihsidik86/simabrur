import type { Knex } from 'knex';

/**
 * N-2: bekukan komponen harga invoice (base_price + room_upcharge) SAAT TERBIT,
 * agar rincian dokumen invoice (payments.service.ts invoiceDocument) tidak berubah
 * diam-diam bila marketing merevisi harga paket setelah invoice terbit.
 *
 * Backfill baris lama (asumsi, dicatat di handoff): tidak ada histori harga paket
 * per tanggal, jadi upcharge kamar diturunkan dari harga paket TERKINI untuk
 * room_type registrasi masing-masing, dibatasi (LEAST) agar tidak melebihi
 * total_amount; base_price = total_amount - upcharge. Ini menjaga invarian
 * Σ item = total_amount PERSIS untuk semua baris lama, tapi bila harga paket
 * sudah berubah sejak invoice lama diterbitkan, rincian per-baris (bukan totalnya)
 * bisa berbeda dari histori asli — estimasi terbaik yang tersedia dari data yang ada.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('invoices', (t) => {
    t.decimal('base_price', 15, 2);
    t.decimal('room_upcharge', 15, 2);
  });

  await knex.raw(`
    UPDATE invoices AS i
    SET room_upcharge = LEAST(
          COALESCE(CASE r.room_type WHEN 'triple' THEN p.triple_upcharge WHEN 'double' THEN p.double_upcharge ELSE 0 END, 0),
          i.total_amount
        ),
        base_price = i.total_amount - LEAST(
          COALESCE(CASE r.room_type WHEN 'triple' THEN p.triple_upcharge WHEN 'double' THEN p.double_upcharge ELSE 0 END, 0),
          i.total_amount
        )
    FROM registrations r
    JOIN departures d ON d.id = r.departure_id
    JOIN packages p ON p.id = d.package_id
    WHERE i.registration_id = r.id
  `);

  await knex.schema.alterTable('invoices', (t) => {
    t.decimal('base_price', 15, 2).notNullable().alter();
    t.decimal('room_upcharge', 15, 2).notNullable().defaultTo(0).alter();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('invoices', (t) => {
    t.dropColumn('base_price');
    t.dropColumn('room_upcharge');
  });
}
