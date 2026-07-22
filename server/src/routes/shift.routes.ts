import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/shift.controller';

const router = Router();
router.use(authenticate);

// RLS: the org roster / everyone's shift assignments are staff-only.
const SHIFT_STAFF = authorizeRoles('admin', 'chro', 'hr', 'property_manager');
// Shift-type definitions (Shift Setup) are managed by admin/CHRO/HR only.
const SHIFT_TYPE_MANAGE = authorizeRoles('admin', 'chro', 'hr');

// Self-service — the employee's own shifts + change requests (any logged-in user).
router.get('/me', ctrl.getMyShift);
router.get('/me/roster', ctrl.getMyRoster);
router.get('/me/change-requests', ctrl.listMyChangeRequests);
router.post('/me/change-requests', ctrl.createMyChangeRequest);

// Shift types — read for all, management restricted to admin/CHRO/HR (Shift Setup)
router.get('/types', authorize('shifts', 'read'), ctrl.listShiftTypes);
router.get('/types/:id', authorize('shifts', 'read'), ctrl.getShiftType);
router.post('/types', SHIFT_TYPE_MANAGE, ctrl.createShiftType);
router.put('/types/:id', SHIFT_TYPE_MANAGE, ctrl.updateShiftType);
router.delete('/types/:id', SHIFT_TYPE_MANAGE, ctrl.deleteShiftType);

// Roster — read + build/publish. Writes are gated by BOTH shifts:create and the
// SHIFT_STAFF role (admin/CHRO/HR/property manager), so a write is never less
// protected than a read.
router.get('/roster', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.getWeeklyRoster);
router.get('/roster/employees/:propertyId', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.getPropertyEmployees);
router.post('/roster/save', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.saveRoster);
router.post('/roster/copy-previous', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.copyPreviousWeek);
router.post('/roster/publish', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.publishRoster);
router.post('/roster/unpublish', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.unpublishRoster);

// Shift-change requests — employees apply via /me/change-requests; managers/HR
// review here. Listing needs shifts:read; deciding writes the roster (shifts:create).
router.get('/change-requests', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.listChangeRequests);
router.post('/change-requests/:id/decision', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.decideChangeRequest);

export default router;
