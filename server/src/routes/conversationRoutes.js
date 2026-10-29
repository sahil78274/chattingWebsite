import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import rateLimit from '../middleware/rateLimit.js';
import * as conversationController from '../controllers/conversationController.js';
import { wrapAll } from '../utils/asyncHandler.js';

const conversations = wrapAll(conversationController);

const router = Router();

const messageLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  keyPrefix: 'message',
  message: 'You are sending messages too quickly. Please wait a moment.'
});

router.use(requireAuth);

router.get('/', conversations.index);
router.get('/blocks', conversations.listBlocks);
router.get('/:conversationId', conversations.show);
router.get('/:conversationId/messages', conversations.messages);
router.post('/:conversationId/messages', messageLimiter, conversations.send);
router.patch('/:conversationId/messages/:messageId', conversations.edit);
router.delete('/:conversationId/messages/:messageId', conversations.remove);
router.post('/:conversationId/messages/:messageId/reactions', conversations.react);
router.post('/:conversationId/messages/:messageId/forward', messageLimiter, conversations.forward);
router.post('/:conversationId/read', conversations.read);
router.post('/:conversationId/delivered', conversations.delivered);
router.get('/:conversationId/unread', conversations.unreadCount);
router.delete('/:conversationId', conversations.hide);

export default router;
