import type { Knex } from 'knex';

/**
 * Integrasi Mabrur (aplikasi lapangan) — sisi Safar:
 * - Nomor HP muthawwif/TL (wajib utk akun Mabrur — penerima SOS)
 * - Kolom mapping id entitas Mabrur (hasil sinkron)
 * - Kredensial awal aplikasi Mabrur (password terenkripsi, ditampilkan di portal)
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('group_staff', (t) => {
    t.string('phone', 20);
    t.uuid('mabrur_user_id');
  });
  await knex.schema.alterTable('jamaah', (t) => {
    t.uuid('mabrur_user_id');
  });
  await knex.schema.alterTable('groups', (t) => {
    t.uuid('mabrur_group_id');
    t.timestamp('mabrur_synced_at');
  });

  await knex.schema.createTable('mabrur_credentials', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.enu('subject_type', ['jamaah', 'staff'], { useNative: true, enumName: 'mabrur_subject_type' }).notNullable();
    t.uuid('subject_id').notNullable(); // jamaah.id atau group_staff.id
    t.string('phone', 20).notNullable();
    t.text('initial_password_enc').notNullable(); // AES-256-GCM iv:tag:cipher
    t.timestamp('synced_at').notNullable().defaultTo(knex.fn.now());
    t.timestamps(true, true);
    t.unique(['subject_type', 'subject_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('mabrur_credentials');
  await knex.raw('DROP TYPE IF EXISTS mabrur_subject_type');
  await knex.schema.alterTable('groups', (t) => {
    t.dropColumn('mabrur_group_id');
    t.dropColumn('mabrur_synced_at');
  });
  await knex.schema.alterTable('jamaah', (t) => {
    t.dropColumn('mabrur_user_id');
  });
  await knex.schema.alterTable('group_staff', (t) => {
    t.dropColumn('phone');
    t.dropColumn('mabrur_user_id');
  });
}
