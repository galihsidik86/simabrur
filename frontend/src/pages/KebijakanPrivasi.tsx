/**
 * Halaman publik Kebijakan Privasi — wajib sebagai URL kebijakan privasi di Google Play
 * untuk aplikasi Portal Jamaah & Portal Agen. Tanpa autentikasi, dapat diakses siapa pun.
 * Route: /kebijakan-privasi
 */

function Bagian({ no, judul, children }: { no: number; judul: string; children: React.ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="font-display text-[17px] text-ink-strong">
        {no}. {judul}
      </h2>
      <div className="mt-2 text-[13.5px] leading-relaxed text-muted-2">{children}</div>
    </section>
  );
}

export function KebijakanPrivasi() {
  return (
    <div className="min-h-screen bg-cream">
      {/* Header brand */}
      <header style={{ background: 'linear-gradient(160deg,#16211b,#1b2a20)' }} className="text-forest-text">
        <div className="mx-auto flex max-w-[820px] items-center gap-3 px-6 py-6">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-[11px] bg-gold font-display text-[22px] text-[#20180a]">
            S
          </div>
          <div>
            <div className="font-display text-[21px] leading-none tracking-[0.5px]">Safar</div>
            <div className="mt-1 text-[10.5px] uppercase tracking-[1px] text-forest-muted">
              Manajemen Umrah & Haji
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-6 py-10">
        <div className="rounded-[16px] bg-card p-8 shadow-float md:p-10">
          <h1 className="font-display text-[26px] text-ink-strong">Kebijakan Privasi</h1>
          <p className="mt-2 text-[13px] text-muted-2">
            Aplikasi Safar — Portal Jamaah &amp; Portal Agen · PT Safar Barokah Wisata
          </p>
          <p className="mt-1 text-[12px] text-muted-2">Terakhir diperbarui: 4 Agustus 2026</p>

          <Bagian no={1} judul="Pendahuluan">
            PT Safar Barokah Wisata (&quot;kami&quot;) mengelola aplikasi <b>Safar — Portal Jamaah</b> dan{' '}
            <b>Safar — Portal Agen</b>. Kebijakan ini menjelaskan data apa yang kami kumpulkan, bagaimana
            kami menggunakannya, dan hak Anda atas data tersebut.
          </Bagian>

          <Bagian no={2} judul="Data yang Kami Kumpulkan">
            <p>
              <b>Portal Jamaah:</b> nama, tempat/tanggal lahir, jenis kelamin, nomor telepon, email, alamat,
              kontak darurat, dokumen persyaratan (paspor, KTP, foto, dan sejenisnya), serta riwayat pembayaran.
            </p>
            <p className="mt-2">
              <b>Portal Agen:</b> nama, nomor telepon, email, data referal jamaah, dan riwayat komisi.
            </p>
            <p className="mt-2">
              Data ini Anda serahkan sendiri atau diinput oleh kantor kami saat proses pendaftaran.
            </p>
          </Bagian>

          <Bagian no={3} judul="Tujuan Penggunaan">
            Data digunakan semata-mata untuk: memproses pendaftaran dan keberangkatan ibadah, mengelola
            pembayaran dan komisi, memverifikasi dokumen, serta berkomunikasi dengan Anda terkait layanan.
            Kami <b>tidak menjual</b> data Anda kepada pihak mana pun.
          </Bagian>

          <Bagian no={4} judul="Penyimpanan & Keamanan">
            Data disimpan pada server kami dan ditransmisikan melalui koneksi terenkripsi (HTTPS/TLS). Akses
            dibatasi hanya untuk Anda (melalui akun) dan petugas kami yang berwenang.
          </Bagian>

          <Bagian no={5} judul="Pembagian Data">
            Kami hanya membagikan data kepada pihak yang diperlukan untuk pelaksanaan ibadah Anda (misalnya
            maskapai, penyedia visa, hotel, dan otoritas terkait) sesuai kebutuhan keberangkatan, serta kepada
            otoritas bila diwajibkan hukum. Kami tidak membagikan data untuk keperluan iklan.
          </Bagian>

          <Bagian no={6} judul="Hak Anda">
            Anda berhak mengakses, memperbaiki, atau meminta penghapusan data pribadi Anda dengan menghubungi
            kami di <b>cs@safar.co.id</b>. Penghapusan data tertentu dapat dibatasi oleh kewajiban
            hukum/akuntansi yang berlaku.
          </Bagian>

          <Bagian no={7} judul="Retensi Data">
            Data disimpan selama diperlukan untuk layanan dan sepanjang diwajibkan oleh peraturan
            perpajakan/akuntansi yang berlaku.
          </Bagian>

          <Bagian no={8} judul="Perubahan Kebijakan">
            Kebijakan ini dapat diperbarui sewaktu-waktu; setiap perubahan dipublikasikan pada halaman ini
            beserta tanggal pembaruannya.
          </Bagian>

          <Bagian no={9} judul="Kontak">
            <p>PT Safar Barokah Wisata</p>
            <p>Email: cs@safar.co.id</p>
            <p>
              Situs:{' '}
              <a className="font-semibold text-primary hover:underline" href="https://safar.sosmartpro.com">
                safar.sosmartpro.com
              </a>
            </p>
          </Bagian>

          <div className="mt-9 border-t border-line pt-5 text-center text-[12px]">
            <a className="font-semibold text-primary hover:underline" href="/">
              ← Kembali ke beranda
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] text-muted-2">
          PT Safar Barokah Wisata · Izin PPIU Kemenag No. U-431 Tahun 2023
        </p>
      </main>
    </div>
  );
}
