import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from '../middleware/rateLimit.js';
import * as userController from '../controllers/userController.js';
import * as conversationController from '../controllers/conversationController.js';
import { wrapAll } from '../utils/asyncHandler.js';

const users = wrapAll(userController);
const conversations = wrapAll(conversationController);

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 40,
  keyPrefix: 'search',
  message: 'You are searching too quickly. Please slow down.'
});

router.use(requireAuth);

router.get('/search', searchLimiter, users.searchUsers);
router.get('/:userId', users.getUser);
router.post('/:userId/conversation', conversations.startWithUser);
router.post('/:userId/block', conversations.blockUser);
router.delete('/:userId/block', conversations.unblockUser);
router.post('/:userId/report', conversations.reportUser);

export default router;
