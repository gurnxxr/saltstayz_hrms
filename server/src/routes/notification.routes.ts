import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as ctrl from '../controllers/notification.controller';

// Every authenticated user manages their own notifications — no module RBAC.
const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.put('/read-all', ctrl.markAllRead);
router.put('/:id/read', ctrl.markRead);

export default router;
