# Berkas TWA — Portal Jamaah & Portal Agen

Folder ini berisi konfigurasi **TWA (Trusted Web Activity)** untuk membungkus PWA
Safar menjadi aplikasi Android yang bisa diterbitkan ke **Google Play Store**.
Codebase tetap web yang sama — TWA hanya menampilkan portal layar penuh tanpa bar URL.

```
twa/
├── portal-jamaah/twa-manifest.json   → app "Safar — Portal Jamaah"  (id.co.safar.jamaah, start /portal)
└── portal-agen/twa-manifest.json     → app "Safar — Portal Agen"    (id.co.safar.agen,   start /portal-agen)
```

Yang di-commit HANYA `twa-manifest.json`. Proyek Android (`android/`), output build
(`.aab`/`.apk`), dan **keystore** (RAHASIA) dibuat lokal & di-`.gitignore`.

## Prasyarat (di komputer Anda)
- **Node.js** + **JDK 17** (Bubblewrap bisa mengunduhkan JDK & Android SDK otomatis saat pertama build).
- Akun **Google Play Console** (biaya sekali $25) untuk menerbitkan.

## Build (ulangi untuk tiap portal)

```bash
npm i -g @bubblewrap/cli

cd twa/portal-jamaah          # atau twa/portal-agen
bubblewrap update             # generate proyek Android dari twa-manifest.json
bubblewrap build              # build → app-release-signed.aab (+ apk untuk uji)
#   Saat pertama: Bubblewrap menawarkan MEMBUAT keystore (android.keystore, alias "safar").
#   ⚠️ SIMPAN keystore + passwordnya BAIK-BAIK. Hilang = tak bisa update app di Play.
```

Uji APK di HP: `adb install app-release-signed.apk` (atau kirim APK-nya).

## Digital Asset Links (menghilangkan bar URL)

Agar app tampil tanpa bar alamat, domain harus mengakui app lewat
`https://safar.sosmartpro.com/.well-known/assetlinks.json`.

File itu **sudah ada** di `frontend/public/.well-known/assetlinks.json` (sudah
dilayani backend — terverifikasi). Anda tinggal **mengganti dua placeholder
fingerprint** dengan SHA-256 yang benar, lalu build + deploy Safar seperti biasa.

Ambil fingerprint yang BENAR dari **Play Console → (app) → Setup → App integrity →
App signing key certificate → SHA-256** (Play memakai *Play App Signing*, jadi
sidik jari final berasal dari Play, bukan keystore lokal Anda). Isikan:
- `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_JAMAAH` → SHA-256 app jamaah
- `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_AGEN` → SHA-256 app agen

## Unggah ke Play
1. Play Console → **Create app** (Indonesia, tipe App, gratis).
2. **Production → Create release** → unggah `app-release-signed.aab`.
3. Lengkapi listing (ikon `https://safar.sosmartpro.com/icons/pwa-512.png`, screenshot,
   deskripsi, kebijakan privasi), isi Data safety, **submit for review**.

## Update aplikasi
- **Konten/fitur** berubah otomatis mengikuti web tiap deploy Safar — TANPA rilis Play ulang.
- **Ikon / nama / izin native** berubah → naikkan `appVersionCode` di `twa-manifest.json`,
  `bubblewrap update && bubblewrap build`, unggah `.aab` baru.

Detail lengkap: lihat `docs/PLAY-STORE-TWA.md`.
