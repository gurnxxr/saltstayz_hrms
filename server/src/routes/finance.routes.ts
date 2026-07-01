import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/finance.controller';

const router = Router();

router.use(authenticate);

router.get('/bank-details', authorize('finance', 'read'), ctrl.getAll);
router.get('/bank-details/stats', authorize('finance', 'read'), ctrl.getStats);
router.get('/bank-details/me', authorize('payroll', 'read'), ctrl.getMyBankDetails);
router.get('/bank-details/:employeeId', authorize('finance', 'read'), ctrl.getByEmployee);
router.put('/bank-details/:employeeId', authorize('finance', 'update'), ctrl.upsert);
router.delete('/bank-details/:employeeId', authorize('finance', 'delete'), ctrl.remove);

export default router;
