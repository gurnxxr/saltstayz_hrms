import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { sessionContext } from '../controllers/auth.controller';
import employeeRoutes from './employee.routes';
import attendanceRoutes from './attendance.routes';
import leaveRoutes from './leave.routes';
import shiftRoutes from './shift.routes';
import checklistRoutes from './checklist.routes';
import offboardingRoutes from './offboarding.routes';
import recruitmentRoutes from './recruitment.routes';
import analyticsRoutes from './analytics.routes';
import reportsRoutes from './reports.routes';
import payrollRoutes from './payroll.routes';
import adminRoutes from './admin.routes';
import financeRoutes from './finance.routes';
import biometricRoutes from './biometric.routes';
import notificationRoutes from './notification.routes';
import manpowerRoutes from './manpower.routes';
import payScheduleRoutes from './paySchedule.routes';
import statutoryRoutes from './statutory.routes';
import salaryComponentRoutes from './salaryComponent.routes';
import employeeLifecycleRoutes from './employeeLifecycle.routes';
import regularisationRoutes from './regularisation.routes';

const router = Router();

// Sign-in/out live under /auth/* (handled by Better Auth, mounted in app.ts before this
// router). The client hydrates its session — user + permissions + overrides — from here.
router.get('/session-context', authenticate, sessionContext);
router.use('/employees', employeeRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/leave', leaveRoutes);
router.use('/shifts', shiftRoutes);
router.use('/checklists', checklistRoutes);
router.use('/offboarding', offboardingRoutes);
router.use('/recruitment', recruitmentRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/reports', reportsRoutes);
router.use('/payroll', payrollRoutes);
router.use('/admin', adminRoutes);
router.use('/finance', financeRoutes);
router.use('/biometric', biometricRoutes);
router.use('/notifications', notificationRoutes);
router.use('/manpower', manpowerRoutes);
router.use('/pay-schedule', payScheduleRoutes);
router.use('/statutory', statutoryRoutes);
router.use('/salary-components', salaryComponentRoutes);
router.use('/employee-lifecycle', employeeLifecycleRoutes);
router.use('/regularisation', regularisationRoutes);

export default router;
