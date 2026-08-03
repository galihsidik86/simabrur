# Design Doc — Portal Agen (Safar)

**Tanggal:** 2026-07-31 · **Status:** disetujui (office-hours) · **Mode:** produk nyata (bisnis jalan)

## 1. Masalah & tujuan

Agen/mitra (Barokah Tour, Hj. Fatimah, dst.) saat ini **tak punya visibilitas** atas kinerjanya. Untuk tahu berapa jamaah referralnya konversi atau berapa komisinya, mereka harus menghubungi staf Marketing. Portal Agen memberi agen **layar self-service** untuk memantau referral & komisinya sendiri, plus menambah prospek (lead) — mengurangi bolak-balik dan menaikkan kepercayaan mitra.

**Bukan bagian dari portal ini:** melihat data sensitif jamaah (NIK, paspor, dokumen), menyetujui/membayar komisi (itu hak Keuangan), atau mendaftarkan jamaah langsung.

## 2. Pengguna & cakupan (keputusan office-hours)

| Keputusan | Pilihan |
|---|---|
| **Konteks** | Produk nyata, agen eksternal riil → auth kuat, isolasi per-agen, audit |
| **Login** | **Kredensial terbit-kantor** (pola Mabrur): HP + password awal sistem, **wajib ganti** saat login pertama |
| **Kemampuan** | **Lihat** referral + komisi sendiri **+ input leads** |
| **Isolasi** | Ketat — agen hanya melihat datanya, di-*enforce* server-side dari `agentId` di token |
| **Arsitektur** | **A — Reuse pola portal** (token portal ber-kind + kredensial Mabrur) |

## 3. Arsitektur (Approach A)

Menyatu ke dua pola yang **sudah ada** di kode, sehingga hampir tak ada infra baru:
- **Token portal terpisah** — JWT ber-`kind`. `requireAuth` (staf) sudah menolak token `kind='portal'`; kita tambah `kind='agent'` dan pastikan saling-tolak antar-kind.
- **Kredensial terbit-kantor** — pola dari integrasi Mabrur (password sistem, `must_change`, ditampilkan sekali ke staf).

### 3.1 Skema (migrasi baru)
Tambah pada tabel **`agents`**:
- `password_hash` (text, null) — bcrypt; null = portal belum diaktifkan
- `must_change_password` (bool, default true)
- `portal_enabled` (bool, default false)
- `last_login_at` (timestamp, null)
- Indeks unik parsial pada `lower(phone)` **where `portal_enabled`** — HP = username login, wajib unik untuk agen berportal.

Tak ada tabel baru; leads/commissions/registrations sudah ada (`registrations.agent_id` dari perbaikan komisi kemarin jadi sumber "jamaah referral").

### 3.2 Auth
- **Login:** `POST /v1/portal-agen/login {phone, password}` → JWT `{kind:'agent', agentId}` (akses pendek + refresh, pola sama seperti sesi lain) + flag `mustChangePassword`.
- **Ganti password:** `POST /v1/portal-agen/change-password {oldPassword, newPassword}` (≥8 char) → set `must_change_password=false`.
- **Middleware `requireAgent`** — verifikasi `kind='agent'`, tempel `req.agentId`. Semua rute portal-agen memakainya.
- **Saling-tolak kind:** rute staf (`requireAuth`) menolak `kind` in {portal, agent}; portal jamaah menolak `kind='agent'`; rute agen menolak non-`agent`. Cegah eskalasi lintas-portal.
- **Rate-limit** pada login (reuse limiter yang ada).

### 3.3 Endpoint (semua di-scope `req.agentId` — tak pernah dari input klien)
- `GET /me` — profil agen (nama, kode, referral_code, commission_pct, mustChangePassword)
- `GET /summary` — KPI: jumlah referral, konversi, komisi didapat (paid), terutang (approved belum paid), pending
- `GET /jamaah` — registrasi referralnya (`registrations.agent_id = agentId`): **data terbatas** — nama jamaah, paket, status registrasi, progres pembayaran (%). **TIDAK** memuat NIK/paspor/dokumen (PII sensitif).
- `GET /commissions` — komisinya (base, pct, amount, status pending/approved/paid, tanggal)
- `GET /leads` — leadsnya
- `POST /leads {name, phone}` — tambah lead (agent_id=agentId, status 'new') untuk ditindaklanjuti Marketing

