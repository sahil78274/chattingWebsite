import { SearchX, MessageSquarePlus, UserPlus } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatLastSeen } from '../lib/format.js';

export function SearchResults({
  query,
  results,
  loading,
  error,
  hasMore,
  page,
  onLoadMore,
  onStartConversation,
  onViewProfile,
  startingWith
}) {
  if (!query.trim()) return null;

  if (loading) {
    return (
      <div aria-hidden>
        {[0, 1, 2].map((index) => (
          <div className="skeleton-row" key={index}>
            <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%', flex: 'none' }} />
            <div className="skeleton-row__body">
              <div className="skeleton" style={{ height: 11, width: '58%' }} />
              <div className="skeleton" style={{ height: 9, width: '38%' }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state" style={{ padding: '24px 16px' }}>
        <div className="empty-state__inner">
          <p className="field__error">{error}</p>
        </div>
      </div>
    );
  }

  if (!results.length) {
    return (
      <div className="empty-state" style={{ padding: '28px 16px' }}>
        <div className="empty-state__inner">
          <span className="empty-state__icon" style={{ width: 52, height: 52, borderRadius: 16 }}>
            <SearchX size={22} />
          </span>
          <h3 style={{ fontSize: 15 }}>No one found</h3>
          <p style={{ fontSize: 13.5 }}>
            No registered user matches “{query}”. Try a shorter part of their username, or their exact user ID.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      {results.map((user) => (
        <div className="result-item" key={user.id} role="button" tabIndex={0}
          onClick={() => onViewProfile(user)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onViewProfile(user);
            }
          }}
        >
          <Avatar user={user} size="sm" showPresence />
          <span className="result-item__body">
            <span className="result-item__name">{user.displayName}</span>
            <span className="result-item__meta">
              @{user.username} · {formatLastSeen(user)}
            </span>
          </span>
          <button
            type="button"
            className="result-item__action"
            title={`Message ${user.username}`}
            aria-label={`Start a conversation with ${user.username}`}
            disabled={startingWith === user.id}
            onClick={(event) => {
              event.stopPropagation();
              onStartConversation(user);
            }}
          >
            {startingWith === user.id ? <span className="spinner" /> : <MessageSquarePlus size={16} />}
          </button>
        </div>
      ))}
      {hasMore ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0' }}>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onLoadMore(page + 1)}>
            <UserPlus size={14} /> Load more results
          </button>
        </div>
      ) : null}
    </>
  );
}

export default SearchResults;
