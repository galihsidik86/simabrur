import type { Request } from 'express';
import { db } from '../config/db.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * Catat mutasi ke audit_logs. Dipanggil dari service pada SEMUA transaksi
 * keuangan & perubahan data sensitif (aturan Handoff §7).
 */
export async function audit(req: Request | null, entry: AuditEntry): Promise<void> {
  await db('audit_logs').insert({
    user_id: req?.user?.id ?? null,
    action: entry.action,
    entity: entry.entity,
    entity_id: entry.entityId ?? null,
    old_values: entry.oldValues ? JSON.stringify(entry.oldValues) : null,
    new_values: entry.newValues ? JSON.stringify(entry.newValues) : null,
    ip: req?.ip ?? null
  });
}
