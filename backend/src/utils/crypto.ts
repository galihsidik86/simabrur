import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { errors } from './http.js';

/**
 * AES-256-GCM utk data sensitif kecil (password awal Mabrur).
 * Format: iv:tag:cipher (hex) — pola yang sama dgn crypto.service Mabrur.
 */

function key(): Buffer {
  const k = env.mabrur.encryptionKey;
  if (!/^[0-9a-f]{64}$/i.test(k)) {
    throw errors.badRequest('SAFAR_ENCRYPTION_KEY belum dikonfigurasi (64 karakter hex)');
  }
  return Buffer.from(k, 'hex');
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const parts = String(payload).split(':');
  if (parts.length !== 3) throw errors.badRequest('Format ciphertext tidak valid');
  const [ivHex, tagHex, dataHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  // GCM: IV 12 byte, auth tag WAJIB 16 byte — tag terpotong akan ditolak
  // (tanpa ini setAuthTag menerima tag pendek → peluang forgery jauh lebih besar).
  if (iv.length !== 12 || tag.length !== 16) throw errors.badRequest('IV/auth tag tidak valid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv, { authTagLength: 16 });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