### 3.4 Frontend
- Route publik **`/portal-agen`** (mobile-first, terpisah dari shell staf & portal jamaah). Login → dashboard 5 tab: **Ringkasan · Jamaah Saya · Komisi · Leads · Profil**. Paksa ganti password bila `mustChangePassword`. Reuse design tokens Safar.

### 3.5 UI Marketing (penerbitan kredensial)
- Di halaman `/marketing` (detail/aksi agen): tombol **"Aktifkan Portal"** → sistem generate password awal → tampilkan sekali (HP + password, tombol salin), set `portal_enabled=true`, `must_change_password=true`. Tombol **"Reset Password"** untuk terbitkan ulang. Hanya role marketing/admin.

## 4. Keamanan (kritis — agen = pihak luar)
- Isolasi per-agen **selalu** dari `agentId` token; endpoint tak menerima `agentId`/id agen dari klien.
- Agen **tak melihat PII dokumen jamaah** (hanya nama + status + progres bayar).
- Hanya agen **aktif** (`is_active`) & `portal_enabled` yang bisa login.
- Token agen ber-kind sendiri; saling-tolak dgn token staf/jamaah.
- Semua mutasi (login, ganti password, tambah lead, aktivasi portal) tercatat audit log.
- Password: bcrypt, min 8 char saat ganti, `must_change` dipaksa.

## 5. Peta reuse (kenapa Effort M, Risk Low)
| Butuh | Sudah ada |
|---|---|
| Token portal ber-kind + penolakan lintas-kind | `middleware/auth.ts` (`kind==='portal'` ditolak) |
| Kredensial terbit-kantor + must-change | pola Mabrur (`mabrur.service`, portal jamaah) |
| Rotasi refresh token aman | `auth.service.revokeIfActive` |
| "Jamaah referral agen" | `registrations.agent_id` (perbaikan komisi kemarin) |
| Komisi per agen | tabel `commissions` + status pending/approved/paid |
| Leads | tabel `leads` |
| Design system / pola portal mobile | Portal Jamaah (`/portal`) |

## 6. Rencana build (bertahap, tiap fase teruji)
1. **Skema + penerbitan kredensial + UI Marketing** — migrasi kolom agents, endpoint aktivasi/reset (marketing), panel kredensial.
2. **Auth agen** — login, change-password, `requireAgent`, kind terpisah + saling-tolak, rate-limit.
3. **Endpoint baca + dashboard** — me/summary/jamaah/commissions + frontend 4 tab.
4. **Leads** — input + daftar (tab Leads).
5. **Tes + deploy** — unit/supertest (isolasi per-agen, tolak lintas-kind, PII tak bocor), build, migrasi produksi (Anda jalankan), verifikasi.

## 7. Risiko & pertanyaan terbuka
- **HP sebagai username:** butuh unik untuk agen berportal. Jika dua agen berbagi HP → aktivasi kedua ditolak (pesan jelas). *(Alternatif: username = kode agen; tapi HP lebih mudah diingat agen.)*
- **Berapa detail data jamaah yang pantas dilihat agen?** Rekomendasi: nama + paket + status + % bayar. Tidak lebih. (Bisa disesuaikan.)
- **Komisi yang tampil ke agen:** tampilkan nominal & status? Ya (transparansi = tujuan). Pastikan hanya miliknya.
- **Notifikasi** (mis. "komisi Anda cair") di luar cakupan awal — bisa fase lanjutan (WA/email).

## 8. Assignment / langkah nyata berikutnya
1. **Konfirmasi 1 keputusan PII** (poin 7): setuju agen melihat *nama + paket + status + % bayar* jamaah referralnya, tanpa NIK/dokumen? 
2. Setelah itu, saya **bangun bertahap** (fase 1→5) dengan tes & deploy seperti fitur sebelumnya.

---
*Dokumen ini hasil sesi office-hours (design only). Implementasi menyusul setelah konfirmasi.*
