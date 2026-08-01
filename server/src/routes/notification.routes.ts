import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { authorize, authorizeRoles } from '../middleware/rbac';
import * as ctrl from '../controllers/notification.controller';

// Every authenticated user manages their own notifications — no module RBAC.
const router = Router();
router.use(authenticate);

router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.put('/read-all', ctrl.markAllRead);

// Who gets told what. Deciding that somebody else's inbox fills up is an admin act, and the
// grid names every role in the company, so it sits behind the admin module rather than the
// per-user routes above. Declared before /:id/read so "settings" is not read as an id.
router.get('/settings', authorize('admin', 'read'), ctrl.getSettings);
router.get('/settings/activity', authorize('admin', 'read'), ctrl.getActivity);
router.put('/settings/:eventKey', authorize('admin', 'update'), authorizeRoles('admin', 'chro', 'hr'), ctrl.updateEventAudiences);

router.put('/:id/read', ctrl.markRead);

export default router;
