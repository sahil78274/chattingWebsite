import { Router } from 'express';
import rateLimit from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { uploadMiddleware } from '../middleware/upload.js';
import * as authController from '../controllers/authController.js';
import { wrapAll } from '../utils/asyncHandler.js';

const auth = wrapAll(authController);

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  keyPrefix: 'login',
  message: 'Too many sign-in attempts. Please try again in a few minutes.'
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  keyPrefix: 'register',
  message: 'Too many accounts created from this network. Please try again later.'
});
const refreshLimiter = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'refresh' });
const resetLimiter = rateLimit({
  windowMs: 60 * 60_000,
  max: 5,
  keyPrefix: 'reset',
  message: 'Too many password reset requests. Please try again later.'
});

router.post('/register', registerLimiter, auth.register);
router.post('/login', loginLimiter, auth.login);
router.post('/refresh', refreshLimiter, auth.refresh);
router.post('/logout', auth.logout);
router.get('/me', requireAuth, auth.me);
router.patch('/me', requireAuth, auth.updateProfile);
router.post('/me/avatar', requireAuth, uploadMiddleware, auth.uploadAvatar);
router.post('/me/avatar-color', requireAuth, auth.setAvatarColor);
router.post('/me/password', requireAuth, auth.updatePassword);
router.post('/me/logout-all', requireAuth, auth.logoutAll);
router.post('/forgot-password', resetLimiter, auth.forgotPassword);
router.post('/reset-password', resetLimiter, auth.resetPasswordHandler);

export default router;
