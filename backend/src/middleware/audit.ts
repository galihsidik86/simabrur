import type { Request } from 'express';
import type { Knex } from 'knex';
import { db } from '../config/db.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
  /**
   * Ganti aktor default (`req.user.id`) — dipakai saat aksi terjadi di endpoint TANPA
   * `requireAuth` (mis. NEW-FE-02 logout: kredensial adalah refresh token itu sendiri,
   * bukan sesi ber-`req.user`), dan aktor sebenarnya diketahui dari baris token/data lain.
   */
  actorId?: string | null;
}

/**
 * Catat mutasi ke audit_logs. Dipanggil dari service pada SEMUA transaksi
 * keuangan & perubahan data sensitif (aturan Handoff §7).
 *
 * `exec`: bila dipanggil DI DALAM sebuah transaksi, WAJIB diberi `trx` agar
 * (a) tidak mengambil koneksi pool kedua sementara transaksi memegang yang
 * pertama — sumber deadlock pool-exhaustion saat konkuren, dan (b) baris audit
 * ikut rollback bila transaksi gagal (tidak mencatat aksi yang tak pernah terjadi).
 */
export async function audit(req: Request | null, entry: AuditEntry, exec: Knex = db): Promise<void> {
  await exec('audit_logs').insert({
    user_id: entry.actorId !== undefined ? entry.actorId : (req?.user?.id ?? null),
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    old_values: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
    new_values: entry.newValues ? JSON.stringify(entry.newValues) : null,
    ip: req?.ip ?? null
  });
}
