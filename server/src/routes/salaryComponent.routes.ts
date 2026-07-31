import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/salaryComponent.controller';

// Salary component catalog is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

// Belt and braces, same as payroll.routes.ts: the role gate says WHO may reach payroll
// setup, and `payroll_setup` lets Admin → Module Access revoke it from an individual.
// Both must pass, so pairing them can only ever narrow access, never widen it.
const gate = authorizeRoles('admin', 'finance');

router.get('/', authorize('payroll_setup', 'read'), gate, ctrl.list);
router.post('/', authorize('payroll_setup', 'update'), gate, ctrl.create);
router.put('/:id', authorize('payroll_setup', 'update'), gate, ctrl.update);
router.patch('/:id/status', authorize('payroll_setup', 'update'), gate, ctrl.setStatus);
router.delete('/:id', authorize('payroll_setup', 'update'), gate, ctrl.remove);

export default router;
