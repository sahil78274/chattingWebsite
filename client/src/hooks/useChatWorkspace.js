import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAccessToken } from '../services/api.js';
import { createSocket } from '../services/socket.js';
import {
  applyConversationReceipt,
  idsEqual,
  mergeServerMessage,
  reconcileMessages
} from '../lib/messages.js';

const PAGE_SIZE = 30;

function emitAck(socket, event, payload, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The server did not confirm in time.')), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      if (response?.ok) return resolve(response);
      const error = new Error(response?.error?.message || 'The message could not be sent');
      error.code = response?.error?.code;
      return reject(error);
    });
  });
}

export function useChatWorkspace({ user, notify, onBrowserNotification }) {
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [typingByConversation, setTypingByConversation] = useState({});
  const [connectionState, setConnectionState] = useState('connecting');

  const socketRef = useRef(null);
  const activeIdRef = useRef(null);
  const conversationsRef = useRef([]);
  const messagesRef = useRef([]);
  const cacheRef = useRef(new Map());
  const typingTimers = useRef(new Map());
  const failedMessagesRef = useRef([]);
  const browserNotificationRef = useRef(onBrowserNotification);
  const openRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const userId = user?.id;

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    messagesRef.current = messages;
    if (activeId) cacheRef.current.set(activeId, messages);
  }, [messages, activeId]);

  useEffect(() => {
    browserNotificationRef.current = onBrowserNotification;
  }, [onBrowserNotification]);

  useEffect(() => {
    failedMessagesRef.current = messages.filter((message) => message.failed);
  }, [messages]);

  const updateMessagesFor = useCallback((conversationId, updater) => {
    if (!conversationId) return;
    if (idsEqual(activeIdRef.current, conversationId)) {
      setMessages((current) => {
        const next = updater(current);
        cacheRef.current.set(conversationId, next);
        return next;
      });
    } else {
      const current = cacheRef.current.get(conversationId) || [];
      cacheRef.current.set(conversationId, updater(current));
    }
  }, []);

  const loadConversations = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setConversationsLoading(true);
    try {
      const data = await api.listConversations();
      if (!mountedRef.current) return;
      setConversations(data.conversations);
      setConversationsError('');
    } catch (error) {
      if (!mountedRef.current) return;
      setConversationsError(error.message || 'Could not load your conversations');
    } finally {
      if (mountedRef.current) setConversationsLoading(false);
    }
  }, []);

  const markRead = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      if (socketRef.current?.connected) {
        socketRef.current.emit('message:read', { conversationId }, () => {});
      } else {
        await api.markRead(conversationId);
      }
    } catch {
      /* non critical — unread badges resync on the next conversation load */
    }
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation
      )
    );
  }, []);

  const openConversation = useCallback(
    async (conversationId) => {
      const requestId = openRequestRef.current + 1;
      openRequestRef.current = requestId;
      const previous = activeIdRef.current;
      if (previous && !idsEqual(previous, conversationId)) {
        cacheRef.current.set(previous, messagesRef.current);
      }

      setActiveId(conversationId);
      activeIdRef.current = conversationId;
      setMessagesError('');

      const cached = cacheRef.current.get(conversationId);
      if (cached?.length) {
        setMessages(cached);
        setMessagesLoading(false);
      } else if (!idsEqual(previous, conversationId)) {
        setMessages([]);
        setMessagesLoading(true);
      } else {
        setMessagesLoading(true);
      }

      try {
        const data = await api.listMessages(conversationId, { limit: PAGE_SIZE });
        if (openRequestRef.current !== requestId) return;
        setMessages((current) => {
          const next = reconcileMessages(current, data.messages, conversationId);
          cacheRef.current.set(conversationId, next);
          return next;
        });
        setHasMore(data.hasMore);
        setCursor(data.hasMore ? { before: data.nextCursor, beforeId: data.nextCursorId } : null);
        socketRef.current?.emit('conversation:join', { conversationId }, () => {});
        markRead(conversationId);
      } catch (error) {
        if (openRequestRef.current !== requestId) return;
        setMessagesError(error.message || 'Could not load this conversation');
      } finally {
        if (openRequestRef.current === requestId) setMessagesLoading(false);
      }
    },
    [markRead]
  );

  const closeConversation = useCallback(() => {
    if (activeIdRef.current) cacheRef.current.set(activeIdRef.current, messagesRef.current);
    setActiveId(null);
    activeIdRef.current = null;
    setMessages([]);
  }, []);

  const loadOlderMessages = useCallback(async () => {
    const conversationId = activeIdRef.current;
    if (!conversationId || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await api.listMessages(conversationId, {
        before: cursor.before,
        beforeId: cursor.beforeId,
        limit: PAGE_SIZE
      });
      setMessages((current) => {
        const next = reconcileMessages(current, data.messages, conversationId);
        cacheRef.current.set(conversationId, next);
        return next;
      });
      setHasMore(data.hasMore);
      setCursor(data.hasMore ? { before: data.nextCursor, beforeId: data.nextCursorId } : null);
    } catch (error) {
      notify.error(error.message || 'Could not load older messages');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, notify]);

  const applyConversationPreview = useCallback((conversationId, message, { incrementUnread }) => {
    setConversations((current) => {
      const index = current.findIndex((conversation) => conversation.id === conversationId);
      if (index === -1) return current;
      const existing = current[index];
      const updated = {
        ...existing,
        lastMessage: { text: message.text, senderId: message.senderId, createdAt: message.createdAt },
        lastMessageAt: message.createdAt,
        unreadCount: incrementUnread ? (existing.unreadCount || 0) + 1 : existing.unreadCount || 0
      };
      return [updated, ...current.filter((_, position) => position !== index)];
    });
  }, []);

  const sendMessage = useCallback(
    async (text, { replyToId, replyTo } = {}) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) return;
      const clientId = crypto.randomUUID();
      const optimistic = {
        id: `temp-${clientId}`,
        clientId,
        conversationId,
        senderId: userId,
        text,
        createdAt: new Date().toISOString(),
        pending: true,
        deliveredAt: null,
        readAt: null,
        replyTo: replyTo || (replyToId ? { id: replyToId, text: '', senderId: null } : null)
      };
      updateMessagesFor(conversationId, (current) => [...current, optimistic]);
      applyConversationPreview(conversationId, optimistic, { incrementUnread: false });

      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:send', { conversationId, text, clientId, replyToId })
          : await api.sendMessage(conversationId, { text, clientId, replyToId });
        if (!result?.message) {
          throw new Error('The server did not return the saved message');
        }
        updateMessagesFor(conversationId, (current) => mergeServerMessage(current, result.message));
      } catch (error) {
        updateMessagesFor(conversationId, (current) =>
          current.map((message) =>
            message.clientId === clientId ? { ...message, pending: false, failed: true } : message
          )
        );
        notify.error(error.message || 'Your message could not be sent');
      }
    },
    [applyConversationPreview, notify, updateMessagesFor, userId]
  );

  const retryMessage = useCallback(
    async (message) => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId) return;
      updateMessagesFor(conversationId, (current) =>
        current.map((item) =>
          item.clientId === message.clientId ? { ...item, failed: false, pending: true } : item
        )
      );
      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:send', {
              conversationId,
              text: message.text,
              clientId: message.clientId
            })
          : await api.sendMessage(conversationId, {
              text: message.text,
              clientId: message.clientId
            });
        if (!result?.message) throw new Error('The server did not return the saved message');
        updateMessagesFor(conversationId, (current) => mergeServerMessage(current, result.message));
      } catch (error) {
        updateMessagesFor(conversationId, (current) =>
          current.map((item) =>
            item.clientId === message.clientId ? { ...item, pending: false, failed: true } : item
          )
        );
        notify.error(error.message || 'Still could not send that message');
      }
    },
    [notify, updateMessagesFor]
  );

  const startConversation = useCallback(
    async (peer) => {
      const data = await api.startConversation(peer.id);
      const { conversation } = data;
      setConversations((current) => {
        if (current.some((item) => item.id === conversation.id)) {
          return current.map((item) => (item.id === conversation.id ? conversation : item));
        }
        return [conversation, ...current];
      });
      await openConversation(conversation.id);
      return conversation;
    },
    [openConversation]
  );

  const hideConversation = useCallback(
    async (conversationId) => {
      await api.hideConversation(conversationId);
      setConversations((current) => current.filter((item) => item.id !== conversationId));
      cacheRef.current.delete(conversationId);
      if (idsEqual(activeIdRef.current, conversationId)) closeConversation();
      notify.success('Conversation removed from your list');
    },
    [closeConversation, notify]
  );

  const blockPeer = useCallback(
    async (userToBlock) => {
      await api.blockUser(userToBlock);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userToBlock ? { ...conversation, blockedByMe: true } : conversation
        )
      );
      notify.success('User blocked');
    },
    [notify]
  );

  const unblockPeer = useCallback(
    async (userToUnblock) => {
      await api.unblockUser(userToUnblock);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userToUnblock ? { ...conversation, blockedByMe: false } : conversation
        )
      );
      notify.success('User unblocked');
    },
    [notify]
  );

  const setConversationBlockState = useCallback((targetUserId, blocked) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.peer?.id === targetUserId ? { ...conversation, blockedByMe: blocked } : conversation
      )
    );
  }, []);

  const notifyTyping = useCallback(() => {
    const conversationId = activeIdRef.current;
    if (!conversationId || !socketRef.current?.connected) return;
    socketRef.current.emit('typing:start', { conversationId });
  }, []);

  const notifyStopTyping = useCallback(() => {
    const conversationId = activeIdRef.current;
    if (!conversationId || !socketRef.current?.connected) return;
    socketRef.current.emit('typing:stop', { conversationId });
  }, []);

  const editMessage = useCallback(
    async (message, text) => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId || !message?.id) return;
      updateMessagesFor(conversationId, (current) =>
        current.map((item) => (item.id === message.id ? { ...item, text, editedAt: new Date().toISOString() } : item))
      );
      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:edit', { conversationId, messageId: message.id, text })
          : await api.editMessage(conversationId, message.id, text);
        if (result?.message) {
          updateMessagesFor(conversationId, (current) => mergeServerMessage(current, result.message));
        }
      } catch (error) {
        notify.error(error.message || 'Could not edit that message');
      }
    },
    [notify, updateMessagesFor]
  );

  const deleteMessage = useCallback(
    async (message, scope = 'me') => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId || !message?.id) return;
      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:delete', { conversationId, messageId: message.id, scope })
          : await api.deleteMessage(conversationId, message.id, scope);
        if (scope === 'me') {
          updateMessagesFor(conversationId, (current) => current.filter((item) => item.id !== message.id));
        } else if (result?.message) {
          updateMessagesFor(conversationId, (current) => mergeServerMessage(current, result.message));
        }
      } catch (error) {
        notify.error(error.message || 'Could not delete that message');
      }
    },
    [notify, updateMessagesFor]
  );

  const reactToMessage = useCallback(
    async (message, emoji) => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId || !message?.id) return;
      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:react', { conversationId, messageId: message.id, emoji })
          : await api.reactToMessage(conversationId, message.id, emoji);
        if (result?.message) {
          updateMessagesFor(conversationId, (current) => mergeServerMessage(current, result.message));
        }
      } catch (error) {
        notify.error(error.message || 'Could not add that reaction');
      }
    },
    [notify, updateMessagesFor]
  );

  const forwardMessage = useCallback(
    async (message, targetConversationId) => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId || !message?.id || !targetConversationId) return;
      const clientId = crypto.randomUUID();
      try {
        const socket = socketRef.current;
        const result = socket?.connected
          ? await emitAck(socket, 'message:forward', {
              conversationId,
              messageId: message.id,
              targetConversationId,
              clientId
            })
          : await api.forwardMessage(conversationId, message.id, targetConversationId, clientId);
        if (result?.message) {
          updateMessagesFor(targetConversationId, (current) => mergeServerMessage(current, result.message));
          applyConversationPreview(targetConversationId, result.message, { incrementUnread: false });
        }
        notify.success('Message forwarded');
      } catch (error) {
        notify.error(error.message || 'Could not forward that message');
      }
    },
    [applyConversationPreview, notify, updateMessagesFor]
  );

  useEffect(() => {
    if (!userId) return undefined;
    mountedRef.current = true;

    const socket = createSocket(getAccessToken);
    socketRef.current = socket;

    const clearTyping = (conversationId) => {
      setTypingByConversation((current) => {
        if (!current[conversationId]) return current;
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      const timer = typingTimers.current.get(conversationId);
      if (timer) clearTimeout(timer);
      typingTimers.current.delete(conversationId);
    };

    const retryFailed = (conversationId) => {
      const failed = failedMessagesRef.current.filter((message) =>
        idsEqual(message.conversationId, conversationId)
      );
      for (const message of failed) {
        updateMessagesFor(conversationId, (current) =>
          current.map((item) =>
            item.clientId === message.clientId ? { ...item, failed: false, pending: true } : item
          )
        );
        socket.emit(
          'message:send',
          { conversationId, text: message.text, clientId: message.clientId },
          (response) => {
            if (response?.ok && response.message) {
              updateMessagesFor(conversationId, (current) => mergeServerMessage(current, response.message));
            } else {
              updateMessagesFor(conversationId, (current) =>
                current.map((item) =>
                  item.clientId === message.clientId ? { ...item, pending: false, failed: true } : item
                )
              );
            }
          }
        );
      }
    };

    const onConnect = async () => {
      setConnectionState('connected');
      const active = activeIdRef.current;
      await loadConversations();
      if (!active) return;
      socket.emit('conversation:join', { conversationId: active }, () => {});
      try {
        const data = await api.listMessages(active, { limit: PAGE_SIZE });
        if (activeIdRef.current !== active) return;
        updateMessagesFor(active, (current) => reconcileMessages(current, data.messages, active));
        markRead(active);
        retryFailed(active);
      } catch {
        /* keep the local cache */
      }
    };

    const onDisconnect = (reason) => {
      setConnectionState(reason === 'io client disconnect' ? 'disconnected' : 'reconnecting');
    };

    const onConnectError = () => setConnectionState('reconnecting');

    const onMessageNew = ({ message, conversationId }) => {
      const threadId = conversationId || message?.conversationId;
      if (!message || !threadId) return;

      const isActive = idsEqual(activeIdRef.current, threadId);
      const fromMe = idsEqual(message.senderId, userId);
      const visible = document.visibilityState === 'visible';
      const readingNow = isActive && visible && !fromMe;

      updateMessagesFor(threadId, (current) => mergeServerMessage(current, message));

      if (!fromMe) {
        socket.emit(readingNow ? 'message:read' : 'message:delivered', { conversationId: threadId }, () => {});
        if (readingNow) {
          setConversations((current) =>
            current.map((item) => (item.id === threadId ? { ...item, unreadCount: 0 } : item))
          );
        }
      }

      setConversations((current) => {
        const index = current.findIndex((item) => item.id === threadId);
        if (index === -1) {
          loadConversations();
          return current;
        }
        const existing = current[index];
        const unreadCount = fromMe || readingNow ? existing.unreadCount || 0 : (existing.unreadCount || 0) + 1;
        const updated = {
          ...existing,
          lastMessage: {
            text: message.text,
            senderId: message.senderId,
            createdAt: message.createdAt
          },
          lastMessageAt: message.createdAt,
          unreadCount
        };
        return [updated, ...current.filter((_, position) => position !== index)];
      });

      if (!isActive && !fromMe) {
        clearTyping(threadId);
        const conversation = conversationsRef.current.find((item) => item.id === threadId);
        browserNotificationRef.current?.({
          conversation,
          message,
          title: conversation?.peer?.displayName || conversation?.peer?.username || 'New message'
        });
      }
    };

    const onTypingStart = ({ conversationId }) => {
      setTypingByConversation((current) => ({ ...current, [conversationId]: true }));
      const existing = typingTimers.current.get(conversationId);
      if (existing) clearTimeout(existing);
      typingTimers.current.set(conversationId, setTimeout(() => clearTyping(conversationId), 5000));
    };

    const onTypingStop = ({ conversationId }) => clearTyping(conversationId);

    const onPresence = ({ userId: peerId, online, lastSeen }) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === peerId
            ? {
                ...conversation,
                peer: {
                  ...conversation.peer,
                  online,
                  ...(lastSeen !== undefined ? { lastSeen } : {})
                }
              }
            : conversation
        )
      );
    };

    const onReadReceipt = ({ conversationId, readAt }) => {
      updateMessagesFor(conversationId, (current) =>
        applyConversationReceipt(current, { conversationId, viewerId: userId, readAt })
      );
    };

    const onDeliveredReceipt = ({ conversationId, deliveredAt }) => {
      updateMessagesFor(conversationId, (current) =>
        applyConversationReceipt(current, { conversationId, viewerId: userId, deliveredAt })
      );
    };

    const onUnread = ({ conversationId, unreadCount }) => {
      setConversations((current) =>
        current.map((item) => (item.id === conversationId ? { ...item, unreadCount } : item))
      );
    };

    const onMessageUpdated = ({ conversationId, message }) => {
      if (!message || !conversationId) return;
      const reactions = (message.reactions || []).map((reaction) => ({
        ...reaction,
        reacted: Boolean(userId && (reaction.userIds || []).includes(userId))
      }));
      updateMessagesFor(conversationId, (current) => mergeServerMessage(current, { ...message, reactions }));
    };

    const onMessageRemoved = ({ conversationId, messageId }) => {
      if (!conversationId || !messageId) return;
      updateMessagesFor(conversationId, (current) => current.filter((item) => item.id !== messageId));
    };

    const onBlockChanged = ({ userId: peerId, blocked, byMe }) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === peerId
            ? {
                ...conversation,
                ...(byMe ? { blockedByMe: Boolean(blocked) } : { blockedMe: Boolean(blocked) })
              }
            : conversation
        )
      );
      loadConversations();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('message:new', onMessageNew);
    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    socket.on('presence:update', onPresence);
    socket.on('message:read', onReadReceipt);
    socket.on('receipt:delivered', onDeliveredReceipt);
    socket.on('conversation:unread', onUnread);
    socket.on('block:changed', onBlockChanged);
    socket.on('message:updated', onMessageUpdated);
    socket.on('message:removed', onMessageRemoved);

    setConnectionState('connecting');
    socket.connect();
    loadConversations({ showLoading: true });

    return () => {
      mountedRef.current = false;
      for (const timer of typingTimers.current.values()) clearTimeout(timer);
      typingTimers.current.clear();
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId, loadConversations, markRead, updateMessagesFor]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && activeIdRef.current) {
        markRead(activeIdRef.current);
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [markRead]);

  const activeConversation = conversations.find((conversation) => conversation.id === activeId) || null;

  return {
    conversations,
    conversationsLoading,
    conversationsError,
    activeId,
    activeConversation,
    messages,
    messagesLoading,
    messagesError,
    hasMore,
    loadingMore,
    typingByConversation,
    typing: activeId ? Boolean(typingByConversation[activeId]) : false,
    connectionState,
    actions: {
      loadConversations,
      openConversation,
      closeConversation,
      loadOlderMessages,
      sendMessage,
      retryMessage,
      startConversation,
      hideConversation,
      blockPeer,
      unblockPeer,
      setConversationBlockState,
      markRead,
      notifyTyping,
      notifyStopTyping,
      editMessage,
      deleteMessage,
      reactToMessage,
      forwardMessage
    }
  };
}

export default useChatWorkspace;
