import type { Knex } from 'knex';
import { db } from '../config/db.js';

/** Kode error Postgres yang aman diulang otomatis: deadlock & serialization failure. */
const RETRYABLE_PG_CODES = new Set(['40P01', '40001']);

function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Deadlock (40P01) / serialization failure (40001) — retryable. Error lain: lempar apa adanya. */
export function isRetryablePgError(err: unknown): boolean {
  const code = pgErrorCode(err);
  return code !== undefined && RETRYABLE_PG_CODES.has(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Jeda kecil ber-jitter sebelum retry (hindari thundering herd pada deadlock berulang). */
function backoffDelay(attempt: number): number {
  return Math.round(15 + Math.random() * 35 * attempt);
}

export interface WithTransactionOptions {
  /** Jumlah percobaan ULANG (di luar percobaan pertama). Default 0 = tanpa retry. */
  retries?: number;
}

/**
 * E (retry otomatis 40P01/40001): bungkus `db.transaction` — bila callback gagal
 * dengan error deadlock/serialization Postgres, ULANGI SELURUH callback dari awal
 * (bukan hanya statement yang gagal — itulah cara Postgres mengharuskan pemulihan
 * dari kedua error ini). Error lain dilempar apa adanya tanpa retry.
 *
 * PENTING: callback yang dibungkus TIDAK BOLEH punya efek samping di luar transaksi
 * yang berbahaya bila dijalankan berkali-kali (menulis file, memanggil API eksternal
 * non-idempotent, dsb) — hanya aman untuk callback yang efeknya murni di dalam `trx`
 * (di-rollback otomatis oleh Postgres saat percobaan gagal).
 */
export async function withTransaction<T>(
  fn: (trx: Knex.Transaction) => Promise<T>,
  opts: WithTransactionOptions = {}
): Promise<T> {
  const retries = opts.retries ?? 0;
  let attempt = 0;
  for (;;) {
    try {
      return await db.transaction(fn);
    } catch (err) {
      if (attempt >= retries || !isRetryablePgError(err)) throw err;
      attempt++;
      await sleep(backoffDelay(attempt));
    }
  }
}
