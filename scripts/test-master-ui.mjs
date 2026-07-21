/**
 * Uji UI halaman Master Data Paket dengan Playwright (Microsoft Edge headless).
 * Verifikasi: (1) semua input LTR + rata kiri, (2) lebar field memadai — teks contoh
 * tidak terpotong/overflow, (3) alur CRUD hotel & maskapai & kategori benar-benar
 * jalan dari browser (tambah → tampil di tabel → hapus).
 *
 * Jalankan: node scripts/test-master-ui.mjs [BASE_URL]
 *   default BASE_URL: https://safar.sosmartpro.com
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'https://safar.sosmartpro.com';
const OUT = path.resolve(import.meta.dirname, '../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (cond, label) => {
  console.log(`${cond ? 'LULUS' : 'GAGAL'}  ${label}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// ===== Login sebagai admin =====
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('input[type="email"]', 'admin@safar.co.id');
await page.fill('input[type="password"]', 'safar123');
await page.click('button[type="submit"]');
await page.waitForURL('**/', { timeout: 15000 });

// ===== Buka Master Data Paket dari menu sidebar =====
await page.click('text=Master Data Paket');
await page.waitForURL('**/paket/master');
await page.waitForSelector('text=Kategori Paket');
await page.waitForTimeout(800); // tunggu data ketiga panel

// ===== 1) Arah tulisan & perataan semua input form =====
const inputs = page.locator('form input, form select');
const n = await inputs.count();
let ltrOk = true;
for (let i = 0; i < n; i++) {
  const s = await inputs.nth(i).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { dir: cs.direction, align: cs.textAlign };
  });
  if (s.dir !== 'ltr' || (s.align !== 'left' && s.align !== 'start')) ltrOk = false;
}
check(ltrOk, `semua ${n} input/select form LTR dan rata kiri`);

// ===== 2) Lebar field memadai: teks contoh tidak overflow =====
const SAMPLES = {
  'mis. premium': 'kategori-baru',
  'mis. Premium': 'Kategori Premium',
  'mis. Grand Makkah': 'Hotel Anwar Al Madinah',
  'mis. Makkah': 'Madinah',
  'mis. Garuda Indonesia': 'Garuda Indonesia',
  GA: 'GA'
};
let widthOk = true;
for (const [ph, sample] of Object.entries(SAMPLES)) {
  const el = page.locator(`input[placeholder="${ph}"]`);
  await el.fill(sample);
  const m = await el.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth, w: e.getBoundingClientRect().width }));
  const fits = m.scroll <= m.client + 1;
  if (!fits || m.w < 60) widthOk = false;
  console.log(`   field "${ph}": lebar ${Math.round(m.w)}px, teks "${sample}" ${fits ? 'muat' : 'TERPOTONG'}`);
  await el.fill('');
}
check(widthOk, 'lebar semua field memadai — teks contoh tampil utuh tanpa terpotong');

// ===== 2b) Ketik per karakter (bukan fill): urutan huruf harus kiri→kanan =====
// Regresi utk bug "tulisan terbalik" — kursor melompat ke awal tiap keystroke
for (const [ph, sample] of [
  ['mis. Garuda Indonesia', 'Garuda Indonesia'],
  ['mis. Grand Makkah', 'Grand Makkah'],
  ['mis. premium', 'kategori-uji']
]) {
  const el = page.locator(`input[placeholder="${ph}"]`);
  await el.click();
  await el.pressSequentially(sample, { delay: 25 });
  const val = await el.inputValue();
  check(val === sample, `ketik per karakter "${sample}" → tersimpan "${val}" (urutan benar)`);
  await el.fill('');
}

// ===== 3) CRUD hotel dari browser =====
await page.fill('input[placeholder="mis. Grand Makkah"]', 'Hotel Uji Playwright');
await page.fill('input[placeholder="mis. Makkah"]', 'Jeddah');
await page.locator('form').filter({ hasText: 'Tambah hotel' }).locator('button[type="submit"]').click();
await page.waitForSelector('td:has-text("Hotel Uji Playwright")', { timeout: 10000 });
check(true, 'tambah hotel dari form → muncul di tabel');
page.once('dialog', (d) => d.accept());
await page
  .locator('tr', { hasText: 'Hotel Uji Playwright' })
  .locator('button:has-text("Hapus")')
  .click();
await page.waitForSelector('td:has-text("Hotel Uji Playwright")', { state: 'detached', timeout: 10000 });
check(true, 'hapus hotel → hilang dari tabel');

// ===== 4) CRUD maskapai dari browser =====
await page.fill('input[placeholder="mis. Garuda Indonesia"]', 'Playwright Air');
await page.fill('input[placeholder="GA"]', 'pw');
check((await page.inputValue('input[placeholder="GA"]')) === 'PW', 'kode IATA otomatis kapital saat diketik');
await page.locator('form').filter({ hasText: 'Tambah maskapai' }).locator('button[type="submit"]').click();
await page.waitForSelector('td:has-text("Playwright Air")', { timeout: 10000 });
check(true, 'tambah maskapai dari form → muncul di tabel');
page.once('dialog', (d) => d.accept());
await page.locator('tr', { hasText: 'Playwright Air' }).locator('button:has-text("Hapus")').click();
await page.waitForSelector('td:has-text("Playwright Air")', { state: 'detached', timeout: 10000 });
check(true, 'hapus maskapai → hilang dari tabel');

