import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/manpower.controller';

const router = Router();
router.use(authenticate);

// ─── Reads (any manpower viewer; data is scoped per-user in the service) ───
router.get('/properties', authorize('manpower', 'read'), ctrl.listScopedProperties);
router.get('/availability', authorize('manpower', 'read'), ctrl.getAvailability);
router.get('/sanctions', authorize('manpower', 'read'), ctrl.listSanctions);
router.get('/property-budgets', authorize('manpower', 'read'), ctrl.listPropertyBudgets);
// Static path before the :id route, or Express reads "unassigned" as an :id.
router.get('/property-budgets/unassigned', authorize('manpower', 'read'), ctrl.unassignedCommitment);
router.get('/property-budgets/:id/committed', authorize('manpower', 'read'), ctrl.propertyCommittedBreakdown);
router.get('/employees', authorize('manpower', 'read'), ctrl.listEmployees);
router.get('/replacements', authorize('manpower', 'read'), ctrl.listReplacements);
router.get('/employees/:id/history', authorize('manpower', 'read'), ctrl.getStatusHistory);
router.get('/exceptions', authorize('manpower', 'read'), ctrl.listExceptions);
router.get('/clusters', authorize('manpower', 'read'), ctrl.listClusters);

// ─── Sanctions + clusters: HQ Admin only ───
router.post('/sanctions', authorizeRoles('admin'), ctrl.upsertSanction);
router.put('/sanctions/:id/lock', authorizeRoles('admin'), ctrl.setSanctionLock);
router.post('/property-budgets/:id', authorizeRoles('admin'), ctrl.upsertPropertyBudget);
router.post('/clusters', authorizeRoles('admin'), ctrl.upsertCluster);
router.put('/properties/:id/cluster', authorizeRoles('admin'), ctrl.setPropertyCluster);
router.get('/property-console', authorizeRoles('admin'), ctrl.getPropertyConsole);
router.put('/property-console/department-workers', authorizeRoles('admin'), ctrl.setDepartmentWorkers);
router.get('/cluster-hr-users', authorizeRoles('admin'), ctrl.listClusterHrUsers);
router.get('/users/:id/clusters', authorizeRoles('admin'), ctrl.getUserClusters);
router.put('/users/:id/clusters', authorizeRoles('admin'), ctrl.setUserClusters);

// ─── Hiring + status (Cluster HR / Admin / Property Manager per RBAC) ───
router.post('/hires', authorize('manpower', 'create'), ctrl.createHire);
router.put('/employees/:id/status', authorize('manpower', 'update'), ctrl.changeStatus);
router.post('/exceptions', authorize('manpower', 'create'), ctrl.createException);

// ─── Exception review: HQ Admin only ───
router.put('/exceptions/:id/approve', authorizeRoles('admin'), ctrl.approveException);
router.put('/exceptions/:id/reject', authorizeRoles('admin'), ctrl.rejectException);

export default router;
