import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LogOut,
  MessageSquarePlus,
  Moon,
  Search,
  Settings,
  Sun,
  X
} from 'lucide-react';
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
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useChatWorkspace } from '../hooks/useChatWorkspace.js';
import { useDebounce } from '../hooks/useDebounce.js';
import { api } from '../services/api.js';

const NOTIFICATIONS_KEY = 'connectly.notifications';

export function ChatPage() {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
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

  const notificationSupported = typeof window !== 'undefined' && 'Notification' in window;
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    if (!notificationSupported) return false;
    return (
      window.localStorage.getItem(NOTIFICATIONS_KEY) === '1' &&
      window.Notification.permission === 'granted'
    );
  });

  const handleBrowserNotification = useCallback(
    ({ title, message }) => {
      if (!notificationsEnabled || !notificationSupported) return;
      if (window.Notification.permission !== 'granted') return;
      if (document.visibilityState === 'visible') return;
      try {
        const notification = new window.Notification(title, {
          body: message.text.length > 140 ? `${message.text.slice(0, 139)}…` : message.text,
          tag: message.conversationId,
          icon: '/favicon.svg',
          badge: '/favicon.svg'
        });
        notification.onclick = () => {
          window.focus();
          notification.close();
        };
      } catch {
        /* notifications are best effort */
      }
    },
    [notificationsEnabled, notificationSupported]
  );

  const workspace = useChatWorkspace({ user, notify, onBrowserNotification: handleBrowserNotification });
  const { actions } = workspace;

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
  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!trimmed) {
      setSearch({ results: [], loading: false, error: '', hasMore: false, page: 1 });
      return undefined;
    }
    let cancelled = false;
    setSearch((current) => ({ ...current, loading: true, error: '' }));
    api
      .searchUsers(trimmed, 1)
      .then((data) => {
        if (cancelled) return;
        setSearch({ results: data.results, loading: false, error: '', hasMore: data.hasMore, page: 1 });
      })
      .catch((error) => {
        if (cancelled) return;
        setSearch({ results: [], loading: false, error: error.message || 'Search failed', hasMore: false, page: 1 });
      });
    return () => {
      cancelled = true;
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
            <button
              type="button"
              className="icon-btn"
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
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
            />

            {workspace.messagesError ? (
              <div style={{ padding: 16 }}>
                <div className="alert alert--error">{workspace.messagesError}</div>
              </div>
            ) : (
              <MessageList
                messages={workspace.messages}
                loading={workspace.messagesLoading}
                hasMore={workspace.hasMore}
                loadingMore={workspace.loadingMore}
                onLoadMore={actions.loadOlderMessages}
                peer={peer}
                viewerId={user.id}
                onRetry={actions.retryMessage}
              />
            )}

            <Composer
              conversationId={active.id}
              onSend={(text) => actions.sendMessage(text)}
              disabled={composerDisabled}
              disabledReason={disabledReason}
              onTyping={actions.notifyTyping}
              onStopTyping={actions.notifyStopTyping}
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
        />
      ) : null}

      {reportTarget ? (
        <ReportModal
          user={reportTarget}
          conversationId={conversationForHeader?.id}
          onClose={() => setReportTarget(null)}
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
