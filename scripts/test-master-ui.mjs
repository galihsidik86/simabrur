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
console.log(`\nScreenshot: docs/screenshots/master-paket.png`);
await browser.close();

console.log(failures === 0 ? '\nSEMUA UJI LULUS' : `\n${failures} UJI GAGAL`);
process.exit(failures === 0 ? 0 : 1);
