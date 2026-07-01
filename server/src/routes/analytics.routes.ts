import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/analytics.controller';

const router = Router();
router.use(authenticate);

// Personal analytics — the logged-in employee's own attendance & leave (any analytics:read holder).
router.get('/me/overview', authorize('analytics', 'read'), ctrl.getMyOverview);
router.get('/me/trends', authorize('analytics', 'read'), ctrl.getMyTrends);

// ─── Org-level analytics: require analytics:read_org (admin/CHRO/HR), NOT employees ───

// Legacy endpoints (still used by some components)
router.get('/overview', authorize('analytics', 'read_org'), ctrl.getDashboardOverview);
router.get('/headcount', authorize('analytics', 'read_org'), ctrl.getHeadcount);
router.get('/attendance', authorize('analytics', 'read_org'), ctrl.getAttendance);
router.get('/leaves', authorize('analytics', 'read_org'), ctrl.getLeaves);
router.get('/recruitment', authorize('analytics', 'read_org'), ctrl.getRecruitment);
router.get('/attrition', authorize('analytics', 'read_org'), ctrl.getAttrition);

// v2 — 3-layer dashboard
router.get('/kpi', authorize('analytics', 'read_org'), ctrl.getKpiStrip);
router.get('/workforce', authorize('analytics', 'read_org'), ctrl.getWorkforceOverview);
router.get('/attrition-analysis', authorize('analytics', 'read_org'), ctrl.getAttritionAnalysis);
router.get('/attendance-productivity', authorize('analytics', 'read_org'), ctrl.getAttendanceProductivity);
router.get('/property-status', authorize('analytics', 'read_org'), ctrl.getPropertyEmployeeStatus);
router.get('/property-analytics', authorize('analytics', 'read_org'), ctrl.getPropertyAnalytics);
router.get('/drilldown', authorize('analytics', 'read_org'), ctrl.getDrilldown);

export default router;
