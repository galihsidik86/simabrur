import type { Knex } from 'knex';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Seed M1+M2 — katalog paket & jamaah persis "benang merah" mockup:
 * Hj. Siti Rohmah / UMR-2026-0418 / Umrah Plus Turki 20 Agu 2026 / Grup B / Triple 511.
 */
export async function seed(knex: Knex): Promise<void> {
  // Penghapusan tabel dilakukan global di 001_system.ts

  // ---- Hotel & maskapai (dari kartu paket mockup) ----
  const hotels = await knex('hotels')
    .insert([
      { name: "Zowar Int'l", city: 'Makkah', star: 3 },
      { name: 'Grand Makkah', city: 'Makkah', star: 4 },
      { name: 'Fairmont', city: 'Makkah', star: 5 },
      { name: 'Hilton Suites', city: 'Makkah', star: 5 },
      { name: 'Movenpick', city: 'Madinah', star: 4 },
      { name: 'Dar Al Eiman', city: 'Madinah', star: 3 }
    ])
    .returning('*');
  const airlines = await knex('airlines')
    .insert([
      { name: 'Saudia', iata_code: 'SV' },
      { name: 'Turkish Air', iata_code: 'TK' },
      { name: 'Emirates', iata_code: 'EK' },
      { name: 'Royal Jordanian', iata_code: 'RJ' },
      { name: 'Lion Air', iata_code: 'JT' }
    ])
    .returning('*');
  const hotel = (n: string) => hotels.find((h) => h.name === n)!.id;
  const airline = (n: string) => airlines.find((a) => a.name === n)!.id;

  // ---- Paket (6 kartu mockup) + jadwal + komponen HPP ----
  const pkgDefs = [
    { code: 'UMR-REG-9', name: 'Reguler 9 Hari', type: 'umrah', category: 'reguler', duration: 9, price: 28_500_000, hotel: "Zowar Int'l", airline: 'Saudia', depart: '2026-08-12', quota: 45, taken: 45 },
    { code: 'UMR-PLUS-TR', name: 'Plus Turki', type: 'umrah', category: 'plus', duration: 13, price: 39_900_000, hotel: 'Grand Makkah', airline: 'Turkish Air', depart: '2026-08-20', quota: 40, taken: 34 },
    { code: 'UMR-VIP-12', name: 'VIP 12 Hari', type: 'umrah', category: 'vip', duration: 12, price: 62_000_000, hotel: 'Fairmont', airline: 'Emirates', depart: '2026-09-03', quota: 24, taken: 18 },
    { code: 'HAJ-FURODA-27', name: 'Furoda 2027', type: 'haji', category: 'khusus', duration: 25, price: 245_000_000, hotel: 'Hilton Suites', airline: 'Saudia', depart: '2027-05-28', quota: 20, taken: 12 },
    { code: 'UMR-PLUS-AQ', name: 'Plus Aqsa', type: 'umrah', category: 'plus', duration: 12, price: 44_500_000, hotel: 'Movenpick', airline: 'Royal Jordanian', depart: '2026-10-15', quota: 40, taken: 9 },
    { code: 'UMR-REG-AT', name: 'Reguler Akhir Tahun', type: 'umrah', category: 'reguler', duration: 9, price: 31_000_000, hotel: 'Dar Al Eiman', airline: 'Lion Air', depart: '2026-12-26', quota: 45, taken: 21 }
  ] as const;

  const departureIds: Record<string, string> = {};
  for (const p of pkgDefs) {
    const [pkg] = await knex('packages')
      .insert({
        code: p.code,
        name: p.name,
        type: p.type,
        category: p.category,
        duration_days: p.duration,
        base_price: p.price,
        hotel_id: hotel(p.hotel),
        airline_id: airline(p.airline)
      })
      .returning('*');

    // Komponen HPP ±74% dari harga (proporsi contoh Chart of Accounts: hotel 10/22, tiket 9/22, visa 3/22)
    const hpp = Math.round(p.price * 0.74);
    await knex('package_costs').insert([
      { package_id: pkg.id, component: 'Tiket Maskapai', amount: Math.round(hpp * 0.38) },
      { package_id: pkg.id, component: 'Hotel & Akomodasi', amount: Math.round(hpp * 0.4) },
      { package_id: pkg.id, component: 'Visa', amount: Math.round(hpp * 0.1) },
      { package_id: pkg.id, component: 'Katering / Konsumsi', amount: Math.round(hpp * 0.05) },
      { package_id: pkg.id, component: 'Transportasi & Handling', amount: Math.round(hpp * 0.04) },
      { package_id: pkg.id, component: 'Muthawwif / Tour Leader', amount: Math.round(hpp * 0.02) },
      { package_id: pkg.id, component: 'Perlengkapan Jamaah', amount: Math.round(hpp * 0.01) }
    ]);

    const departDate = new Date(p.depart);
    const returnDate = new Date(departDate);
    returnDate.setDate(returnDate.getDate() + p.duration);
    const [dep] = await knex('departures')
      .insert({
        package_id: pkg.id,
        departure_date: p.depart,
        return_date: returnDate.toISOString().slice(0, 10),
        quota: p.quota,
        seats_taken: p.taken,
        status: 'open'
      })
      .returning('*');
    departureIds[p.code] = dep.id;
  }

  // ---- Rombongan Plus Turki (Grup A & B, mockup operasional/portal) ----
  const [grupA] = await knex('groups')
    .insert({ departure_id: departureIds['UMR-PLUS-TR'], name: 'Grup A', capacity: 20 })
    .returning('*');
  const [grupB] = await knex('groups')
    .insert({ departure_id: departureIds['UMR-PLUS-TR'], name: 'Grup B', capacity: 20 })
    .returning('*');

  // ---- Jamaah + registrasi + dokumen ----
  // File dokumen contoh untuk seed (agar tautan tidak 404)
  const uploadDir = path.resolve(__dirname, '../../../uploads/seed');
  fs.mkdirSync(uploadDir, { recursive: true });
  const seedFile = path.join(uploadDir, 'contoh-dokumen.pdf');
  if (!fs.existsSync(seedFile)) {
    fs.writeFileSync(seedFile, '%PDF-1.4\n% Dokumen contoh seed Safar\n%%EOF\n');
  }
  const FILE = '/uploads/seed/contoh-dokumen.pdf';

  type DocState = 'verified' | 'pending' | 'rejected' | null; // null = belum diunggah
  interface JRow {
    reg: string | null;
    name: string;
    gender: 'L' | 'P';
    birth: string;
    city: string;
    pkg: string;
    scheme: 'dp' | 'cicil' | 'lunas';
    // [KTP, KK, PPR, FTO, VKS, NKH]
    docs: DocState[];
    passport?: [string, string]; // [no, expiry]
    room?: ['quad' | 'triple' | 'double', string | null];
    group?: string | null;
    mahram?: [string, string];
    status?: 'pending_documents' | 'active';
  }

  const J: JRow[] = [
    { reg: 'UMR-2026-0402', name: 'Ahmad Zaki', gender: 'L', birth: '1983-03-11', city: 'Jakarta', pkg: 'UMR-REG-9', scheme: 'cicil', docs: ['verified', 'verified', 'verified', 'verified', 'verified', null], passport: ['C3310881', '2028-06-15'], room: ['quad', null], status: 'active' },
    { reg: 'UMR-2026-0412', name: 'H. Ahmad Fauzi', gender: 'L', birth: '1972-02-10', city: 'Jakarta', pkg: 'UMR-REG-9', scheme: 'lunas', docs: ['verified', 'verified', 'verified', 'verified', 'verified', null], passport: ['C4821094', '2028-02-12'], room: ['double', '402'], status: 'active' },
    { reg: 'UMR-2026-0418', name: 'Hj. Siti Rohmah', gender: 'P', birth: '1977-05-21', city: 'Bekasi', pkg: 'UMR-PLUS-TR', scheme: 'cicil', docs: ['verified', 'verified', 'verified', 'verified', null, 'verified'], passport: ['C5120388', '2027-09-30'], room: ['triple', '511'], group: grupB.id, mahram: ['H. Bambang Suryo', 'Suami'], status: 'pending_documents' },
    { reg: 'UMR-2026-0421', name: 'Budi Santoso', gender: 'L', birth: '1988-08-02', city: 'Depok', pkg: 'UMR-VIP-12', scheme: 'cicil', docs: ['verified', 'verified', 'pending', 'verified', 'pending', null], passport: ['B9042175', '2026-11-05'], room: ['triple', null], status: 'pending_documents' },
    { reg: 'UMR-2026-0425', name: 'Dewi Lestari', gender: 'P', birth: '1995-01-17', city: 'Tangerang', pkg: 'UMR-REG-9', scheme: 'dp', docs: ['verified', 'verified', 'rejected', 'pending', 'verified', null], passport: ['C0281734', '2026-10-01'], room: ['quad', null], mahram: ['Slamet Riyadi', 'Suami'], status: 'pending_documents' },
    { reg: 'UMR-2026-0429', name: 'Hj. Maryam Zahra', gender: 'P', birth: '1971-12-03', city: 'Jakarta', pkg: 'UMR-VIP-12', scheme: 'cicil', docs: ['verified', 'verified', 'verified', 'verified', 'verified', null], passport: ['C4419087', '2027-01-14'], room: ['quad', '517'], status: 'active' },
    { reg: 'UMR-2026-0430', name: 'Nur Aini', gender: 'P', birth: '1982-04-09', city: 'Bogor', pkg: 'UMR-PLUS-AQ', scheme: 'dp', docs: ['verified', 'pending', 'pending', 'verified', 'pending', null], passport: ['C6621043', '2029-03-18'], room: ['quad', '517'], mahram: ['H. Utsman', 'Suami'], status: 'pending_documents' },
    { reg: 'UMR-2026-0433', name: 'Rahmat Hidayat', gender: 'L', birth: '1999-06-25', city: 'Jakarta', pkg: 'UMR-REG-9', scheme: 'cicil', docs: ['verified', 'verified', 'verified', 'verified', 'pending', null], passport: ['C7710922', '2028-07-22'], room: ['triple', '511'], status: 'pending_documents' },
    { reg: 'HAJ-2027-0033', name: 'H. Sulaiman Yusuf', gender: 'L', birth: '1965-09-30', city: 'Jakarta', pkg: 'HAJ-FURODA-27', scheme: 'lunas', docs: ['verified', 'verified', 'verified', 'verified', 'verified', null], passport: ['C2209118', '2030-04-02'], room: ['double', null], status: 'active' },
    // Rombongan Plus Turki lain (matriks dokumen mockup Laporan Operasional)
    { reg: 'UMR-2026-0436', name: 'H. Bambang Suryo', gender: 'L', birth: '1974-11-08', city: 'Bekasi', pkg: 'UMR-PLUS-TR', scheme: 'cicil', docs: ['verified', 'verified', 'verified', 'verified', 'verified', 'verified'], passport: ['C5120401', '2028-01-20'], room: ['triple', '511'], group: grupB.id, status: 'active' },
    { reg: 'UMR-2026-0437', name: 'Ir. Hendra Wijaya', gender: 'L', birth: '1969-07-14', city: 'Jakarta', pkg: 'UMR-PLUS-TR', scheme: 'cicil', docs: ['verified', 'verified', 'rejected', 'verified', null, null], passport: ['B8830271', '2026-12-30'], room: ['double', '402'], group: grupA.id, status: 'pending_documents' },
    { reg: 'UMR-2026-0438', name: 'Hj. Aisyah Putri', gender: 'P', birth: '1980-02-28', city: 'Depok', pkg: 'UMR-PLUS-TR', scheme: 'lunas', docs: ['verified', 'verified', 'verified', 'verified', 'verified', 'verified'], passport: ['C6108852', '2029-08-11'], room: ['quad', '517'], group: grupA.id, mahram: ['Ir. Hendra Wijaya', 'Suami'], status: 'active' },
    { reg: 'UMR-2026-0439', name: 'Slamet Riyadi', gender: 'L', birth: '1978-10-19', city: 'Tangerang', pkg: 'UMR-PLUS-TR', scheme: 'cicil', docs: ['verified', 'verified', 'verified', null, null, 'verified'], passport: ['C1174902', '2028-09-05'], room: ['quad', '517'], group: grupA.id, status: 'pending_documents' },
    { reg: 'UMR-2026-0440', name: 'Dra. Kartini', gender: 'P', birth: '1966-04-21', city: 'Jakarta', pkg: 'UMR-PLUS-TR', scheme: 'lunas', docs: ['verified', 'verified', 'verified', 'verified', 'verified', 'verified'], passport: ['C3391045', '2029-02-17'], room: ['double', '402'], group: grupB.id, status: 'active' }
  ];

  const DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'] as const;
  let nikCounter = 3175012345670001n;

  for (const j of J) {
    const [jamaah] = await knex('jamaah')
      .insert({
        nik: String(nikCounter++),
        full_name: j.name,
        gender: j.gender,
        birth_place: j.city,
        birth_date: j.birth,
        phone: '0812-2200-0' + String(nikCounter % 1000n).padStart(3, '0'),
        email: null,
        address: `Jl. Contoh No. ${Number(nikCounter % 90n) + 1}, ${j.city}`,
        emergency_contact_name: j.mahram?.[0] ?? 'Keluarga ' + j.name.split(' ').pop(),
        emergency_contact_phone: '0813-9900-0' + String(nikCounter % 1000n).padStart(3, '0'),
        passport_no: j.passport?.[0] ?? null,
        passport_expiry: j.passport?.[1] ?? null,
        mahram_name: j.mahram?.[0] ?? null,
        mahram_relation: j.mahram?.[1] ?? null
      })
      .returning('*');

    await knex('registrations').insert({
      reg_number: j.reg,
      jamaah_id: jamaah.id,
      departure_id: departureIds[j.pkg],
      group_id: j.group ?? null,
      room_type: j.room?.[0] ?? 'quad',
      room_number: j.room?.[1] ?? null,
      payment_scheme: j.scheme,
      source: 'seed',
      status: j.status ?? 'pending_documents'
    });

    const docRows = j.docs
      .map((state, i) => ({ state, type: DOC_TYPES[i] }))
      .filter((d) => d.state !== null)
      .map((d) => ({
        jamaah_id: jamaah.id,
        doc_type: d.type,
        file_url: FILE,
        status: d.state as string,
        verified_at: d.state === 'verified' ? knex.fn.now() : null,
        note: d.state === 'rejected' ? 'Dokumen buram / paspor perlu diperpanjang' : null
      }));
    if (docRows.length) await knex('documents').insert(docRows);
  }

  // Nomor lanjutan agar registrasi baru tidak bentrok dengan seed
  await knex('numbering_sequences').insert([
    { key: 'UMR-2026', next_value: 500 },
    { key: 'HAJ-2027', next_value: 50 }
  ]);
}
