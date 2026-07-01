import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/rbac';
import * as ctrl from '../controllers/offboarding.controller';

// Reuses the 'onboarding' permission set (HR / CHRO / admin) — the exit workflow
// is the lifecycle mirror of onboarding.
const router = Router();
router.use(authenticate);

router.get('/stats', authorize('onboarding', 'read'), ctrl.stats);
router.get('/cases', authorize('onboarding', 'read'), ctrl.list);
router.get('/cases/:id', authorize('onboarding', 'read'), ctrl.get);
router.post('/cases', authorize('onboarding', 'create'), ctrl.create);
router.put('/cases/:id', authorize('onboarding', 'update'), ctrl.update);
router.put('/cases/:id/fnf', authorize('onboarding', 'update'), ctrl.saveFnF);
router.post('/cases/:id/complete', authorize('onboarding', 'update'), ctrl.complete);

router.post('/cases/:id/items', authorize('onboarding', 'update'), ctrl.addItem);
router.put('/items/:itemId/toggle', authorize('onboarding', 'update'), ctrl.toggleItem);
router.delete('/items/:itemId', authorize('onboarding', 'delete'), ctrl.deleteItem);

export default router;
