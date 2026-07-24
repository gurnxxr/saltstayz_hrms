import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/shift.controller';

const router = Router();
router.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// RLS: the org roster / everyone's shift assignments are staff-only.
const SHIFT_STAFF = authorizeRoles('admin', 'chro', 'hr', 'property_manager');
// Shift-type definitions (Shift Setup) are managed by admin/CHRO/HR only.
const SHIFT_TYPE_MANAGE = authorizeRoles('admin', 'chro', 'hr');

// Self-service — the employee's own shift + change requests (any logged-in user).
router.get('/me', ctrl.getMyShift);
router.get('/me/shift', ctrl.getMyShiftOverview);
router.get('/me/change-requests', ctrl.listMyChangeRequests);
router.post('/me/change-requests', ctrl.createMyChangeRequest);

// Shift types — read for all, management restricted to admin/CHRO/HR (Shift Setup)
router.get('/types', authorize('shifts', 'read'), ctrl.listShiftTypes);
router.get('/types/:id', authorize('shifts', 'read'), ctrl.getShiftType);
router.post('/types', SHIFT_TYPE_MANAGE, ctrl.createShiftType);
router.put('/types/:id', SHIFT_TYPE_MANAGE, ctrl.updateShiftType);
router.delete('/types/:id', SHIFT_TYPE_MANAGE, ctrl.deleteShiftType);

// Employee → shift mapping. Reading everyone's assignment is staff-only; writing is
// gated by BOTH shifts:create and the staff role, so a write is never less protected
// than a read. Routes are ordered so /assignments/employees/:id can't match /:id.
router.get('/assignments', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.listShiftAssignments);
// Static sub-paths before the param routes, or Express reads "export" as an :id.
router.get('/assignments/export', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.exportShiftAssignments);
router.get('/assignments/employees/:employeeId', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.getEmployeeShiftHistory);
router.post('/assignments/bulk-upload', authorize('shifts', 'create'), SHIFT_STAFF, upload.single('file'), ctrl.bulkUploadShiftAssignments);
router.post('/assignments', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.assignShift);
// Removing an assignment is the same class of write as creating one, so it is gated the same
// way. `shifts:delete` is never granted to property_manager, who the nav and the screen both
// expect to be able to do this — gating on it would show them a button that always 403s.
router.delete('/assignments/:id', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.removeShiftAssignment);

// Shift-change requests — employees apply via /me/change-requests; managers/HR
// review here. Listing needs shifts:read; approving writes an assignment (shifts:create).
router.get('/change-requests', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.listChangeRequests);
router.post('/change-requests/:id/decision', authorize('shifts', 'create'), SHIFT_STAFF, ctrl.decideChangeRequest);

export default router;
