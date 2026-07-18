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
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
}