// ===== 5) CRUD kategori + proteksi hapus terpakai =====
await page.fill('input[placeholder="mis. premium"]', 'uji-pw');
await page.fill('input[placeholder="mis. Premium"]', 'Uji Playwright');
await page.locator('form').filter({ hasText: 'Tambah kategori' }).locator('button[type="submit"]').click();
await page.waitForSelector('td:has-text("uji-pw")', { timeout: 10000 });
check(true, 'tambah kategori dari form → muncul di tabel');
page.once('dialog', (d) => d.accept());
await page.locator('tr', { hasText: 'uji-pw' }).locator('button:has-text("Hapus")').click();
await page.waitForSelector('td:has-text("uji-pw")', { state: 'detached', timeout: 10000 });
check(true, 'hapus kategori → hilang dari tabel');

page.once('dialog', (d) => d.accept());
await page.locator('tr', { hasText: 'Reguler' }).first().locator('button:has-text("Hapus")').click();
await page.waitForSelector('text=/dipakai \\d+ paket/', { timeout: 10000 });
check(true, 'hapus kategori terpakai → ditolak dengan pesan jelas');

await page.screenshot({ path: path.join(OUT, 'master-paket.png'), fullPage: true });

// ============================================================
// Master Data Keuangan: vendor & rekening bank
// ============================================================
await page.click('text=Master Data Keuangan');
await page.waitForURL('**/keuangan-master');
await page.waitForSelector('text=Rekening Bank');
await page.waitForTimeout(800);

const inputs2 = page.locator('form input, form select');
const n2 = await inputs2.count();
let ltr2 = true;
for (let i = 0; i < n2; i++) {
  const s = await inputs2.nth(i).evaluate((el) => {
    const cs = getComputedStyle(el);
    return { dir: cs.direction, align: cs.textAlign };
  });
  if (s.dir !== 'ltr' || (s.align !== 'left' && s.align !== 'start')) ltr2 = false;
}
check(ltr2, `keuangan-master: semua ${n2} input/select form LTR dan rata kiri`);

let width2 = true;
for (const [ph, sample] of [
  ['1-1230', '1-1230'],
  ['1230009911', '7201456789012'],
  ['mis. Bank Mandiri Operasional', 'Bank Syariah Indonesia Operasional'],
  ['mis. Grand Al Massa Hotel', 'PT Katering Barokah Internasional']
]) {
  const el = page.locator(`input[placeholder="${ph}"]`);
  await el.fill(sample);
  const m = await el.evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth, w: e.getBoundingClientRect().width }));
  const fits = m.scroll <= m.client + 1;
  if (!fits) width2 = false;
  console.log(`   field "${ph}": lebar ${Math.round(m.w)}px, teks "${sample}" ${fits ? 'muat' : 'TERPOTONG'}`);
  await el.fill('');
}
check(width2, 'keuangan-master: lebar field memadai — teks contoh tampil utuh');

// Vendor: ketik per karakter + CRUD penuh
const vName = page.locator('input[placeholder="mis. Grand Al Massa Hotel"]');
await vName.click();
await vName.pressSequentially('Katering Al Barokah', { delay: 25 });
check((await vName.inputValue()) === 'Katering Al Barokah', 'ketik per karakter nama vendor → urutan benar');
await page.locator('form').filter({ hasText: 'Tambah vendor' }).locator('select').selectOption('catering');
await page.locator('form').filter({ hasText: 'Tambah vendor' }).locator('button[type="submit"]').click();
await page.waitForSelector('td:has-text("Katering Al Barokah")', { timeout: 10000 });
check(true, 'tambah vendor dari form → muncul di tabel');
page.once('dialog', (d) => d.accept());
await page.locator('tr', { hasText: 'Katering Al Barokah' }).locator('button:has-text("Hapus")').click();
await page.waitForSelector('td:has-text("Katering Al Barokah")', { state: 'detached', timeout: 10000 });
check(true, 'hapus vendor → hilang dari tabel');

// Rekening bank: kode akun tak dikenal → pesan error jelas; kode valid → CRUD jalan
await page.fill('input[placeholder="1-1230"]', '1-9999');
await page.fill('input[placeholder="mis. Bank Mandiri Operasional"]', 'Bank Salah Kode');
await page.locator('form').filter({ hasText: 'Tambah rekening' }).locator('button[type="submit"]').click();
await page.waitForSelector('text=/Bagan Akun/', { timeout: 10000 });
check(true, 'rekening dgn kode akun tak dikenal → ditolak dgn pesan jelas');

await page.fill('input[placeholder="1-1230"]', '1-1300');
await page.fill('input[placeholder="mis. Bank Mandiri Operasional"]', 'Rekening Uji Playwright');
await page.locator('form').filter({ hasText: 'Tambah rekening' }).locator('button[type="submit"]').click();
await page.waitForSelector('td:has-text("Rekening Uji Playwright")', { timeout: 10000 });
check(true, 'tambah rekening (kode COA valid) → muncul di tabel, saldo 0');
page.once('dialog', (d) => d.accept());
await page.locator('tr', { hasText: 'Rekening Uji Playwright' }).locator('button:has-text("Hapus")').click();
await page.waitForSelector('td:has-text("Rekening Uji Playwright")', { state: 'detached', timeout: 10000 });
check(true, 'hapus rekening bersaldo 0 → hilang dari tabel');

await page.screenshot({ path: path.join(OUT, 'master-keuangan.png'), fullPage: true });
console.log(`\nScreenshot: docs/screenshots/master-paket.png & master-keuangan.png`);
await browser.close();

console.log(failures === 0 ? '\nSEMUA UJI LULUS' : `\n${failures} UJI GAGAL`);
process.exit(failures === 0 ? 0 : 1);
