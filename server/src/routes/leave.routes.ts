import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/leave.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// Reference data
router.get('/types', authorize('leave', 'read'), ctrl.getLeaveTypes);
router.get('/periods', authorize('leave', 'read'), ctrl.getLeavePeriods);
router.get('/balances', authorize('leave', 'read'), ctrl.getMyBalances);
router.get('/holidays', authorize('leave', 'read'), ctrl.getHolidays);
router.get('/holidays/me', authorize('leave', 'read'), ctrl.getMyHolidays);
router.get('/regions', authorize('leave', 'read'), ctrl.listRegions);

// My leaves
router.get('/my', authorize('leave', 'read'), ctrl.getMyLeaves);
router.post('/apply', authorize('leave', 'create'), ctrl.applyLeave);
router.put('/:id/cancel', authorize('leave', 'update'), ctrl.cancelLeave);

// All leaves (HR/admin view) — RLS: org-wide leave history is staff-only.
// Managers approve their reports via /approvals (already scoped) instead.
router.get('/all', authorize('leave', 'read'), authorizeRoles('admin', 'chro', 'hr', 'property_manager'), ctrl.getAllLeaves);

// Approvals — Admin/CHRO/HR only (managed centrally from Leaves → Application)
const APPROVAL_ROLES = authorizeRoles('admin', 'chro', 'hr');
router.get('/approvals', authorize('leave', 'read'), APPROVAL_ROLES, ctrl.getPendingApprovals);
router.put('/:id/approve', authorize('leave', 'update'), APPROVAL_ROLES, ctrl.approveLeave);
router.put('/:id/reject', authorize('leave', 'update'), APPROVAL_ROLES, ctrl.rejectLeave);

// ─── Leaves module (admin layer): Application / Encashment / Control Panel / Allocation ───
const LEAVE_ADMIN = authorizeRoles('admin', 'chro', 'hr');

// Apply on behalf of an employee (reuses the standard apply validations)
router.post('/apply-for/:employeeId', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.applyLeaveFor);

// Control Panel: leave types (delete when unused, else deactivate) + periods
router.get('/types/all', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getAllLeaveTypes);
router.post('/types', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createLeaveType);
router.put('/types/:id', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.updateLeaveType);
router.delete('/types/:id', authorize('leave', 'delete'), LEAVE_ADMIN, ctrl.deleteLeaveType);
router.post('/periods', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createLeavePeriod);
router.put('/periods/:id/current', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.setCurrentPeriod);

// Allocation: entitlements grid + single/bulk upsert
router.get('/entitlements', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getEntitlements);
router.put('/entitlements', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.upsertEntitlement);
router.post('/entitlements/bulk', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.bulkAllocate);

// Encashment: record-only (Finance pays outside payroll)
router.get('/encashments', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.listEncashments);
router.post('/encashments', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createEncashment);
router.put('/encashments/:id/approve', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.approveEncashment);
router.put('/encashments/:id/reject', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.rejectEncashment);

// Holiday & region management (admin only) — configured from Leave & Attendance
const ADMIN_ONLY = authorizeRoles('admin');
router.post('/holidays', ADMIN_ONLY, ctrl.createHoliday);
router.put('/holidays/:id', ADMIN_ONLY, ctrl.updateHoliday);
router.post('/holidays/upload-csv', ADMIN_ONLY, upload.single('file'), ctrl.uploadHolidaysCSV);
router.delete('/holidays/:id', ADMIN_ONLY, ctrl.deleteHoliday);

router.post('/regions', ADMIN_ONLY, ctrl.createRegion);
router.put('/regions/:id', ADMIN_ONLY, ctrl.updateRegion);
router.delete('/regions/:id', ADMIN_ONLY, ctrl.deleteRegion);

router.get('/region-properties', ADMIN_ONLY, ctrl.listPropertiesWithRegion);
router.put('/properties/:id/region', ADMIN_ONLY, ctrl.setPropertyRegion);

export default router;
