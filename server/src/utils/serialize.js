/**
 * Single source of truth for turning store records into API payloads.
 * Nothing here ever includes password hashes, emails of other users, token
 * versions or raw store internals.
 */

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
  const lastSeenAllowed = user.privacy?.lastSeen !== 'nobody';
  const payload = {
    id: user._id || user.id,
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
    privacy: { lastSeen: user.privacy?.lastSeen || 'everyone' }
  };
}

export function conversationSummary(conversation, { viewerId, otherUser, blockedByMe = false, blockedMe = false }) {
  const participant = conversation.participants.find((p) => p.user === viewerId);
  return {
    id: conversation._id,
    type: conversation.type || 'direct',
    peer: publicUser(otherUser),
    lastMessage: conversation.lastMessage?.messageId
      ? {
          text: conversation.lastMessage.text || '',
          senderId: conversation.lastMessage.senderId,
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

export function messagePayload(message) {
  if (!message) return null;
  const deliveredAt = toIso(message.deliveredAt);
  const readAt = toIso(message.readAt);
  return {
    id: message._id || message.id,
    conversationId: message.conversation || message.conversationId,
    senderId: message.sender || message.senderId,
    text: message.text,
    clientId: message.clientId || null,
    createdAt: toIso(message.createdAt) || message.createdAt,
    deliveredAt,
    readAt,
    status: readAt ? 'read' : deliveredAt ? 'delivered' : 'sent'
  };
}

export default { publicUser, selfUser, conversationSummary, messagePayload, initialsFor };
