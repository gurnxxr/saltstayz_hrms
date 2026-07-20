import { Response, NextFunction } from 'express';
import { getUserPermissions } from '../services/auth.service';
import { getEmployeeOverrides } from '../services/moduleAccess.service';
import { AuthRequest } from '../types';

// Sign-in / sign-out / password change are handled by Better Auth (mounted at /api/v1/auth/*).
// This endpoint hydrates the client AFTER a session exists: the signed-in user plus the app's
// permission set and per-employee overrides. Better Auth owns identity; the app owns
// authorization, so this stitches the two together. Runs behind `authenticate`.
export async function sessionContext(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const u = req.user!;
    const permissions = await getUserPermissions(u.roleId as number, u.employeeId);
    const overrides = u.employeeId ? await getEmployeeOverrides(u.employeeId) : { granted: [], denied: [] };
    res.json({ user: u, permissions, overrides });
  } catch (err) {
    next(err);
  }
}
