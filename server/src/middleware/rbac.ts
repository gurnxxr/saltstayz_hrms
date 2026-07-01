import { Response, NextFunction } from 'express';
import { AuthRequest } from '../types';
import { ForbiddenError } from '../utils/errors';
import db from '../config/database';

export function authorize(requiredModule: string, requiredAction: string) {
  return async (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new ForbiddenError());
    }

    try {
      // Per-employee module override takes precedence over the role default
      if (req.user.employeeId) {
        const override = await db('employee_module_access')
          .where({ employee_id: req.user.employeeId, module: requiredModule })
          .first();
        if (override) {
          if (override.allowed) return next();
          return next(new ForbiddenError(`No access to ${requiredModule}:${requiredAction}`));
        }
      }

      const permission = await db('role_permissions')
        .join('permissions', 'permissions.id', 'role_permissions.permission_id')
        .where({
          'role_permissions.role_id': req.user.roleId,
          'permissions.module': requiredModule,
          'permissions.action': requiredAction,
        })
        .first();

      if (!permission) {
        return next(new ForbiddenError(`No access to ${requiredModule}:${requiredAction}`));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

export function authorizeRoles(...roles: string[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.roleName)) {
      return next(new ForbiddenError());
    }
    next();
  };
}
