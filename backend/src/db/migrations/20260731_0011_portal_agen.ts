import type { Knex } from 'knex';

/**
 * Portal Agen — kredensial login untuk agen/mitra (pihak luar).
 * Pola sama seperti kredensial Mabrur: password terbit-kantor, wajib ganti saat
 * login pertama. HP = username (unik untuk agen berportal).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('agents', (t) => {
    t.text('password_hash'); // bcrypt; null = portal belum diaktifkan
    t.boolean('must_change_password').notNullable().defaultTo(true);
    t.boolean('portal_enabled').notNullable().defaultTo(false);
    t.timestamp('last_login_at');
  });
  // HP = username login; wajib unik untuk agen yang portalnya aktif
  await knex.raw(
    `CREATE UNIQUE INDEX agents_portal_phone_unique
       ON agents (lower(phone))
       WHERE portal_enabled AND phone IS NOT NULL`
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS agents_portal_phone_unique');
  await knex.schema.alterTable('agents', (t) => {
    t.dropColumn('password_hash');
    t.dropColumn('must_change_password');
    t.dropColumn('portal_enabled');
    t.dropColumn('last_login_at');
  });
}
