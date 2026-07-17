import knex, { Knex } from 'knex';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { env } from './env.js';

// Kolom DATE dikembalikan sebagai string 'YYYY-MM-DD' apa adanya — mencegah
// pergeseran tanggal akibat konversi timezone JS Date (kritis utk tanggal keberangkatan).
pg.types.setTypeParser(pg.types.builtins.DATE, (v: string) => v);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATIONS_DIR = path.resolve(__dirname, '../db/migrations');

/**
 * Migration source bebas-ekstensi: nama tercatat tanpa .ts/.js sehingga
 * migrasi yang dijalankan saat dev (tsx, .ts) tetap dikenali oleh runtime
 * produksi (dist, .js) — dan sebaliknya.
 */
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations() {
    return fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => /\.(ts|js)$/.test(f) && !f.endsWith('.d.ts'))
      .map((f) => path.parse(f).name)
      .sort();
  },
  getMigrationName: (name) => name,
  async getMigration(name) {
    for (const ext of ['.js', '.ts']) {
      const p = path.join(MIGRATIONS_DIR, name + ext);
      if (fs.existsSync(p)) return import(pathToFileURL(p).href);
    }
    throw new Error(`File migrasi tidak ditemukan: ${name}`);
  }
};

/** Normalisasi catatan lama (nama ber-ekstensi) — idempoten, aman utk DB baru. */
export async function normalizeMigrationNames(k: Knex): Promise<void> {
  const hasTable = await k.schema.hasTable('knex_migrations');
  if (hasTable) {
    await k('knex_migrations').update({ name: k.raw(`regexp_replace(name, '\\.(ts|js)$', '')`) }).whereRaw(`name ~ '\\.(ts|js)$'`);
  }
}

export function knexConfig(connection?: string): Knex.Config {
  return {
    client: 'pg',
    connection: connection ?? (env.isTest ? env.databaseUrlTest : env.databaseUrl),
    pool: { min: 0, max: 10 },
    migrations: { migrationSource },
    seeds: {
      directory: path.resolve(__dirname, '../db/seeds'),
      extension: 'ts'
    }
  };
}

export const db = knex(knexConfig());
