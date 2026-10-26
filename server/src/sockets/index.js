import { Server } from 'socket.io';
import cookie from 'cookie';
import config from '../config/env.js';
import logger from '../utils/logger.js';
import { verifyAccessToken, ACCESS_COOKIE } from '../utils/tokens.js';
import { idSchema, sanitizeText } from '../utils/validation.js';
import ApiError from '../utils/ApiError.js';
import {
  createMessage,
  loadConversationForUser,
  markConversationDelivered,
  markConversationRead,
  peerIdsForUser
} from '../services/chatService.js';

const userRoom = (userId) => `user:${userId}`;
const conversationRoom = (conversationId) => `conv:${conversationId}`;

/** In-process presence registry: userId -> Set<socketId>. */
const presence = new Map();

export function onlineUserIds() {
  return [...presence.keys()];
}

export function isUserOnline(userId) {
  return presence.has(userId);
}

function extractToken(socket) {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === 'string' && fromAuth.length > 10) return fromAuth;
  const raw = socket.handshake.headers?.cookie;
  if (raw) {
    const parsed = cookie.parse(raw);
    if (parsed[ACCESS_COOKIE]) return parsed[ACCESS_COOKIE];
  }
  const header = socket.handshake.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

function ackError(ack, error) {
  const status = error instanceof ApiError ? error.statusCode : 500;
  const payload = {
    ok: false,
    error: {
      message: error instanceof ApiError ? error.message : 'Unable to process the request',
      code: error?.code || 'SOCKET_ERROR',
      status
    }
  };
  if (typeof ack === 'function') ack(payload);
  else logger.warn('Socket handler error without ack', { error: error?.message });
}

