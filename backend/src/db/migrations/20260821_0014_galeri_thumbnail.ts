import type { Knex } from 'knex';

// Thumbnail galeri: URL berkas mini (dibuat di sisi klien saat unggah) untuk grid,
// agar jamaah tak perlu mengunduh foto penuh hanya untuk pratinjau. Nullable —
// foto lama / unggahan via API tanpa thumbnail tetap disajikan versi penuh.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('gallery_photos', (t) => {
    t.text('thumb_url');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('gallery_photos', (t) => {
    t.dropColumn('thumb_url');
  });
}
