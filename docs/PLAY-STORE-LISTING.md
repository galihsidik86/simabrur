# Draf Listing Google Play — Portal Jamaah & Portal Agen

Semua teks di bawah **siap tempel** ke Play Console. Dua aplikasi terpisah, masing‑masing
punya listing sendiri. Batas karakter Play ditulis di tiap bagian.

> Domain resmi: **https://safar.sosmartpro.com**
> Email kontak developer: **cs@safar.co.id** _(ganti bila kantor memakai email lain)_
> Kebijakan privasi (wajib): **https://safar.sosmartpro.com/kebijakan-privasi** — draf teksnya ada di bagian akhir dokumen ini; halaman ini HARUS online sebelum submit.

---

## APLIKASI 1 — Portal Jamaah  (`id.co.safar.jamaah`)

**Berkas unggah:** `twa/portal-jamaah/safar-jamaah-1.0.0.aab`

### Nama aplikasi (maks 30 karakter)
```
Safar — Portal Jamaah
```

### Deskripsi singkat (maks 80 karakter)
```
Pantau pendaftaran, pembayaran, dokumen & jadwal Umrah/Haji Anda dari genggaman.
```

### Deskripsi lengkap (maks 4000 karakter)
```
Safar — Portal Jamaah adalah aplikasi resmi bagi calon jamaah Umrah dan Haji yang
mendaftar melalui travel PT Safar Barokah Wisata. Semua kebutuhan perjalanan ibadah
Anda dalam satu genggaman — kapan saja, di mana saja.

FITUR UTAMA
• Beranda — hitung mundur keberangkatan, ringkasan progres dokumen & pembayaran, serta
  daftar hal yang perlu Anda tindak lanjuti.
• Pembayaran — lihat jadwal termin (DP & cicilan), sisa tagihan, dan riwayat setoran
  Anda secara transparan.
• Dokumen — pantau status verifikasi paspor, foto, KTP, dan berkas lain yang sudah
  Anda serahkan.
• Perjalanan — detail penerbangan, hotel, jadwal rombongan, dan checklist perlengkapan.
• Profil — data diri Anda serta unduhan invoice dan kwitansi resmi.

MENGAPA PORTAL JAMAAH?
• Transparan — status pembayaran dan dokumen selalu terbarui, tanpa perlu bertanya
  berulang ke kantor.
• Praktis — akses mandiri 24 jam, cukup dari ponsel.
• Aman — data pribadi Anda dilindungi dan hanya bisa diakses dengan akun Anda sendiri.

CATATAN
Aplikasi ini diperuntukkan bagi jamaah yang telah terdaftar dan menerima akun dari
kantor PT Safar Barokah Wisata. Jika Anda belum memiliki akun, silakan hubungi tim kami.

PT Safar Barokah Wisata — melayani ibadah Umrah & Haji dengan amanah.
```

### Kategori & detail
- **Kategori aplikasi:** Perjalanan & Lokal (Travel & Local)
- **Tag:** perjalanan, umrah, haji, ibadah
- **Situs web:** https://safar.sosmartpro.com
- **Email:** cs@safar.co.id
- **Telepon:** _(isi nomor CS kantor — opsional tapi disarankan)_

---

## APLIKASI 2 — Portal Agen  (`id.co.safar.agen`)

**Berkas unggah:** `twa/portal-agen/safar-agen-1.0.0.aab`

### Nama aplikasi (maks 30 karakter)
```
Safar — Portal Agen
```

### Deskripsi singkat (maks 80 karakter)
```
Pantau jamaah referal, status pendaftaran, dan komisi Anda secara real‑time.
```

### Deskripsi lengkap (maks 4000 karakter)
```
Safar — Portal Agen adalah aplikasi resmi bagi mitra pemasaran (agen) PT Safar Barokah
Wisata. Pantau kinerja Anda dan penghasilan komisi dari referal jamaah — langsung dari
ponsel, kapan saja.

FITUR UTAMA
• Ringkasan — jumlah jamaah referal, pendaftaran aktif, dan total komisi Anda dalam
  satu layar.
• Jamaah Referal — daftar calon jamaah yang mendaftar melalui kode referal Anda beserta
  status pendaftarannya.
• Komisi — rincian komisi per jamaah: yang masih diproses, disetujui, hingga sudah
  dicairkan — transparan dan terbarui.
• Leads — catat dan pantau calon jamaah yang sedang Anda dampingi.
• Notifikasi — pemberitahuan saat ada referal baru, pendaftaran aktif, komisi disetujui,
  atau komisi cair.

MENGAPA PORTAL AGEN?
• Transparan — hitungan komisi jelas dan bisa dipantau kapan saja.
• Real‑time — begitu ada perkembangan, Anda langsung tahu.
• Praktis — tak perlu lagi menunggu rekap manual dari kantor.

CATATAN
Aplikasi ini diperuntukkan bagi agen resmi yang telah menerima akun dari kantor PT Safar
Barokah Wisata. Jika Anda tertarik menjadi mitra, silakan hubungi tim kami.

PT Safar Barokah Wisata — tumbuh bersama mitra yang amanah.
```

