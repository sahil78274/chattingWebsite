import ApiError from '../utils/ApiError.js';
import { idsEqual, newId, normalizeId, pairKeyFor } from '../utils/ids.js';
import { MESSAGE_MAX_LENGTH, REACTION_EMOJIS } from '../models/Message.js';
import { sanitizeText } from '../utils/validation.js';
import { conversationSummary, messagePayload, publicUser } from '../utils/serialize.js';
import logger from '../utils/logger.js';

/**
 * All conversation/message business rules live here so that the REST API and the
 * Socket.IO handlers enforce exactly the same authorization and validation.
 */

export async function loadConversationForUser(store, conversationId, userId) {
  const conversation = await store.findConversationById(conversationId);
  if (!conversation) throw ApiError.notFound('Conversation not found', { code: 'CONVERSATION_NOT_FOUND' });
  if (!conversation.participants.some((p) => idsEqual(p.user, userId))) {
    // Do not reveal whether the conversation exists.
    throw ApiError.forbidden('You are not a participant in this conversation', {
      code: 'NOT_A_MEMBER'
    });
  }
  return conversation;
}

export async function getPeer(store, conversation, userId) {
  const other = conversation.participants.find((p) => !idsEqual(p.user, userId));
  if (!other) return null;
  return store.findUserById(other.user);
}

export async function getOrCreateConversation(store, userId, peerId) {
  if (idsEqual(userId, peerId)) {
    throw ApiError.badRequest('You cannot start a conversation with yourself', {
      code: 'SELF_CONVERSATION'
    });
  }
  const peer = await store.findUserById(peerId);
  if (!peer) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });

  if (await store.isBlockedEitherWay(userId, peerId)) {
    throw ApiError.forbidden('You cannot start a conversation with this user', {
      code: 'BLOCKED'
    });
  }

  const pairKey = pairKeyFor(userId, peerId);
  const existing = await store.findConversationByPair(pairKey);
  if (existing) {
    // Re-opening a hidden thread brings it back for the requesting user only.
    const participant = existing.participants.find((p) => idsEqual(p.user, userId));
    if (participant?.hiddenAt) {
      const participants = existing.participants.map((p) =>
        idsEqual(p.user, userId) ? { ...p, hiddenAt: null } : p
      );
      return store.updateConversation(existing._id, { participants });
    }
    return existing;
  }

  try {
    return await store.createConversation({
      _id: newId(),
      pairKey,
      type: 'direct',
      participants: [
        { user: userId, unreadCount: 0, lastReadAt: new Date() },
        { user: peerId, unreadCount: 0, lastReadAt: new Date() }
      ],
      lastMessage: { text: '', senderId: null, messageId: null, createdAt: null },
      lastMessageAt: new Date()
    });
  } catch (error) {
    if (error.name === 'UniqueViolationError') {
      // Lost a race with another request creating the same pair - reuse it.
      const conversation = await store.findConversationByPair(pairKey);
      if (conversation) return conversation;
    }
    throw error;
  }
}

export async function listConversations(store, userId) {
  const conversations = await store.listConversationsForUser(userId);
  const blocked = new Set((await store.listBlockedUsers(userId)).map((id) => normalizeId(id)));

  const summaries = await Promise.all(
    conversations.map(async (conversation) => {
      const peer = await getPeer(store, conversation, userId);
      if (!peer) return null;
      const peerBlockedMe = await store.findBlock(peer._id, userId);
      return conversationSummary(conversation, {
        viewerId: userId,
        otherUser: peer,
        blockedByMe: blocked.has(normalizeId(peer._id)),
        blockedMe: Boolean(peerBlockedMe)
      });
    })
  );

  return summaries
    .filter(Boolean)
    .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
}

export async function getConversationPayload(store, conversationId, userId) {
  const conversation = await loadConversationForUser(store, conversationId, userId);
  const peer = await getPeer(store, conversation, userId);
  const blockedByMe = await store.findBlock(userId, conversation.participants.find((p) => !idsEqual(p.user, userId))?.user);
  const blockedMe = peer ? await store.findBlock(peer._id, userId) : null;
  return {
    conversation: conversationSummary(conversation, {
      viewerId: userId,
      otherUser: peer,
      blockedByMe: Boolean(blockedByMe),
      blockedMe: Boolean(blockedMe)
    }),
    peer: publicUser(peer)
  };
}

export async function listMessages(store, { conversationId, userId, before, beforeId, limit = 30 }) {
  await loadConversationForUser(store, conversationId, userId);
  const messages = await store.listMessages({ conversationId, limit, before, beforeId, viewerId: userId });
  return messages.map((message) => messagePayload(message, { viewerId: userId }));
}

