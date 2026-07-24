import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/employee.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// RLS: the directory exposes other people's PII, so it is restricted to staff
// roles. Plain employees use /me only.
const DIRECTORY_ROLES = authorizeRoles('admin', 'chro', 'hr', 'hr_manager', 'property_manager', 'finance');
const EMPLOYEE_WRITE_ROLES = authorizeRoles('admin', 'chro', 'hr');
// Creating employees directly (single or bulk CSV) bypasses the recruitment funnel, so it's the
// widest way to add bodies/cost — held to Admin only, and still cap-enforced in the service.
const EMPLOYEE_CREATE_ROLES = authorizeRoles('admin');

// My profile (any authenticated user)
router.get('/me', ctrl.getMyProfile);
router.put('/me', ctrl.updateMyProfile);

// Managers list (for dropdowns) — staff only (name enumeration otherwise)
router.get('/managers', DIRECTORY_ROLES, ctrl.getManagers);

// Employee directory (HR+ roles)
router.get('/', authorize('employees', 'read'), DIRECTORY_ROLES, ctrl.listEmployees);
router.get('/upload-logs', authorize('employees', 'read'), EMPLOYEE_WRITE_ROLES, ctrl.getEmployeeUploadLogs);
// Bulk PII in one file — every phone, email and Aadhaar at once — so it is held to the tighter
// write-role list rather than the whole directory. Declared BEFORE /:id, or Express reads
// "export" as an employee id.
router.get('/export', authorize('employees', 'read'), EMPLOYEE_WRITE_ROLES, ctrl.exportEmployees);
router.get('/:id', authorize('employees', 'read'), DIRECTORY_ROLES, ctrl.getEmployee);
router.post('/bulk-upload', authorize('employees', 'create'), EMPLOYEE_CREATE_ROLES, upload.single('file'), ctrl.bulkUploadEmployees);
router.post('/', authorize('employees', 'create'), EMPLOYEE_CREATE_ROLES, ctrl.createEmployee);
router.put('/:id', authorize('employees', 'update'), EMPLOYEE_WRITE_ROLES, ctrl.updateEmployee);
router.delete('/:id', authorize('employees', 'delete'), EMPLOYEE_WRITE_ROLES, ctrl.deleteEmployee);

export default router;
