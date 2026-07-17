import type { Response } from 'express';

export interface Meta {
  page?: number;
  limit?: number;
  total?: number;
}

export function ok(res: Response, data: unknown, meta?: Meta, status = 200) {
  const body: Record<string, unknown> = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const errors = {
  badRequest: (msg: string, details?: unknown) => new ApiError(400, 'BAD_REQUEST', msg, details),
  unauthorized: (msg = 'Tidak terautentikasi') => new ApiError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'Akses ditolak untuk role Anda') => new ApiError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Data tidak ditemukan') => new ApiError(404, 'NOT_FOUND', msg),
  conflict: (msg: string) => new ApiError(409, 'CONFLICT', msg)
};
