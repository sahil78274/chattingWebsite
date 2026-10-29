/**
 * Pure helpers for the chat workspace.
 *
 * Kept free of React so the merge / receipt rules can be unit-tested and so
 * every code path (ack, socket, REST, reconnect, pagination) applies the same
 * identity and monotonic-status rules.
 */

export function idsEqual(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export function isId(value) {
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

/** Accept a conversation object, `{ id }`, `{ _id }`, or a raw id string. */
export function conversationKey(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    if (typeof value.$oid === 'string') return value.$oid.trim();
    const nested = value.id || value._id;
    if (nested && nested !== value) return conversationKey(nested);
  }
  const asString = String(value);
  return asString === '[object Object]' ? '' : asString;
}

export function toMillis(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

export function conversationIdOf(message) {
  return message?.conversationId || message?.conversation || null;
}

export function senderIdOf(message) {
  return message?.senderId || message?.sender || null;
}

export function messageStatus(message) {
  if (!message) return 'sent';
  if (message.failed) return 'failed';
  if (message.pending) return 'pending';
  if (message.readAt) return 'read';
  if (message.deliveredAt) return 'delivered';
  return 'sent';
}

/** Keep the earliest timestamp; never drop an existing one. */
export function preferTimestamp(current, incoming) {
  if (current && incoming) {
    return toMillis(current) <= toMillis(incoming) ? current : incoming;
  }
  return current || incoming || null;
}

/**
 * Combine a local copy of a message with a server/socket copy.
 * Status only moves sent → delivered → read. Pending/failed flags clear once
 * the server has accepted the message.
 */
export function mergeMessageRecord(local, incoming) {
  if (!incoming && !local) return null;
  if (!incoming) return local;
  if (!local) {
    return { ...incoming, pending: false, failed: false };
  }

  const serverId = incoming.id && !String(incoming.id).startsWith('temp-') ? incoming.id : null;
  const readAt = preferTimestamp(local.readAt, incoming.readAt);
  const deliveredAt = preferTimestamp(local.deliveredAt, incoming.deliveredAt);
  const delivered = readAt ? deliveredAt || readAt : deliveredAt;

  const deleted = Boolean(incoming.deletedAt || incoming.deleted || local.deletedAt || local.deleted);
  return {
    ...local,
    ...incoming,
    id: serverId || local.id,
    clientId: incoming.clientId || local.clientId || null,
    conversationId: incoming.conversationId || local.conversationId || conversationIdOf(incoming) || conversationIdOf(local),
    senderId: incoming.senderId || local.senderId || senderIdOf(incoming) || senderIdOf(local),
    text: deleted ? '' : incoming.text ?? local.text,
    pending: false,
    failed: false,
    deliveredAt: delivered || null,
    readAt: readAt || null,
    editedAt: incoming.editedAt || local.editedAt || null,
    deletedAt: incoming.deletedAt || local.deletedAt || null,
    deleted,
    replyTo: incoming.replyTo !== undefined ? incoming.replyTo : local.replyTo || null,
    reactions: incoming.reactions || local.reactions || []
  };
}

export function findMessageIndex(list, message) {
  if (!Array.isArray(list) || !message) return -1;
  if (message.id && !String(message.id).startsWith('temp-')) {
    const id = String(message.id);
    const byId = list.findIndex((item) => item.id && String(item.id) === id);
    if (byId !== -1) return byId;
  }
  const clientId = message.clientId ? String(message.clientId) : null;
  if (clientId) {
    const byClient = list.findIndex((item) => item.clientId && String(item.clientId) === clientId);
    if (byClient !== -1) return byClient;
  }
  if (message.id) {
    const id = String(message.id);
    return list.findIndex((item) => item.id && String(item.id) === id);
  }
  return -1;
}

/** Insert or replace a single canonical message inside a thread. */
export function mergeServerMessage(list, message) {
  if (!message) return list || [];
  const current = list || [];
  const index = findMessageIndex(current, message);
  if (index === -1) return [...current, { ...message, pending: false, failed: false }];
  const next = [...current];
  next[index] = mergeMessageRecord(current[index], message);
  return next;
}

function inConversation(message, conversationId) {
  if (!conversationId) return true;
  const cid = conversationIdOf(message);
  return !cid || idsEqual(cid, conversationId);
}

/**
 * Reconcile a server page with whatever the client already has.
 *
 * - Matches on durable id, then on clientId (optimistic → canonical).
 * - Keeps local-only rows: pending, failed, older paginated history, and
 *   messages that were sent after a stale fetch started.
 * - Never downgrades delivery/read timestamps.
 */
export function reconcileMessages(local, serverPage, conversationId) {
  const localInThread = (local || []).filter((message) => inConversation(message, conversationId));
  const server = (serverPage || []).filter((message) => inConversation(message, conversationId));

  const merged = [];
  const usedLocal = new Set();

  for (const incoming of server) {
    const index = findMessageIndex(localInThread, incoming);
    if (index !== -1) {
      merged.push(mergeMessageRecord(localInThread[index], incoming));
      usedLocal.add(index);
    } else {
      merged.push({ ...incoming, pending: false, failed: false });
    }
  }

  for (let i = 0; i < localInThread.length; i += 1) {
    if (usedLocal.has(i)) continue;
    merged.push(localInThread[i]);
  }

  merged.sort((a, b) => {
    const delta = toMillis(a.createdAt) - toMillis(b.createdAt);
    if (delta !== 0) return delta;
    return String(a.id || a.clientId || '').localeCompare(String(b.id || b.clientId || ''));
  });

  const seenIds = new Set();
  const seenClients = new Set();
  const unique = [];
  for (const message of merged) {
    const idKey = message.id && !String(message.id).startsWith('temp-') ? String(message.id) : null;
    const clientKey = message.clientId ? String(message.clientId) : null;
    if (idKey && seenIds.has(idKey)) continue;
    if (clientKey && seenClients.has(clientKey)) continue;
    if (idKey) seenIds.add(idKey);
    if (clientKey) seenClients.add(clientKey);
    unique.push(message);
  }
  return unique;
}

/**
 * Apply a conversation-level delivery or read receipt to the sender's own
 * messages. Transitions are monotonic: sent → delivered → read.
 */
export function applyConversationReceipt(messages, { conversationId, viewerId, deliveredAt, readAt } = {}) {
  if (!Array.isArray(messages) || !conversationId) return messages || [];
  return messages.map((message) => {
    if (!inConversation(message, conversationId)) return message;
    if (!idsEqual(senderIdOf(message), viewerId)) return message;
    if (message.failed) return message;

    let nextDelivered = message.deliveredAt || null;
    let nextRead = message.readAt || null;

    if (deliveredAt && !nextDelivered) nextDelivered = deliveredAt;
    if (readAt && !nextRead) {
      nextRead = readAt;
      nextDelivered = nextDelivered || readAt;
    }

    if (nextDelivered === message.deliveredAt && nextRead === message.readAt) return message;
    return { ...message, deliveredAt: nextDelivered, readAt: nextRead };
  });
}

export default {
  idsEqual,
  messageStatus,
  mergeMessageRecord,
  mergeServerMessage,
  reconcileMessages,
  applyConversationReceipt
};
