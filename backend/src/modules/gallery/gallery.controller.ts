import path from 'node:path';
import type { Request, Response } from 'express';
import { ok, errors } from '../../utils/http.js';
import { galleryService } from './gallery.service.js';
import { resolveUploadPath } from '../jamaah/storage.js';
import { streamZip, safeEntryName, type ZipEntry } from '../../utils/zip.js';

const CONTENT_TYPE: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp'
};

/** Sajikan byte foto dengan header aman. Dipakai endpoint staf & portal (setelah cek kepemilikan). */
export function sendPhotoFile(res: Response, fileUrl: string) {
  const abs = resolveUploadPath(fileUrl);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Type', CONTENT_TYPE[path.extname(abs).toLowerCase()] ?? 'application/octet-stream');
  res.sendFile(abs);
}

/** Rakit entri ZIP dari daftar foto sebuah keberangkatan (nama unik & aman). */
export function zipEntriesFor(photos: { fileUrl: string; caption: string | null }[]): ZipEntry[] {
  return photos.map((p, i) => {
    const ext = path.extname(p.fileUrl).toLowerCase() || '.jpg';
    const base = p.caption ? safeEntryName(p.caption) : `foto-${String(i + 1).padStart(3, '0')}`;
    return { name: `${String(i + 1).padStart(3, '0')}-${base}${ext}`, absPath: resolveUploadPath(p.fileUrl) };
  });
}

export const galleryController = {
  async list(req: Request, res: Response) {
    const departureId = String(req.params.id);
    await galleryService.assertDeparture(departureId);
    ok(res, await galleryService.listByDeparture(departureId));
  },

  async upload(req: Request, res: Response) {
    const departureId = String(req.params.id);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const captions = req.body.captions; // opsional: string atau array sejajar files
    const photos = files.map((f, i) => ({
      fileUrl: `/uploads/gallery/${departureId}/${f.filename}`,
      contentType: f.mimetype,
      fileSize: f.size,
      caption: (Array.isArray(captions) ? captions[i] : i === 0 ? captions : undefined) || null
    }));
    ok(res, await galleryService.addPhotos(req, departureId, photos), undefined, 201);
  },

  async remove(req: Request, res: Response) {
    ok(res, await galleryService.remove(req, String(req.params.photoId)));
  },

  /** Serve satu foto untuk staf (butuh auth staf di route). */
  async file(req: Request, res: Response) {
    const photo = await galleryService.getPhoto(String(req.params.photoId));
    sendPhotoFile(res, String(photo.file_url));
  },

  /** Unduh semua foto satu keberangkatan sebagai ZIP (staf). */
  async zip(req: Request, res: Response) {
    const departureId = String(req.params.id);
    await galleryService.assertDeparture(departureId);
    const photos = await galleryService.listByDeparture(departureId);
    if (photos.length === 0) throw errors.notFound('Belum ada foto pada keberangkatan ini');
    await streamZip(res, zipEntriesFor(photos), 'galeri-rombongan.zip');
  }
};

export { streamZip };
