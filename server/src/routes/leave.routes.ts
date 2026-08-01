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

// Approvals — a reporting manager acts on their own reports; HR/CHRO/Admin act on
// all. Authority is enforced inside the service (manager-or-HR), so the route only
// needs plain leave read/update (a plain employee who is someone's manager qualifies).
router.get('/approvals', authorize('leave', 'read'), ctrl.getPendingApprovals);
router.put('/:id/approve', authorize('leave', 'update'), ctrl.approveLeave);
router.put('/:id/reject', authorize('leave', 'update'), ctrl.rejectLeave);

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

// Control Panel: leave templates (a reusable bundle of per-type rules) + assignment.
// Static sub-paths before the :id routes, or Express reads "assignments"/"assign" as an :id.
router.get('/templates', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.listLeaveTemplates);
router.get('/templates/assignments', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.listLeaveTemplateAssignments);
// Departments + headcount + which template already claims each — powers the department picker.
// Declared before '/templates/:id' so "departments" is not swallowed as an id.
router.get('/templates/departments', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.listLeaveTemplateDepartments);
router.post('/templates/assign', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.bulkAssignLeaveTemplate);
router.get('/templates/:id', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getLeaveTemplate);
router.post('/templates', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createLeaveTemplate);
router.put('/templates/:id', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.updateLeaveTemplate);
router.delete('/templates/:id', authorize('leave', 'delete'), LEAVE_ADMIN, ctrl.deleteLeaveTemplate);
router.put('/employees/:employeeId/template', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.setEmployeeLeaveTemplate);

// Balances: every employee x every leave type for a period (read-only grid).
// Distinct from GET /balances above, which is the caller's own self-service balances.
router.get('/balances/overview', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getBalancesOverview);

// Allocation: entitlements grid + single/bulk upsert
router.get('/entitlements', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getEntitlements);
router.put('/entitlements', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.upsertEntitlement);
router.post('/entitlements/bulk', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.bulkAllocate);

// Encashment: record-only (Finance pays outside payroll)
router.get('/encashments', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.listEncashments);
router.post('/encashments', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createEncashment);
router.put('/encashments/:id/approve', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.approveEncashment);
router.put('/encashments/:id/reject', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.rejectEncashment);

// Holiday management (Admin → Holidays) — Admin/CHRO/HR upload per-state lists.
const ADMIN_ONLY = authorizeRoles('admin');
router.post('/holidays', authorize('leave', 'create'), LEAVE_ADMIN, ctrl.createHoliday);
router.put('/holidays/:id', authorize('leave', 'update'), LEAVE_ADMIN, ctrl.updateHoliday);
router.post('/holidays/upload-csv', authorize('leave', 'create'), LEAVE_ADMIN, upload.single('file'), ctrl.uploadHolidaysCSV);
// How many people a holiday actually reaches. The one thing that can catch a valid-looking
// audience — "Front Desk at Gurgaon" — that happens to match nobody.
router.post('/holidays/reach-preview', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.previewHolidayReach);
router.get('/holidays/:id/reach', authorize('leave', 'read'), LEAVE_ADMIN, ctrl.getHolidayReach);
router.delete('/holidays/:id', authorize('leave', 'delete'), LEAVE_ADMIN, ctrl.deleteHoliday);

router.post('/regions', ADMIN_ONLY, ctrl.createRegion);
router.put('/regions/:id', ADMIN_ONLY, ctrl.updateRegion);
router.delete('/regions/:id', ADMIN_ONLY, ctrl.deleteRegion);

router.get('/region-properties', ADMIN_ONLY, ctrl.listPropertiesWithRegion);
router.put('/properties/:id/region', ADMIN_ONLY, ctrl.setPropertyRegion);

export default router;
