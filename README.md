# Safar — Sistem Informasi Manajemen Travel Haji & Umrah

Implementasi full-stack dari mockup desain di repo ini (file `*.dc.html`). Rencana lengkap dan pembagian fase: lihat **PLAN.md**.

## Stack

- **Backend**: Node.js + Express 5 + TypeScript · Knex + PostgreSQL 16 (Docker) · Zod · JWT (access + refresh) · RBAC 6 role · audit log
- **Frontend**: React 18 + Vite + Tailwind CSS v4 (design token dari mockup) · react-router · TanStack Query
- **Struktur**: npm workspaces — `backend/` & `frontend/`

## Prasyarat

- Node.js ≥ 20 dan npm
- Docker Desktop (untuk PostgreSQL)

## Setup & Menjalankan

```bash
# 1. Install dependensi (root — mengurus kedua workspace)
npm install

# 2. Konfigurasi env backend (sudah ada default dev di backend/.env)
#    Salin backend/.env.example → backend/.env bila belum ada.

# 3. Nyalakan database (host port 5434 — 5432/5433 umum terpakai)
docker compose up -d db

# 4. Migrasi + seed
npm run migrate
npm run seed

# 5. Jalankan (dua terminal)
npm run dev:backend    # API   → http://localhost:3001
npm run dev:frontend   # Web   → http://localhost:5173
```

## Akun demo (password semua: `safar123`)

| Email | Role |
|---|---|
| admin@safar.co.id | Admin (akses penuh) |
| keuangan@safar.co.id | Keuangan |
| ops@safar.co.id | Operasional |
| marketing@safar.co.id | Marketing |
| pimpinan@safar.co.id | Pimpinan (read-only) |

## Test

```bash
npm test   # Vitest + supertest (memakai database safar_test di kontainer yang sama)
```

## Konvensi API

- Base: `http://localhost:3001/v1` — frontend dev mem-proxy `/v1` ke backend
- Envelope sukses: `{ "success": true, "data": …, "meta": … }`
- Envelope error: `{ "success": false, "error": { "code", "message", "details?" } }`
- Auth: `Authorization: Bearer <accessToken>`; refresh via `POST /v1/auth/refresh` (token dirotasi)

## Halaman utama

| URL | Keterangan |
|---|---|
| `/login` | Masuk (admin & staf) |
| `/daftar` | **Wizard pendaftaran jamaah publik** (6 langkah, tanpa login) |
| `/paket` | Kartu paket + tab filter + form Tambah Paket (admin/marketing) |
| `/jamaah` | Tabel jamaah + badge 5 dokumen + pencarian; klik nama → detail |
| `/jamaah/:id` | Profil, pendaftaran, dokumen + aksi Verifikasi/Tolak (admin/ops) |
| `/pembayaran` | Kartu piutang + 3 KPI; Kelola: catat pembayaran (Idempotency-Key) & verifikasi → kwitansi (admin/keuangan) |
| `/dokumen/invoice/:id` | Invoice A4 printable (line items, termin, VA BSI, catatan PSAK 72) |
| `/dokumen/kwitansi/:id` | Kwitansi A4 printable (terbilang, stempel, catatan jurnal) |
| `/operasional` | Manifest per keberangkatan (paspor + flag <7 bln, visa, PNR, kamar) + ubah visa/tiket (admin/ops) |
| `/laporan-operasional` | 3 tab: Piutang Aging, Kepatuhan Dokumen (matriks per jamaah), Kesiapan Keberangkatan (skor 4 metrik); ekspor Excel/PDF |
| `/keuangan` | Ringkasan: 3 KPI (liabilitas 2-1100, pendapatan PSAK 72, laba kotor), laba per cost center, feed jurnal |
| `/keuangan/input` | Input Transaksi 4 tipe + preview jurnal live (panel gelap); valas + realisasi selisih kurs 7-1000 |
| `/keuangan/jurnal` | Jurnal Umum (filter sumber/bulan, jurnal manual) & Rekonsiliasi Bank (penyesuaian 2 sisi + pencocokan mutasi) |
| `/keuangan/coa` | Bagan akun 7 kelas berwarna; klik akun → buku besar dgn saldo berjalan |
| `/` | Dashboard Eksekutif: 4 KPI, chart arus kas vs pendapatan diakui, profitabilitas per paket, keberangkatan mendatang |
| `/laporan-keuangan` | 3 tab: Laba Rugi, Neraca (cek seimbang), Laba Rugi per Paket; ekspor Excel/PDF |
| `/portal` | **Portal Jamaah** (login no. registrasi + NIK): beranda countdown, bayar/termin + VA, dokumen + unggah, perjalanan, profil |
| `/admin` | Administrasi (admin): pengguna & role, audit log viewer |
| `/marketing` | Kinerja agen & komisi (3 KPI + tabel), registrasi agen + kode referral, persetujuan komisi → jurnal otomatis |

Aturan bisnis aktif: paspor wajib berlaku ≥ 7 bulan setelah keberangkatan, perempuan < 45 th wajib mahram, kuota real-time (lock transaksi), nomor registrasi `UMR/HAJ-<tahun>-<serial>`, registrasi otomatis aktif saat 5 dokumen wajib terverifikasi, semua mutasi tercatat di audit log.

