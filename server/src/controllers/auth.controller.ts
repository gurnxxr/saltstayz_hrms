import { Response, NextFunction } from 'express';
import db from '../config/database';
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
    // Does anyone report to this person? A capability, resolved once per session, so the Approvals
    // tab on /leaves/my can be drawn on the first paint rather than inferred from whether the
    // approver's queue happens to be non-empty right now. That inference is what made a line
    // manager with nothing to approve lose the tab entirely — and with it any way to look at what
    // they had already decided, or to follow the "leave request submitted" notification, which
    // deep-links straight to it.
    //
    // It cannot be derived on the client. `employee` is a role and says nothing about who reports
    // to you, and seeds/01_roles_permissions.ts grants leave only read/create/update — there is no
    // 'approve' action, so can('leave','approve') is false for everybody including admins.
    //
    // reporting_manager_id carries no index (Postgres does not index the referencing side of a
    // foreign key). Deliberately left that way: this is a LIMIT 1 over a few hundred rows, once
    // per session, and an index on a table this size would be slower than the scan it replaced.
    const managesAnyone = u.employeeId
      ? !!(await db('employees')
          .where('reporting_manager_id', u.employeeId)
          .where('is_active', true)
          .first('id'))
      : false;
    res.json({ user: { ...u, managesAnyone }, permissions, overrides });
  } catch (err) {
    next(err);
  }
}
