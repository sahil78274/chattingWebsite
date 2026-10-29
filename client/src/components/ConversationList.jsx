import { MessageSquareDashed } from 'lucide-react';
import { ConversationItem } from './ConversationItem.jsx';
import { idsEqual } from '../lib/messages.js';

export function ConversationSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2, 3, 4].map((index) => (
        <div className="skeleton-row" key={index}>
          <div className="skeleton" style={{ width: 44, height: 44, borderRadius: '50%', flex: 'none' }} />
          <div className="skeleton-row__body">
            <div className="skeleton" style={{ height: 11, width: `${52 + (index % 3) * 12}%` }} />
            <div className="skeleton" style={{ height: 9, width: `${70 - (index % 2) * 18}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationList({
  conversations,
  loading,
  activeId,
  viewerId,
  typingByConversation,
  onSelect,
  onStartSearch
}) {
  if (loading) return <ConversationSkeleton />;

  if (!conversations.length) {
    return (
      <div className="empty-state" style={{ padding: '28px 16px' }}>
        <div className="empty-state__inner">
          <span className="empty-state__icon" style={{ width: 52, height: 52, borderRadius: 16 }}>
            <MessageSquareDashed size={22} />
          </span>
          <h3 style={{ fontSize: 15 }}>No conversations yet</h3>
          <p style={{ fontSize: 13.5 }}>
            Search for someone by their username to start your first private conversation.
          </p>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onStartSearch}>
            Find people
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {conversations.map((conversation) => (
        <ConversationItem
          key={conversation.id || conversation._id}
          conversation={conversation}
          isActive={idsEqual(conversation.id || conversation._id, activeId)}
          isTyping={Boolean(typingByConversation[conversation.id || conversation._id])}
          viewerId={viewerId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

export default ConversationList;
