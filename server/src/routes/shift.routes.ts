import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/shift.controller';

const router = Router();
router.use(authenticate);

// RLS: the org roster / everyone's shift assignments are staff-only.
const SHIFT_STAFF = authorizeRoles('admin', 'chro', 'hr', 'property_manager');

// Self-service — any authenticated employee manages their own shift (no module RBAC).
router.get('/me', ctrl.getMyShift);
router.get('/me/change-requests', ctrl.listMyShiftChangeRequests);
router.post('/me/change-request', ctrl.createMyShiftChangeRequest);

// Shift types — read for all, management restricted to admin
router.get('/types', authorize('shifts', 'read'), ctrl.listShiftTypes);
router.get('/types/:id', authorize('shifts', 'read'), ctrl.getShiftType);
router.post('/types', authorize('admin', 'create'), ctrl.createShiftType);
router.put('/types/:id', authorize('admin', 'update'), ctrl.updateShiftType);

// Per-employee shift assignment (property-agnostic)
router.get('/employee-shifts', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.listEmployeeShifts);
router.put('/employee-shifts/:employeeId', authorize('shifts', 'update'), ctrl.assignEmployeeShift);
router.delete('/employee-shifts/:employeeId', authorize('shifts', 'update'), ctrl.removeEmployeeShift);

// Roster — assignment open to property managers
router.get('/roster', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.getWeeklyRoster);
router.get('/roster/employees/:propertyId', authorize('shifts', 'read'), SHIFT_STAFF, ctrl.getPropertyEmployees);
router.post('/roster', authorize('shifts', 'create'), ctrl.assignShift);
router.post('/roster/bulk', authorize('shifts', 'create'), ctrl.bulkAssignShifts);
router.delete('/roster/:id', authorize('admin', 'delete'), ctrl.removeShift);

// Change requests — admin only for management
router.get('/change-requests', authorize('admin', 'read'), ctrl.listChangeRequests);
router.post('/change-requests', authorize('shifts', 'create'), ctrl.createChangeRequest);
router.put('/change-requests/:id', authorize('admin', 'update'), ctrl.approveChangeRequest);

export default router;
