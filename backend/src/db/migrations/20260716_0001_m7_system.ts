import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('branches', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable();
    t.string('city').notNullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name').notNullable().unique();
    t.string('label').notNullable();
    t.jsonb('permissions').notNullable().defaultTo('{}');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('branch_id').notNullable().references('id').inTable('branches');
    t.uuid('role_id').notNullable().references('id').inTable('roles');
    t.string('name').notNullable();
    t.string('email').notNullable().unique();
    t.string('password_hash').notNullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash').notNullable().unique();
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at');
    t.timestamps(true, true);
    t.index(['user_id']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.bigIncrements('id').primary();
    t.uuid('user_id').references('id').inTable('users');
    t.string('action').notNullable();
    t.string('entity').notNullable();
    t.string('entity_id');
    t.jsonb('old_values');
    t.jsonb('new_values');
    t.string('ip');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity', 'entity_id']);
    t.index(['user_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('audit_logs');
  await knex.schema.dropTableIfExists('refresh_tokens');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('branches');
}
