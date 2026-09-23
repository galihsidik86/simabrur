import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Format email tidak valid'),
  password: z.string().min(1, 'Password wajib diisi')
});

// `refreshSchema` DIHAPUS (SEC-07): refresh token tidak lagi dikirim lewat body —
// ia dibaca dari cookie httpOnly `safar.refresh`, jadi tidak ada body yang divalidasi.
