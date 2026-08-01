import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/attendance.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
// The marked-grid dashboard is an Excel workbook — allow a little more headroom than the CSV.
const gridUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

router.get('/my-calendar', authorize('attendance', 'read'), ctrl.getMyCalendar);
router.get('/my-summary', authorize('attendance', 'read'), ctrl.getMonthSummary);
router.post('/upload', authorize('attendance', 'update'), upload.single('file'), ctrl.uploadAttendanceCsv);
// Marked-grid dashboard import (wide sheet of day-codes), alongside the biometric punch upload.
router.post('/upload-grid', authorize('attendance', 'update'), gridUpload.single('file'), ctrl.uploadMarkedGrid);

// Admin property-level views — RLS: others' attendance is staff-only.
const ATT_STAFF = authorizeRoles('admin', 'chro', 'hr', 'property_manager');
router.get('/admin/property-summary', authorize('attendance', 'read'), ATT_STAFF, ctrl.getPropertySummary);
router.get('/admin/property-employees', authorize('attendance', 'read'), ATT_STAFF, ctrl.getPropertyEmployees);
router.get('/admin/dates', authorize('attendance', 'read'), ATT_STAFF, ctrl.getAvailableDates);
router.get('/admin/upload-logs', authorize('attendance', 'read'), ATT_STAFF, ctrl.getUploadLogs);
// Blank template for the marked-grid upload. Read-only — it contains the employee roster the
// uploader can already see on this screen, so it sits behind the same gate as the page itself.
router.get('/admin/template/marked-grid', authorize('attendance', 'read'), ATT_STAFF, ctrl.downloadMarkedGridTemplate);

export default router;
