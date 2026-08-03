# Menerbitkan Portal Safar ke Google Play Store (TWA)

Portal Jamaah & Portal Agen sudah menjadi **PWA** (Progressive Web App): bisa
"dipasang" ke layar utama HP, jalan seperti aplikasi, dan bekerja offline (shell).
Untuk **muncul di Play Store**, PWA dibungkus jadi **TWA (Trusted Web Activity)** —
aplikasi Android tipis yang menampilkan situs Anda **layar penuh tanpa bar URL**,
memakai **codebase web yang sama** (tak perlu tulis ulang native).

Satu PWA = satu TWA. Anda bisa menerbitkan dua aplikasi terpisah:
- **Safar Jamaah** dari `https://safar.sosmartpro.com/manifest-jamaah.webmanifest`
- **Safar Portal Agen** dari `https://safar.sosmartpro.com/manifest-agen.webmanifest`

## Prasyarat
- Akun **Google Play Console** (biaya sekali seumur hidup **$25**).
- Node.js di komputer Anda.
- PWA sudah live di HTTPS (**sudah** — produksi aktif).

## Langkah (memakai Bubblewrap, CLI resmi Google)

```bash
# 1) Pasang Bubblewrap
npm i -g @bubblewrap/cli

# 2) Inisialisasi dari manifest (pilih salah satu portal)
bubblewrap init --manifest https://safar.sosmartpro.com/manifest-agen.webmanifest
#   Isi saat ditanya:
#   - Application ID  : id.co.safar.agen   (untuk jamaah: id.co.safar.jamaah)
#   - App name        : Safar — Portal Agen
#   - Display mode    : standalone
#   - Signing key     : buat baru (simpan .keystore + passwordnya BAIK-BAIK)

# 3) Build → menghasilkan app-release-signed.aab (untuk Play) + APK (untuk uji)
bubblewrap build

# 4) Ambil sidik jari (SHA-256) kunci penandatangan
bubblewrap fingerprint    # atau lihat output langkah 3
```

## Digital Asset Links (menghapus bar URL di aplikasi)

Agar TWA tampil **tanpa bar alamat** (seperti native), domain harus "mengakui"
aplikasi. Buat file `assetlinks.json` lalu taruh agar dilayani di:
`https://safar.sosmartpro.com/.well-known/assetlinks.json`

Backend Safar **sudah menyiapkan rute** untuk file ini (`app.ts`) — Anda cukup
menaruh filenya di `frontend/public/.well-known/assetlinks.json`, build, deploy.
Isi (ganti `SHA256_FINGERPRINT` dengan sidik jari dari langkah 4; boueh berisi
beberapa aplikasi — jamaah & agen):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "id.co.safar.agen",
      "sha256_cert_fingerprints": ["SHA256_FINGERPRINT_AGEN"]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "id.co.safar.jamaah",
      "sha256_cert_fingerprints": ["SHA256_FINGERPRINT_JAMAAH"]
    }
  }
]
```

> Penting: setelah upload ke Play, Play memakai **Play App Signing** — sidik jari
> FINAL ada di Play Console → *Setup → App integrity*. Gunakan sidik jari itu di
> `assetlinks.json` (bukan hanya kunci lokal), lalu deploy ulang.

## Unggah ke Play Console
1. Play Console → **Create app** → isi nama, bahasa (Indonesia), tipe (App), gratis.
2. **Production → Create release** → unggah `app-release-signed.aab`.
3. Lengkapi: ikon (pakai `/icons/pwa-512.png`), screenshot, deskripsi, kebijakan privasi.
4. Isi kuesioner konten & data safety, lalu **submit for review** (biasanya 1–3 hari).

## Catatan
- **Update aplikasi = update web.** Karena TWA menampilkan situs, setiap deploy
  Safar langsung tercermin di aplikasi — tak perlu rilis Play ulang, kecuali
  mengubah ikon/nama/izin native.
- **iOS**: TWA hanya Android. Untuk iPhone, PWA tetap bisa "Add to Home Screen"
  dari Safari (sudah didukung). App Store iOS butuh jalur berbeda (mis. PWABuilder /
  wrapper) — bahas terpisah bila perlu.
- **Notifikasi**: untuk push native di TWA, tambahkan Web Push; namun untuk Safar,
  kanal WhatsApp/email lebih andal di Indonesia (lihat catatan notifikasi).
