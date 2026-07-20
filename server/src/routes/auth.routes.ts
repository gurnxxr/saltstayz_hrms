import { Router } from 'express';
import { z } from 'zod';
import * as authController from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { validate } from '../middleware/validate';

const router = Router();

// Request-body validation. `validate()` now writes the parsed (trimmed / stripped) values
// back onto req, so these schemas are real gates, not decoration. Wired onto the auth
// surface first as the highest-risk mutation path; broader per-route adoption across the
// other modules is follow-up work.
const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(1, 'Password is required'),
  }),
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(4, 'New password must be at least 4 characters'),
  }),
});

router.post('/login', validate(loginSchema), authController.login);
router.get('/me', authenticate, authController.me);
router.post('/logout', authController.logout);
router.post('/change-password', authenticate, validate(changePasswordSchema), authController.changePassword);

export default router;
