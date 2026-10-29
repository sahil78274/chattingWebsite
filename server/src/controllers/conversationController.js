import ApiError from '../utils/ApiError.js';
import { getStore } from '../store/index.js';
import {
  parseOrThrow,
  idSchema,
  sendMessageSchema,
  reportSchema,
  editMessageSchema,
  deleteMessageSchema,
  reactionSchema,
  forwardMessageSchema
} from '../utils/validation.js';
import { publicUser, conversationSummary } from '../utils/serialize.js';
import {
  createMessage,
  getConversationPayload,
  getOrCreateConversation,
  getPeer,
  hideConversation,
  listConversations,
  listMessages,
  loadConversationForUser,
  markConversationDelivered,
  markConversationRead,
  editMessage,
  deleteMessage,
  toggleReaction,
  forwardMessage
} from '../services/chatService.js';
import config from '../config/env.js';

export async function index(req, res) {
  const conversations = await listConversations(getStore(), req.user._id);
  res.json({ conversations });
}

export async function startWithUser(req, res) {
  const peerId = parseOrThrow(idSchema, req.params.userId, ApiError);
  const store = getStore();
  const conversation = await getOrCreateConversation(store, req.user._id, peerId);
  const payload = await getConversationPayload(store, conversation._id, req.user._id);
  res.status(201).json(payload);
}

export async function show(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const payload = await getConversationPayload(getStore(), conversationId, req.user._id);
  res.json(payload);
}

