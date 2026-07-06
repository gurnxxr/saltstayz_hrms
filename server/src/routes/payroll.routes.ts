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

// ─── Structure assignments (employee → structure + base) — Admin only ───
const ADMIN_ONLY = authorizeRoles('admin');
router.get('/assignments', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.listAssignments);
router.get('/assignments/:employeeId', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.getAssignment);
router.put('/assignments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.upsertAssignment);
router.delete('/assignments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.removeAssignment);

// ─── Generate payslip for any employee (HR / Finance / Admin) ───
router.get('/employees/:employeeId/payslip', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.computeEmployeePayslip);
router.get('/employees/:employeeId/payslip/pdf', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.downloadEmployeePayslip);
router.get('/employees/:employeeId/payable-days', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.getPayableDays);

// ─── Payroll runs — bulk generation open to payroll staff; review & finalize
//     (details/export/adjust/lock/unlock) stay Admin only. ───
router.get('/runs', authorize('payroll', 'read'), PAYROLL_STAFF, ctrl.listRuns);
router.get('/runs/details', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.getRunDetails);
router.get('/runs/export', authorize('payroll', 'read'), ADMIN_ONLY, ctrl.exportRegister);
router.post('/runs', authorize('payroll', 'update'), PAYROLL_STAFF, ctrl.runPayroll);
router.put('/runs/adjustments/:employeeId', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.upsertAdjustment);
router.post('/runs/lock', authorize('payroll', 'update'), ADMIN_ONLY, ctrl.lockRun);
router.post('/runs/unlock', authorize('payroll', 'approve'), ADMIN_ONLY, ctrl.unlockRun);

export default router;
