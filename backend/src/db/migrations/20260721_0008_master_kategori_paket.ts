import type { Knex } from 'knex';

/**
 * Kategori paket menjadi master data ber-CRUD (sebelumnya enum kaku).
 * packages.category dikonversi enum → varchar dengan FK ke package_categories.code
 * agar kategori baru bisa ditambah dari UI tanpa migrasi.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('package_categories', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('code', 30).notNullable().unique();
    t.string('label', 60).notNullable();
    t.integer('sort').notNullable().defaultTo(0);
    t.timestamps(true, true);
  });
  await knex('package_categories').insert([
    { code: 'reguler', label: 'Reguler', sort: 1 },
    { code: 'plus', label: 'Plus', sort: 2 },
    { code: 'vip', label: 'VIP', sort: 3 },
    { code: 'khusus', label: 'Khusus', sort: 4 }
  ]);

  await knex.raw('ALTER TABLE packages ALTER COLUMN category TYPE varchar(30) USING category::text');
  await knex.raw('DROP TYPE IF EXISTS package_category');
  await knex.raw(
    'ALTER TABLE packages ADD CONSTRAINT packages_category_fk FOREIGN KEY (category) REFERENCES package_categories(code) ON UPDATE CASCADE'
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('ALTER TABLE packages DROP CONSTRAINT IF EXISTS packages_category_fk');
  await knex.raw("CREATE TYPE package_category AS ENUM ('reguler','plus','vip','khusus')");
  await knex.raw(
    'ALTER TABLE packages ALTER COLUMN category TYPE package_category USING category::package_category'
  );
  await knex.schema.dropTableIfExists('package_categories');
}