function createSendRateLimiter({ max = 20, windowMs = 10_000 } = {}) {
  let windowStart = Date.now();
  let count = 0;
  return () => {
    const now = Date.now();
    if (now - windowStart > windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    return count <= max;
  };
}

export function createSocketServer(httpServer, store) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: {
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST']
    },
    maxHttpBufferSize: 1e6,
    pingTimeout: 25_000,
    pingInterval: 20_000
  });

  // ---------------------------------------------------------------- auth
  io.use(async (socket, next) => {
    try {
      const token = extractToken(socket);
      if (!token) return next(new Error('UNAUTHORIZED'));
      const payload = verifyAccessToken(token);
      const user = await store.findUserById(payload.sub);
      if (!user) return next(new Error('UNAUTHORIZED'));
      if ((user.tokenVersion || 0) !== (payload.tokenVersion || 0)) {
        return next(new Error('SESSION_REVOKED'));
      }
      socket.data.user = user;
      return next();
    } catch (error) {
      return next(new Error(error.code === 'TOKEN_EXPIRED' ? 'TOKEN_EXPIRED' : 'UNAUTHORIZED'));
    }
  });

  // ------------------------------------------------------- notifications
  async function notifyPresence(userId, online) {
    const peers = await peerIdsForUser(store, userId).catch(() => []);
    const payload = {
      userId,
      online,
      lastSeen: online ? null : new Date().toISOString()
    };
    for (const peerId of peers) io.to(userRoom(peerId)).emit('presence:update', payload);
  }

  async function joinUserConversations(socket) {
    const conversations = await store.listConversationsForUser(socket.data.user._id);
    for (const conversation of conversations) socket.join(conversationRoom(conversation._id));
    return conversations;
  }

  /**
   * Delivers a persisted message to both participants only. Never broadcasts
   * private content to unrelated sockets.
   */
  function deliverMessage(result) {
    const { message, conversation } = result;
    const recipient = conversation.participants.find((p) => p.user !== message.senderId);
    for (const participant of conversation.participants) {
      io.to(userRoom(participant.user)).emit('message:new', {
        message,
        conversationId: conversation._id,
        senderId: message.senderId,
        recipientId: recipient?.user || null,
        unreadCount: participant.unreadCount
      });
    }
  }

  io.emitDirectMessage = (result) => deliverMessage(result);

  io.emitReadReceipt = ({ conversationId, readerId, senderId, readAt }) => {
    if (!senderId) return;
    io.to(userRoom(senderId)).emit('message:read', { conversationId, readerId, readAt });
  };

  io.emitDeliveredReceipt = async ({ conversationId, recipientId, deliveredAt }) => {
    const conversation = await store.findConversationById(conversationId);
    const senderId = conversation?.participants.find((p) => p.user !== recipientId)?.user;
    if (senderId) {
      io.to(userRoom(senderId)).emit('receipt:delivered', { conversationId, recipientId, deliveredAt });
    }
  };

  io.emitBlockChanged = ({ blockerId, blockedId, blocked = true }) => {
    io.to(userRoom(blockerId)).emit('block:changed', { userId: blockedId, blocked, byMe: true });
    io.to(userRoom(blockedId)).emit('block:changed', { userId: blockerId, blocked, byMe: false });
  };

  // ------------------------------------------------------------ connection
  io.on('connection', async (socket) => {
    const user = socket.data.user;
    const userId = user._id;

    if (!presence.has(userId)) presence.set(userId, new Set());
    const wasOffline = presence.get(userId).size === 0;
    presence.get(userId).add(socket.id);

    socket.join(userRoom(userId));
    const conversations = await joinUserConversations(socket);
    await store.setPresence(userId, true);

    // Messages waiting for this user are now delivered to a live client.
    for (const conversation of conversations) {
      try {
        const { deliveredAt, senderId } = await markConversationDelivered(store, {
          conversationId: conversation._id,
          userId
        });
        if (senderId) {
          io.to(userRoom(senderId)).emit('receipt:delivered', {
            conversationId: conversation._id,
            recipientId: userId,
            deliveredAt
          });
        }
      } catch {
        /* ignore individual conversation failures */
      }
    }

    if (wasOffline) {
      notifyPresence(userId, true).catch(() => {});
    }

    // Tell the freshly connected client who of its peers is currently online.
    peerIdsForUser(store, userId)
      .then((peerIds) => {
        for (const peerId of peerIds) {
          socket.emit('presence:update', { userId: peerId, online: presence.has(peerId) });
        }
      })
      .catch(() => {});

    logger.info('Socket connected', { userId, socketId: socket.id });

    const allowSend = createSendRateLimiter();

    // ---------------------------------------------------------- sending
    socket.on('message:send', async (payload, ack) => {
      try {
        if (!allowSend()) {
          throw ApiError.tooMany('You are sending messages too quickly', { code: 'MESSAGE_RATE_LIMIT' });
        }
        const conversationId = idSchema.parse(payload?.conversationId);
        const text = sanitizeText(payload?.text);
        const clientId = typeof payload?.clientId === 'string' ? payload.clientId.slice(0, 80) : null;

        const result = await createMessage(store, {
          conversationId,
          senderId: userId,
          text,
          clientId
        });

        if (!result.duplicate) {
          deliverMessage(result);
          socket.join(conversationRoom(conversationId));
        }

        if (typeof ack === 'function') {
          ack({
            ok: true,
            message: result.message,
            duplicate: result.duplicate,
            serverTime: new Date().toISOString()
          });
        }
      } catch (error) {
        ackError(ack, error);
      }
    });

    // ------------------------------------------------------- joining room
    socket.on('conversation:join', async (payload, ack) => {
      try {
        const conversationId = idSchema.parse(payload?.conversationId);
        await loadConversationForUser(store, conversationId, userId);
        socket.join(conversationRoom(conversationId));
        await markConversationDelivered(store, { conversationId, userId });
        if (typeof ack === 'function') ack({ ok: true, conversationId });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('conversation:leave', async (payload) => {
      const parsed = idSchema.safeParse(payload?.conversationId);
      if (parsed.success) socket.leave(conversationRoom(parsed.data));
    });

    // ------------------------------------------------------------- typing
    socket.on('typing:start', async (payload) => {
      const parsed = idSchema.safeParse(payload?.conversationId);
      if (!parsed.success) return;
      try {
        const conversation = await loadConversationForUser(store, parsed.data, userId);
        const peer = conversation.participants.find((p) => p.user !== userId);
        if (!peer) return;
        socket.to(userRoom(peer.user)).emit('typing:start', {
          conversationId: parsed.data,
          userId,
          username: user.username
        });
      } catch {
        /* unauthorized conversation ids are ignored */
      }
    });

    socket.on('typing:stop', async (payload) => {
      const parsed = idSchema.safeParse(payload?.conversationId);
      if (!parsed.success) return;
      try {
        const conversation = await loadConversationForUser(store, parsed.data, userId);
        const peer = conversation.participants.find((p) => p.user !== userId);
        if (peer) {
          socket.to(userRoom(peer.user)).emit('typing:stop', { conversationId: parsed.data, userId });
        }
      } catch {
        /* ignore */
      }
    });

    // ----------------------------------------------------------- receipts
    socket.on('message:delivered', async (payload, ack) => {
      try {
        const conversationId = idSchema.parse(payload?.conversationId);
        // The sender is derived from the conversation, never trusted from the client.
        const { deliveredAt, senderId } = await markConversationDelivered(store, { conversationId, userId });
        if (senderId) {
          io.to(userRoom(senderId)).emit('receipt:delivered', {
            conversationId,
            recipientId: userId,
            deliveredAt
          });
        }
        if (typeof ack === 'function') ack({ ok: true });
      } catch (error) {
        ackError(ack, error);
      }
    });

    socket.on('message:read', async (payload, ack) => {
      try {
        const conversationId = idSchema.parse(payload?.conversationId);
        const result = await markConversationRead(store, { conversationId, userId });
        if (result.senderId) {
          io.to(userRoom(result.senderId)).emit('message:read', {
            conversationId,
            readerId: userId,
            readAt: result.readAt
          });
        }
        // Keep this user's other tabs in sync.
        io.to(userRoom(userId)).emit('conversation:unread', { conversationId, unreadCount: 0 });
        if (typeof ack === 'function') ack({ ok: true, readAt: result.readAt });
      } catch (error) {
        ackError(ack, error);
      }
    });

    // ---------------------------------------------------------- presence
    socket.on('presence:ping', (ack) => {
      if (typeof ack === 'function') ack({ ok: true, serverTime: new Date().toISOString() });
    });

    socket.on('disconnect', async (reason) => {
      const sockets = presence.get(userId);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          presence.delete(userId);
          await store.setPresence(userId, false).catch(() => {});
          notifyPresence(userId, false).catch(() => {});
        }
      }
      logger.info('Socket disconnected', { userId, reason });
    });
  });

  return io;
}

export default createSocketServer;
