import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/propertyAnalytics.controller';

const router = Router();
router.use(authenticate);

// Data is scoped per-user in the service (admin/chro/cluster_hr: org/cluster-wide;
// property_manager: own property). A single 'read' gate suffices.
router.get('/budget', authorize('propertyanalytics', 'read'), ctrl.budgetOverview);
router.get('/headcount', authorize('propertyanalytics', 'read'), ctrl.headcountByRole);
router.get('/salary-variance', authorize('propertyanalytics', 'read'), ctrl.salaryVariance);
router.get('/attrition', authorize('propertyanalytics', 'read'), ctrl.attrition);
router.get('/backfill', authorize('propertyanalytics', 'read'), ctrl.backfill);
router.get('/exceptions', authorize('propertyanalytics', 'read'), ctrl.exceptionLog);

export default router;
