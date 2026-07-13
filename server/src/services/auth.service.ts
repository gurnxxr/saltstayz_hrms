import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import db from '../config/database';
import { env } from '../config/env';
import { UnauthorizedError, ValidationError, NotFoundError } from '../utils/errors';
import { JwtPayload } from '../types';

export async function login(email: string, password: string) {
  const user = await db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .where('users.email', email)
    .where('users.is_active', true)
    .select(
      'users.id as userId',
      'users.email',
      'users.password_hash',
      'users.employee_id',
      'roles.id as roleId',
      'roles.name as roleName'
    )
    .first();

  if (!user) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const payload: JwtPayload = {
    userId: user.userId,
    email: user.email,
    roleId: user.roleId,
    roleName: user.roleName,
    employeeId: user.employee_id,
  };

  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: '24h' });

  return { token, user: payload };
}

/**
 * Live user identity straight from the DB. Email and role can change after the
 * JWT was minted at login, so /auth/me reads them fresh rather than trusting the
 * token's login-time snapshot. Returns null if the account is gone/deactivated.
 */
export async function getCurrentUser(userId: number): Promise<JwtPayload | null> {
  const row = await db('users')
    .join('roles', 'roles.id', 'users.role_id')
    .where('users.id', userId)
    .where('users.is_active', true)
    .select(
      'users.id as userId',
      'users.email',
      'users.employee_id',
      'roles.id as roleId',
      'roles.name as roleName'
    )
    .first();
  if (!row) return null;
  return {
    userId: row.userId,
    email: row.email,
    roleId: row.roleId,
    roleName: row.roleName,
    employeeId: row.employee_id,
  };
}

export async function changePassword(userId: number, currentPassword: string, newPassword: string) {
  const user = await db('users').where('id', userId).first();
  if (!user) throw new NotFoundError('User');

  if (!currentPassword || !newPassword) {
    throw new ValidationError('Current and new password are required');
  }
  if (newPassword.length < 4) {
    throw new ValidationError('New password must be at least 4 characters');
  }

  const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isMatch) throw new UnauthorizedError('Current password is incorrect');

  const password_hash = await bcrypt.hash(newPassword, 12);
  // The user has taken over their own password — the admin no longer knows it, so
  // drop the shareable plaintext (Admin → User Credentials then shows "changed by user").
  await db('users').where('id', userId).update({ password_hash, initial_password: null, updated_at: db.fn.now() });
  return { message: 'Password changed successfully' };
}

const OVERRIDE_ACTIONS = ['create', 'read', 'update', 'delete'];

export async function getUserPermissions(roleId: number, employeeId?: number | null) {
  let perms = await db('role_permissions')
    .join('permissions', 'permissions.id', 'role_permissions.permission_id')
    .where('role_permissions.role_id', roleId)
    .select('permissions.module', 'permissions.action');

  if (employeeId) {
    const overrides = await db('employee_module_access').where('employee_id', employeeId).select('module', 'allowed');
    if (overrides.length) {
      const denied = new Set(overrides.filter((o: any) => !o.allowed).map((o: any) => o.module));
      const granted = overrides.filter((o: any) => o.allowed).map((o: any) => o.module);
      // Remove denied modules entirely
      perms = perms.filter((p: any) => !denied.has(p.module));
      // Add granted modules (standard CRUD) if not already present
      for (const m of granted) {
        for (const a of OVERRIDE_ACTIONS) {
          if (!perms.some((p: any) => p.module === m && p.action === a)) perms.push({ module: m, action: a });
        }
      }
    }
  }
  return perms;
}
