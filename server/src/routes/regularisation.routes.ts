import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/regularisation.controller';

const router = Router();
router.use(authenticate);

// Self-service: raise a correction + see my own requests.
router.post('/', authorize('attendance', 'create'), ctrl.requestRegularisation);
router.get('/me', authorize('attendance', 'read'), ctrl.getMyRegularisations);

// Approvals — routed to the reporting manager (HR/admin see all). A manager may be
// an employee-role user, so we gate on plain attendance access and enforce the
// "reporting manager or HR" rule inside the service (mirrors leave approvals).
router.get('/pending', authorize('attendance', 'read'), ctrl.getPendingRegularisations);
// Regularisation log (history) — decided requests, scoped to the manager's reports / all for HR.
router.get('/log', authorize('attendance', 'read'), ctrl.getRegularisationLog);
router.post('/:id/approve', authorize('attendance', 'read'), ctrl.approveRegularisation);
router.post('/:id/reject', authorize('attendance', 'read'), ctrl.rejectRegularisation);

export default router;