### Kategori & detail
- **Kategori aplikasi:** Bisnis (Business)
- **Tag:** bisnis, penjualan, mitra
- **Situs web:** https://safar.sosmartpro.com
- **Email:** cs@safar.co.id
- **Telepon:** _(opsional)_

---

## Aset grafis yang WAJIB disiapkan (untuk KEDUA app)

Play tidak menerima listing tanpa aset berikut. Ukuran & format tepat:

| Aset | Ukuran | Format | Catatan |
|---|---|---|---|
| **Ikon aplikasi** | 512 × 512 px | PNG 32‑bit | Sudah ada: `frontend/public/icons/pwa-512.png` — pakai ini |
| **Grafik unggulan** (feature graphic) | 1024 × 500 px | PNG/JPG | WAJIB. Belum ada — perlu dibuat (logo "S" emas di atas latar hijau `#16211b`) |
| **Screenshot ponsel** | min 2, maks 8; sisi 320–3840 px, rasio ≤ 2:1 | PNG/JPG | Ambil dari portal berjalan (lihat cara di bawah) |
| Screenshot tablet 7"/10" | opsional | | Boleh dilewati untuk rilis awal |

**Cara ambil screenshot cepat (tanpa HP):**
1. Buka Chrome di komputer → `https://safar.sosmartpro.com/portal` (jamaah) atau `/portal-agen` (agen).
2. Login dengan akun demo.
3. F12 → ikon "Toggle device toolbar" (Ctrl+Shift+M) → pilih perangkat mis. "Pixel 7".
4. Menu ⋮ di panel device → **Capture screenshot**. Ulangi untuk tiap tab/layar.
5. Ambil 3–5 layar terbaik per app (Beranda, Pembayaran, Dokumen, Perjalanan untuk jamaah;
   Ringkasan, Komisi, Notifikasi untuk agen).

> Saya bisa membuatkan **grafik unggulan 1024×500** dan menata screenshot bila Anda mau —
> tinggal minta.

---

## Content Rating (kuesioner rating konten) — jawaban untuk KEDUA app

Play menanyakan kuesioner; hasil untuk aplikasi seperti ini = **Rated for 3+ / Semua umur**.
Jawaban:

- Kategori: **Utility, Productivity, Communication, or Other** (Portal Jamaah bisa "Travel"; Portal Agen "Business")
- Kekerasan, seksual, bahasa kasar, narkoba, judi: **Tidak** (semua)
- Berbagi lokasi pengguna: **Tidak**
- Berbagi konten buatan pengguna: **Tidak**
- Pembelian dalam aplikasi / harga: **Tidak**
- Konten yang dibuat pengguna & bisa dilihat publik: **Tidak**

---

## Data Safety (Keamanan Data) — WAJIB & harus jujur

Kedua app menangani data pribadi. Isi form Data Safety seperti ini:

**Apakah aplikasi mengumpulkan/membagikan data pengguna?** → **Ya, mengumpulkan.**

**Jenis data yang dikumpulkan:**
| Jenis | Portal Jamaah | Portal Agen | Tujuan | Dibagikan ke pihak ketiga? |
|---|---|---|---|---|
| Nama | ✔ | ✔ | Fungsi aplikasi, manajemen akun | Tidak |
| Email | ✔ | ✔ | Fungsi aplikasi, manajemen akun | Tidak |
| Nomor telepon | ✔ | ✔ | Fungsi aplikasi | Tidak |
| Alamat | ✔ | – | Fungsi aplikasi (administrasi keberangkatan) | Tidak |
| Info keuangan (riwayat pembayaran/komisi) | ✔ | ✔ | Fungsi aplikasi | Tidak |
| Dokumen/foto (paspor, KTP, dsb.) | ✔ | – | Fungsi aplikasi (persyaratan keberangkatan) | Tidak |

**Praktik keamanan (centang):**
- ✔ Data dienkripsi saat transit (HTTPS/TLS).
- ✔ Pengguna dapat meminta penghapusan data (melalui kantor / email CS).
- Data TIDAK dijual ke pihak ketiga.

