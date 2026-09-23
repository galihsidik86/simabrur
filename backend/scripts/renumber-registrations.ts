/**
 * SEC-01 — penomoran ulang registrasi LAMA (opsional, tidak otomatis).
 *
 * Registrasi baru sudah memakai serial acak. Registrasi yang terlanjur dibuat dengan
 * skema berurutan (`UMR-2026-0418`) TIDAK ikut berubah, sehingga nomor-nomor lama masih
 * bisa ditebak satu dari yang lain. Skrip ini menomori ulang mereka.
 *
 * BACA DULU — nomor registrasi adalah KREDENSIAL login Portal Jamaah (nomor + NIK):
 *  - Setiap jamaah yang nomornya diganti TIDAK BISA login lagi dengan nomor lamanya.
 *    Siapkan pemberitahuan ke jamaah sebelum menjalankan ini di produksi.
 *  - Nomor lama tercetak di invoice/kwitansi yang mungkin sudah dibagikan. Dokumen itu
 *    tidak ikut berubah: `invoices.number`, `receipts`, dan `va_number` TIDAK disentuh.
 *  - Jalankan `npm run db:backup` lebih dulu.
 *
 * Pemakaian (dari folder `backend/`):
 *   npm run renumber:reg              → DRY-RUN: hanya menampilkan rencana perubahan
 *   npm run renumber:reg -- --commit  → benar-benar menulis ke database
 *
 * Aman diulang: registrasi yang sudah berformat acak dilewati.
 */
import { db } from '../src/config/db.js';
import { randomSerial } from '../src/utils/numbering.js';

/** Persis skema lama: PREFIX-TAHUN-NNNN dengan 4 digit angka. */
const POLA_LAMA = /^(UMR|HAJ)-(\d{4})-(\d{4})$/;

async function main() {
  const commit = process.argv.includes('--commit');

  const rows = await db('registrations').select('id', 'reg_number').orderBy('created_at');
  const perluDiganti = rows.filter((r) => POLA_LAMA.test(r.reg_number));

  if (perluDiganti.length === 0) {
    console.log(`Tidak ada nomor berformat lama. Total registrasi: ${rows.length}. Tidak ada yang perlu dikerjakan.`);
    await db.destroy();
    return;
  }

  console.log(
    `${perluDiganti.length} dari ${rows.length} registrasi masih berformat berurutan.` +
      (commit ? ' Menulis perubahan…' : ' DRY-RUN — tidak ada yang ditulis.')
  );

  // Nomor terpakai dikumpulkan di memori supaya calon nomor baru dicek terhadap nomor
  // lama MAUPUN nomor yang baru saja dibuat dalam proses yang sama.
  const terpakai = new Set<string>(rows.map((r) => r.reg_number));
  const rencana: Array<{ id: string; lama: string; baru: string }> = [];

  for (const r of perluDiganti) {
    const [, prefix, tahun] = POLA_LAMA.exec(r.reg_number)!;
    let baru = '';
    for (let i = 0; i < 10 && !baru; i++) {
      const calon = `${prefix}-${tahun}-${randomSerial(8)}`;
      if (!terpakai.has(calon)) baru = calon;
    }
    if (!baru) throw new Error(`Gagal membuat nomor unik untuk ${r.reg_number} setelah 10 percobaan`);
    terpakai.add(baru);
    rencana.push({ id: r.id, lama: r.reg_number, baru });
  }

  for (const p of rencana) console.log(`  ${p.lama}  →  ${p.baru}`);

  if (!commit) {
    console.log('\nDRY-RUN selesai. Jalankan ulang dengan `-- --commit` untuk menerapkannya.');
    await db.destroy();
    return;
  }

  // Satu transaksi: kalau ada satu saja yang gagal, tidak ada jamaah yang setengah
  // terganti nomornya — kondisi paling membingungkan untuk dipulihkan.
  await db.transaction(async (trx) => {
    for (const p of rencana) {
      await trx('registrations').where({ id: p.id }).update({ reg_number: p.baru, updated_at: trx.fn.now() });
    }
  });

  console.log(`\nSelesai: ${rencana.length} nomor registrasi diganti.`);
  console.log('INGAT: beri tahu jamaah terkait — nomor lama mereka tidak bisa dipakai login lagi.');
  await db.destroy();
}

main().catch(async (err) => {
  console.error('Gagal:', err);
  await db.destroy();
  process.exit(1);
});
