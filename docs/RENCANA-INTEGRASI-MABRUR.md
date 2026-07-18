# Rencana Integrasi Safar ⇄ Mabrur

**Safar** (repo ini) = back-office travel: pendaftaran → pembayaran → operasional → akuntansi → laporan.
**Mabrur** (repo [galihsidik86/mabrur](https://github.com/galihsidik86/mabrur)) = aplikasi lapangan: mobile Expo untuk jamaah & muthawwif (panduan ibadah, geofence miqat/Arafah, penghitung tawaf/sa'i, SOS, monitoring rombongan) + server Express/PG sendiri (`mabrur.sosmartpro.com`).

**Sasaran**: satu alur ujung-ke-ujung — rombongan yang siap berangkat di Safar **disinkronkan sekali klik** menjadi akun + rombongan + jadwal di Mabrur; selama di tanah suci, tim operasional Safar **memantau lapangan** (status anggota, SOS) dari dashboard Safar; jamaah menerima kredensial aplikasi Mabrur lewat portal Safar.

---

## 1. Prinsip Arsitektur

1. **Dua sistem tetap terpisah** (repo, DB, deployment). Alasan: Mabrur terikat manuskrip jurnal (reproducibility artefak riset — algoritme geospasial TIDAK disentuh), design system berbeda (maroon vs cream-hijau), siklus rilis mobile berbeda. Integrasi murni via API.
2. **Safar = source of truth data induk** (jamaah, rombongan, jadwal keberangkatan). **Mabrur = source of truth data lapangan** (lokasi, ihram, SOS, counter ibadah). Tidak ada duplikasi kepemilikan.
3. **Sinkronisasi idempoten** — dapat diulang kapan pun; upsert berbasis `external_ref` (UUID Safar), bukan insert buta.
4. **Autentikasi mesin-ke-mesin** dengan service token khusus (bukan akun admin manusia) — Mabrur saat ini belum punya mekanisme ini, akan ditambahkan.
5. Semua aksi tercatat **audit log di kedua sisi**.

## 2. Pemetaan Data & Identitas

| Safar | → | Mabrur | Kunci korelasi |
|---|---|---|---|
| `groups` (rombongan) + `departures`+`packages` | → | `groups` | `groups.external_ref` = UUID rombongan Safar; `kloter_code` = kode CC Safar (mis. `CC-UMR-PLUS-TR`-`B`) |
| `jamaah` (via `registrations` aktif di rombongan) | → | `users` role `jamaah` + `group_members` | `users.external_ref` = UUID jamaah Safar; **login = nomor HP** (sudah wajib di wizard Safar ✓) |
| `group_staff` (muthawwif/TL) | → | `users` role `muthawwif` + `group_members` | `users.external_ref` = UUID group_staff; **GAP: group_staff belum punya nomor HP → ditambah** |
| `departures` (tgl berangkat/pulang) + agenda | → | `schedules` per group | dibuat saat sinkron; muthawwif boleh menambah/mengubah di Mabrur |
| paspor jamaah | → | `users.passport_no` | dikirim plaintext via HTTPS; Mabrur mengenkripsi dgn kuncinya sendiri (AES-256-GCM, mekanisme existing) |

Arah balik (Mabrur → Safar, read-only): status anggota (`/groups/:id/members/status`) + SOS aktif → panel "Lapangan" di Safar.

Kolom mapping yang disimpan Safar: `groups.mabrur_group_id`, `groups.mabrur_synced_at`, `jamaah.mabrur_user_id`, `group_staff.mabrur_user_id`.

## 3. Desain Teknis

### 3a. Sisi Mabrur (repo `mabrur`) — permukaan integrasi baru

Modul baru `server/src/routes/integrations.ts` + `services/integration.service.ts` — **tidak menyentuh** services/algoritme yang ada.

- **Auth M2M**: header `X-Service-Token` dicocokkan dgn env `SAFAR_SYNC_TOKEN` (≥ 32 char; timing-safe compare). 401 bila salah/absen.
- **Migrasi**: `users.external_ref` (uuid, UNIQUE, nullable) + `groups.external_ref` (uuid, UNIQUE, nullable).
- **`POST /integrations/safar/sync`** — satu transaksi DB, payload:
  ```json
  {
    "group":   { "externalRef": "...", "name": "Plus Turki — Grup B", "kloterCode": "UMR-PLUS-TR-B", "year": 2026 },
    "members": [ { "externalRef": "...", "phone": "08...", "name": "...", "role": "jamaah|muthawwif",
                   "passportNo": "...", "emergencyContact": "...", "initialPassword": "..." } ],
    "schedules": [ { "title": "...", "locationName": "...", "startTime": "ISO", "sortOrder": 1 } ]
  }
  ```
  Perilaku: upsert group by `externalRef`; per anggota — cari by `externalRef`, lalu by `phone`; buat baru bila tak ada (password = `initialPassword`, hanya utk user BARU — user lama tidak di-reset); daftarkan ke `group_members` (reaktivasi bila pernah dicabut); anggota Safar yang hilang dari payload → `group_members.is_active=false` (user tidak dihapus). Schedules: replace-by-sync utk baris ber-tag sinkron, agenda buatan muthawwif dibiarkan. Response: mapping `{externalRef → mabrurUserId, created|updated|conflict}` per anggota + `mabrurGroupId`. Konflik phone (nomor dipakai user lain dgn externalRef berbeda) tidak menggagalkan seluruh batch — dilaporkan per baris.
- **`GET /integrations/safar/groups/:externalRef/status`** — gabungan monitoring existing (`monitoring.service`) + SOS aktif group, digua rd service token. Read-only.
- Vitest: idempotensi (2× sync = hasil sama, tanpa duplikat), konflik phone, guard token, reaktivasi member.

### 3b. Sisi Safar (repo `simabrur`) — modul `modules/mabrur`

- **Env**: `MABRUR_API_URL`, `MABRUR_SERVICE_TOKEN`, `SAFAR_ENCRYPTION_KEY` (utk menyimpan password awal terenkripsi AES-256-GCM — util crypto baru).
- **Migrasi**: `group_staff.phone`, kolom mapping (§2), tabel kecil `mabrur_credentials` (jamaah_id, phone, initial_password_enc, synced_at) agar portal bisa menampilkan kredensial awal.
- **Prasyarat UI operasional** (belum ada): kelola rombongan — assign registrasi ke rombongan (Grup A/B), tambah/edit muthawwif **dengan nomor HP**.
- **Service sync per rombongan**: kumpulkan anggota (kebijakan §4) → generate password awal 6 digit per user baru → panggil `POST /integrations/safar/sync` → simpan mapping + kredensial → audit.
- **UI**: di `/operasional` per rombongan → tombol **"Sinkron ke Mabrur"** + badge `Tersinkron <waktu> · N anggota` + daftar hasil (created/updated/conflict).
- **Monitoring balik**: endpoint proxy `GET /v1/mabrur/groups/:groupId/status` (server-side fetch ke Mabrur pakai service token; RBAC operasional/pimpinan) → tab **"Lapangan"** di Operasional: statistik aman/perhatian, daftar anggota + jarak miqat + ihram + link Google Maps, banner merah SOS aktif; auto-refresh 30 dtk.
- **Portal jamaah**: kartu **"Aplikasi Pendamping Mabrur"** — nomor HP login + password awal (sekali tampil dari `mabrur_credentials`) + tautan unduh APK/`mabrur.sosmartpro.com`.

## 4. Kebijakan (default — bisa diubah saat konfirmasi)

| Keputusan | Default | Alasan |
|---|---|---|
| Siapa yang disinkron | Semua registrasi **berstatus aktif** (dokumen lengkap) pada rombongan tsb — tidak menunggu lunas | Kebutuhan keselamatan lapangan ≠ status pembayaran; bisa diketatkan ke "lunas" bila diinginkan |
| Password awal | 6 digit numerik acak per user baru; tampil di portal + panel ops; user lama tidak di-reset | Mudah diketik di lapangan; Mabrur punya ganti-password mandiri |
| Muthawwif tanpa nomor HP | Sinkron rombongan ditolak dgn pesan jelas | Muthawwif adalah penerima SOS — wajib punya akun |
| Sinkron ulang | Kapan pun, idempoten; anggota dicabut → dinonaktifkan di group (bukan dihapus) | Konsisten kebijakan soft-delete Mabrur |
| Push kredensial via WhatsApp | Stub/log (konsisten kebijakan integrasi WA Safar) | Integrasi WA nyata di luar scope |

## 5. Fase Implementasi (per fase: selesai utuh → test → berhenti → konfirmasi)

| Fase | Repo | Isi | Estimasi hasil uji |
|---|---|---|---|
| **I1** | mabrur | Migrasi `external_ref`, middleware service-token, `POST /integrations/safar/sync`, `GET .../status`, vitest | curl sync idempoten + 401 tanpa token |
| **I2** | simabrur | Migrasi (phone muthawwif, mapping, credentials) + UI kelola rombongan (assign anggota, HP muthawwif) | Grup A/B Plus Turki bisa dikelola dari UI |
| **I3** | simabrur | Service + tombol "Sinkron ke Mabrur", kredensial terenkripsi, kartu portal | Sinkron Grup B golden thread → akun Siti Rohmah tercipta di Mabrur |
| **I4** | simabrur (+mabrur bila perlu) | Tab "Lapangan": proxy status + SOS banner | SOS dari mobile tampil di Safar |
| **I5** | keduanya | E2E dua server lokal (login Expo dgn kredensial hasil sinkron), dokumentasi (README ×2, PANDUAN §7, diagram), catatan deployment env | Skenario lengkap terverifikasi |

## 6. Risiko & Mitigasi

- **Konflik nomor HP** (nomor sama dipakai orang berbeda) → dilaporkan per baris, tidak menggagalkan batch; resolusi manual di admin Mabrur.
- **Artefak riset jurnal** → seluruh perubahan Mabrur berada di file baru + 1 migrasi; `sacred-zones-core`, `geofence.service`, harness Monte Carlo tidak tersentuh; `npm run simulate` harus tetap lolos (diverifikasi di I1).
- **CORS Mabrur masih terbuka & rate-limit login 10/15 mnt** → sinkron memakai service token (bukan login), tak terdampak; rekomendasi whitelist CORS dicatat terpisah.
- **Kredensial awal di Safar** → disimpan terenkripsi AES-256-GCM, ditampilkan sekali di portal; produksi disarankan kanal WA resmi.
- **Mabrur down saat sinkron/monitoring** → error ditampilkan apa adanya + tombol coba lagi; sinkron aman diulang.

## 7. Verifikasi Akhir (Fase I5)

1. Kedua server lokal (`simabrur` :3001, `mabrur` :3000) + seed masing-masing.
2. Safar: assign Grup B (Siti Rohmah dkk) + muthawwif Ust. Fadhil ber-HP → **Sinkron ke Mabrur**.
3. Mabrur admin: group `UMR-PLUS-TR-B` muncul beserta anggota; mobile Expo login `08…` + password awal dari portal Safar.
4. Mobile: kirim SOS uji → muncul di dashboard muthawwif Mabrur **dan** tab Lapangan Safar; resolve dari mobile → hilang di keduanya.
5. Sinkron ulang → tanpa duplikat (idempoten); `npm test` hijau di kedua repo; `npm run simulate` (mabrur) tetap lolos.

## 8. Di Luar Scope (dicatat, tidak dikerjakan sekarang)

SSO penuh antar sistem · pengiriman kredensial via WhatsApp nyata · sinkronisasi konten ibadah/doa · penghapusan user lintas sistem · penggabungan repo/DB.
