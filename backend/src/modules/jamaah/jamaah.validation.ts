import { z } from 'zod';

export const createRegistrationSchema = z.object({
  departureId: z.string().uuid(),
  roomType: z.enum(['quad', 'triple', 'double']).default('quad'),
  paymentScheme: z.enum(['dp', 'cicil', 'lunas']).default('dp'),
  source: z.string().max(60).default('web'),
  jamaah: z.object({
    nik: z.string().regex(/^\d{16}$/, 'NIK harus 16 digit angka'),
    fullName: z.string().min(3, 'Nama minimal 3 karakter'),
    gender: z.enum(['L', 'P']),
    birthPlace: z.string().min(2),
    birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    phone: z.string().min(8),
    email: z.string().email().nullish(),
    address: z.string().min(5),
    emergencyContactName: z.string().min(2),
    emergencyContactPhone: z.string().min(8),
    // DOM-01: paspor WAJIB (PLAN.md §4.7) — dulu nullish, celah menembus wizard publik.
    passportNo: z.string().trim().min(6, 'Nomor paspor minimal 6 karakter'),
    passportIssuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal berlaku paspor YYYY-MM-DD'),
    mahramName: z.string().nullish(),
    mahramRelation: z.string().nullish()
  })
});

export const updateJamaahSchema = z
  .object({
    fullName: z.string().min(3, 'Nama minimal 3 karakter').optional(),
    gender: z.enum(['L', 'P']).optional(),
    phone: z.string().min(8).optional(),
    email: z.string().email().nullish(),
    address: z.string().min(5).optional(),
    emergencyContactName: z.string().min(2).optional(),
    emergencyContactPhone: z.string().min(8).optional(),
    mahramName: z.string().min(2).nullish(),
    mahramRelation: z.string().min(2).nullish(),
    // DOM-01 (opsional M): staf bisa melengkapi paspor jamaah yang belum punya —
    // divalidasi ≥7 bulan terhadap keberangkatan registrasi aktif jamaah di service.
    passportNo: z.string().trim().min(6, 'Nomor paspor minimal 6 karakter').nullish(),
    passportIssuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal berlaku paspor YYYY-MM-DD').nullish()
  })
  .refine((o) => Object.values(o).some((v) => v !== undefined), 'Minimal satu field harus diisi');

export const cancelRegistrationSchema = z.object({
  reason: z.string().trim().min(5, 'Alasan pembatalan minimal 5 karakter')
});

export const passportCheckQuery = z.object({
  departureId: z.string().uuid(),
  expiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const verifyDocumentSchema = z.object({
  status: z.enum(['verified', 'rejected']),
  note: z.string().max(500).nullish()
});

export const listJamaahQuery = z.object({
  tab: z.enum(['semua', 'dokumen', 'lunas']).default('semua'),
  q: z.string().max(100).optional(),
  // G (putaran 3): filter status registrasi & penanda menunggu konfirmasi identitas.
  // Default (tanpa filter): tampilkan SEMUA status, termasuk cancelled.
  status: z.enum(['pending_documents', 'active', 'completed', 'cancelled']).optional(),
  // R3TS-01: JANGAN pakai z.coerce.boolean() untuk query string — semua
  // string tak kosong menjadi true, sehingga `?identityPending=false` justru
  // MENGAKTIFKAN filter. Terima hanya 'true'/'false'; nilai lain ditolak 400.
  identityPending: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'] as const;
export const REQUIRED_DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS'] as const; // NKH opsional
