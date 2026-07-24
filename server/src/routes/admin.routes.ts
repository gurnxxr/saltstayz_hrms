import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as userCtrl from '../controllers/user.controller';
import * as orgCtrl from '../controllers/organization.controller';
import * as accessCtrl from '../controllers/moduleAccess.controller';
import * as salaryStructureCtrl from '../controllers/salaryStructure.controller';
import * as employmentTypeCtrl from '../controllers/employmentType.controller';
import * as auditCtrl from '../controllers/audit.controller';
import * as backupCtrl from '../controllers/backup.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// CSV-only upload for the Employment Types import — reject a non-CSV and turn multer's
// size/type rejections into a clean 400 (a bare MulterError becomes a generic 500 otherwise).
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    if (/\.csv$/i.test(file.originalname) || ['text/csv', 'application/csv', 'application/vnd.ms-excel'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Please upload a .csv file'));
  },
});
function uploadCsv(req: Request, res: Response, next: NextFunction) {
  csvUpload.single('file')(req, res, (err: any) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'CSV file is too large (max 2 MB)' : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}

const router = Router();
router.use(authenticate);

// ─── Lookup data (any authenticated user) ───
// These read-only endpoints are used by forms in other modules (recruitment, shifts, etc.)

router.get('/properties', orgCtrl.listProperties);
router.get('/departments', orgCtrl.listDepartments);
router.get('/property-categories', orgCtrl.listPropertyCategories);
router.get('/job-titles', orgCtrl.listJobTitles);
router.get('/employee-categories', orgCtrl.listCategories);
router.get('/pay-grades', orgCtrl.listPayGrades);
router.get('/employment-statuses', orgCtrl.listStatuses);

// ─── Organization CRUD (admin only) ───

router.post('/properties', authorize('admin', 'create'), orgCtrl.createProperty);
router.post('/properties/upload', authorize('admin', 'create'), upload.single('file'), orgCtrl.bulkUploadProperties);
router.put('/properties/:id', authorize('admin', 'update'), orgCtrl.updateProperty);
router.delete('/properties/:id', authorize('admin', 'delete'), orgCtrl.deleteProperty);

router.post('/departments', authorize('admin', 'create'), orgCtrl.createDepartment);
router.put('/departments/:id', authorize('admin', 'update'), orgCtrl.updateDepartment);
router.delete('/departments/:id', authorize('admin', 'delete'), orgCtrl.deleteDepartment);

router.post('/property-categories', authorize('admin', 'create'), orgCtrl.createPropertyCategory);
router.put('/property-categories/:id', authorize('admin', 'update'), orgCtrl.updatePropertyCategory);
router.delete('/property-categories/:id', authorize('admin', 'delete'), orgCtrl.deletePropertyCategory);

router.post('/job-titles', authorize('admin', 'create'), orgCtrl.createJobTitle);
router.put('/job-titles/:id', authorize('admin', 'update'), orgCtrl.updateJobTitle);
router.delete('/job-titles/:id', authorize('admin', 'delete'), orgCtrl.deleteJobTitle);

router.post('/employee-categories', authorize('admin', 'create'), orgCtrl.createCategory);
router.put('/employee-categories/:id', authorize('admin', 'update'), orgCtrl.updateCategory);
router.delete('/employee-categories/:id', authorize('admin', 'delete'), orgCtrl.deleteCategory);

router.post('/pay-grades', authorize('admin', 'create'), orgCtrl.createPayGrade);
router.put('/pay-grades/:id', authorize('admin', 'update'), orgCtrl.updatePayGrade);
router.delete('/pay-grades/:id', authorize('admin', 'delete'), orgCtrl.deletePayGrade);

router.post('/employment-statuses', authorize('admin', 'create'), orgCtrl.createStatus);
router.put('/employment-statuses/:id', authorize('admin', 'update'), orgCtrl.updateStatus);
router.delete('/employment-statuses/:id', authorize('admin', 'delete'), orgCtrl.deleteStatus);

// ─── Employment Types master (admin config; catalog-only) ───
// Static sub-paths before the :id routes, or Express reads "export"/"import" as an :id.
router.get('/employment-types', authorize('admin', 'read'), employmentTypeCtrl.list);
router.get('/employment-types/export', authorize('admin', 'read'), employmentTypeCtrl.exportCsv);
router.post('/employment-types/import', authorize('admin', 'create'), uploadCsv, employmentTypeCtrl.importCsv);
router.get('/employment-types/:id', authorize('admin', 'read'), employmentTypeCtrl.get);
router.post('/employment-types', authorize('admin', 'create'), employmentTypeCtrl.create);
router.put('/employment-types/:id', authorize('admin', 'update'), employmentTypeCtrl.update);
router.delete('/employment-types/:id', authorize('admin', 'delete'), employmentTypeCtrl.remove);

// ─── User Management (admin only) ───

router.get('/users', authorize('admin.users', 'read'), userCtrl.listUsers);
// Login email + shareable password for every user (Admin → User Credentials).
router.get('/credentials', authorize('admin.users', 'read'), userCtrl.listCredentials);
// Backfill 1234 for employees with no login / no known password.
router.post('/credentials/fill-missing', authorize('admin.users', 'update'), userCtrl.fillMissingCredentials);
router.get('/users/roles', authorize('admin.users', 'read'), userCtrl.getRoles);
router.get('/users/access-matrix', authorize('admin.users', 'read'), userCtrl.getAccessMatrix);
router.get('/users/unlinked-employees', authorize('admin.users', 'read'), userCtrl.getUnlinkedEmployees);
router.get('/users/:id', authorize('admin.users', 'read'), userCtrl.getUser);
router.post('/users', authorize('admin.users', 'create'), userCtrl.createUser);
router.put('/users/:id', authorize('admin.users', 'update'), userCtrl.updateUser);
router.put('/users/:id/reset-password', authorize('admin.users', 'update'), userCtrl.resetPassword);
router.delete('/users/:id', authorize('admin.users', 'delete'), userCtrl.deleteUser);

// ─── Salary Structures v2 (component-based templates, admin only) ───
router.get('/salary-structures', authorize('admin', 'read'), salaryStructureCtrl.list);
router.get('/salary-structures/components', authorize('admin', 'read'), salaryStructureCtrl.componentOptions);
router.post('/salary-structures/preview', authorize('admin', 'read'), salaryStructureCtrl.preview);
router.get('/salary-structures/:id', authorize('admin', 'read'), salaryStructureCtrl.get);
router.post('/salary-structures', authorize('admin', 'create'), salaryStructureCtrl.create);
router.put('/salary-structures/:id', authorize('admin', 'update'), salaryStructureCtrl.update);
router.delete('/salary-structures/:id', authorize('admin', 'delete'), salaryStructureCtrl.remove);

// ─── Per-employee salary structures (admin only) ───
router.get('/employee-salary', authorize('admin', 'read'), salaryStructureCtrl.listEmployeeSalary);
router.get('/salary-overview', authorize('admin', 'read'), salaryStructureCtrl.getSalaryOverview);
router.get('/employee-salary/:employeeId', authorize('admin', 'read'), salaryStructureCtrl.getEmployeeSalary);
router.put('/employee-salary/:employeeId', authorize('admin', 'update'), salaryStructureCtrl.saveEmployeeSalary);
router.post('/employee-salary/:employeeId/reset', authorize('admin', 'update'), salaryStructureCtrl.resetEmployeeSalary);

// ─── Database backups (admin only) ───
router.get('/backups', authorize('admin', 'read'), backupCtrl.list);
router.post('/backups/run', authorize('admin', 'create'), backupCtrl.run);

// ─── Audit trail (admin only, read-only) ───
router.get('/audit-logs', authorize('admin', 'read'), auditCtrl.list);
router.get('/audit-logs/meta', authorize('admin', 'read'), auditCtrl.meta);

// ─── Per-employee module access (admin only) ───
router.get('/module-access/employees', authorize('admin.users', 'read'), accessCtrl.searchEmployees);
router.get('/module-access/:employeeId', authorize('admin.users', 'read'), accessCtrl.getEmployeeAccess);
router.put('/module-access/:employeeId', authorize('admin.users', 'update'), accessCtrl.setEmployeeAccess);
router.delete('/module-access/:employeeId', authorize('admin.users', 'update'), accessCtrl.resetEmployeeAccess);

export default router;
