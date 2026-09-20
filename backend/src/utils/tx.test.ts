import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/db.js', () => ({
  db: { transaction: vi.fn() }
}));

import { db } from '../config/db.js';
import { isRetryablePgError, withTransaction } from './tx.js';

function pgError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

describe('isRetryablePgError', () => {
  it('true untuk 40P01 (deadlock) dan 40001 (serialization failure)', () => {
    expect(isRetryablePgError(pgError('40P01', 'deadlock detected'))).toBe(true);
    expect(isRetryablePgError(pgError('40001', 'could not serialize access'))).toBe(true);
  });

  it('false untuk kode error Postgres lain, non-objek, atau tanpa kode', () => {
    expect(isRetryablePgError(pgError('23505', 'unique violation'))).toBe(false);
    expect(isRetryablePgError(new Error('generik tanpa kode'))).toBe(false);
    expect(isRetryablePgError('string bukan objek')).toBe(false);
    expect(isRetryablePgError(null)).toBe(false);
    expect(isRetryablePgError(undefined)).toBe(false);
  });
});

describe('withTransaction', () => {
  it('mengulang SELURUH callback sekali setelah gagal 40P01, lalu sukses', async () => {
    let calls = 0;
    vi.mocked(db.transaction).mockImplementation((async (fn: (trx: unknown) => unknown) => {
      calls++;
      if (calls === 1) throw pgError('40P01', 'deadlock detected');
      return fn({});
    }) as typeof db.transaction);

    const result = await withTransaction(async () => 'ok', { retries: 2 });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('error yang BUKAN 40P01/40001 dilempar langsung tanpa diulang', async () => {
    let calls = 0;
    vi.mocked(db.transaction).mockImplementation((async () => {
      calls++;
      throw pgError('23505', 'unique violation');
    }) as typeof db.transaction);

    await expect(withTransaction(async () => 'x', { retries: 3 })).rejects.toThrow('unique violation');
    expect(calls).toBe(1);
  });

  it('retries habis (40001 terus-menerus) → error terakhir dilempar setelah percobaan awal + N retry', async () => {
    let calls = 0;
    vi.mocked(db.transaction).mockImplementation((async () => {
      calls++;
      throw pgError('40001', 'could not serialize access due to concurrent update');
    }) as typeof db.transaction);

    await expect(withTransaction(async () => 'x', { retries: 2 })).rejects.toThrow('could not serialize');
    expect(calls).toBe(3);
  });

  it('tanpa opsi retries (default 0) — gagal sekali langsung dilempar, tidak diulang', async () => {
    let calls = 0;
    vi.mocked(db.transaction).mockImplementation((async () => {
      calls++;
      throw pgError('40P01', 'deadlock detected');
    }) as typeof db.transaction);

    await expect(withTransaction(async () => 'x')).rejects.toThrow('deadlock detected');
    expect(calls).toBe(1);
  });
});
