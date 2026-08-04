import { Router } from 'express';
import * as ctrl from '../controllers/passwordReset.controller';

/**
 * Password reset — the ONLY app-owned routes without `authenticate`.
 *
 * `.claude/rules/security-checklist.md` requires `router.use(authenticate)` and an `authorize()`
 * on every route file. This one deliberately has neither, because a password reset is by definition
 * for someone who cannot sign in. That is a documented deviation, not an oversight, and it is paid
 * for by controls the other routers do not need: a per-IP limiter (app.ts), a per-account issuance
 * and failure budget (passwordResetThrottle), responses that are byte-identical whether the account
 * exists or not, and full audit coverage.
 *
 * Mounted at its own prefix rather than under `/auth/*`, which matters more than it looks:
 *   - `app.ts` hands every `/api/v1/auth/*` path to Better Auth's catch-all, which would swallow it;
 *   - that catch-all sits BEFORE `express.json()`, so a route there gets no parsed body and no 10kb cap;
 *   - `middleware/audit.ts` skips any path beginning `auth`, so a reset placed there would never be
 *     audited — the one endpoint where the trail matters most.
 *
 * POST only, and no GET anywhere in the flow. `morgan` logs every request URL in production, so a
 * code in a query string is a code in the log aggregator.
 */
const router = Router();

router.get('/capabilities', ctrl.capabilities);
router.post('/request', ctrl.requestReset);
router.post('/confirm', ctrl.confirmReset);

export default router;
