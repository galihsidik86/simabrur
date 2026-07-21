# PLAN — Implementasi Full-Stack SIM Travel Haji & Umrah "Safar"

## Context

Repo berisi 11 mockup UI/UX (.dc.html, Claude Design) + dokumen spesifikasi (Handoff Developer, ERD 30 tabel, Chart of Accounts) untuk "Safar" — sistem manajemen travel Haji & Umrah PT Safar Barokah Wisata. Belum ada kode aplikasi. Tujuan: implementasi full-stack fungsional yang mempertahankan design system mockup 1:1, dikerjakan per fase dengan konfirmasi user setiap fase. **Langkah eksekusi pertama setelah approve: salin rencana ini menjadi `PLAN.md` di root repo** (plan mode melarang menulis ke repo sekarang).

Keputusan user (dikonfirmasi): **PostgreSQL via Docker** + **TypeScript** (backend & frontend).

## 1. Inventarisasi Mockup → Modul (lengkap, 11 file)

| Mockup | Screen/isi | Modul |
|---|---|---|
| Aplikasi Travel | Shell admin (sidebar gelap + header) + 7 view: Dashboard Eksekutif (4 KPI, chart arus kas vs pendapatan diakui, aging, profit/paket, keberangkatan mendatang), Paket (kartu + tab filter), Jamaah (tabel + badge 5 dokumen), Pembayaran (kartu piutang + 3 KPI), Keuangan (3 KPI liabilitas/pendapatan/laba, laba per cost center, feed jurnal), Operasional (manifest: paspor/visa/tiket/kamar), Marketing (kinerja agen & komisi) | Semua (shell utama) |
| Pendaftaran Jamaah | Wizard publik 6 langkah: Paket → Data Diri (10 field) → Dokumen (6 jenis upload + validasi paspor live) → Kamar & Mahram (quad/triple/double + upcharge) → Pembayaran (DP/Cicilan 6×/Lunas; VA/kartu/manual) → Konfirmasi (akad wakalah checkbox) + success screen dgn nomor registrasi | Jamaah & Pendaftaran |
| Portal Jamaah | Mobile app 5 tab: Beranda (countdown, progress dokumen/pembayaran, perlu-tindakan, rombongan), Bayar (jadwal termin + CTA), Dokumen (status verifikasi), Perjalanan (penerbangan, hotel, checklist perlengkapan), Profil (+ unduh invoice/kwitansi) | Portal Jamaah (role jamaah) |
| Invoice Kwitansi | Dokumen A4 2 halaman: INVOICE (line items, riwayat termin, VA BSI, instruksi akad) + KWITANSI (terbilang, stempel, catatan jurnal otomatis) | Pembayaran |
| Laporan Operasional | 3 tab: Piutang Aging (4 bucket), Kepatuhan Dokumen (progress per keberangkatan + matriks dokumen per jamaah), Kesiapan Keberangkatan (skor % dari pelunasan/dokumen/visa/tiket); ekspor Excel/PDF | Operasional / Laporan |
| Chart of Accounts | Dokumen cetak: 4 prinsip akuntansi, COA 7 kelas ~45 akun, 6 alur jurnal kunci (A–F), ringkasan laba per jamaah | Keuangan (spesifikasi) |
| Input Transaksi | 4 tipe transaksi (Terima Pembayaran/Pembayaran Biaya/Pengakuan Pendapatan/Pengakuan Komisi) + preview jurnal live panel gelap; multi-line biaya, valas + realisasi selisih kurs, kalkulator komisi | Keuangan & Akuntansi |
| Jurnal Rekonsiliasi | 2 tab: Jurnal Umum (filter sumber, 4 KPI, kartu jurnal JV + cost center) & Rekonsiliasi Bank (saldo buku vs koran, skedul penyesuaian, pencocokan mutasi) | Keuangan & Akuntansi |
| Laporan Keuangan | 3 tab: Laba Rugi, Neraca (balance check), Laba Rugi per Paket (cost center); ekspor | Laporan |
| ERD Sistem Travel | 30 tabel / 7 modul, relasi FK crow's foot | Spesifikasi DB |
| Handoff Developer | Stack, struktur folder, konvensi API, endpoint per modul, RBAC 6 role, roadmap | Spesifikasi teknis |

