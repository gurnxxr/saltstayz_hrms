import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/paySchedule.controller';

// Pay Schedule is org-wide payroll setup — Admin & Finance only.
// Belt and braces, same as payroll.routes.ts: the role gate says WHO may reach payroll
// setup, and `payroll_setup` lets Admin → Module Access revoke it from an individual.
// Both must pass, so pairing them can only ever narrow access, never widen it.
const router = Router();
router.use(authenticate);

router.get('/', authorize('payroll_setup', 'read'), authorizeRoles('admin', 'finance'), ctrl.getPaySchedule);
router.put('/', authorize('payroll_setup', 'update'), authorizeRoles('admin', 'finance'), ctrl.updatePaySchedule);

export default router;
