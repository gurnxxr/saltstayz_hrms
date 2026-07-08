import { Request, Response, NextFunction } from 'express';
import * as authService from '../services/auth.service';
import { getEmployeeOverrides } from '../services/moduleAccess.service';
import { record as auditRecord } from '../services/audit.service';
import { AuthRequest } from '../types';

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
    const { token, user } = await authService.login(email, password);

    // Assemble the full response BEFORE staging the cookie: if the permission /
    // override queries throw, we must not emit a valid session cookie alongside
    // the resulting 500 (that would authenticate the browser while the UI shows
    // a login error — another "worked on the second attempt" trap).
    const permissions = await authService.getUserPermissions(user.roleId, user.employeeId);
    const overrides = user.employeeId ? await getEmployeeOverrides(user.employeeId) : { granted: [], denied: [] };

    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ user, permissions, overrides });

    void auditRecord({
      user_id: user.userId, actor_email: user.email, actor_role: user.roleName,
      action: 'login', module: 'auth', method: 'POST', path: 'auth/login',
      status_code: 200, summary: 'logged in', ip_address: req.ip ?? null,
    });
  } catch (err) {
    next(err);
  }
}

export async function me(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const permissions = await authService.getUserPermissions(req.user.roleId, req.user.employeeId);
    const overrides = req.user.employeeId ? await getEmployeeOverrides(req.user.employeeId) : { granted: [], denied: [] };

    res.json({ user: req.user, permissions, overrides });
  } catch (err) {
    next(err);
  }
}

export async function logout(req: AuthRequest, res: Response) {
  res.clearCookie('token');
  res.json({ message: 'Logged out' });
  if (req.user) {
    void auditRecord({
      user_id: req.user.userId, actor_email: req.user.email, actor_role: req.user.roleName,
      action: 'logout', module: 'auth', method: 'POST', path: 'auth/logout',
      status_code: 200, summary: 'logged out', ip_address: req.ip ?? null,
    });
  }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user.userId, currentPassword, newPassword);
    res.json(result);
    void auditRecord({
      user_id: req.user.userId, actor_email: req.user.email, actor_role: req.user.roleName,
      action: 'change-password', module: 'auth', method: 'POST', path: 'auth/change-password',
      status_code: 200, summary: 'changed own password', ip_address: req.ip ?? null,
    });
  } catch (err) {
    next(err);
  }
}
