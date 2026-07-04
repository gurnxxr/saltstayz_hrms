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

// Self-service — any authenticated employee manages their own shift (no module RBAC).
router.get('/me', ctrl.getMyShift);
router.get('/me/change-requests', ctrl.listMyShiftChangeRequests);
router.post('/me/change-request', ctrl.createMyShiftChangeRequest);

// Shift types — read for all, management restricted to admin/CHRO/HR (Shift Setup)
router.get('/types', authorize('shifts', 'read'), ctrl.listShiftTypes);
router.get('/types/holiday-lists', authorize('shifts', 'read'), ctrl.listHolidayLists);
router.get('/types/:id', authorize('shifts', 'read'), ctrl.getShiftType);
router.post('/types', SHIFT_TYPE_MANAGE, ctrl.createShiftType);
router.put('/types/:id', SHIFT_TYPE_MANAGE, ctrl.updateShiftType);
router.delete('/types/:id', SHIFT_TYPE_MANAGE, ctrl.deleteShiftType);

// Shift locations (Shift Setup) — read for shifts, management admin/CHRO/HR
router.get('/locations', authorize('shifts', 'read'), ctrl.listShiftLocations);
router.post('/locations', SHIFT_TYPE_MANAGE, ctrl.createShiftLocation);
router.put('/locations/:id', SHIFT_TYPE_MANAGE, ctrl.updateShiftLocation);
router.delete('/locations/:id', SHIFT_TYPE_MANAGE, ctrl.deleteShiftLocation);

// Shift schedules (Shift Setup) — recurring shift-type × weekday patterns
router.get('/schedules', authorize('shifts', 'read'), ctrl.listShiftSchedules);
router.get('/schedules/:id', authorize('shifts', 'read'), ctrl.getShiftSchedule);
router.post('/schedules', SHIFT_TYPE_MANAGE, ctrl.createShiftSchedule);
router.put('/schedules/:id', SHIFT_TYPE_MANAGE, ctrl.updateShiftSchedule);
router.delete('/schedules/:id', SHIFT_TYPE_MANAGE, ctrl.deleteShiftSchedule);

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
