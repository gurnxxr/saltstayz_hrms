import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/payroll.controller';

const router = Router();
router.use(authenticate);

// RLS: anything that reads another employee's salary/payslip or org payroll is
// restricted to payroll staff. Employees use /me/* for their own data.
const PAYROLL_STAFF = authorizeRoles('admin', 'chro', 'hr', 'finance');

// ─── Self-service: the signed-in user's OWN salary (the "Salary" tab) ───
// Gated by the `salary` module so Admin → Module Access can grant/revoke a person's
// access to their own salary independently of the Payroll config module.
router.get('/me/setup', authorize('salary', 'read'), ctrl.getMySetup);
router.get('/me/structure', authorize('salary', 'read'), ctrl.getMyStructure);
router.get('/me/payslip', authorize('salary', 'read'), ctrl.computeMyPayslip);
router.get('/me/payslip/pdf', authorize('salary', 'read'), ctrl.downloadMyPayslip);
router.get('/me/history', authorize('salary', 'read'), ctrl.listMyHistory);
router.get('/me/history/:id/pdf', authorize('salary', 'read'), ctrl.downloadMyHistoryPdf);

// ─── Structure assignments (employee → structure + base) — Admin only ───
const ADMIN_ONLY = authorizeRoles('admin');
router.get('/assignments', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.listAssignments);
router.get('/assignments/:employeeId', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.getAssignment);
router.put('/assignments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.upsertAssignment);
router.delete('/assignments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.removeAssignment);

// ─── Generate/download the salary slip of ANY employee — Admin only ───
// (Everyone else uses /me/* for their own slip; this powers Admin → Salary Slips.)
router.get('/employees', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.listPayrollEmployees);
router.get('/employees/:employeeId/payslip', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.computeEmployeePayslip);
router.get('/employees/:employeeId/payslip/pdf', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.downloadEmployeePayslip);
router.get('/employees/:employeeId/payable-days', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.getPayableDays);

// ─── Payroll runs — Admin only (bulk generate + review & finalize). ───
router.get('/runs', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.listRuns);
router.get('/runs/details', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.getRunDetails);
router.get('/runs/export', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.exportRegister);
router.post('/runs', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.runPayroll);
router.put('/runs/adjustments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.upsertAdjustment);
router.post('/runs/lock', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.lockRun);
router.post('/runs/unlock', authorize('payroll', 'approve'), ADMIN_ONLY, ctrl.unlockRun);

export default router;
