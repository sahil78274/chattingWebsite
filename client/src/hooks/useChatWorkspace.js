import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getAccessToken } from '../services/api.js';
import { createSocket } from '../services/socket.js';

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

/** Replaces the optimistic copy of a message with the persisted one. */
function mergeServerMessage(list, message) {
  const byId = list.findIndex((item) => item.id === message.id);
  if (byId !== -1) return list;
  const byClient = message.clientId
    ? list.findIndex((item) => item.clientId && item.clientId === message.clientId)
    : -1;
  if (byClient !== -1) {
    const next = [...list];
    next[byClient] = { ...message };
    return next;
  }
  return [...list, message];
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
  const [cursor, setCursor] = useState(null); // { before, beforeId } for older pages
  const [loadingMore, setLoadingMore] = useState(false);
  const [typingByConversation, setTypingByConversation] = useState({});
  const [connectionState, setConnectionState] = useState('connecting');

  const socketRef = useRef(null);
  const activeIdRef = useRef(null);
  const conversationsRef = useRef([]);
  const typingTimers = useRef(new Map());
  const failedMessagesRef = useRef([]);
  const browserNotificationRef = useRef(onBrowserNotification);
  const openRequestRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    browserNotificationRef.current = onBrowserNotification;
  }, [onBrowserNotification]);

  useEffect(() => {
    failedMessagesRef.current = messages.filter((message) => message.failed);
  }, [messages]);

  // ------------------------------------------------------------- loaders
  const loadConversations = useCallback(
    async ({ showLoading = false } = {}) => {
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
    },
    []
  );

  const markRead = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      if (socketRef.current?.connected) {
        socketRef.current.emit('message:read', { conversationId }, () => {});
      } else {
        await api.markRead(conversationId);
      }
    } catch {
      /* non critical */
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
      setActiveId(conversationId);
      activeIdRef.current = conversationId;
      setMessages([]);
      setMessagesError('');
      setMessagesLoading(true);

      try {
        const data = await api.listMessages(conversationId, { limit: PAGE_SIZE });
        if (openRequestRef.current !== requestId) return;
        setMessages(data.messages);
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
        const ids = new Set(current.map((message) => message.id));
        const older = data.messages.filter((message) => !ids.has(message.id));
        return [...older, ...current];
      });
      setHasMore(data.hasMore);
      setCursor(data.hasMore ? { before: data.nextCursor, beforeId: data.nextCursorId } : null);
    } catch (error) {
      notify.error(error.message || 'Could not load older messages');
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore, notify]);

  // ------------------------------------------------------------- sending
  const applyConversationPreview = useCallback((conversationId, message, { incrementUnread }) => {
    setConversations((current) => {
      const index = current.findIndex((conversation) => conversation.id === conversationId);
      if (index === -1) return current;
      const existing = current[index];
      const updated = {
        ...existing,
        lastMessage: { text: message.text, senderId: message.senderId, createdAt: message.createdAt },
        lastMessageAt: message.createdAt,
        unreadCount: incrementUnread
          ? (existing.unreadCount || 0) + 1
          : existing.unreadCount || 0
      };
      return [updated, ...current.filter((_, position) => position !== index)];
    });
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const conversationId = activeIdRef.current;
      if (!conversationId) return;
      const clientId = crypto.randomUUID();
      const optimistic = {
        id: `temp-${clientId}`,
        clientId,
        conversationId,
        senderId: user.id,
        text,
        createdAt: new Date().toISOString(),
        pending: true
      };
      setMessages((current) => [...current, optimistic]);
      applyConversationPreview(conversationId, optimistic, { incrementUnread: false });

      try {
        const socket = socketRef.current;
        const result =
          socket?.connected
            ? await emitAck(socket, 'message:send', { conversationId, text, clientId })
            : await api.sendMessage(conversationId, { text, clientId });
        setMessages((current) => mergeServerMessage(current, result.message));
      } catch (error) {
        setMessages((current) =>
          current.map((message) =>
            message.clientId === clientId ? { ...message, pending: false, failed: true } : message
          )
        );
        notify.error(error.message || 'Your message could not be sent');
      }
    },
    [applyConversationPreview, notify, user.id]
  );

  const retryMessage = useCallback(
    async (message) => {
      const conversationId = message.conversationId || activeIdRef.current;
      if (!conversationId) return;
      setMessages((current) =>
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
        setMessages((current) => mergeServerMessage(current, result.message));
      } catch (error) {
        setMessages((current) =>
          current.map((item) =>
            item.clientId === message.clientId ? { ...item, pending: false, failed: true } : item
          )
        );
        notify.error(error.message || 'Still could not send that message');
      }
    },
    [notify]
  );

  // ---------------------------------------------------------- conversations
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
      if (activeIdRef.current === conversationId) closeConversation();
      notify.success('Conversation removed from your list');
    },
    [closeConversation, notify]
  );

  const blockPeer = useCallback(
    async (userId) => {
      await api.blockUser(userId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userId ? { ...conversation, blockedByMe: true } : conversation
        )
      );
      notify.success('User blocked');
    },
    [notify]
  );

  const unblockPeer = useCallback(
    async (userId) => {
      await api.unblockUser(userId);
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userId ? { ...conversation, blockedByMe: false } : conversation
        )
      );
      notify.success('User unblocked');
    },
    [notify]
  );

  const setConversationBlockState = useCallback((userId, blocked) => {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.peer?.id === userId ? { ...conversation, blockedByMe: blocked } : conversation
      )
    );
  }, []);

  // ------------------------------------------------------------- typing
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

  // -------------------------------------------------------------- socket
  useEffect(() => {
    if (!user) return undefined;
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
      const failed = failedMessagesRef.current.filter(
        (message) => message.conversationId === conversationId
      );
      for (const message of failed) {
        setMessages((current) =>
          current.map((item) =>
            item.clientId === message.clientId ? { ...item, failed: false, pending: true } : item
          )
        );
        socket.emit(
          'message:send',
          { conversationId, text: message.text, clientId: message.clientId },
          (response) => {
            if (response?.ok) {
              setMessages((current) => mergeServerMessage(current, response.message));
            } else {
              setMessages((current) =>
                current.map((item) =>
                  item.clientId === message.clientId
                    ? { ...item, pending: false, failed: true }
                    : item
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
      // Re-sync anything missed while offline (the server is the source of truth).
      try {
        const data = await api.listMessages(active, { limit: PAGE_SIZE });
        if (activeIdRef.current !== active) return;
        setMessages((current) => {
          const unsent = current.filter(
            (message) =>
              (message.failed || message.pending) &&
              !data.messages.some((server) => server.clientId === message.clientId)
          );
          const merged = [...data.messages, ...unsent];
          merged.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          return merged;
        });
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
      const isActive = activeIdRef.current === conversationId;
      const fromMe = message.senderId === user.id;
      const visible = document.visibilityState === 'visible';
      const readingNow = isActive && visible && !fromMe;

      if (isActive) {
        setMessages((current) => mergeServerMessage(current, message));
      }

      if (!fromMe) {
        // The message reached a live client, so report it as delivered. When the
        // thread is open and visible it is marked read instead (which implies
        // delivery and also clears the server-side unread counter).
        socket.emit(readingNow ? 'message:read' : 'message:delivered', { conversationId }, () => {});
        if (readingNow) {
          setConversations((current) =>
            current.map((item) => (item.id === conversationId ? { ...item, unreadCount: 0 } : item))
          );
        }
      }

      setConversations((current) => {
        const index = current.findIndex((item) => item.id === conversationId);
        if (index === -1) {
          // A conversation we did not know about yet (e.g. someone new messaged us).
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
        clearTyping(conversationId);
        const conversation = conversationsRef.current.find((item) => item.id === conversationId);
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

    const onPresence = ({ userId, online, lastSeen }) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userId
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
      setMessages((current) =>
        current.map((message) =>
          message.conversationId === conversationId && message.senderId === user.id && !message.readAt
            ? { ...message, readAt, deliveredAt: message.deliveredAt || readAt }
            : message
        )
      );
    };

    const onDeliveredReceipt = ({ conversationId, deliveredAt }) => {
      setMessages((current) =>
        current.map((message) =>
          message.conversationId === conversationId && message.senderId === user.id && !message.deliveredAt
            ? { ...message, deliveredAt }
            : message
        )
      );
    };

    const onBlockChanged = ({ userId, blocked, byMe }) => {
      setConversations((current) =>
        current.map((conversation) =>
          conversation.peer?.id === userId
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
    socket.on('block:changed', onBlockChanged);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Mark the open conversation as read when the tab becomes visible again.
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
      notifyStopTyping
    }
  };
}

export default useChatWorkspace;
