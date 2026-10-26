import { useRef, useState } from 'react';
import { ArrowLeft, Ban, Bell, BellOff, Flag, MoreVertical, Trash2, UserRound, Volume2, VolumeX } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatLastSeen } from '../lib/format.js';
import { useClickOutside } from '../hooks/useClickOutside.js';

export function ChatHeader({
  peer,
  typing,
  onBack,
  onOpenProfile,
  onBlock,
  onUnblock,
  blockedByMe,
  notificationsEnabled,
  onToggleNotifications,
  onReport,
  onHide,
  muted = false,
  onToggleMute,
  soundEnabled = true,
  onToggleSound
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useClickOutside(menuRef, () => setMenuOpen(false), menuOpen);

  const presenceText = typing ? 'typing…' : formatLastSeen(peer);
  const status = peer?.username ? `@${peer.username} · ${presenceText}` : presenceText;

  return (
    <header className="chat-header">
      <button type="button" className="icon-btn chat-header__back" onClick={onBack} aria-label="Back to conversations">
        <ArrowLeft size={20} />
      </button>

      <button type="button" className="chat-header__identity" onClick={onOpenProfile}>
        <Avatar user={peer} size="md" showPresence />
        <span style={{ minWidth: 0 }}>
          <span className="chat-header__name">{peer?.displayName || peer?.username}</span>
          <span
            className={[
              'chat-header__status',
              typing ? 'chat-header__status--typing' : peer?.online ? 'chat-header__status--online' : ''
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {!typing && peer?.online ? <span className="dot" aria-hidden /> : null}
            {status}
            {muted ? <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 4 }}><VolumeX size={11} /> muted</span> : null}
          </span>
        </span>
      </button>

      <div className="chat-header__actions">
        <button
          type="button"
          className={`icon-btn${muted ? ' is-active' : ''}`}
          onClick={onToggleMute}
          title={muted ? 'Unmute conversation' : 'Mute conversation'}
          aria-label={muted ? 'Unmute conversation' : 'Mute conversation'}
          aria-pressed={muted}
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>

        <button
          type="button"
          className={`icon-btn${notificationsEnabled ? ' is-active' : ''}`}
          onClick={onToggleNotifications}
          title={notificationsEnabled ? 'Mute browser notifications' : 'Enable browser notifications'}
          aria-label={notificationsEnabled ? 'Mute browser notifications' : 'Enable browser notifications'}
        >
          {notificationsEnabled ? <Bell size={18} /> : <BellOff size={18} />}
        </button>

        <div className="menu-anchor" ref={menuRef}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Conversation options"
          >
            <MoreVertical size={19} />
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenProfile();
                }}
              >
                <UserRound size={16} /> View profile
              </button>
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleMute?.();
                }}
              >
                {muted ? <Volume2 size={16} /> : <VolumeX size={16} />}
                {muted ? 'Unmute conversation' : 'Mute conversation'}
              </button>
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onToggleNotifications();
                }}
              >
                {notificationsEnabled ? <BellOff size={16} /> : <Bell size={16} />}
                {notificationsEnabled ? 'Mute browser notifications' : 'Enable browser notifications'}
              </button>
              {onToggleSound ? (
                <button
                  type="button"
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onToggleSound();
                  }}
                >
                  {soundEnabled ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  {soundEnabled ? 'Mute sounds' : 'Enable sounds'}
                </button>
              ) : null}
              <div className="menu__separator" />
              {blockedByMe ? (
                <button
                  type="button"
                  className="menu__item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onUnblock();
                  }}
                >
                  <Ban size={16} /> Unblock user
                </button>
              ) : (
                <button
                  type="button"
                  className="menu__item menu__item--danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onBlock();
                  }}
                >
                  <Ban size={16} /> Block user
                </button>
              )}
              <button
                type="button"
                className="menu__item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onReport();
                }}
              >
                <Flag size={16} /> Report user
              </button>
              <button
                type="button"
                className="menu__item menu__item--danger"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onHide();
                }}
              >
                <Trash2 size={16} /> Remove conversation
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export default ChatHeader;
