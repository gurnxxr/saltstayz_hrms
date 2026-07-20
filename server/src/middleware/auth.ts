import { Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../config/auth';
import db from '../config/database';
import { AuthRequest } from '../types';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

// role_id → role name, cached in memory (roles are static seed data). Avoids a DB round-trip
// per request while keeping req.user.roleName exactly what RBAC + the client expect.
let roleNames: Map<number, string> | null = null;
async function roleNameFor(roleId: number | null | undefined): Promise<string> {
  if (roleId == null) return '';
  if (!roleNames) {
    const rows = await db('roles').select('id', 'name');
    roleNames = new Map((rows as any[]).map((r) => [r.id, r.name]));
  }
  return roleNames.get(roleId) ?? '';
}

// Authenticate via the Better Auth session (server-side), NOT a self-verifying token. Because
// the session is looked up live, logout and deactivation take effect immediately. The signed-in
// user is mapped to the SAME req.user shape the app already uses, so RBAC and every controller
// are unchanged.
export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    const u = session?.user as (Record<string, any> | undefined);
    if (!u) return next(new UnauthorizedError('Not authenticated'));

    // Login is disabled the instant an account is deactivated or banned.
    if (u.is_active === false || u.is_active === 0 || u.banned === true || u.banned === 1) {
      return next(new ForbiddenError('This account is inactive.'));
    }

    req.user = {
      userId: Number(u.id),
      email: u.email,
      roleId: u.role_id ?? null,
      roleName: (u.role as string) || (await roleNameFor(u.role_id)),
      employeeId: u.employee_id ?? null,
      firstName: u.name ? String(u.name).split(' ')[0] : null,
    };
    next();
  } catch (err) {
    next(err);
  }
}
