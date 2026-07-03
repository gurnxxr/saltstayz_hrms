import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/paySchedule.controller';

// Pay Schedule is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

router.get('/', authorizeRoles('admin', 'finance'), ctrl.getPaySchedule);
router.put('/', authorizeRoles('admin', 'finance'), ctrl.updatePaySchedule);

export default router;
