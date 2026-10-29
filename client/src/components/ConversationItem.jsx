import { memo } from 'react';
import { Ban } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatListTime, truncate } from '../lib/format.js';

function ConversationItemComponent({ conversation, isActive, isTyping, viewerId, onSelect }) {
  const { peer, lastMessage, unreadCount, lastMessageAt, blockedByMe, blockedMe } = conversation;
  const isUnread = unreadCount > 0;
  const previewText = (() => {
    if (!lastMessage) return blockedByMe ? 'You blocked this person' : 'Start the conversation';
    if (lastMessage.senderId === viewerId) {
      return `You: ${truncate(lastMessage.text, 64)}`;
    }
    return truncate(lastMessage.text, 64);
  })();

  return (
    <button
      type="button"
      className={[
        'conversation-item',
        isActive ? 'is-active' : '',
        isUnread ? 'is-unread' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onSelect(conversation.id)}
      aria-current={isActive ? 'true' : undefined}
    >
      <Avatar user={peer} size="md" showPresence />
      <span className="conversation-item__body">
        <span className="conversation-item__row">
          <span className="conversation-item__name">{peer?.displayName || peer?.username}</span>
          <span className="conversation-item__time">{formatListTime(lastMessageAt)}</span>
        </span>
        <span className="conversation-item__preview">
          {isTyping ? (
            <span className="conversation-item__typing">typing…</span>
          ) : (
            <span className="conversation-item__text">
              {blockedByMe ? <Ban size={12} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} /> : null}
              {blockedByMe ? 'You blocked this person' : previewText}
            </span>
          )}
          {isUnread ? (
            <span className="unread-badge" aria-label={`${unreadCount} unread messages`}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

export const ConversationItem = memo(ConversationItemComponent);
export default ConversationItem;
