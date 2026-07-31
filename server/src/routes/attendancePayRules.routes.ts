import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/attendancePayRules.controller';

const router = Router();
router.use(authenticate);

// Per-attendance-code pay rules — read + edit by Admin/Finance.
// Belt and braces, same as payroll.routes.ts: the role gate says WHO may reach payroll
// setup, and `payroll_setup` lets Admin → Module Access revoke it from an individual.
// Both must pass, so pairing them can only ever narrow access, never widen it.
router.get('/', authorize('payroll_setup', 'read'), authorizeRoles('admin', 'finance'), ctrl.list);
router.put('/:code', authorize('payroll_setup', 'update'), authorizeRoles('admin', 'finance'), ctrl.update);

export default router;
