import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/payroll.controller';

const router = Router();
router.use(authenticate);

// RLS: anything that reads another employee's salary/payslip or org payroll is
// restricted to payroll staff. Employees use /me/* for their own data.
const PAYROLL_STAFF = authorizeRoles('admin', 'chro', 'hr', 'finance');

// ─── Self-service (any role with payroll:read) ───
router.get('/me/setup', authorize('payroll', 'read'), ctrl.getMySetup);
router.get('/me/payslip', authorize('payroll', 'read'), ctrl.computeMyPayslip);
router.post('/me/payslip', authorize('payroll', 'read'), ctrl.generateMyPayslip);
router.get('/me/payslip/pdf', authorize('payroll', 'read'), ctrl.downloadMyPayslip);
router.get('/me/history', authorize('payroll', 'read'), ctrl.listMyHistory);
router.get('/me/history/:id/pdf', authorize('payroll', 'read'), ctrl.downloadMyHistoryPdf);

// ─── Salary setup management — org-level control, Admin only ───
const ADMIN_ONLY = authorizeRoles('admin');
router.get('/salary-setups', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.listSalarySetups);
router.get('/salary-setups/:employeeId', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.getSalarySetup);
router.put('/salary-setups/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.upsertSalarySetup);

// ─── Generate payslip for any employee (HR / Finance / Admin) ───
router.get('/employees/:employeeId/payslip', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.computeEmployeePayslip);
router.get('/employees/:employeeId/payslip/pdf', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.downloadEmployeePayslip);

// ─── Payroll runs: bulk generate + lock — org-level control, Admin only ───
router.get('/runs', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.listRuns);
router.post('/runs', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.runPayroll);
router.post('/runs/lock', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.lockRun);
router.post('/runs/unlock', authorize('payroll', 'approve'), ADMIN_ONLY, ctrl.unlockRun);

export default router;
