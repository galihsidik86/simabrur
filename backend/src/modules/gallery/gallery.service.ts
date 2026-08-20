import type { Request } from 'express';
import { db } from '../../config/db.js';
import { errors } from '../../utils/http.js';
import { audit } from '../../middleware/audit.js';
import { resolveUploadPath } from '../jamaah/storage.js';
import fs from 'node:fs/promises';

export interface UploadedPhoto {
  fileUrl: string;
  contentType: string;
  fileSize: number;
  caption: string | null;
}

function mapPhoto(p: {
  id: string; file_url: string; content_type: string; file_size: number; caption: string | null; created_at: Date;
}) {
  return {
    id: p.id,
    fileUrl: p.file_url,
    contentType: p.content_type,
    fileSize: Number(p.file_size),
    caption: p.caption,
    createdAt: p.created_at
  };
}

export const galleryService = {
  async assertDeparture(departureId: string) {
    const dep = await db('departures').where({ id: departureId }).first();
    if (!dep) throw errors.notFound('Keberangkatan tidak ditemukan');
    return dep;
  },

  /** Daftar foto satu keberangkatan (terbaru dulu). */
  async listByDeparture(departureId: string) {
    const rows = await db('gallery_photos').where({ departure_id: departureId }).orderBy('created_at', 'desc');
    return rows.map(mapPhoto);
  },

  /** Simpan metadata foto yang sudah ditulis multer ke disk. */
  async addPhotos(req: Request, departureId: string, photos: UploadedPhoto[]) {
    if (photos.length === 0) throw errors.badRequest('Tidak ada foto yang diunggah (field "files")');
    const inserted = await db('gallery_photos')
      .insert(
        photos.map((p) => ({
          departure_id: departureId,
          file_url: p.fileUrl,
          content_type: p.contentType,
          file_size: p.fileSize,
          caption: p.caption,
          uploaded_by: req.user?.id ?? null
        }))
      )
      .returning('*');
    await audit(req, { action: 'gallery.upload', entity: 'departures', entityId: departureId, newValues: { count: photos.length } });
    return inserted.map(mapPhoto);
  },

  /** Ambil satu foto; bila `departureId` diberikan, wajib milik keberangkatan itu (scoping portal). */
  async getPhoto(photoId: string, departureId?: string) {
    const q = db('gallery_photos').where({ id: photoId });
    if (departureId) q.andWhere({ departure_id: departureId });
    const photo = await q.first();
    if (!photo) throw errors.notFound('Foto tidak ditemukan');
    return photo;
  },

  async remove(req: Request, photoId: string) {
    const photo = await this.getPhoto(photoId);
    await db('gallery_photos').where({ id: photoId }).del();
    // Hapus file fisik best-effort — baris DB adalah sumber kebenaran; file yatim tak fatal.
    try {
      await fs.unlink(resolveUploadPath(String(photo.file_url)));
    } catch {
      /* file mungkin sudah tiada */
    }
    await audit(req, { action: 'gallery.delete', entity: 'departures', entityId: String(photo.departure_id), oldValues: { photoId } });
    return { deleted: true };
  }
};
