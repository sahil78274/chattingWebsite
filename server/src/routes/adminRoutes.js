import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import rateLimit from '../middleware/rateLimit.js';
import * as adminController from '../controllers/adminController.js';
import { wrapAll } from '../utils/asyncHandler.js';

const admin = wrapAll(adminController);
const router = Router();

const writeLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  keyPrefix: 'admin-write',
  message: 'Too many admin actions. Please wait a moment.'
});

router.use(requireAuth, requireAdmin);

router.get('/overview', admin.overview);
router.get('/users', admin.users);
router.post('/users', writeLimiter, admin.createUser);
router.patch('/users/:userId/status', writeLimiter, admin.updateStatus);
router.patch('/users/:userId/role', writeLimiter, admin.updateRole);
router.get('/audit', admin.audit);

export default router;
