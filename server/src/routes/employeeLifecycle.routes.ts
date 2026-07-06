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

// Item catalog + assignment deletions are corrective, admin-only actions.
const ADMIN_ONLY = authorizeRoles('admin');

router.get('/options', ctrl.getOptions);
router.get('/employees', ctrl.listEmployees);

router.get('/promotions', ctrl.listPromotions);
router.post('/promotions', ctrl.createPromotion);

router.get('/transfers', ctrl.listTransfers);
router.post('/transfers', ctrl.createTransfer);

router.get('/exit-interviews', ctrl.listExitInterviews);
router.post('/exit-interviews', ctrl.scheduleExitInterview);
router.put('/exit-interviews/:id/complete', ctrl.completeExitInterview);

// ─── Company Assets ───
router.get('/assets/types', ctrl.listAssetTypes);
router.post('/assets/types', ADMIN_ONLY, ctrl.createAssetType);
router.put('/assets/types/:id', ADMIN_ONLY, ctrl.updateAssetType);

router.get('/assets/assignments', ctrl.listAssignments);
router.post('/assets/assignments', ctrl.createAssignment);
router.put('/assets/assignments/:id', ctrl.updateAssignment);
router.put('/assets/assignments/:id/return', ctrl.returnAssignment);
router.delete('/assets/assignments/:id', ADMIN_ONLY, ctrl.deleteAssignment);

router.get('/assets/outstanding/:employeeId', ctrl.getOutstandingAssets);

export default router;
