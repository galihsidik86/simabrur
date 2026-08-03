# Aset Grafis Google Play — siap unggah

Semua berkas di folder ini sudah sesuai spesifikasi Play. Data pada screenshot adalah
**data demo fiktif** (Hj. Siti Rohmah / UMR‑2026‑0418, agen Barokah Tour / BRKH‑07) — bukan
data jamaah nyata, aman untuk gambar publik.

## Grafik unggulan (Feature graphic) — 1024 × 500
- `feature-graphic-jamaah-1024x500.png` → app **Portal Jamaah** (`id.co.safar.jamaah`)
- `feature-graphic-agen-1024x500.png`   → app **Portal Agen** (`id.co.safar.agen`)

## Screenshot ponsel — 824 × 1600 (rasio 1,94:1, memenuhi batas ≤ 2:1 Play)
Portal Jamaah (unggah min 2 — sarankan keempatnya):
- `screenshots/jamaah-1-beranda.png`     — hitung mundur + progres dokumen/pembayaran
- `screenshots/jamaah-2-bayar.png`       — jadwal termin + BSI Virtual Account
- `screenshots/jamaah-3-dokumen.png`     — status verifikasi dokumen
- `screenshots/jamaah-4-perjalanan.png`  — penerbangan/hotel/checklist

Portal Agen:
- `screenshots/agen-1-ringkasan.png`     — KPI referal & komisi
- `screenshots/agen-2-jamaah.png`        — daftar jamaah referal
- `screenshots/agen-3-komisi.png`        — rincian komisi
- `screenshots/agen-4-notifikasi.png`    — pusat notifikasi

## Ikon aplikasi — 512 × 512
Pakai `../../frontend/public/icons/pwa-512.png` (satu ikon untuk kedua app; jika ingin
membedakan, bisa dibuat varian nanti).

## Cara memperbarui screenshot
Jalankan portal lokal (`npm run dev:backend` + `npm run dev:frontend`, DB ter‑seed), lalu
render ulang dengan Playwright viewport 412×800 @2x (skrip ada di riwayat sesi). Jaga rasio
tinggi ≤ 2× lebar agar tidak ditolak Play.
