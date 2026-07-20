import type { Request } from 'express';
import crypto from 'node:crypto';
import { db } from '../../config/db.js';
import { env } from '../../config/env.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { encrypt, decrypt } from '../../utils/crypto.js';

/**
 * Sinkronisasi rombongan Safar → Mabrur (aplikasi lapangan).
 * - Safar = sumber data induk; panggilan idempoten ke POST /integrations/safar/sync
 * - Password awal 6 digit hanya utk akun BARU (dari respons Mabrur), disimpan
 *   terenkripsi agar bisa ditampilkan di portal jamaah.
 */

const PHONE_RE = /^08\d{8,13}$/;
const normalizePhone = (p: string | null | undefined) => (p ?? '').replace(/\D/g, '');
const genPassword = () => String(crypto.randomInt(100000, 1000000));

interface MabrurMemberResult {
  externalRef: string;
  phone: string;
  status: 'created' | 'updated' | 'conflict';
  mabrurUserId?: string;
  message?: string;
}

function ensureConfigured() {
  if (!env.mabrur.apiUrl || !env.mabrur.serviceToken) {
    throw errors.badRequest('Integrasi Mabrur belum dikonfigurasi (MABRUR_API_URL / MABRUR_SERVICE_TOKEN)');
  }
}

async function callMabrur(path: string, init: RequestInit = {}) {
  ensureConfigured();
  let res: Response;
  try {
    res = await fetch(`${env.mabrur.apiUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Token': env.mabrur.serviceToken,
        ...(init.headers ?? {})
      },
      signal: AbortSignal.timeout(15_000)
    });
  } catch (e) {
    throw errors.badRequest(`Server Mabrur tidak terjangkau (${env.mabrur.apiUrl}): ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (body as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`;
    throw errors.badRequest(`Mabrur menolak permintaan: ${msg}`);
  }
  return (body as { data: unknown }).data;
}

export const mabrurService = {
  /** Sinkronkan satu rombongan (group Safar) ke Mabrur. */
  async syncGroup(req: Request, groupId: string) {
    const group = await db('groups as g')
      .join('departures as d', 'd.id', 'g.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('g.*', 'd.departure_date', 'd.return_date', 'p.name as package_name', 'p.code as package_code')
      .where('g.id', groupId)
      .first();
    if (!group) throw errors.notFound('Rombongan tidak ditemukan');

    const staff = await db('group_staff').where({ group_id: groupId });
    const registrations = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .select('r.id as registration_id', 'r.reg_number', 'r.status',
        'j.id as jamaah_id', 'j.full_name', 'j.phone', 'j.passport_no',
        'j.emergency_contact_name', 'j.emergency_contact_phone')
      .where('r.group_id', groupId)
      .whereNot('r.status', 'cancelled');

    // Prasyarat: minimal satu muthawwif/TL ber-HP valid (penerima SOS)
    const staffWithPhone = staff.filter((s) => PHONE_RE.test(normalizePhone(s.phone)));
    if (staffWithPhone.length === 0) {
      throw errors.badRequest(
        'Sinkron ditolak: belum ada muthawwif/TL dengan nomor HP valid pada rombongan ini (isi lewat Kelola Rombongan)'
      );
    }
    if (registrations.length === 0) {
      throw errors.badRequest('Sinkron ditolak: rombongan belum memiliki anggota (tetapkan lewat tombol Ubah pada manifest)');
    }

    // Susun anggota + laporan lokal utk yang HP-nya tidak valid
    const skipped: { name: string; reason: string }[] = [];
    const passwords = new Map<string, string>(); // externalRef -> password kandidat
    const members: Record<string, unknown>[] = [];

    for (const s of staffWithPhone) {
      const pwd = genPassword();
      passwords.set(s.id, pwd);
      members.push({
        externalRef: s.id,
        phone: normalizePhone(s.phone),
        name: s.staff_name,
        role: 'muthawwif', // TL juga memantau rombongan di Mabrur
        initialPassword: pwd
      });
    }
    for (const s of staff.filter((x) => !staffWithPhone.includes(x))) {
      skipped.push({ name: s.staff_name, reason: 'Nomor HP petugas kosong/tidak valid' });
    }
    for (const r of registrations) {
      const phone = normalizePhone(r.phone);
      if (!PHONE_RE.test(phone)) {
        skipped.push({ name: r.full_name, reason: `Nomor HP jamaah tidak valid (${r.phone ?? 'kosong'})` });
        continue;
      }
      const pwd = genPassword();
      passwords.set(r.jamaah_id, pwd);
      members.push({
        externalRef: r.jamaah_id,
        phone,
        name: r.full_name,
        role: 'jamaah',
        passportNo: r.passport_no ?? null,
        emergencyContact: r.emergency_contact_name
          ? `${r.emergency_contact_name}${r.emergency_contact_phone ? ' · ' + r.emergency_contact_phone : ''}`
          : null,
        initialPassword: pwd
      });
    }
    if (members.length === 0) throw errors.badRequest('Tidak ada anggota dengan nomor HP valid untuk disinkronkan');

    const kloterCode = `${group.package_code}-${String(group.name).replace(/grup\s*/i, '')}`
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '-')
      .slice(0, 20);

    const payload = {
      group: {
        externalRef: group.id,
        name: `${group.package_name} — ${group.name}`,
        kloterCode,
        year: new Date(group.departure_date).getFullYear()
      },
      members,
      schedules: [
        { title: `Keberangkatan — ${group.package_name}`, locationName: 'Bandara Soekarno-Hatta (CGK)', startTime: `${group.departure_date}T09:00:00+07:00`, sortOrder: 1 },
        { title: `Kepulangan — ${group.package_name}`, locationName: 'Jeddah (JED)', startTime: `${group.return_date}T09:00:00+07:00`, sortOrder: 99 }
      ]
    };

    const result = (await callMabrur('/integrations/safar/sync', {
      method: 'POST',
      body: JSON.stringify(payload)
    })) as { mabrurGroupId: string; group: string; members: MabrurMemberResult[]; schedules: number };

    // Simpan mapping + kredensial (hanya utk akun BARU — akun lama passwordnya tidak berubah)
    await db.transaction(async (trx) => {
      await trx('groups').where({ id: groupId }).update({
        mabrur_group_id: result.mabrurGroupId,
        mabrur_synced_at: trx.fn.now(),
        updated_at: trx.fn.now()
      });
      for (const m of result.members) {
        if (!m.mabrurUserId) continue;
        const isStaff = staff.some((s) => s.id === m.externalRef);
        if (isStaff) {
          await trx('group_staff').where({ id: m.externalRef }).update({ mabrur_user_id: m.mabrurUserId });
        } else {
          await trx('jamaah').where({ id: m.externalRef }).update({ mabrur_user_id: m.mabrurUserId, updated_at: trx.fn.now() });
        }
        if (m.status === 'created') {
          const pwd = passwords.get(m.externalRef);
          if (pwd) {
            await trx('mabrur_credentials')
              .insert({
                subject_type: isStaff ? 'staff' : 'jamaah',
                subject_id: m.externalRef,
                phone: m.phone,
                initial_password_enc: encrypt(pwd),
                synced_at: trx.fn.now()
              })
              .onConflict(['subject_type', 'subject_id'])
              .merge({ phone: m.phone, initial_password_enc: encrypt(pwd), synced_at: trx.fn.now(), updated_at: trx.fn.now() });
          }
        } else {
          // Akun lama: password tidak berubah, tapi HP (= username login) bisa
          // sudah diganti — segarkan agar tampilan kredensial tidak menyesatkan
          await trx('mabrur_credentials')
            .where({ subject_type: isStaff ? 'staff' : 'jamaah', subject_id: m.externalRef })
            .whereNot('phone', m.phone)
            .update({ phone: m.phone, updated_at: trx.fn.now() });
        }
      }
    });

    const summary = {
      groupId,
      mabrurGroupId: result.mabrurGroupId,
      created: result.members.filter((m) => m.status === 'created').length,
      updated: result.members.filter((m) => m.status === 'updated').length,
      conflicts: result.members.filter((m) => m.status === 'conflict').map((m) => ({ phone: m.phone, message: m.message })),
      skipped,
      schedules: result.schedules
    };
    await audit(req, { action: 'mabrur.sync', entity: 'groups', entityId: groupId, newValues: summary });
    return summary;
  },

  /** Kredensial awal utk ditampilkan ke ops (distribusi manual) — per rombongan. */
  async groupCredentials(groupId: string) {
    const jamaahRows = await db('mabrur_credentials as c')
      .join('jamaah as j', 'j.id', 'c.subject_id')
      .join('registrations as r', 'r.jamaah_id', 'j.id')
      .where('c.subject_type', 'jamaah')
      .where('r.group_id', groupId)
      .select('c.phone', 'c.initial_password_enc', 'c.synced_at', 'j.full_name as name');
    const staffRows = await db('mabrur_credentials as c')
      .join('group_staff as s', 's.id', 'c.subject_id')
      .where('c.subject_type', 'staff')
      .where('s.group_id', groupId)
      .select('c.phone', 'c.initial_password_enc', 'c.synced_at', 's.staff_name as name');
    return [...staffRows, ...jamaahRows].map((r) => ({
      name: r.name,
      phone: r.phone,
      initialPassword: decrypt(r.initial_password_enc),
      syncedAt: r.synced_at
    }));
  },

  /** Kredensial utk portal jamaah (dipanggil dari portal.service). */
  async credentialForJamaah(jamaahId: string) {
    const row = await db('mabrur_credentials')
      .where({ subject_type: 'jamaah', subject_id: jamaahId })
      .first();
    if (!row) return null;
    return {
      phone: row.phone as string,
      initialPassword: decrypt(row.initial_password_enc),
      appUrl: 'https://mabrur.sosmartpro.com',
      syncedAt: row.synced_at as string
    };
  },

  /** Proxy status lapangan (dipakai Fase I4, disiapkan di sini). */
  async groupFieldStatus(groupId: string) {
    const group = await db('groups').where({ id: groupId }).first();
    if (!group) throw errors.notFound('Rombongan tidak ditemukan');
    if (!group.mabrur_synced_at) throw errors.badRequest('Rombongan belum disinkron ke Mabrur');
    return callMabrur(`/integrations/safar/groups/${groupId}/status`);
  }
};
