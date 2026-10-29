import { memo, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  CornerUpLeft,
  MoreVertical,
  Pencil,
  RotateCw,
  SmilePlus,
  Trash2,
  Forward,
  CheckSquare
} from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatTime } from '../lib/format.js';
import { messageStatus } from '../lib/messages.js';
import { REACTION_EMOJIS } from '../lib/constants.js';
import { useClickOutside } from '../hooks/useClickOutside.js';

function StatusIcon({ message, isOut }) {
  if (!isOut) return null;
  const status = messageStatus(message);

  if (status === 'pending') {
    return (
      <span className="bubble__state bubble__state--pending" title="Sending" aria-label="Sending">
        <Clock aria-hidden />
      </span>
    );
  }
  if (status === 'failed') {
    return (
      <span className="bubble__state bubble__state--failed" title="Not sent" aria-label="Not sent">
        <AlertCircle aria-hidden />
      </span>
    );
  }
  if (status === 'read') {
    return (
      <span className="bubble__state bubble__state--read" title="Read" aria-label="Read">
        <CheckCheck aria-hidden />
      </span>
    );
  }
  if (status === 'delivered') {
    return (
      <span className="bubble__state bubble__state--delivered" title="Delivered" aria-label="Delivered">
        <CheckCheck aria-hidden />
      </span>
    );
  }
  return (
    <span className="bubble__state bubble__state--sent" title="Sent" aria-label="Sent">
      <Check aria-hidden />
    </span>
  );
}

function MessageBubbleComponent({
  message,
  isOut,
  peer,
  showAvatar,
  grouped,
  onRetry,
  selected,
  selectionMode,
  onToggleSelect,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onReact,
  onForward,
  onSelect
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuRef = useRef(null);
  const pressTimer = useRef(null);
  useClickOutside(menuRef, () => {
    setMenuOpen(false);
    setPickerOpen(false);
  }, menuOpen || pickerOpen);

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const classes = [
    'message-row',
    isOut ? 'message-row--out' : 'message-row--in',
    grouped ? 'message-row--grouped' : '',
    selected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const status = messageStatus(message);
  const deleted = Boolean(message.deleted || message.deletedAt);
  const reactions = message.reactions || [];

  function openMenu(event) {
    event?.preventDefault?.();
    if (deleted) return;
    setMenuOpen(true);
  }

  function handleTouchStart() {
    pressTimer.current = setTimeout(() => setMenuOpen(true), 520);
  }

  function handleTouchEnd() {
    clearTimeout(pressTimer.current);
  }

  function run(action) {
    setMenuOpen(false);
    setPickerOpen(false);
    action?.();
  }

  return (
    <div
      className={classes}
      onContextMenu={openMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
    >
      {selectionMode ? (
        <button
          type="button"
          className={`select-tick${selected ? ' is-on' : ''}`}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect message' : 'Select message'}
          onClick={() => onToggleSelect?.(message)}
        >
          <Check size={12} />
        </button>
      ) : null}

      {!isOut ? (
        showAvatar ? <Avatar user={peer} size="xs" alt={false} /> : <span className="message-row__spacer" aria-hidden />
      ) : null}

      <div className="bubble-stack">
      <div
        className={[
          'bubble',
          message.pending ? 'bubble--pending' : '',
          message.failed ? 'bubble--failed' : '',
          deleted ? 'bubble--deleted' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-message-id={message.id}
        data-status={status}
      >
        {message.replyTo?.text ? (
          <span className="bubble__quote">
            {message.replyTo.text}
          </span>
        ) : null}
        <span className="bubble__text">
          {deleted ? 'This message was deleted' : message.text}
        </span>
        <span className="bubble__meta">
          {message.failed && onRetry ? (
            <button type="button" className="bubble__retry" onClick={() => onRetry(message)}>
              <RotateCw size={11} aria-hidden /> Not sent — retry
            </button>
          ) : null}
          {message.editedAt && !deleted ? <span className="bubble__edited">edited</span> : null}
          <span>{message.pending ? 'sending…' : formatTime(message.createdAt)}</span>
          <StatusIcon message={message} isOut={isOut} />
        </span>

        {!deleted && !message.pending ? (
          <button
            type="button"
            className="bubble__more"
            aria-label="Message actions"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((open) => !open);
            }}
          >
            <MoreVertical size={14} />
          </button>
        ) : null}

        {menuOpen && !deleted ? (
          <div className={`menu message-menu${isOut ? ' message-menu--out' : ''}`} role="menu" ref={menuRef}>
            {pickerOpen ? (
              <div className="reaction-picker" role="group" aria-label="Reactions">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    className="reaction-picker__btn"
                    onClick={() => run(() => onReact?.(message, emoji))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ) : (
              <>
                <button type="button" className="menu__item" role="menuitem" onClick={() => setPickerOpen(true)}>
                  <SmilePlus size={16} /> React
                </button>
                <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => onReply?.(message))}>
                  <CornerUpLeft size={16} /> Reply
                </button>
                <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => onCopy?.(message))}>
                  <Copy size={16} /> Copy
                </button>
                {isOut ? (
                  <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => onEdit?.(message))}>
                    <Pencil size={16} /> Edit
                  </button>
                ) : null}
                <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => onForward?.(message))}>
                  <Forward size={16} /> Forward
                </button>
                <button type="button" className="menu__item" role="menuitem" onClick={() => run(() => onSelect?.(message))}>
                  <CheckSquare size={16} /> Select
                </button>
                <div className="menu__separator" />
                <button
                  type="button"
                  className="menu__item menu__item--danger"
                  role="menuitem"
                  onClick={() => run(() => onDelete?.(message, 'me'))}
                >
                  <Trash2 size={16} /> Delete for me
                </button>
                {isOut ? (
                  <button
                    type="button"
                    className="menu__item menu__item--danger"
                    role="menuitem"
                    onClick={() => run(() => onDelete?.(message, 'everyone'))}
                  >
                    <Trash2 size={16} /> Delete for everyone
                  </button>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {reactions.length > 0 && !deleted ? (
        <div className="bubble__reactions">
          {reactions.map((reaction) => (
            <button
              type="button"
              key={reaction.emoji}
              className={`reaction-chip${reaction.reacted ? ' is-mine' : ''}`}
              onClick={() => onReact?.(message, reaction.emoji)}
              title={`${reaction.count} ${reaction.emoji}`}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      ) : null}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
export default MessageBubble;
