import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/employeeLifecycle.controller';

// Employee Lifecycle (Promotion / Transfer / Exit Interview) — HR-side module.
// Gated by role only (like statutory routes): hr_manager belongs to this nav
// but holds no broad module permissions.
const router = Router();
router.use(authenticate);

const LIFECYCLE_ROLES = authorizeRoles('admin', 'chro', 'hr', 'hr_manager');
router.use(LIFECYCLE_ROLES);

router.get('/options', ctrl.getOptions);
router.get('/employees', ctrl.listEmployees);

router.get('/promotions', ctrl.listPromotions);
router.post('/promotions', ctrl.createPromotion);

router.get('/transfers', ctrl.listTransfers);
router.post('/transfers', ctrl.createTransfer);

router.get('/exit-interviews', ctrl.listExitInterviews);
router.post('/exit-interviews', ctrl.scheduleExitInterview);
router.put('/exit-interviews/:id/complete', ctrl.completeExitInterview);

export default router;