export async function messages(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const limit = Math.min(Number.parseInt(req.query.limit, 10) || config.limits.messagePageSize, 60);
  const before = req.query.before ? new Date(req.query.before) : null;
  if (before && Number.isNaN(before.getTime())) {
    throw ApiError.badRequest('Invalid "before" cursor', { code: 'INVALID_CURSOR' });
  }
  const beforeId = typeof req.query.beforeId === 'string' && /^[a-f0-9]{24}$/i.test(req.query.beforeId)
    ? req.query.beforeId
    : null;

  const store = getStore();
  // Fetch one extra row to know whether older messages exist.
  const rows = await listMessages(store, {
    conversationId,
    userId: req.user._id,
    before,
    beforeId,
    limit: limit + 1
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(rows.length - limit) : rows;
  const oldest = page.length ? page[0] : null;
  res.json({
    messages: page,
    hasMore,
    nextCursor: hasMore && oldest ? oldest.createdAt : null,
    nextCursorId: hasMore && oldest ? oldest.id : null
  });
}

export async function send(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const body = parseOrThrow(sendMessageSchema, req.body, ApiError);
  const store = getStore();
  const result = await createMessage(store, {
    conversationId,
    senderId: req.user._id,
    text: body.text,
    clientId: body.clientId,
    replyToId: body.replyToId
  });

  if (!result.duplicate) {
    // Mirror the socket broadcast for clients that fell back to REST, including
    // delivery receipts when the recipient already has a live session.
    const io = req.app.get('io');
    if (typeof io?.finalizeAndDeliver === 'function') {
      await io.finalizeAndDeliver(result);
    } else {
      io?.emitDirectMessage(result);
    }
  }
  res.status(201).json({
    message: result.message,
    duplicate: result.duplicate,
    conversation: conversationSummary(result.conversation, {
      viewerId: req.user._id,
      otherUser: await getPeer(store, result.conversation, req.user._id)
    })
  });
}

export async function read(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const result = await markConversationRead(getStore(), { conversationId, userId: req.user._id });
  req.app.get('io')?.emitReadReceipt({
    conversationId,
    readerId: req.user._id,
    senderId: result.senderId,
    readAt: result.readAt
  });
  res.json({ ok: true, readAt: result.readAt });
}

export async function delivered(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const result = await markConversationDelivered(getStore(), {
    conversationId,
    userId: req.user._id
  });
  req.app.get('io')?.emitDeliveredReceipt({
    conversationId,
    recipientId: req.user._id,
    deliveredAt: result.deliveredAt
  });
  res.json({ ok: true, deliveredAt: result.deliveredAt });
}

export async function hide(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  await hideConversation(getStore(), { conversationId, userId: req.user._id });
  res.json({ ok: true });
}

export async function unreadCount(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const store = getStore();
  await loadConversationForUser(store, conversationId, req.user._id);
  const count = await store.countUnreadForUser({ conversationId, userId: req.user._id });
  res.json({ unreadCount: count });
}

export async function blockUser(req, res) {
  const userId = parseOrThrow(idSchema, req.params.userId, ApiError);
  if (userId === req.user._id) throw ApiError.badRequest('You cannot block yourself');
  const store = getStore();
  const target = await store.findUserById(userId);
  if (!target) throw ApiError.notFound('User not found');

  try {
    await store.createBlock(req.user._id, userId);
  } catch (error) {
    if (error.name !== 'UniqueViolationError') throw error;
  }
  req.app.get('io')?.emitBlockChanged({ blockerId: req.user._id, blockedId: userId, blocked: true });
  res.json({ ok: true, blockedByMe: true });
}

export async function unblockUser(req, res) {
  const userId = parseOrThrow(idSchema, req.params.userId, ApiError);
  const store = getStore();
  await store.deleteBlock(req.user._id, userId);
  req.app.get('io')?.emitBlockChanged({ blockerId: req.user._id, blockedId: userId, blocked: false });
  res.json({ ok: true, blockedByMe: false });
}

export async function listBlocks(req, res) {
  const store = getStore();
  const ids = await store.listBlockedUsers(req.user._id);
  const users = await Promise.all(ids.map((id) => store.findUserById(id)));
  res.json({ blocked: users.filter(Boolean).map((u) => publicUser(u)) });
}

export async function reportUser(req, res) {
  const userId = parseOrThrow(idSchema, req.params.userId, ApiError);
  const body = parseOrThrow(reportSchema, req.body, ApiError);
  if (userId === req.user._id) throw ApiError.badRequest('You cannot report yourself');

  const store = getStore();
  const target = await store.findUserById(userId);
  if (!target) throw ApiError.notFound('User not found');

  if (body.messageId) {
    const message = await store.findMessageById(body.messageId);
    if (!message || message.sender !== userId) {
      throw ApiError.badRequest('The reported message does not belong to this user');
    }
  }

  const report = await store.createReport({
    reporter: req.user._id,
    reportedUser: userId,
    conversation: body.conversationId || null,
    message: body.messageId || null,
    reason: body.reason,
    details: body.details || ''
  });
  res.status(201).json({ ok: true, reportId: report._id, message: 'Report submitted. Our team will review it.' });
}

export async function edit(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const messageId = parseOrThrow(idSchema, req.params.messageId, ApiError);
  const body = parseOrThrow(editMessageSchema, req.body, ApiError);
  const result = await editMessage(getStore(), {
    conversationId,
    messageId,
    userId: req.user._id,
    text: body.text
  });
  req.app.get('io')?.emitMessageUpdated?.(result);
  res.json({ message: result.message });
}

export async function remove(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const messageId = parseOrThrow(idSchema, req.params.messageId, ApiError);
  const body = parseOrThrow(
    deleteMessageSchema,
    { scope: req.body?.scope || req.query?.scope || 'me' },
    ApiError
  );
  const result = await deleteMessage(getStore(), {
    conversationId,
    messageId,
    userId: req.user._id,
    scope: body.scope
  });
  const io = req.app.get('io');
  if (result.scope === 'everyone') io?.emitMessageUpdated?.(result);
  else io?.emitMessageRemoved?.({ conversationId, messageId, userId: req.user._id });
  res.json(result);
}

export async function react(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const messageId = parseOrThrow(idSchema, req.params.messageId, ApiError);
  const body = parseOrThrow(reactionSchema, req.body, ApiError);
  const result = await toggleReaction(getStore(), {
    conversationId,
    messageId,
    userId: req.user._id,
    emoji: body.emoji
  });
  req.app.get('io')?.emitMessageUpdated?.(result);
  res.json({ message: result.message });
}

export async function forward(req, res) {
  const conversationId = parseOrThrow(idSchema, req.params.conversationId, ApiError);
  const messageId = parseOrThrow(idSchema, req.params.messageId, ApiError);
  const body = parseOrThrow(forwardMessageSchema, req.body, ApiError);
  const store = getStore();
  const result = await forwardMessage(store, {
    sourceConversationId: conversationId,
    messageId,
    targetConversationId: body.targetConversationId,
    userId: req.user._id,
    clientId: body.clientId
  });
  if (!result.duplicate) {
    const io = req.app.get('io');
    if (typeof io?.finalizeAndDeliver === 'function') await io.finalizeAndDeliver(result);
    else io?.emitDirectMessage(result);
  }
  res.status(201).json({
    message: result.message,
    duplicate: result.duplicate,
    conversation: conversationSummary(result.conversation, {
      viewerId: req.user._id,
      otherUser: await getPeer(store, result.conversation, req.user._id)
    })
  });
}

export default {
  index,
  startWithUser,
  show,
  messages,
  send,
  edit,
  remove,
  react,
  forward,
  read,
  delivered,
  hide,
  unreadCount,
  blockUser,
  unblockUser,
  listBlocks,
  reportUser
};
