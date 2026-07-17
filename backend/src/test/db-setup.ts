import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Knex } from 'knex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '../..');

function findTsxCli(): string {
  // npm workspaces bisa meng-hoist tsx ke node_modules root repo
  for (const base of [backendRoot, path.resolve(backendRoot, '..')]) {
    const p = path.join(base, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    if (fs.existsSync(p)) return p;
  }
  throw new Error('tsx tidak ditemukan di node_modules');
}

/**
 * Reset DB test: rollback semua migrasi → migrate → seed.
 * Seed dijalankan via child process tsx (bukan import dinamis Knex) karena file
 * seed meng-import modul TS lokal yang tidak bisa diresolusi loader Vitest.
 */
export async function resetTestDb(db: Knex): Promise<void> {
  const { normalizeMigrationNames } = await import('../config/db.js');
  await normalizeMigrationNames(db);
  await db.migrate.rollback(undefined, true);
  await db.migrate.latest();
  execFileSync(process.execPath, [findTsxCli(), path.join(backendRoot, 'src', 'db', 'scripts', 'seed.ts')], {
    cwd: backendRoot,
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'pipe'
  });
}
