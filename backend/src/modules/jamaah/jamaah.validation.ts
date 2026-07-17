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
    passportNo: z.string().min(6).nullish(),
    passportIssuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    passportExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    mahramName: z.string().nullish(),
    mahramRelation: z.string().nullish()
  })
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
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export const DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS', 'NKH'] as const;
export const REQUIRED_DOC_TYPES = ['KTP', 'KK', 'PPR', 'FTO', 'VKS'] as const; // NKH opsional
