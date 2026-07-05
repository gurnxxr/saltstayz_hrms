import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/attendance.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

router.get('/my-calendar', authorize('attendance', 'read'), ctrl.getMyCalendar);
router.get('/my-summary', authorize('attendance', 'read'), ctrl.getMonthSummary);
router.post('/upload', authorize('attendance', 'update'), upload.single('file'), ctrl.uploadAttendanceCsv);

// Admin property-level views — RLS: others' attendance is staff-only.
const ATT_STAFF = authorizeRoles('admin', 'chro', 'hr', 'property_manager');
router.get('/admin/property-summary', authorize('attendance', 'read'), ATT_STAFF, ctrl.getPropertySummary);
router.get('/admin/property-employees', authorize('attendance', 'read'), ATT_STAFF, ctrl.getPropertyEmployees);
router.get('/admin/dates', authorize('attendance', 'read'), ATT_STAFF, ctrl.getAvailableDates);
router.get('/admin/upload-logs', authorize('attendance', 'read'), ATT_STAFF, ctrl.getUploadLogs);
// Apply Shift Type auto-attendance thresholds to a date's records (also runs daily).
router.post('/admin/auto-mark', authorize('attendance', 'update'), ATT_STAFF, ctrl.autoMark);

export default router;
