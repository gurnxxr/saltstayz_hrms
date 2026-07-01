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

// My leaves
router.get('/my', authorize('leave', 'read'), ctrl.getMyLeaves);
router.post('/apply', authorize('leave', 'create'), ctrl.applyLeave);
router.put('/:id/cancel', authorize('leave', 'update'), ctrl.cancelLeave);

// All leaves (HR/admin view) — RLS: org-wide leave history is staff-only.
// Managers approve their reports via /approvals (already scoped) instead.
router.get('/all', authorize('leave', 'read'), authorizeRoles('admin', 'chro', 'hr', 'property_manager'), ctrl.getAllLeaves);

// Approvals — Admin/CHRO/HR only (managed centrally from Admin → Leave Approvals)
const APPROVAL_ROLES = authorizeRoles('admin', 'chro', 'hr');
router.get('/approvals', authorize('leave', 'read'), APPROVAL_ROLES, ctrl.getPendingApprovals);
router.put('/:id/approve', authorize('leave', 'update'), APPROVAL_ROLES, ctrl.approveLeave);
router.put('/:id/reject', authorize('leave', 'update'), APPROVAL_ROLES, ctrl.rejectLeave);

// Holiday management (admin only)
router.post('/holidays', authorize('admin', 'create'), ctrl.createHoliday);
router.post('/holidays/upload-csv', authorize('admin', 'create'), upload.single('file'), ctrl.uploadHolidaysCSV);
router.delete('/holidays/:id', authorize('admin', 'delete'), ctrl.deleteHoliday);

export default router;
