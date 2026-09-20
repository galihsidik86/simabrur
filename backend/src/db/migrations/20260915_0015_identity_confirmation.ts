import type { Knex } from 'knex';

// NEW-BE-01 (putaran 2): registrasi baru yang dibuat via wizard publik memakai NIK
// yang SUDAH terdaftar sebelumnya (reuse profil) ditahan dari login Portal Jamaah
// sampai dikonfirmasi petugas — mencegah penyerang yang hanya tahu NIK korban
// mendapat akses portal (termasuk kredensial Mabrur) lewat nomor registrasi baru.
// Default FALSE agar baris lama (dan alur normal jamaah baru) tidak terkunci.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (t) => {
    t.boolean('identity_confirmation_required').notNullable().defaultTo(false);
    t.uuid('identity_confirmed_by').references('id').inTable('users');
    t.timestamp('identity_confirmed_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('registrations', (t) => {
    t.dropColumn('identity_confirmation_required');
    t.dropColumn('identity_confirmed_by');
    t.dropColumn('identity_confirmed_at');
  });
}
