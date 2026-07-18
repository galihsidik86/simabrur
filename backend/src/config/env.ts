import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Env ${name} wajib diisi (lihat backend/.env.example)`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isTest: process.env.NODE_ENV === 'test',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  databaseUrlTest: process.env.DATABASE_URL_TEST ?? '',
  /** Origin frontend terpisah (CORS). Kosong = same-origin (frontend disajikan backend). */
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7)
  },
  /** Integrasi Mabrur (aplikasi lapangan) — opsional; kosong = sinkron dinonaktifkan. */
  mabrur: {
    apiUrl: (process.env.MABRUR_API_URL ?? '').replace(/\/$/, ''),
    serviceToken: process.env.MABRUR_SERVICE_TOKEN ?? '',
    encryptionKey: process.env.SAFAR_ENCRYPTION_KEY ?? ''
  }
};

// Gagal keras di produksi bila secret masih default dev / terlalu pendek
if (env.isProduction) {
  for (const [name, value] of [
    ['JWT_ACCESS_SECRET', env.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', env.jwt.refreshSecret]
  ] as const) {
    if (value.includes('dev-') || value.includes('jangan-dipakai') || value.length < 32) {
      throw new Error(
        `${name} tidak aman untuk produksi (masih default dev / < 32 karakter). ` +
          `Buat secret acak: node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
      );
    }
  }
  if (env.databaseUrl.includes('safar_dev')) {
    console.warn('⚠ DATABASE_URL memakai password default dev — ganti untuk produksi.');
  }
}