## Status fase (lihat PLAN.md)

- [x] **Fase 1** — Fondasi: monorepo, Docker Postgres, migrasi M7 (users/roles/branches/refresh_tokens/audit_logs), auth JWT + RBAC + audit, design token, Login, shell aplikasi
- [x] **Fase 2** — Paket & Jamaah: migrasi M1+M2 + penomoran, API paket/jadwal/registrasi/dokumen, wizard pendaftaran publik, view Paket & Jamaah, detail + verifikasi dokumen, seed 6 paket + 14 jamaah
- [x] **Fase 3** — Pembayaran: invoice otomatis saat pendaftaran + jadwal termin (DP 5 jt + 5 termin / DP+pelunasan / lunas), pencatatan pembayaran ber-Idempotency-Key, verifikasi → kwitansi bernomor + terbilang, kartu piutang + aging, dokumen A4 invoice & kwitansi (INV/KWT/VA persis mockup)
- [x] **Fase 4** — Operasional & Manifest: migrasi M4 (manifests/visas/tickets/group_staff/checklists), manifest per keberangkatan dgn flag paspor <7 bln, upsert visa & tiket, rombongan + muthawwif/TL, checklist perlengkapan, laporan kepatuhan dokumen + kesiapan (skor 4 metrik), ekspor Excel
- [x] **Fase 5** — Keuangan & Akuntansi: COA 7 kelas persis mockup, journal engine (balance wajib, penomoran JV, saldo bank sinkron), template A–F, jurnal otomatis saat verifikasi pembayaran + posting retroaktif, 4 transaksi (terima/biaya/pendapatan PSAK 72/komisi), valas + selisih kurs 7-1000, jurnal manual, buku besar, rekonsiliasi bank (penyesuaian 2 sisi + pencocokan mutasi)
- [ ] Fase 3 — Pembayaran
- [ ] Fase 4 — Operasional & Manifest
- [ ] Fase 5 — Keuangan & Akuntansi
- [x] **Fase 6** — Dashboard, Laporan & Portal Jamaah: dashboard eksekutif dari data jurnal, laporan laba rugi/neraca (selalu seimbang)/laba per paket + ekspor, portal jamaah (login regNumber+NIK, 5 tab, unggah dokumen, VA), audit log viewer + manajemen pengguna
- [x] **Fase 7** — Agen & Komisi: migrasi M5 (agents/leads/commissions), kode referral di wizard (`agent:BRKH-07` → lead terkonversi + komisi pending otomatis), kinerja agen (leads/konversi/komisi), persetujuan komisi → jurnal F (Dr 6-2000 · Cr 2-1400), KPI komisi terhutang dari saldo akun 2-1400

**Seluruh 7 fase PLAN.md selesai.** 94+ test integrasi & unit (`npm test`).

## Deployment (produksi)

### Opsi A — Docker Compose (disarankan)

```bash
# 1. Siapkan secret (sekali): buat file .env di root repo
#    DB_PASSWORD=<acak>
#    JWT_ACCESS_SECRET=<acak >= 32 char>
#    JWT_REFRESH_SECRET=<acak >= 32 char>
#    (buat: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
# 2. Build & jalankan
docker compose -f docker-compose.prod.yml up -d --build
# App: http://<host>:3001 (ubah dgn APP_PORT). Migrasi berjalan otomatis saat start.
```

Frontend disajikan oleh backend (same-origin) — tidak perlu server statis terpisah. Untuk TLS, letakkan reverse proxy (nginx/Caddy) di depan port app.

### Opsi B — Node langsung

```bash
npm ci && npm run build        # backend tsc + frontend vite → backend/public
NODE_ENV=production PORT=3001 DATABASE_URL=... JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=... \
  node backend/dist/db/scripts/migrate.js && node backend/dist/server.js
```

### Perilaku produksi

- **Start ditolak** bila JWT secret masih default dev atau < 32 karakter
- Security headers (helmet + CSP mengizinkan Google Fonts), `trust proxy`, HSTS
- **Rate limit**: login staf/portal 20×/15 mnt per IP, pendaftaran publik 30×/15 mnt
- `GET /v1/health` mengecek koneksi DB (dipakai healthcheck container / load balancer)
- Nama migrasi dicatat **bebas ekstensi** — dev (tsx `.ts`) dan produksi (dist `.js`) memakai riwayat yang sama
- Upload dokumen di volume `safar_uploads`; data DB di volume `safar_pgdata_prod`
- **Seed adalah data demo** — jangan dijalankan di produksi (produksi cukup migrate; buat admin pertama via `POST /v1/users` atau SQL)

### Backup & restore

```bash
npm run db:backup                                    # → backups/safar-<timestamp>.dump (pg_dump -Fc)
npm run db:restore -- -File backups/safar-xxxx.dump  # restore (konfirmasi, --clean --if-exists)
# Linux/macOS: ./scripts/backup-db.sh [container] [user] [db]
# Produksi: ganti nama container, mis. npm run db:backup -- -Container simabrur-db-1
```

### Belum termasuk (stub — lihat PLAN.md §5)

Integrasi nyata WhatsApp/email/payment gateway; object storage + signed URL untuk dokumen (saat ini disk lokal via volume).