**Benang merah data demo** (konsisten lintas mockup — jadi dasar seed): Hj. Siti Rohmah / UMR-2026-0418 / Umrah Plus Turki 20 Agu 2026 / Grup B / Triple 511 / termin DP 5,0 + 11,9 + 11,8 + 11,2 = Rp 39,9 Jt / INV/2026/06/0418 / KWT/2026/06/1183. Katalog paket: Umrah Reguler 28,5 Jt, Plus Turki 39,9 Jt, VIP 62 Jt, Haji Furoda 245 Jt (+ Plus Aqsa 44,5 Jt, Reguler Akhir Tahun 31 Jt).

## 2. Design tokens (ekstrak → `frontend/src/styles/tokens.css` @theme Tailwind v4)

- Surface: bg `#efe8da`, card `#fffdf8`, panel `#faf7f0`, thead `#f6f1e6`; border `#e9e0cd`/`#e6ddca`/`#eee5d3`; input border `#d9cfb9`, focus ring `0 0 0 3px oklch(0.92 0.04 165)`
- Teks: `#2c281f`/`#26221b`; muted `#6f6858`/`#8c8371`/`#9a917d`/`#a89e88`
- Sidebar/panel gelap: gradient `#16211b→#1b2a20`
- Primary action: `oklch(0.5 0.09 165)`; gold: `oklch(0.56 0.11 78)` & `oklch(0.62 0.11 78)`; danger `oklch(0.55 0.15 28)`; sukses `oklch(0.46 0.07 158)`
- Aksen modul: dashboard emas 78, paket hijau 165, jamaah biru 245, pembayaran 78, operasional oranye 45, marketing ungu 322, keuangan 158, sistem slate 265
- Skala warna kelas akun (dipakai konsisten COA/jurnal/input): 1-Aset 165, 2-Liabilitas 245, 3-Ekuitas 265, 4-Pendapatan 158, 5-HPP 78, 6-Beban 45, 7-Lain 322
- Font: Marcellus (heading), Plus Jakarta Sans (body), JetBrains Mono (angka/kode); radius kartu 12–15px, kontrol 9px, pill 20px; shadow `0 4px 16px -10px rgba(60,50,20,0.3)`
- Format angka `id-ID`, ringkas "Jt"/"M"; negatif akuntansi `(Rp …)` merah

## 3. Skema data — ERD 30 tabel + tambahan yang dibutuhkan mockup

ERD (per modul): packages, departures, package_costs, hotels, airlines · jamaah, registrations, documents, groups · invoices, payment_schedules, payments · manifests, visas, tickets, group_staff, checklists · agents, leads, commissions · accounts, journals, journal_lines, cost_centers, vendors, vendor_bills, bank_accounts · users, branches, roles, audit_logs.

**Gap skema (mockup butuh, ERD belum ada — ditambahkan di migrasi):**
- Kolom jamaah: gender, birth_place/date, phone, email, address, emergency_contact_{name,phone} (wizard step 2); doc_type NKH (buku nikah, opsional)
- Kolom registrations: payment_scheme (dp/cicil/lunas), room_type sudah ada; room_number (Triple 511)
- Tabel `receipts` (kwitansi KWT/YYYY/MM/NNNN — terpisah dari invoice, per pembayaran, dgn terbilang)
- Tabel `exchange_rates` (kurs harian IDR/USD/SAR) + kolom kurs pada journals/payments
- Tabel `bank_statement_lines` + `reconciliations` (pencocokan mutasi di mockup Jurnal Rekonsiliasi)
- Tabel `refresh_tokens`; `numbering_sequences` (UMR/HAJ/JV/INV/KWT per tahun/bulan)
- journal_lines: simpan debit/credit dalam IDR (fungsional) + amount_foreign & currency opsional

## 4. Aturan bisnis kritis (sumber: COA doc + mockup, WAJIB benar)