async function loadOwnMessage(store, { conversationId, messageId, userId }) {
  await loadConversationForUser(store, conversationId, userId);
  const message = await store.findMessageById(messageId);
  if (!message || !idsEqual(message.conversation, conversationId)) {
    throw ApiError.notFound('Message not found', { code: 'MESSAGE_NOT_FOUND' });
  }
  return message;
}

export async function createMessage(store, { conversationId, senderId, text, clientId, replyToId }) {
  const conversation = await loadConversationForUser(store, conversationId, senderId);
  const recipient = conversation.participants.find((p) => !idsEqual(p.user, senderId));
  if (!recipient) throw ApiError.badRequest('Conversation has no recipient');
  const threadId = normalizeId(conversation._id || conversationId);
  const fromId = normalizeId(senderId);

  if (await store.isBlockedEitherWay(fromId, recipient.user)) {
    throw ApiError.forbidden('Messaging is unavailable while a block is in place', { code: 'BLOCKED' });
  }

  const cleanText = sanitizeText(text);
  if (!cleanText) throw ApiError.badRequest('Message cannot be empty', { code: 'EMPTY_MESSAGE' });
  if (cleanText.length > MESSAGE_MAX_LENGTH) {
    throw ApiError.badRequest(`Message must be at most ${MESSAGE_MAX_LENGTH} characters`, {
      code: 'MESSAGE_TOO_LONG'
    });
  }

  if (clientId) {
    const existing = await store.findMessageByClientId({ conversationId: threadId, senderId: fromId, clientId });
    if (existing) {
      return { message: messagePayload(existing, { viewerId: fromId }), conversation, duplicate: true };
    }
  }

  let replyTo = null;
  if (replyToId) {
    const original = await store.findMessageById(replyToId);
    if (original && idsEqual(original.conversation, conversationId) && !original.deletedAt) {
      replyTo = {
        id: normalizeId(original._id),
        senderId: normalizeId(original.sender),
        text: String(original.text || '').slice(0, 140)
      };
    }
  }

  let message;
  try {
    message = await store.createMessage({
      conversation: threadId,
      sender: fromId,
      text: cleanText,
      clientId: clientId || null,
      replyTo
    });
  } catch (error) {
    if (error.name === 'UniqueViolationError' && clientId) {
      const existing = await store.findMessageByClientId({ conversationId: threadId, senderId: fromId, clientId });
      if (existing) {
        return { message: messagePayload(existing, { viewerId: fromId }), conversation, duplicate: true };
      }
    }
    throw error;
  }

  const updated = await store.applyNewMessageToConversation(threadId, {
    recipientId: recipient.user,
    senderId: fromId,
    message
  });

  return {
    message: messagePayload(message, { viewerId: fromId }),
    conversation: updated || conversation,
    duplicate: false,
    recipientId: normalizeId(recipient.user)
  };
}

export async function editMessage(store, { conversationId, messageId, userId, text }) {
  const message = await loadOwnMessage(store, { conversationId, messageId, userId });
  if (!idsEqual(message.sender, userId)) {
    throw ApiError.forbidden('You can only edit your own messages', { code: 'NOT_MESSAGE_OWNER' });
  }
  if (message.deletedAt) throw ApiError.badRequest('Deleted messages cannot be edited', { code: 'MESSAGE_DELETED' });
  const cleanText = sanitizeText(text);
  if (!cleanText) throw ApiError.badRequest('Message cannot be empty', { code: 'EMPTY_MESSAGE' });
  if (cleanText.length > MESSAGE_MAX_LENGTH) {
    throw ApiError.badRequest(`Message must be at most ${MESSAGE_MAX_LENGTH} characters`, {
      code: 'MESSAGE_TOO_LONG'
    });
  }
  const updated = await store.updateMessage(messageId, { text: cleanText, editedAt: new Date() });
  await syncConversationPreview(store, conversationId, messageId, cleanText);
  return { message: messagePayload(updated, { viewerId: userId }), conversationId };
}

async function syncConversationPreview(store, conversationId, messageId, text) {
  const conversation = await store.findConversationById(conversationId);
  if (!conversation?.lastMessage) return;
  if (String(conversation.lastMessage.messageId || '') !== String(messageId)) return;
  await store.updateConversation(conversationId, {
    lastMessage: {
      ...conversation.lastMessage,
      text: String(text || '').slice(0, 160)
    }
  });
}

export async function deleteMessage(store, { conversationId, messageId, userId, scope = 'me' }) {
  const message = await loadOwnMessage(store, { conversationId, messageId, userId });
  if (scope === 'everyone') {
    if (!idsEqual(message.sender, userId)) {
      throw ApiError.forbidden('You can only delete everyone\'s copy of your own messages', {
        code: 'NOT_MESSAGE_OWNER'
      });
    }
    const updated = await store.updateMessage(messageId, {
      text: '',
      deletedAt: new Date(),
      deletedBy: userId,
      reactions: []
    });
    await syncConversationPreview(store, conversationId, messageId, '');
    logger.info('Message deleted for everyone', { conversationId, messageId, userId });
    return { message: messagePayload(updated, { viewerId: userId }), conversationId, scope: 'everyone' };
  }

  const deletedFor = [...new Set([...(message.deletedFor || []), userId])];
  await store.updateMessage(messageId, { deletedFor });
  return { messageId, conversationId, scope: 'me' };
}

