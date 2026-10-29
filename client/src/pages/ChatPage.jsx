import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogOut,
  MessageSquarePlus,
  Search,
  Settings,
  Shield,
  Trash2,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { SearchResults } from '../components/SearchPanel.jsx';
import { ConversationList } from '../components/ConversationList.jsx';
import { ChatHeader } from '../components/ChatHeader.jsx';
import { MessageList } from '../components/MessageList.jsx';
import { Composer } from '../components/Composer.jsx';
import { EmptyChatState } from '../components/EmptyChatState.jsx';
import { UserProfileModal } from '../components/UserProfileModal.jsx';
import { EditProfileModal } from '../components/EditProfileModal.jsx';
import { SettingsModal } from '../components/SettingsModal.jsx';
import { ReportModal } from '../components/ReportModal.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { ForwardModal } from '../components/ForwardModal.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useChatWorkspace } from '../hooks/useChatWorkspace.js';
import { useDebounce } from '../hooks/useDebounce.js';
import { api } from '../services/api.js';

const NOTIFICATIONS_KEY = 'connectly.notifications';
const MUTED_KEY = 'connectly.mutedConversations';
const SOUND_KEY = 'connectly.soundEnabled';

export function ChatPage() {
  const { user, logout } = useAuth();
  const { notify } = useToast();

  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 350);
  const [search, setSearch] = useState({ results: [], loading: false, error: '', hasMore: false, page: 1 });
  const [startingWith, setStartingWith] = useState(null);
  const searchInputRef = useRef(null);

  const [profileUser, setProfileUser] = useState(null);
  const [editOpen, setEditOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [threadQuery, setThreadQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);

  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    if (!notificationSupported) return false;
    return (
      window.localStorage.getItem(NOTIFICATIONS_KEY) === '1' &&
      window.Notification.permission === 'granted'
    );
  });
  const [soundEnabled, setSoundEnabled] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(SOUND_KEY);
    return stored === null ? true : stored === '1';
  });
  const [mutedConversations, setMutedConversations] = useState(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(MUTED_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(SOUND_KEY, next ? '1' : '0');
      return next;
    });
  }, []);
  const toggleMuteConversation = useCallback((conversationId) => {
    setMutedConversations((current) => {
      const next = new Set(current);
      if (next.has(conversationId)) next.delete(conversationId);
      else next.add(conversationId);
      window.localStorage.setItem(MUTED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const mutedRef = useRef(mutedConversations);
  useEffect(() => { mutedRef.current = mutedConversations; }, [mutedConversations]);
  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  const playSound = useCallback(() => {
    if (!soundEnabledRef.current) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
      o.start(ctx.currentTime); o.stop(ctx.currentTime + 0.22);
    } catch { /* autoplay may be blocked */ }
  }, []);

  const handleBrowserNotification = useCallback(
    ({ title, message, conversation }) => {
      const conversationId = conversation?.id || message.conversationId;
      if (mutedRef.current.has(conversationId)) return;
      // Respect in-app badge updates regardless, but suppress disruptive notifications for muted threads.
      if (!notificationsEnabled || !notificationSupported) {
        if (soundEnabledRef.current && document.visibilityState !== 'visible') playSound();
        return;
      }
      if (window.Notification.permission !== 'granted') return;
      // If user is actively viewing this conversation, suppress browser notification
      // but still allow in-app toast via the workspace caller.
      if (document.visibilityState === 'visible' && workspaceActiveRef.current === conversationId) return;
      try {
        const notification = new window.Notification(title, {
          body: message.text.length > 140 ? `${message.text.slice(0, 139)}…` : message.text,
          tag: conversationId,
          icon: '/favicon.svg',
          badge: '/favicon.svg'
        });
        notification.onclick = () => {
          window.focus();
          if (conversationId) {
            const url = new URL(window.location.href);
            url.searchParams.set('c', conversationId);
            window.history.replaceState({}, '', url);
            window.dispatchEvent(new Event('connectly:open-conversation'));
          }
          notification.close();
        };
      } catch { /* notifications are best effort */ }
      if (soundEnabledRef.current) playSound();
    },
    [notificationsEnabled, notificationSupported, playSound]
  );

  const workspaceActiveRef = useRef(null);
  const workspace = useChatWorkspace({ user, notify, onBrowserNotification: handleBrowserNotification });
  const { actions } = workspace;
  useEffect(() => { workspaceActiveRef.current = workspace.activeId; }, [workspace.activeId]);

  // Keep the open conversation in the URL so a reload restores it.
  const initialConversationRef = useRef(
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('c') : null
  );

  useEffect(() => {
    const target = initialConversationRef.current;
    if (!target) return;
    if (workspace.activeId) {
      initialConversationRef.current = null;
      return;
    }
    if (workspace.conversations.some((conversation) => conversation.id === target)) {
      initialConversationRef.current = null;
      actions.openConversation(target);
    }
  }, [workspace.conversations, workspace.activeId, actions]);

  const selectConversation = useCallback(
    (conversationId) => {
      actions.openConversation(conversationId);
      setReplyTo(null);
      setEditing(null);
      setThreadQuery('');
      setSelectedIds(new Set());
      setSelectionMode(false);
      const url = new URL(window.location.href);
      url.searchParams.set('c', conversationId);
      window.history.replaceState({}, '', url);
    },
    [actions]
  );

  const closeChat = useCallback(() => {
    actions.closeConversation();
    const url = new URL(window.location.href);
    url.searchParams.delete('c');
    window.history.replaceState({}, '', url);
  }, [actions]);

  // ------------------------------------------------------------- search
  const searchSeqRef = useRef(0);
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSearch({ results: [], loading: false, error: '', hasMore: false, page: 1 });
      return undefined;
    }
    const seq = (searchSeqRef.current += 1);
    setSearch((current) => ({ ...current, loading: true, error: '' }));
    // Normalise the query client-side the same way the server does: trim and
    // lower-case handling is done server-side, but we ensure whitespace is
    // stripped and empty queries never hit the API.
    const normalised = trimmed.replace(/\s+/g, ' ');
    api
      .searchUsers(normalised, 1)
      .then((data) => {
        if (seq !== searchSeqRef.current) return;
        setSearch({ results: data.results, loading: false, error: '', hasMore: data.hasMore, page: 1 });
      })
      .catch((error) => {
        if (seq !== searchSeqRef.current) return;
        // Surface API errors as errors, never as an empty result set.
        setSearch({ results: [], loading: false, error: error.message || 'Search failed', hasMore: false, page: 1 });
      });
    return () => {
      // No abort needed beyond seq check; the response is ignored if stale.
    };
  }, [debouncedQuery]);

  async function loadMoreResults(page) {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) return;
    setSearch((current) => ({ ...current, loading: true }));
    try {
      const data = await api.searchUsers(trimmed, page);
      setSearch((current) => ({
        results: [...current.results, ...data.results.filter((item) => !current.results.some((r) => r.id === item.id))],
        loading: false,
        error: '',
        hasMore: data.hasMore,
        page
      }));
    } catch (error) {
      setSearch((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  // ------------------------------------------------------- conversations
  const startConversation = useCallback(
    async (peer) => {
      setStartingWith(peer.id);
      try {
        const conversation = await actions.startConversation(peer);
        if (conversation?.id) {
          const url = new URL(window.location.href);
          url.searchParams.set('c', conversation.id);
          window.history.replaceState({}, '', url);
        }
        setProfileUser(null);
        setQuery('');
        setSearch({ results: [], loading: false, error: '', hasMore: false, page: 1 });
        if (searchInputRef.current) searchInputRef.current.blur();
      } catch (error) {
        notify.error(error.message || 'Could not start that conversation');
      } finally {
        setStartingWith(null);
      }
    },
    [actions, notify]
  );

  function confirmHideConversation(conversation) {
    setConfirmState({
      title: 'Remove conversation',
      message: `“${conversation.peer?.displayName}” will be removed from your list. Your messages stay in the other person's history and the conversation returns if they write again.`,
      confirmLabel: 'Remove',
      onConfirm: () => actions.hideConversation(conversation.id)
    });
  }

  function confirmBlock(user) {
    setConfirmState({
      title: `Block @${user.username}?`,
      message: 'They will no longer be able to message you, and neither of you can reply in this conversation until you unblock them.',
      confirmLabel: 'Block user',
      onConfirm: () => actions.blockPeer(user.id)
    });
  }

  // ------------------------------------------------------- notifications
  async function toggleNotifications() {
    if (!notificationSupported) {
      notify.error('This browser does not support notifications.');
      return;
    }
    if (notificationsEnabled) {
      setNotificationsEnabled(false);
      window.localStorage.setItem(NOTIFICATIONS_KEY, '0');
      notify.info('Browser notifications muted');
      return;
    }
    if (window.Notification.permission === 'denied') {
      notify.error('Notifications are blocked in your browser settings. Enable them for this site first.');
      return;
    }
    const permission =
      window.Notification.permission === 'granted'
        ? 'granted'
        : await window.Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      window.localStorage.setItem(NOTIFICATIONS_KEY, '1');
      notify.success('Browser notifications enabled');
    } else {
      notify.error('Notification permission was not granted');
    }
  }

  async function handleLogout() {
    await logout();
  }

  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const active = workspace.activeConversation;
  const peer = active?.peer || null;
  const composerDisabled = Boolean(active && (active.blockedByMe || active.blockedMe));
  const disabledReason = active?.blockedByMe
    ? `You blocked @${peer?.username}. Unblock them from the menu to send messages.`
    : active?.blockedMe
      ? `@${peer?.username} is not accepting messages right now.`
      : '';

  const conversationForHeader = active || null;

  return (
    <div className={`app-shell${workspace.activeId ? ' is-chat-open' : ''}`}>
      <aside className="sidebar" aria-label="Conversations">
        <div className="sidebar__top">
          <Brand />
          <div className="sidebar__actions">
            <ThemeToggle />
            {user.role === 'admin' ? (
              <Link to="/app/admin" className="icon-btn" title="Admin dashboard" aria-label="Open admin dashboard">
                <Shield size={18} />
              </Link>
            ) : null}
            <button
              type="button"
              className="icon-btn"
              onClick={() => setSettingsOpen(true)}
              title="Settings"
              aria-label="Open settings"
            >
              <Settings size={18} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={() => searchInputRef.current?.focus()}
              title="Find people"
              aria-label="Search for people to message"
            >
              <MessageSquarePlus size={18} />
            </button>
          </div>
        </div>

        <div className="sidebar__search">
          <div className="search-box">
            <Search size={16} aria-hidden />
            <input
              ref={searchInputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by username or user ID"
              aria-label="Search users by username or user ID"
              maxLength={40}
            />
            {query ? (
              <button type="button" className="search-box__clear" onClick={() => setQuery('')} aria-label="Clear search">
                <X size={15} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="sidebar__section-label">
          <span>{query.trim() ? 'People' : 'Messages'}</span>
          {!query.trim() && workspace.conversations.length ? (
            <span>{workspace.conversations.length}</span>
          ) : null}
        </div>

        <div className="sidebar__list">
          {query.trim() ? (
            <SearchResults
              query={query}
              results={search.results}
              loading={search.loading && !search.results.length}
              error={search.error}
              hasMore={search.hasMore}
              page={search.page}
              onLoadMore={loadMoreResults}
              onStartConversation={startConversation}
              onViewProfile={setProfileUser}
              startingWith={startingWith}
            />
          ) : (
            <ConversationList
              conversations={workspace.conversations}
              loading={workspace.conversationsLoading}
              activeId={workspace.activeId}
              viewerId={user.id}
              typingByConversation={workspace.typingByConversation}
              onSelect={selectConversation}
              onStartSearch={() => searchInputRef.current?.focus()}
            />
          )}
          {workspace.conversationsError && !query.trim() ? (
            <div className="alert alert--error" style={{ margin: 8 }}>
              {workspace.conversationsError}
            </div>
          ) : null}
        </div>

        <div className="sidebar__footer">
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button type="button" className="me-card" onClick={() => setEditOpen(true)} title="Edit your profile">
              <Avatar user={user} size="sm" showPresence />
              <span className="me-card__body">
                <span className="me-card__name">{user.displayName}</span>
                <span className="me-card__handle">@{user.username}</span>
              </span>
            </button>
            <button type="button" className="icon-btn" onClick={handleLogout} title="Sign out" aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="chat-pane" aria-label="Conversation">
        {workspace.connectionState !== 'connected' ? (
          <div className="banner" role="status">
            {workspace.connectionState === 'reconnecting' || workspace.connectionState === 'connecting'
              ? 'Reconnecting to Connectly… messages will sync automatically.'
              : 'You are offline. Your draft is kept and messages retry when you reconnect.'}
          </div>
        ) : null}

        {!active ? (
          <EmptyChatState userName={user.displayName?.split(' ')[0]} onFindPeople={() => searchInputRef.current?.focus()} />
        ) : (
          <>
            <ChatHeader
              peer={peer}
              typing={workspace.typing}
              onBack={closeChat}
              onOpenProfile={() => setProfileUser(peer)}
              blockedByMe={active.blockedByMe}
              onBlock={() => confirmBlock(peer)}
              onUnblock={() => actions.unblockPeer(peer.id).catch((error) => notify.error(error.message))}
              notificationsEnabled={notificationsEnabled}
              onToggleNotifications={toggleNotifications}
              onReport={() => setReportTarget(peer)}
              onHide={() => confirmHideConversation(active)}
              muted={active ? mutedConversations.has(active.id) : false}
              onToggleMute={() => active && toggleMuteConversation(active.id)}
              soundEnabled={soundEnabled}
              onToggleSound={toggleSound}
              searchQuery={threadQuery}
              onSearchChange={setThreadQuery}
            />

            {workspace.messagesError ? (
              <div style={{ padding: '12px 16px 0' }}>
                <div className="alert alert--error">{workspace.messagesError}</div>
              </div>
            ) : null}
              <MessageList
                messages={
                  threadQuery.trim()
                    ? workspace.messages.filter((message) =>
                        String(message.text || '')
                          .toLowerCase()
                          .includes(threadQuery.trim().toLowerCase())
                      )
                    : workspace.messages
                }
                loading={workspace.messagesLoading}
                hasMore={workspace.hasMore}
                loadingMore={workspace.loadingMore}
                onLoadMore={actions.loadOlderMessages}
                peer={peer}
                viewerId={user.id}
                onRetry={actions.retryMessage}
                selectedIds={selectedIds}
                selectionMode={selectionMode}
                onToggleSelect={(message) => {
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (next.has(message.id)) next.delete(message.id);
                    else next.add(message.id);
                    return next;
                  });
                }}
                onReply={(message) => {
                  setEditing(null);
                  setReplyTo(message);
                }}
                onEdit={(message) => {
                  setReplyTo(null);
                  setEditing(message);
                }}
                onCopy={async (message) => {
                  try {
                    await navigator.clipboard.writeText(message.text || '');
                    notify.success('Copied');
                  } catch {
                    notify.error('Could not copy that message');
                  }
                }}
                onDelete={(message, scope) => {
                  setConfirmState({
                    title: scope === 'everyone' ? 'Delete for everyone?' : 'Delete for you?',
                    message:
                      scope === 'everyone'
                        ? 'This removes the message from both sides of the conversation.'
                        : 'The message will disappear from your history. The other person still has their copy.',
                    confirmLabel: 'Delete',
                    onConfirm: () => actions.deleteMessage(message, scope)
                  });
                }}
                onReact={(message, emoji) => actions.reactToMessage(message, emoji)}
                onForward={(message) => setForwarding(message)}
                onSelect={(message) => {
                  setSelectionMode(true);
                  setSelectedIds(new Set([message.id]));
                }}
              />

            {selectionMode ? (
              <div className="selection-bar">
                <span>{selectedIds.size} selected</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    for (const id of selectedIds) {
                      const message = workspace.messages.find((item) => item.id === id);
                      if (message) actions.deleteMessage(message, 'me');
                    }
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                  }}
                  disabled={!selectedIds.size}
                >
                  <Trash2 size={14} /> Delete for me
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setSelectedIds(new Set());
                    setSelectionMode(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : null}

            <Composer
              conversationId={active.id}
              onSend={(text) => {
                if (editing) {
                  actions.editMessage(editing, text);
                  setEditing(null);
                  return;
                }
                actions.sendMessage(text, {
                  replyToId: replyTo?.id,
                  replyTo: replyTo
                    ? { id: replyTo.id, senderId: replyTo.senderId, text: replyTo.text }
                    : null
                });
                setReplyTo(null);
              }}
              disabled={composerDisabled}
              disabledReason={disabledReason}
              onTyping={actions.notifyTyping}
              onStopTyping={actions.notifyStopTyping}
              replyTo={replyTo}
              onClearReply={() => setReplyTo(null)}
              editing={editing}
              onCancelEdit={() => setEditing(null)}
            />
          </>
        )}
      </main>

      {profileUser ? (
        <UserProfileModal
          user={profileUser}
          onClose={() => setProfileUser(null)}
          onStartConversation={startConversation}
          onReport={(target) => {
            setProfileUser(null);
            setReportTarget(target);
          }}
          onBlockedChange={(userId, blocked) => actions.setConversationBlockState(userId, blocked)}
        />
      ) : null}

      {editOpen ? <EditProfileModal onClose={() => setEditOpen(false)} /> : null}

      {settingsOpen ? (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          notificationsEnabled={notificationsEnabled}
          notificationSupported={notificationSupported}
          onToggleNotifications={toggleNotifications}
          soundEnabled={soundEnabled}
          onToggleSound={toggleSound}
          mutedCount={mutedConversations.size}
          onClearMutes={() => {
            setMutedConversations(new Set());
            window.localStorage.removeItem(MUTED_KEY);
            notify.success('All conversations unmuted');
          }}
        />
      ) : null}

      {reportTarget ? (
        <ReportModal
          user={reportTarget}
          conversationId={conversationForHeader?.id}
          onClose={() => setReportTarget(null)}
        />
      ) : null}

      {forwarding ? (
        <ForwardModal
          conversations={workspace.conversations}
          currentId={active?.id}
          onClose={() => setForwarding(null)}
          onChoose={(conversation) => {
            actions.forwardMessage(forwarding, conversation.id);
            setForwarding(null);
          }}
        />
      ) : null}

      {confirmState ? (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmLabel={confirmState.confirmLabel}
          onConfirm={confirmState.onConfirm}
          onClose={() => setConfirmState(null)}
        />
      ) : null}
    </div>
  );
}

export default ChatPage;
