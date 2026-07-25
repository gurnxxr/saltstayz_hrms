import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/attendancePayRules.controller';

const router = Router();
router.use(authenticate);

// Per-attendance-code pay rules — read + edit by Admin/Finance.
router.get('/', authorizeRoles('admin', 'finance'), ctrl.list);
router.put('/:code', authorizeRoles('admin', 'finance'), ctrl.update);

export default router;
