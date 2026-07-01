import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authenticateApiKey } from '../middleware/apikey';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/biometric.controller';

const router = Router();

// ─── External endpoints (biometric vendor pushes data here) ───
// Auth: Bearer <api_key> — NOT JWT

router.post('/punch', authenticateApiKey, ctrl.receivePunch);
router.post('/punch/batch', authenticateApiKey, ctrl.receivePunchBatch);

// ─── Internal endpoints (HRMS admin/HR users) ───
// Auth: JWT cookie

router.use(authenticate);

router.post('/process', authorize('attendance', 'update'), ctrl.processLogs);
router.get('/logs', authorize('attendance', 'read'), ctrl.getLogs);
router.get('/logs/stats', authorize('attendance', 'read'), ctrl.getLogStats);
router.get('/devices', authorize('attendance', 'read'), ctrl.listDevices);

// API key management (admin only)
router.get('/api-keys', authorize('admin', 'read'), ctrl.listApiKeys);
router.post('/api-keys', authorize('admin', 'create'), ctrl.createApiKey);
router.delete('/api-keys/:id', authorize('admin', 'delete'), ctrl.revokeApiKey);

export default router;
