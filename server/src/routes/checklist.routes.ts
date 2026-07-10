import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/checklist.controller';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const router = Router();
router.use(authenticate);

// Templates — reads for anyone with recruitment access; writes are HR-only.
router.get('/templates', authorize('recruitment', 'read'), ctrl.listTemplates);
router.post('/templates/:id/items', authorize('recruitment', 'update'), authorizeRoles('admin', 'chro', 'hr'), ctrl.addTemplateItem);
router.put('/template-items/:id', authorize('recruitment', 'update'), authorizeRoles('admin', 'chro', 'hr'), ctrl.updateTemplateItem);
router.delete('/template-items/:id', authorize('recruitment', 'delete'), authorizeRoles('admin', 'chro', 'hr'), ctrl.deleteTemplateItem);

// Instances
router.get('/instances/:id', authorize('recruitment', 'read'), ctrl.getInstance);
router.post('/instances/:id/items', authorize('recruitment', 'update'), ctrl.addItem);

// Items
router.put('/items/:itemId/toggle', authorize('recruitment', 'update'), ctrl.toggleItem);
router.delete('/items/:itemId', authorize('recruitment', 'delete'), ctrl.deleteItem);

// Per-item document upload / download / remove
router.post('/items/:itemId/document', authorize('recruitment', 'update'), upload.single('file'), ctrl.uploadItemDocument);
router.get('/items/:itemId/document', authorize('recruitment', 'read'), ctrl.downloadItemDocument);
router.delete('/items/:itemId/document', authorize('recruitment', 'update'), ctrl.removeItemDocument);

export default router;
