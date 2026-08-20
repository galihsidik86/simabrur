import type { Knex } from 'knex';

// Galeri foto per keberangkatan (rombongan). Satu album implisit per departure —
// jamaah hanya melihat foto keberangkatannya sendiri (dijamin di service, bukan
// URL tebakan). File fisik di backend/uploads/gallery/<departureId>/ (tidak statis).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('gallery_photos', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('departure_id').notNullable().references('id').inTable('departures').onDelete('CASCADE');
    t.text('file_url').notNullable();
    t.string('content_type').notNullable();
    t.integer('file_size').notNullable().defaultTo(0);
    t.string('caption');
    t.uuid('uploaded_by').references('id').inTable('users');
    t.timestamps(true, true);
    t.index(['departure_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('gallery_photos');
}