1. Penerimaan jamaah → **Dr Bank/Kas, Cr 2-1100 Uang Muka Jamaah** (liabilitas, akad wakalah/ijarah) — BUKAN pendapatan
2. Pengakuan pendapatan saat keberangkatan (PSAK 72): **Dr 2-1100, Cr 4-1000/4-2000**; HPP bersamaan: **Dr 5-xxxx (per komponen), Cr 1-1400 Uang Muka Vendor**
3. DP vendor: **Dr 1-1400, Cr Bank**; komisi agen (default 3%): **Dr 6-2000, Cr 2-1400 Hutang Komisi**
4. Valas: bank 1-1200 IDR / 1-1210 USD / 1-1220 SAR; jurnal dicatat IDR memakai kurs; realisasi selisih kurs saat pelunasan hutang → **7-1000**
5. Setiap keberangkatan = cost center; laba per paket = agregasi cost center
6. Setiap journal HARUS balance (Σdebit=Σkredit) — dijaga constraint DB + service + test
7. Validasi: paspor berlaku ≥ 7 bulan setelah tanggal keberangkatan; perempuan < 45 th wajib mahram; kuota keberangkatan real-time
8. Penomoran: `UMR-2026-0418`/`HAJ-2027-0033`, `JV-2026-0614`, `INV/2026/06/0418`, `KWT/2026/06/1183`, VA `8801 0418 0000 0418`
9. Termin cicilan = DP + 5 termin bulanan; aging: belum tempo / 1–30 / 31–60 / >60 hari
10. Kwitansi wajib terbilang; audit log untuk semua mutasi keuangan & data sensitif
11. Seed COA lengkap ~45 akun 7 kelas persis seperti Chart of Accounts.dc.html

## 5. Gap analysis — screen yang belum ada di mockup (dibuat mengikuti design system, TIDAK mengubah desain yang ada)

- Login (semua role) — pakai palet sidebar gelap + gold
- CRUD form: paket + komponen HPP, jadwal keberangkatan, hotel/maskapai, vendor, agen, bank account
- Detail jamaah (admin) + aksi verifikasi dokumen per file (matriks di Laporan Operasional hanya read-only)
- Form jurnal manual (tombol "+ Jurnal Manual" ada, formnya belum)
- Buku besar per akun (endpoint `/ledger/:code` ada di handoff, screen belum)
- Admin user/role/cabang + audit log viewer
- Manajemen rombongan & penugasan muthawwif/TL, input visa/tiket (manifest mockup read-only)
- Notifikasi/reminder WA & email + payment gateway → **stub/log adapter** (interface disiapkan, integrasi nyata di luar scope awal, dicatat di PLAN.md)

## 6. Stack teknis (keputusan + alasan)

- **Backend**: Node.js 24 + Express 5 + **TypeScript**, modular monolith persis struktur Handoff (`src/modules/<modul>/{routes,controller,service,repository,validation}`), Zod (validasi), jsonwebtoken (JWT access+refresh), middleware auth/rbac/audit/error. Alasan: sesuai spesifikasi Handoff; TS untuk keamanan tipe logika akuntansi.
- **DB**: **PostgreSQL 16 via docker-compose** + **Knex** (migration + seed + query builder). Alasan Knex vs Prisma: laporan akuntansi butuh agregasi SQL bebas (ledger, neraca, aging) dan file migrasi eksplisit yang diminta user.
- **Frontend**: React 18 + Vite + **Tailwind CSS v4** (token via `@theme` CSS variables), react-router, TanStack Query, axios. Dokumen cetak (invoice/kwitansi) = route React + print CSS (`@page`), ekspor PDF via print browser; ekspor Excel via SheetJS/xlsx di server.
- **Test**: Vitest + supertest (fokus: service akuntansi — balance, kurs, PSAK 72, penomoran, aging).
- **Struktur**: npm workspaces `backend/` + `frontend/` (monorepo per Handoff), root `docker-compose.yml`, `README.md`.

## 7. Fase implementasi (urutan sesuai permintaan user; tiap fase: migrasi → API+test → UI → seed → jalankan → ringkasan → BERHENTI konfirmasi)

**Fase 1 — Fondasi + Auth/RBAC + Design Token**
Monorepo, docker-compose (Postgres), Knex setup, migrasi M7 (users/branches/roles/audit_logs/refresh_tokens), auth JWT + RBAC middleware (6 role) + audit middleware, envelope `{success,data,meta}` + error handler, seed admin & cabang; frontend: Vite+Tailwind+token, screen Login, shell layout (sidebar+header identik mockup), routing guard per role. Test: auth flow, RBAC.

**Fase 2 — Paket & Jamaah**
Migrasi M1+M2 (+kolom tambahan §3), API packages/departures/package_costs/hotels/airlines + jamaah/registrations/documents/groups; upload dokumen (multer, storage lokal `uploads/`), verifikasi dokumen; validasi paspor ≥7 bln & mahram & kuota; penomoran registrasi. UI: view Paket (kartu+tab), Jamaah (tabel+badge dokumen), wizard Pendaftaran publik 6 langkah + success, CRUD paket, detail jamaah + verifikasi. Seed: 6 paket + ~20 jamaah termasuk golden thread.

