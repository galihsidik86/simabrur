import type { Request } from 'express';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { passportExpiringSoon, readinessLevel, readinessScore } from './operations.rules.js';

const REQUIRED_DOCS = ['KTP', 'KK', 'PPR', 'FTO', 'VKS'];
const ALL_DOCS = [...REQUIRED_DOCS, 'NKH'];

export const operationsService = {
  /** Manifest keberangkatan — data untuk pengajuan visa & maskapai (mockup Operasional). */
  async manifest(departureId: string) {
    const dep = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('d.*', 'p.name as package_name')
      .where('d.id', departureId)
      .first();
    if (!dep) throw errors.notFound('Keberangkatan tidak ditemukan');

    const groups = await db('groups').where({ departure_id: departureId }).orderBy('name');
    const staff = groups.length
      ? await db('group_staff').whereIn('group_id', groups.map((g) => g.id))
      : [];

    const rows = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .leftJoin('groups as g', 'g.id', 'r.group_id')
      .leftJoin('visas as v', 'v.registration_id', 'r.id')
      .leftJoin('tickets as t', 't.registration_id', 'r.id')
      .select(
        'r.id as registration_id', 'r.reg_number', 'r.room_type', 'r.room_number', 'r.group_id',
        'j.full_name', 'j.passport_no', 'j.passport_expiry',
        'g.name as group_name',
        'v.id as visa_id', 'v.status as visa_status', 'v.visa_no',
        't.id as ticket_id', 't.pnr', 't.seat', 't.status as ticket_status'
      )
      .where('r.departure_id', departureId)
      .orderBy('j.full_name');

    const manifest = await db('manifests').where({ departure_id: departureId }).first();
    const roomLabel: Record<string, string> = { quad: 'Quad', triple: 'Triple', double: 'Double' };
    const memberCounts: any[] = await db('registrations')
      .select('group_id')
      .count({ n: '*' })
      .where('departure_id', departureId)
      .whereNotNull('group_id')
      .groupBy('group_id');
    const countOf = (gid: string) => Number(memberCounts.find((m) => m.group_id === gid)?.n ?? 0);

    return {
      departure: {
        id: dep.id, packageName: dep.package_name, departureDate: dep.departure_date,
        returnDate: dep.return_date, quota: dep.quota, seatsTaken: dep.seats_taken
      },
      manifestStatus: manifest?.status ?? 'draft',
      groups: groups.map((g) => ({
        id: g.id, name: g.name, capacity: g.capacity,
        memberCount: countOf(g.id),
        mabrurGroupId: g.mabrur_group_id ?? null,
        mabrurSyncedAt: g.mabrur_synced_at ?? null,
        staff: staff
          .filter((s) => s.group_id === g.id)
          .map((s) => ({ id: s.id, staffName: s.staff_name, role: s.role, phone: s.phone ?? null })),
        muthawwif: staff.filter((s) => s.group_id === g.id && s.role === 'muthawwif').map((s) => s.staff_name),
        tourLeader: staff.filter((s) => s.group_id === g.id && s.role === 'tour_leader').map((s) => s.staff_name)
      })),
      rows: rows.map((r) => ({
        registrationId: r.registration_id,
        regNumber: r.reg_number,
        groupId: r.group_id ?? null,
        name: r.full_name,
        passportNo: r.passport_no,
        passportExpiry: r.passport_expiry,
        passportExpiringSoon: passportExpiringSoon(r.passport_expiry, dep.departure_date),
        groupName: r.group_name,
        visa: { id: r.visa_id, status: r.visa_status ?? 'process', visaNo: r.visa_no },
        ticket: { id: r.ticket_id, pnr: r.pnr, seat: r.seat, status: r.ticket_status ?? 'pending' },
        room: r.room_number ? `${roomLabel[r.room_type]} ${r.room_number}` : roomLabel[r.room_type]
      }))
    };
  },

  /** Upsert status visa per registrasi (POST /visas). */
  async upsertVisa(req: Request, input: { registrationId: string; status: 'process' | 'biometric' | 'issued'; visaNo?: string | null }) {
    const reg = await db('registrations').where({ id: input.registrationId }).first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
    const [visa] = await db('visas')
      .insert({
        registration_id: input.registrationId,
        status: input.status,
        visa_no: input.visaNo ?? null,
        biometric_at: input.status !== 'process' ? db.fn.now() : null,
        issued_at: input.status === 'issued' ? db.fn.now() : null
      })
      .onConflict('registration_id')
      .merge({
        status: input.status,
        visa_no: input.visaNo ?? null,
        biometric_at: input.status !== 'process' ? db.fn.now() : null,
        issued_at: input.status === 'issued' ? db.fn.now() : null,
        updated_at: db.fn.now()
      })
      .returning('*');
    await audit(req, { action: 'visas.upsert', entity: 'visas', entityId: visa.id, newValues: input });
    return visa;
  },

  /** Upsert tiket (PNR) per registrasi (POST /tickets). */
  async upsertTicket(req: Request, input: { registrationId: string; pnr: string; seat?: string | null }) {
    const reg = await db('registrations').where({ id: input.registrationId }).first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
    const [ticket] = await db('tickets')
      .insert({ registration_id: input.registrationId, pnr: input.pnr, seat: input.seat ?? null, status: 'issued', issued_at: db.fn.now() })
      .onConflict('registration_id')
      .merge({ pnr: input.pnr, seat: input.seat ?? null, status: 'issued', issued_at: db.fn.now(), updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'tickets.upsert', entity: 'tickets', entityId: ticket.id, newValues: input });
    return ticket;
  },

  async assignGroupStaff(req: Request, input: { groupId: string; staffName: string; role: 'muthawwif' | 'tour_leader'; phone?: string | null }) {
    const group = await db('groups').where({ id: input.groupId }).first();
    if (!group) throw errors.notFound('Rombongan tidak ditemukan');
    const [row] = await db('group_staff')
      .insert({ group_id: input.groupId, staff_name: input.staffName, role: input.role, phone: input.phone ?? null })
      .onConflict(['group_id', 'role', 'staff_name'])
      .merge({ phone: input.phone ?? null, updated_at: db.fn.now() })
      .returning('*');
    await audit(req, { action: 'group_staff.assign', entity: 'group_staff', entityId: row?.id, newValues: input });
    return row;
  },

  async updateGroupStaff(req: Request, id: string, input: { staffName?: string; phone?: string | null }) {
    const before = await db('group_staff').where({ id }).first();
    if (!before) throw errors.notFound('Petugas tidak ditemukan');
    const [row] = await db('group_staff')
      .where({ id })
      .update({
        ...(input.staffName !== undefined && { staff_name: input.staffName }),
        ...(input.phone !== undefined && { phone: input.phone }),
        updated_at: db.fn.now()
      })
      .returning('*');
    await audit(req, { action: 'group_staff.update', entity: 'group_staff', entityId: id, oldValues: { staffName: before.staff_name, phone: before.phone }, newValues: input });
    return row;
  },

  /** Buat rombongan baru pada sebuah keberangkatan. */
  async createGroup(req: Request, input: { departureId: string; name: string; capacity: number }) {
    const dep = await db('departures').where({ id: input.departureId }).first();
    if (!dep) throw errors.notFound('Keberangkatan tidak ditemukan');
    const dup = await db('groups').where({ departure_id: input.departureId, name: input.name }).first();
    if (dup) throw errors.conflict(`Rombongan "${input.name}" sudah ada pada keberangkatan ini`);
    const [group] = await db('groups')
      .insert({ departure_id: input.departureId, name: input.name, capacity: input.capacity })
      .returning('*');
    await audit(req, { action: 'groups.create', entity: 'groups', entityId: group.id, newValues: input });
    return group;
  },

  /** Tetapkan/lepaskan registrasi ke rombongan + nomor kamar. */
  async assignRegistration(req: Request, registrationId: string, input: { groupId?: string | null; roomNumber?: string | null }) {
    const reg = await db('registrations').where({ id: registrationId }).first();
    if (!reg) throw errors.notFound('Registrasi tidak ditemukan');
    if (input.groupId) {
      const group = await db('groups').where({ id: input.groupId }).first();
      if (!group) throw errors.notFound('Rombongan tidak ditemukan');
      if (group.departure_id !== reg.departure_id) {
        throw errors.badRequest('Rombongan bukan milik keberangkatan registrasi ini');
      }
    }
    const [updated] = await db('registrations')
      .where({ id: registrationId })
      .update({
        ...(input.groupId !== undefined && { group_id: input.groupId }),
        ...(input.roomNumber !== undefined && { room_number: input.roomNumber }),
        updated_at: db.fn.now()
      })
      .returning('*');
    await audit(req, {
      action: 'registrations.assign_group',
      entity: 'registrations',
      entityId: registrationId,
      oldValues: { groupId: reg.group_id, roomNumber: reg.room_number },
      newValues: input
    });
    return updated;
  },

  async checklists(registrationId: string) {
    return db('checklists').where({ registration_id: registrationId }).orderBy('created_at');
  },

  async toggleChecklist(req: Request, id: string, isDone: boolean) {
    const [row] = await db('checklists').where({ id }).update({ is_done: isDone, updated_at: db.fn.now() }).returning('*');
    if (!row) throw errors.notFound('Item checklist tidak ditemukan');
    await audit(req, { action: 'checklists.toggle', entity: 'checklists', entityId: id, newValues: { isDone } });
    return row;
  },

  /** Laporan Kepatuhan Dokumen (tab 2 mockup Laporan Operasional). */
  async documentCompliance(departureId?: string) {
    const regs = await db('registrations as r')
      .join('jamaah as j', 'j.id', 'r.jamaah_id')
      .join('departures as d', 'd.id', 'r.departure_id')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('r.id as registration_id', 'j.id as jamaah_id', 'j.full_name', 'j.passport_expiry',
        'd.id as departure_id', 'd.departure_date', 'p.name as package_name')
      .orderBy('d.departure_date');
    const docs = await db('documents');

    const docStatus = (jamaahId: string, type: string): 'ok' | 'no' | 'bad' => {
      const d = docs.find((x) => x.jamaah_id === jamaahId && x.doc_type === type);
      if (!d) return 'no';
      if (d.status === 'verified') return 'ok';
      if (d.status === 'rejected') return 'bad';
      return 'no';
    };

    // Tiles
    let complete = 0, pendingDocs = 0, passportIssues = 0;
    for (const r of regs) {
      const verified = REQUIRED_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'ok').length;
      if (verified >= REQUIRED_DOCS.length) complete++;
      if (passportExpiringSoon(r.passport_expiry, r.departure_date)) passportIssues++;
    }
    pendingDocs = docs.filter((d) => d.status === 'pending').length +
      regs.reduce((s, r) => s + REQUIRED_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'no').length, 0);

    // Per keberangkatan
    const byDeparture = new Map<string, typeof regs>();
    for (const r of regs) {
      if (!byDeparture.has(r.departure_id)) byDeparture.set(r.departure_id, []);
      byDeparture.get(r.departure_id)!.push(r);
    }
    const perDeparture = [...byDeparture.entries()].map(([depId, rows]) => {
      const totalReq = rows.length * REQUIRED_DOCS.length;
      const verified = rows.reduce((s, r) => s + REQUIRED_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'ok').length, 0);
      const badPassports = rows.filter((r) => passportExpiringSoon(r.passport_expiry, r.departure_date)).length;
      const rejected = rows.reduce((s, r) => s + ALL_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'bad').length, 0);
      return {
        departureId: depId,
        packageName: rows[0].package_name,
        departureDate: rows[0].departure_date,
        jamaahCount: rows.length,
        pct: totalReq ? Math.round((verified / totalReq) * 100) : 0,
        note: badPassports > 0 ? `${badPassports} paspor perlu perpanjangan` : rejected > 0 ? `${rejected} dokumen bermasalah` : 'lengkap'
      };
    });

    // Matriks per keberangkatan (bila diminta)
    let matrix = null;
    if (departureId) {
      const rows = byDeparture.get(departureId) ?? [];
      matrix = rows.map((r) => {
        const cells = ALL_DOCS.map((t) => ({ type: t, status: docStatus(r.jamaah_id, t) }));
        const missing = REQUIRED_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'no').length;
        const bad = ALL_DOCS.filter((t) => docStatus(r.jamaah_id, t) === 'bad').length;
        return {
          jamaahId: r.jamaah_id,
          name: r.full_name,
          cells,
          rowStatus: bad > 0 ? 'Perlu tindakan' : missing > 0 ? 'Belum lengkap' : 'Lengkap'
        };
      });
    }

    return {
      tiles: { complete, pendingDocs, passportIssues, totalActive: regs.length },
      perDeparture,
      matrix
    };
  },

  /** Laporan Kesiapan Keberangkatan (tab 3 mockup). */
  async readiness() {
    const deps = await db('departures as d')
      .join('packages as p', 'p.id', 'd.package_id')
      .select('d.*', 'p.name as package_name')
      .where('d.status', 'open')
      .orderBy('d.departure_date');

    const cards = [];
    for (const dep of deps) {
      const regs = await db('registrations as r')
        .join('jamaah as j', 'j.id', 'r.jamaah_id')
        .leftJoin('invoices as i', 'i.registration_id', 'r.id')
        .leftJoin(
          db('payments').select('invoice_id').sum('amount as paid').where('status', 'verified').groupBy('invoice_id').as('pp'),
          'pp.invoice_id', 'i.id'
        )
        .leftJoin('visas as v', 'v.registration_id', 'r.id')
        .leftJoin('tickets as t', 't.registration_id', 'r.id')
        .select('r.id', 'j.id as jamaah_id', 'i.total_amount', 'pp.paid', 'v.status as visa_status', 't.status as ticket_status')
        .where('r.departure_id', dep.id);
      if (regs.length === 0) continue;

      const totalInv = regs.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
      const totalPaid = regs.reduce((s, r) => s + Number(r.paid ?? 0), 0);
      const paymentPct = totalInv ? Math.round((totalPaid / totalInv) * 100) : 0;

      const jamaahIds = regs.map((r) => r.jamaah_id);
      const verifiedDocs = await db('documents')
        .whereIn('jamaah_id', jamaahIds)
        .where('status', 'verified')
        .whereNot('doc_type', 'NKH')
        .count({ n: '*' })
        .first();
      const documentPct = Math.round((Number(verifiedDocs?.n ?? 0) / (regs.length * REQUIRED_DOCS.length)) * 100);

      const visaIssued = regs.filter((r) => r.visa_status === 'issued').length;
      const ticketIssued = regs.filter((r) => r.ticket_status === 'issued').length;
      const metrics = { paymentPct, documentPct, visaIssued, ticketIssued, totalJamaah: regs.length };
      const score = readinessScore(metrics);
      const manifest = await db('manifests').where({ departure_id: dep.id }).first();

      const notes: string[] = [];
      if (manifest?.status === 'ready') notes.push('Manifest siap dikirim.');
      const visaPending = regs.length - visaIssued;
      if (visaPending > 0) notes.push(`${visaPending} visa dalam proses.`);
      const unpaidCount = regs.filter((r) => Number(r.paid ?? 0) < Number(r.total_amount ?? 0)).length;
      if (unpaidCount > 0) notes.push(`${unpaidCount} jamaah belum lunas.`);

      cards.push({
        departureId: dep.id,
        packageName: dep.package_name,
        departureDate: dep.departure_date,
        jamaahCount: regs.length,
        score,
        level: readinessLevel(score),
        metrics: { ...metrics, visaPct: Math.round((visaIssued / regs.length) * 100), ticketPct: Math.round((ticketIssued / regs.length) * 100) },
        manifestStatus: manifest?.status ?? 'draft',
        note: notes.join(' ')
      });
    }

    const totalVisa = cards.reduce((s, c) => s + c.metrics.visaIssued, 0);
    const totalJamaah = cards.reduce((s, c) => s + c.jamaahCount, 0);
    return {
      tiles: {
        activeDepartures: cards.length,
        visaIssued: totalVisa,
        visaTotal: totalJamaah,
        manifestReady: cards.filter((c) => c.manifestStatus === 'ready').length,
        manifestTotal: cards.length
      },
      cards
    };
  }
};