export async function toggleReaction(store, { conversationId, messageId, userId, emoji }) {
  if (!REACTION_EMOJIS.includes(emoji)) {
    throw ApiError.badRequest('That reaction is not supported', { code: 'INVALID_REACTION' });
  }
  const message = await loadOwnMessage(store, { conversationId, messageId, userId });
  if (message.deletedAt) {
    throw ApiError.badRequest('Cannot react to a deleted message', { code: 'MESSAGE_DELETED' });
  }
  const current = Array.isArray(message.reactions) ? message.reactions : [];
  const exists = current.some((reaction) => idsEqual(reaction.user, userId) && reaction.emoji === emoji);
  const reactions = exists
    ? current.filter((reaction) => !(idsEqual(reaction.user, userId) && reaction.emoji === emoji))
    : [...current, { emoji, user: normalizeId(userId), createdAt: new Date() }];
  const updated = await store.updateMessage(messageId, { reactions });
  return { message: messagePayload(updated, { viewerId: userId }), conversationId };
}

export async function forwardMessage(store, { sourceConversationId, messageId, targetConversationId, userId, clientId }) {
  const source = await loadOwnMessage(store, {
    conversationId: sourceConversationId,
    messageId,
    userId
  });
  if (source.deletedAt) throw ApiError.badRequest('Cannot forward a deleted message', { code: 'MESSAGE_DELETED' });
  return createMessage(store, {
    conversationId: targetConversationId,
    senderId: userId,
    text: source.text,
    clientId
  });
}

export async function markConversationRead(store, { conversationId, userId }) {
  const conversation = await loadConversationForUser(store, conversationId, userId);
  const readAt = new Date();
  await store.markReadByUser({ conversationId, readerId: userId, at: readAt });
  const updated = await store.resetUnread(conversationId, userId, readAt);
  const senderId = conversation.participants.find((p) => !idsEqual(p.user, userId))?.user;
  return { readAt, senderId: senderId ? normalizeId(senderId) : senderId, conversation: updated };
}

export async function markConversationDelivered(store, { conversationId, userId }) {
  const conversation = await loadConversationForUser(store, conversationId, userId);
  const deliveredAt = new Date();
  await store.markDeliveredToUser({ conversationId, recipientId: userId });
  const senderId = conversation.participants.find((p) => !idsEqual(p.user, userId))?.user || null;
  return { deliveredAt, senderId: senderId ? normalizeId(senderId) : null };
}

export async function conversationIdsForUser(store, userId) {
  const conversations = await store.listConversationsForUser(userId);
  return conversations.map((c) => normalizeId(c._id));
}

export async function peerIdsForUser(store, userId) {
  const conversations = await store.listConversationsForUser(userId);
  const peers = conversations.map((c) => c.participants.find((p) => !idsEqual(p.user, userId))?.user);
  return [...new Set(peers.filter(Boolean).map((id) => normalizeId(id)))];
}

export async function searchUsersForViewer(store, { query, viewerId, page = 1, limit = 10 }) {
  const offset = (page - 1) * limit;
  const results = await store.searchUsers({ query, excludeId: viewerId, limit: limit + 1, offset });
  const hasMore = results.length > limit;
  const pageItems = results.slice(0, limit);
  const blocked = new Set((await store.listBlockedUsers(viewerId)).map((id) => normalizeId(id)));
  return {
    results: pageItems.map((user) => ({
      ...publicUser(user),
      blockedByMe: blocked.has(normalizeId(user._id))
    })),
    page,
    pageSize: limit,
    hasMore
  };
}

export async function hideConversation(store, { conversationId, userId }) {
  const conversation = await loadConversationForUser(store, conversationId, userId);
  const participants = conversation.participants.map((p) =>
    idsEqual(p.user, userId) ? { ...p, hiddenAt: new Date(), unreadCount: 0 } : p
  );
  await store.updateConversation(conversationId, { participants });
  logger.info('Conversation hidden by user', { conversationId, userId });
  return { ok: true };
}

export default {
  loadConversationForUser,
  getOrCreateConversation,
  listConversations,
  getConversationPayload,
  listMessages,
  createMessage,
  markConversationRead,
  markConversationDelivered,
  conversationIdsForUser,
  peerIdsForUser,
  searchUsersForViewer,
  hideConversation,
  getPeer,
  editMessage,
  deleteMessage,
  toggleReaction,
  forwardMessage
};