**Fase 3 — Pembayaran**
Migrasi M3 + receipts + numbering; API invoices/payment_schedules/payments (Idempotency-Key), generator jadwal termin (DP+5), kwitansi + terbilang, aging. Transaksi pembayaran dicatat & siap-jurnal (posting penuh aktif Fase 5). UI: view Pembayaran (kartu piutang+KPI), invoice & kwitansi printable A4, tab Bayar portal (nanti Fase 6 utk portal penuh — di fase ini cukup dokumen + admin). Seed: termin golden thread persis mockup.

**Fase 4 — Operasional & Manifest**
Migrasi M4; API manifests/visas/tickets/group_staff/checklists; UI: view Operasional (manifest), Laporan Operasional 3 tab (aging/kepatuhan/kesiapan) + skor kesiapan, input visa/tiket/rombongan. Ekspor Excel.

**Fase 5 — Keuangan & Akuntansi** (inti)
Migrasi M6 + exchange_rates + bank_statement_lines/reconciliations; seed COA ~45 akun; **journal engine**: template A–F, balance enforcement, cost center, valas + selisih kurs 7-1000, posting retroaktif transaksi Fase 3–4; API accounts/transactions(4 tipe)/journals(manual)/ledger/bank-reconciliations. UI: COA, Input Transaksi (4 form + preview jurnal live), Jurnal Umum + Rekonsiliasi Bank, view Keuangan di shell, buku besar. Test paling ketat di sini.

**Fase 6 — Dashboard, Laporan & Portal Jamaah**
API reports (income-statement, balance-sheet, profit-by-package, document-compliance, export); UI: Dashboard Eksekutif (chart), Laporan Keuangan 3 tab, Portal Jamaah mobile 5 tab (login jamaah), audit log viewer, admin user/role.

**Fase 7 — Agen & Komisi**
Migrasi M5; API agents/leads/commissions + approve→posting jurnal komisi; UI: view Marketing, CRUD agen + kode referral, sumber `agent:BRKH-07` di wizard.

## 8. Verifikasi (tiap fase)

1. `docker compose up -d db` → `npm run migrate && npm run seed` → `npm run dev` (backend :3001, frontend :5173) — harus jalan tanpa error
2. `npm test` — unit service (akuntansi: setiap jurnal balance, reclass PSAK 72 benar, selisih kurs, penomoran, aging bucket) + supertest endpoint utama
3. Uji manual flow fase tsb di browser dgn seed golden thread (mis. Fase 3: buka invoice UMR-2026-0418 → angka = mockup: total 39,9 Jt, terbayar 28,7 Jt, sisa 11,2 Jt)
4. Cek visual vs mockup .dc.html berdampingan (token & layout harus sama)
5. README diperbarui per fase (install, migrate, seed, run)

## 9. Batasan yang dijaga (permintaan user)

- JANGAN mengubah visual/branding mockup; screen baru mengikuti design system §2
- JANGAN menambah fitur di luar scope tanpa mencatat di PLAN.md dulu
- Per fase selesai utuh + teruji → berhenti → minta konfirmasi user sebelum fase berikutnya

## 10. Catatan fitur pasca-fase (atas permintaan user)

