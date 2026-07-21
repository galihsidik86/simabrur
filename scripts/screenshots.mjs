/**
 * Potret layar aplikasi utk galeri README → docs/screenshots/*.png
 * Prasyarat: Microsoft Edge terpasang; target = dev server (default) atau produksi.
 * Jalankan: node scripts/screenshots.mjs [BASE_URL]
 *   contoh: node scripts/screenshots.mjs https://safar.sosmartpro.com
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? 'http://localhost:5173';
const API = process.argv[2] ? `${process.argv[2]}/v1` : 'http://localhost:3001/v1';
const OUT = path.resolve(import.meta.dirname, '../docs/screenshots');
fs.mkdirSync(OUT, { recursive: true });

// Data pendukung via API
async function apiLogin(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'safar123' })
  });
  return (await res.json()).data.accessToken;
}

const keuToken = await apiLogin('keuangan@safar.co.id');
const recv = await (await fetch(`${API}/receivables`, { headers: { Authorization: `Bearer ${keuToken}` } })).json();
const siti = recv.data.data.find((r) => r.regNumber === 'UMR-2026-0418');

const browser = await chromium.launch({ channel: 'msedge', headless: true });

async function shot(name, { url, size = { width: 1440, height: 900 }, before, fullPage = false }) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  if (before) await before(page);
  await page.goto(BASE + url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // font + query settle
  await page.screenshot({ path: path.join(OUT, name + '.png'), fullPage });
  await ctx.close();
  console.log('✓', name);
}

async function staffLogin(page, email = 'admin@safar.co.id') {
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#email', email);
  await page.fill('#password', 'safar123');
  await page.click('button[type=submit]');
  await page.waitForURL(BASE + '/**', { timeout: 15000 });
  await page.waitForTimeout(1200);
}

// 1. Dashboard eksekutif (admin)
await shot('dashboard', { url: '/', before: (p) => staffLogin(p) });
// 2. Wizard pendaftaran publik
await shot('wizard-pendaftaran', { url: '/daftar' });
// 3. Kartu piutang pembayaran (keuangan)
await shot('pembayaran', { url: '/pembayaran', before: (p) => staffLogin(p, 'keuangan@safar.co.id') });
// 4. Input transaksi + preview jurnal gelap
await shot('input-transaksi', { url: '/keuangan/input', before: (p) => staffLogin(p, 'keuangan@safar.co.id') });
// 5. Laporan keuangan (neraca)
await shot('laporan-keuangan', {
  url: '/laporan-keuangan',
  before: async (p) => {
    await staffLogin(p, 'keuangan@safar.co.id');
  }
});
// 5b. Master data paket (kategori, hotel, maskapai) & keuangan (vendor, rekening bank)
await shot('master-paket', { url: '/paket/master', before: (p) => staffLogin(p) });
await shot('master-keuangan', { url: '/keuangan-master', before: (p) => staffLogin(p) });
// 6. Invoice A4 golden thread
if (siti) {
  await shot('invoice-a4', { url: `/dokumen/invoice/${siti.invoiceId}`, before: (p) => staffLogin(p, 'keuangan@safar.co.id'), fullPage: true });
}
// 7. Portal jamaah (frame ponsel) — login via API portal, token ke sessionStorage
{
  const nik = process.env.PORTAL_NIK;
  if (nik) {
    const res = await fetch(`${API}/portal/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ regNumber: 'UMR-2026-0418', nik })
    });
    const token = (await res.json()).data?.token;
    if (token) {
      await shot('portal-jamaah', {
        url: '/portal',
        size: { width: 560, height: 980 },
        before: async (p) => {
          await p.goto(BASE + '/portal', { waitUntil: 'domcontentloaded' });
          await p.evaluate((t) => sessionStorage.setItem('safar.portal', t), token);
        }
      });
    }
  } else {
    console.log('lewati portal-jamaah (set PORTAL_NIK utk menyertakan)');
  }
}

await browser.close();
console.log('Selesai →', OUT);