**Catatan penting:** JANGAN mencentang "Location", "Ads", atau "Analytics" kecuali memang
dipakai — saat ini portal tidak memakai iklan, pelacakan lokasi, atau analytics pihak ketiga.

---

## Isian wajib lain (per app)
- **Target audiens & konten:** usia 18+ (menyangkut keuangan/administrasi). Bukan aplikasi
  untuk anak.
- **Iklan:** "Aplikasi ini tidak menampilkan iklan."
- **Akses aplikasi:** karena butuh login akun dari kantor, sediakan **kredensial demo**
  untuk tim peninjau Play (App content → App access → "All or some functionality is
  restricted"). Beri akun demo + langkah login. Tanpa ini, review sering ditolak.
- **Kategori & kontak:** seperti di masing‑masing app di atas.

---

## Draf Kebijakan Privasi (host di https://safar.sosmartpro.com/kebijakan-privasi)

> Play WAJIB URL kebijakan privasi yang bisa diakses publik. Teks di bawah adalah draf —
> tinjau bersama pihak yang berwenang di PT Safar sebelum dipublikasikan.

```
KEBIJAKAN PRIVASI — Aplikasi Safar (Portal Jamaah & Portal Agen)
PT Safar Barokah Wisata
Terakhir diperbarui: [tanggal]

1. PENDAHULUAN
PT Safar Barokah Wisata ("kami") mengelola aplikasi Safar — Portal Jamaah dan Safar —
Portal Agen. Kebijakan ini menjelaskan data apa yang kami kumpulkan, bagaimana kami
menggunakannya, dan hak Anda atas data tersebut.

2. DATA YANG KAMI KUMPULKAN
Portal Jamaah: nama, tempat/tanggal lahir, jenis kelamin, nomor telepon, email, alamat,
kontak darurat, dokumen persyaratan (paspor, KTP, foto, dsb.), serta riwayat pembayaran.
Portal Agen: nama, nomor telepon, email, data referal jamaah, dan riwayat komisi.
Data ini Anda serahkan sendiri atau diinput oleh kantor kami saat proses pendaftaran.

3. TUJUAN PENGGUNAAN
Data digunakan semata‑mata untuk: memproses pendaftaran dan keberangkatan ibadah,
mengelola pembayaran dan komisi, memverifikasi dokumen, serta berkomunikasi dengan Anda
terkait layanan. Kami TIDAK menjual data Anda kepada pihak mana pun.

4. PENYIMPANAN & KEAMANAN
Data disimpan pada server kami dan ditransmisikan melalui koneksi terenkripsi (HTTPS/TLS).
Akses dibatasi hanya untuk Anda (melalui akun) dan petugas kami yang berwenang.

5. PEMBAGIAN DATA
Kami hanya membagikan data kepada pihak yang diperlukan untuk pelaksanaan ibadah Anda
(mis. maskapai, penyedia visa, hotel, otoritas terkait) sesuai kebutuhan keberangkatan,
dan kepada otoritas bila diwajibkan hukum. Kami tidak membagikan data untuk iklan.

6. HAK ANDA
Anda berhak mengakses, memperbaiki, atau meminta penghapusan data pribadi Anda dengan
menghubungi kami di cs@safar.co.id. Penghapusan data tertentu dapat dibatasi oleh
kewajiban hukum/akuntansi.

7. RETENSI
Data disimpan selama diperlukan untuk layanan dan sepanjang diwajibkan peraturan
perpajakan/akuntansi yang berlaku.

8. PERUBAHAN
Kebijakan ini dapat diperbarui sewaktu‑waktu; perubahan dipublikasikan pada halaman ini.

9. KONTAK
PT Safar Barokah Wisata
Email: cs@safar.co.id
Situs: https://safar.sosmartpro.com
```

---

## Ringkas — urutan mengisi di Play Console
1. Create app (× 2) → nama + bahasa Indonesia + tipe App + Gratis.
2. **Main store listing:** tempel nama, deskripsi singkat & lengkap, unggah ikon +
   grafik unggulan + screenshot.
3. **Store settings:** kategori + kontak.
4. **App content:** Privacy policy URL, Data safety, Content rating, Target audience,
   Ads (tidak ada), App access (beri akun demo peninjau).
5. **Production → Create release:** unggah `.aab`, isi release notes, review, roll out.
6. Setelah rilis: ambil **SHA‑256 Play App Signing** → kirim ke saya untuk isi
   `assetlinks.json`.
```
```
