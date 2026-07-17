import { db } from '../../config/db.js';

export interface UserRow {
  id: string;
  branch_id: string;
  role_id: string;
  name: string;
  email: string;
  password_hash: string;
  is_active: boolean;
  role_name: string;
  role_label: string;
  permissions: Record<string, unknown>;
  branch_name: string;
}

export const authRepository = {
  findUserByEmail(email: string): Promise<UserRow | undefined> {
    return db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .join('branches', 'branches.id', 'users.branch_id')
      .select(
        'users.*',
        'roles.name as role_name',
        'roles.label as role_label',
        'roles.permissions',
        'branches.name as branch_name'
      )
      .where('users.email', email)
      .first();
  },

  findUserById(id: string): Promise<UserRow | undefined> {
    return db('users')
      .join('roles', 'roles.id', 'users.role_id')
      .join('branches', 'branches.id', 'users.branch_id')
      .select(
        'users.*',
        'roles.name as role_name',
        'roles.label as role_label',
        'roles.permissions',
        'branches.name as branch_name'
      )
      .where('users.id', id)
      .first();
  },

  insertRefreshToken(userId: string, tokenHash: string, expiresAt: Date) {
    return db('refresh_tokens').insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt });
  },

  findRefreshToken(tokenHash: string) {
    return db('refresh_tokens').where({ token_hash: tokenHash }).first();
  },

  revokeRefreshToken(tokenHash: string) {
    return db('refresh_tokens').where({ token_hash: tokenHash }).update({ revoked_at: db.fn.now() });
  }
};
