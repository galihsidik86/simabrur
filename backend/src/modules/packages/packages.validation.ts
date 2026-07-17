import { z } from 'zod';

export const createPackageSchema = z.object({
  code: z.string().min(3).max(30),
  name: z.string().min(3),
  type: z.enum(['umrah', 'haji']),
  category: z.enum(['reguler', 'plus', 'vip', 'khusus']),
  durationDays: z.number().int().min(1).max(60),
  basePrice: z.number().positive(),
  tripleUpcharge: z.number().min(0).default(3_500_000),
  doubleUpcharge: z.number().min(0).default(8_000_000),
  hotelId: z.string().uuid().nullish(),
  airlineId: z.string().uuid().nullish(),
  costs: z
    .array(z.object({ component: z.string().min(2), amount: z.number().min(0) }))
    .default([]),
  departure: z
    .object({
      departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      quota: z.number().int().min(1)
    })
    .nullish()
});

export const updatePackageSchema = createPackageSchema.partial().omit({ departure: true });

export const createDepartureSchema = z.object({
  packageId: z.string().uuid(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  quota: z.number().int().min(1)
});

export const listPackagesQuery = z.object({
  type: z.enum(['umrah', 'haji']).optional(),
  status: z.enum(['aktif', 'ditutup']).optional()
});
