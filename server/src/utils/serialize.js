/**
 * Single source of truth for turning store records into API payloads.
 * Nothing here ever includes password hashes, emails of other users, token
 * versions or raw store internals.
 */

import { idsEqual, normalizeId } from './ids.js';

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function initialsFor(user) {
  const source = String(user?.displayName || user?.username || '?').trim();
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function publicUser(user, { includeEmail = false } = {}) {
  if (!user) return null;
  if ((user.status || 'active') === 'deleted') {
    return {
      id: normalizeId(user._id || user.id),
      username: 'deleted',
      displayName: 'Deleted account',
      bio: '',
      avatarUrl: '',
      avatarColor: '#71717a',
      initials: '?',
      createdAt: user.createdAt,
      online: false,
      lastSeen: null,
      lastSeenHidden: true
    };
  }
  const lastSeenAllowed = user.privacy?.lastSeen !== 'nobody';
  const payload = {
    id: normalizeId(user._id || user.id),
    username: user.username,
    displayName: user.displayName,
    bio: user.bio || '',
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '#6366f1',
    initials: initialsFor(user),
    createdAt: user.createdAt,
    online: Boolean(user.presence?.online),
    lastSeen: lastSeenAllowed ? user.presence?.lastSeen || null : null,
    lastSeenHidden: !lastSeenAllowed
  };
  if (includeEmail) payload.email = user.email;
  return payload;
}

export function selfUser(user) {
  return {
    ...publicUser(user, { includeEmail: true }),
    privacy: { lastSeen: user.privacy?.lastSeen || 'everyone' },
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status || 'active'
  };
}

export function adminUser(user) {
  if (!user) return null;
  return {
    id: normalizeId(user._id || user.id),
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    bio: user.bio || '',
    avatarUrl: user.avatarUrl || '',
    avatarColor: user.avatarColor || '#6366f1',
    initials: initialsFor(user),
    role: user.role === 'admin' ? 'admin' : 'user',
    status: user.status || 'active',
    createdAt: user.createdAt,
    online: Boolean(user.presence?.online),
    lastSeen: user.presence?.lastSeen || null
  };
}

export function conversationSummary(conversation, { viewerId, otherUser, blockedByMe = false, blockedMe = false }) {
  const participant = (conversation.participants || []).find((p) => idsEqual(p.user, viewerId));
  return {
    id: normalizeId(conversation._id || conversation.id),
    type: conversation.type || 'direct',
    peer: publicUser(otherUser),
    lastMessage: conversation.lastMessage?.messageId
      ? {
          text: conversation.lastMessage.text || '',
          senderId:
            conversation.lastMessage.senderId != null
              ? normalizeId(conversation.lastMessage.senderId)
              : null,
          createdAt: conversation.lastMessage.createdAt
        }
      : null,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount: participant?.unreadCount || 0,
    blockedByMe,
    blockedMe,
    createdAt: conversation.createdAt
  };
}

export function serializeReactions(reactions = [], viewerId) {
  const map = new Map();
  for (const reaction of reactions) {
    const emoji = reaction.emoji;
    if (!emoji) continue;
    if (!map.has(emoji)) map.set(emoji, { emoji, count: 0, reacted: false, userIds: [] });
    const entry = map.get(emoji);
    entry.count += 1;
    entry.userIds.push(reaction.user);
    if (viewerId && String(reaction.user) === String(viewerId)) entry.reacted = true;
  }
  return [...map.values()];
}

export function messagePayload(message, { viewerId } = {}) {
  if (!message) return null;
  const deliveredAt = toIso(message.deliveredAt);
  const readAt = toIso(message.readAt);
  const deletedAt = toIso(message.deletedAt);
  const reply = message.replyTo
    ? {
        id: message.replyTo.id,
        senderId: message.replyTo.senderId,
        text: message.replyTo.text || ''
      }
    : null;
  return {
    id: normalizeId(message._id || message.id),
    conversationId: normalizeId(message.conversation || message.conversationId),
    senderId: normalizeId(message.sender || message.senderId),
    text: deletedAt ? '' : message.text,
    clientId: message.clientId || null,
    createdAt: toIso(message.createdAt) || message.createdAt,
    deliveredAt,
    readAt,
    editedAt: toIso(message.editedAt),
    deletedAt,
    deleted: Boolean(deletedAt),
    replyTo: reply,
    reactions: serializeReactions(message.reactions || [], viewerId),
    status: deletedAt ? 'deleted' : readAt ? 'read' : deliveredAt ? 'delivered' : 'sent'
  };
}

export default { publicUser, selfUser, adminUser, conversationSummary, messagePayload, initialsFor };