- **2026-07-20 — Pencarian global & lonceng header difungsikan.** Di mockup keduanya elemen dekoratif; atas laporan user ("field pencarian tidak bisa diisi, tombol di sebelahnya tidak berfungsi") dibangun: `GET /v1/search` (jamaah/paket/invoice, ILIKE, 5 hasil per kategori, role staf) + `GET /v1/search/notifications` (dokumen & pembayaran menunggu verifikasi) dan dropdown hasil/lonceng di `AppShell` mengikuti design token yang ada. Visual field & tombol tidak berubah.
- Fitur pasca-fase lain: `PATCH /v1/jamaah/:id` (edit profil oleh operasional, tercatat audit), penyegaran HP kredensial Mabrur saat sinkron ulang, `Cache-Control: no-store` di semua respons API.
- **2026-07-21 — Menu "Master Data Paket" (CRUD kategori paket, hotel, maskapai).** Migrasi 0008 mengubah `packages.category` dari enum kaku menjadi FK ke tabel `package_categories` (seed 4 kategori bawaan; ON UPDATE CASCADE). Endpoint CRUD `/v1/package-categories`, `/v1/hotels`, `/v1/airlines` (mutasi role marketing, hapus ditolak 409 bila masih dipakai paket). Screen baru `/paket/master` + item sidebar; form paket kini memuat kategori dari API.
- **2026-07-21 — Menu "Master Data Keuangan" (CRUD vendor & rekening bank).** Endpoint `/v1/vendors` (modul accounting) dan mutasi `/v1/bank-accounts` (modul payments), role keuangan. Aturan dijaga: kode akun rekening wajib ada di COA kelas 1 postable; saldo TIDAK bisa diedit/di-set (hanya lewat jurnal); hapus ditolak bila vendor punya tagihan/jurnal atau rekening bersaldo/dipakai pembayaran. Screen `/keuangan-master`; komponen master dipakai bersama via `components/master.tsx`; uji Playwright diperluas.
- **2026-07-21 — Audit keamanan & korektnes (workflow multi-agent) + perbaikan.** 33 temuan; diperbaiki 1 CRITICAL + 10 HIGH (commit terkait): path-traversal upload dokumen (validasi UUID + cek jamaah + allow-list docType di multer + rate limit), IDOR invoice/kwitansi (requireAuth menolak token portal), pembayaran valas dibukukan IDR (tolak rekening non-IDR), jurnal tak-balance karena pembulatan (postJournal round per-baris sekali), settleDebt valas (selalu Dr 2-1300; kredit bank = Σ debit), pengakuan pendapatan PSAK 72 (anti-dobel per cost center + cegah 2-1100 negatif), tabrakan nomor invoice (sekuens bulanan INV/YYYY/MM/NNNN via nextNumber), validasi SAFAR_ENCRYPTION_KEY sebelum sinkron Mabrur, secret produksi (blokir placeholder + wajib HTTPS Mabrur + access≠refresh), audit() memakai trx di jalur transaksional, tolak overpayment. 128 tes (9 regresi baru). **Sisa (MEDIUM/LOW, belum dikerjakan):** /uploads menyajikan PII tanpa auth; non-atomik create/verify pembayaran + lost-update status invoice + idempotency check-then-insert; race NIK/termin/refresh-token → 500 bukan 409; CORS wildcard default; decrypt() tanpa validasi authTagLength; dependency xlsx (write-only, risiko rendah). Ditolak peninjau adversarial: password 6-digit (kebijakan), groupCredentials tanpa audit (konvensi audit-mutasi).
- **2026-07-22 — Audit batch MEDIUM selesai.** Diperbaiki: /uploads PII tidak lagi statis (endpoint `GET /v1/documents/:id/file` ber-RBAC + no-store + nama file acak); idempotency pembayaran ON CONFLICT DO NOTHING (retry serentak → replay, bukan 500); verifyPayment mengunci baris invoice (cegah lost-update status); transactionReceipt retry menyelesaikan verifikasi tertunda. Overpayment, expenseLines valas multi-baris, dan MABRUR_API_URL HTTPS sudah tertutup di batch HIGH. 129 tes. **Sisa LOW** (belum): race NIK/termin/refresh-token → 500 bukan 409; CORS wildcard default bila CORS_ORIGIN kosong; decrypt() tanpa authTagLength; token portal bisa baca /hotels & /airlines (mitigasi parsial: requireAuth kini tolak token portal → sudah tertutup). Dependency xlsx write-only (risiko rendah).
- **2026-07-22 — Audit batch LOW selesai.** decrypt() validasi format + IV/tag length (authTagLength 16) + groupCredentials tahan-gagal; rotasi refresh token atomik (deteksi replay); unique-violation race → 409 bukan 500; verifyPayment kunci termin (cegah dobel-verifikasi); CORS default origin:false (tolak cross-origin) bila CORS_ORIGIN kosong; DATABASE_URL dev di produksi → hard-fail. Terverifikasi live: boot OK, cross-origin ditolak (tanpa ACAO), login 200. 130 tes. **Sisa (diterima, bukan bug):** upload dokumen publik (wizard butuh sebelum akun jamaah ada — sudah dimitigasi: UUID+eksistensi+docType+traversal+rate-limit); dependency xlsx write-only (risiko rendah). **Audit menyeluruh: CRITICAL+HIGH+MEDIUM+LOW seluruhnya tertangani.**
