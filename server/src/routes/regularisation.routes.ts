import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/regularisation.controller';

const router = Router();
router.use(authenticate);

// Org-wide guardrails (deadline, monthly cap, range ceiling, offered types).
//
// READ is open to anyone with attendance access, not restricted to the people who may change it:
// the employee's own request form has to show the deadline it will be judged against, and a form
// that enforces a rule it cannot display is how you get someone typing a date that is silently
// refused. Nothing here is sensitive — it is the policy the employee is already subject to.
//
// WRITE is HR's. Deliberately not gated on `authorize('attendance', 'update')` alone: a
// property_manager holds that permission so they can decide their reports' requests, which must
// not also let them widen the rules those requests are judged by.
router.get('/settings', authorize('attendance', 'read'), ctrl.getSettings);
router.put('/settings', authorize('attendance', 'update'), authorizeRoles('admin', 'chro', 'hr'), ctrl.updateSettings);

// Self-service: raise a correction + see my own requests.
router.post('/', authorize('attendance', 'create'), ctrl.requestRegularisation);
router.get('/me', authorize('attendance', 'read'), ctrl.getMyRegularisations);

// Approvals — routed to the reporting manager (HR/admin see all). A manager may be
// an employee-role user, so we gate on plain attendance access and enforce the
// "reporting manager or HR" rule inside the service (mirrors leave approvals).
router.get('/pending', authorize('attendance', 'read'), ctrl.getPendingRegularisations);
// Regularisation log (history) — decided requests, scoped to the manager's reports / all for HR.
router.get('/log', authorize('attendance', 'read'), ctrl.getRegularisationLog);
// Deciding a regularisation mutates attendance, so it is gated on attendance:update
// (not read) — mirroring leave approvals, which gate on leave:update. property_manager
// holds attendance:update, so reporting managers can still decide; the service further
// restricts to the reporting manager or HR.
router.post('/:id/approve', authorize('attendance', 'update'), ctrl.approveRegularisation);
router.post('/:id/reject', authorize('attendance', 'update'), ctrl.rejectRegularisation);

export default router;
