import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { errors } from '../../utils/http.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Akar penyimpanan dokumen jamaah (paspor/KTP/dll) — TIDAK disajikan statis publik. */
export const UPLOAD_ROOT = path.resolve(__dirname, '../../../uploads');

/**
 * Ubah file_url dokumen (`/uploads/<id>/<file>`) menjadi path absolut yang dijamin
 * berada di dalam UPLOAD_ROOT. Menolak path traversal (file_url manipulatif di DB).
 */
export function resolveUploadPath(fileUrl: string): string {
  const rel = fileUrl.replace(/^\/uploads\//, '');
  const abs = path.resolve(UPLOAD_ROOT, rel);
  const root = path.resolve(UPLOAD_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw errors.badRequest('Path dokumen tidak valid');
  }
  if (!fs.existsSync(abs)) throw errors.notFound('Berkas dokumen tidak ditemukan');
  return abs;
}
