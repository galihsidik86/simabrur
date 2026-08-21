import fs from 'node:fs/promises';
import type { Response } from 'express';

/**
 * Penulis ZIP minimalis metode STORED (tanpa kompresi) langsung ke response.
 * Foto JPG/PNG sudah terkompresi → deflate tak berguna, jadi STORED cukup dan
 * membebaskan kita dari dependency (archiver/jszip). Setiap file dibaca satu per
 * satu (memori = satu file), CRC32 dihitung, lalu header + byte ditulis ke stream.
 *
 * Batas format ZIP 32-bit: per-file & total < 4 GB, < 65.535 entri — aman untuk
 * galeri satu rombongan. Bila melewati batas, pemanggil harus memecah.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Nama di dalam arsip (mis. "Grup A/foto-1.jpg"). */
  name: string;
  /** Path absolut file di disk. */
  absPath: string;
}

/** Nama file yang aman dipakai di dalam arsip (buang path traversal & pemisah). */
export function safeEntryName(name: string): string {
  return name.replace(/[\\/]+/g, '-').replace(/[\x00-\x1f<>:"|?*]/g, '').trim() || 'file';
}

/** Tulis satu buffer ke response dengan menghormati backpressure (tunggu `drain`
 *  bila buffer socket penuh) — agar arsip besar tidak menumpuk seluruhnya di memori. */
function write(res: Response, buf: Buffer): Promise<void> {
  if (res.write(buf)) return Promise.resolve();
  return new Promise((resolve) => res.once('drain', resolve));
}

export async function streamZip(res: Response, entries: ZipEntry[], downloadName: string): Promise<void> {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName.replace(/"/g, '')}"`);
  res.setHeader('Cache-Control', 'private, no-store');

  const central: Buffer[] = [];
  let offset = 0;
  // Waktu DOS tetap (kita tidak mengandalkan waktu file) — 2026-01-01 00:00.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

  for (const e of entries) {
    const data = await fs.readFile(e.absPath);
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const size = data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versi minimum
    local.writeUInt16LE(0x0800, 6); // flag: nama UTF-8
    local.writeUInt16LE(0, 8); // metode: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    await write(res, local);
    await write(res, nameBuf);
    await write(res, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // versi pembuat
    cd.writeUInt16LE(20, 6); // versi minimum
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk start
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // offset header lokal
    central.push(Buffer.concat([cd, nameBuf]));

    offset += local.length + nameBuf.length + size;
  }

  const centralBuf = Buffer.concat(central);
  await write(res, centralBuf);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk ini
  eocd.writeUInt16LE(0, 6); // disk awal CD
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  await write(res, eocd);
  res.end();
}
