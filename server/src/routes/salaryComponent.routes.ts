import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/salaryComponent.controller';

// Salary component catalog is org-wide payroll setup — Admin & Finance only.
const router = Router();
router.use(authenticate);

const gate = authorizeRoles('admin', 'finance');

router.get('/', gate, ctrl.list);
router.post('/', gate, ctrl.create);
router.put('/:id', gate, ctrl.update);
router.patch('/:id/status', gate, ctrl.setStatus);
router.delete('/:id', gate, ctrl.remove);

export default router;
