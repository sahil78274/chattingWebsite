import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, MessageCircle } from 'lucide-react';
import { MessageBubble } from './MessageBubble.jsx';
import { isSameDay, formatDayLabel } from '../lib/format.js';

function MessageSkeleton() {
  return (
    <div aria-hidden>
      {[
        { width: '46%', out: false },
        { width: '58%', out: true },
        { width: '36%', out: false },
        { width: '64%', out: true },
        { width: '42%', out: false }
      ].map((item, index) => (
        <div key={index} className="skeleton-row" style={{ justifyContent: item.out ? 'flex-end' : 'flex-start' }}>
          <div
            className="skeleton skeleton-bubble"
            style={{ width: item.width, marginLeft: item.out ? 'auto' : 0 }}
          />
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  hasMore,
  loadingMore,
  onLoadMore,
  peer,
  viewerId,
  onRetry
}) {
  const containerRef = useRef(null);
  const bottomRef = useRef(null);
  const previousHeightRef = useRef(0);
  const shouldStickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // Track whether the user is near the bottom so incoming messages don't
  // yank them away from older history they are reading.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    function onScroll() {
      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldStickToBottom.current = distanceFromBottom < 140;
      setShowJump(distanceFromBottom > 320);
    }
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, []);

  // Restore scroll position after prepending older messages.
  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (previousHeightRef.current && node.scrollHeight > previousHeightRef.current) {
      node.scrollTop += node.scrollHeight - previousHeightRef.current;
      previousHeightRef.current = 0;
    }
  }, [messages]);

  useEffect(() => {
    if (shouldStickToBottom.current) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [messages.length, peer?.id]);

  function loadOlder() {
    if (!containerRef.current) return;
    previousHeightRef.current = containerRef.current.scrollHeight;
    onLoadMore();
  }

  if (loading) {
    return (
      <div className="messages" aria-busy="true">
        <div className="messages__loading">
          <span className="spinner" aria-hidden />
          Loading messages…
        </div>
        <MessageSkeleton />
      </div>
    );
  }

  if (!messages.length) {
    return (
      <div className="messages" ref={containerRef}>
        <div className="empty-state">
          <div className="empty-state__inner">
            <span className="empty-state__icon">
              <MessageCircle size={30} />
            </span>
            <h3>Say hello to {peer?.displayName || peer?.username}</h3>
            <p>
              This is the start of your private conversation. Messages are delivered instantly and stay
              in your history.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="messages" ref={containerRef}>
      {hasMore ? (
        <div className="messages__load-more">
          <button type="button" className="btn btn--ghost btn--sm" onClick={loadOlder} disabled={loadingMore}>
            {loadingMore ? <span className="spinner" aria-hidden /> : null}
            {loadingMore ? 'Loading…' : 'Load earlier messages'}
          </button>
        </div>
      ) : null}

      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const isOut = message.senderId === viewerId;
        const newDay = !previous || !isSameDay(previous.createdAt, message.createdAt);
        const grouped =
          !newDay &&
          previous &&
          previous.senderId === message.senderId &&
          new Date(message.createdAt) - new Date(previous.createdAt) < 5 * 60 * 1000;

        return (
          <div key={message.id || message.clientId}>
            {newDay ? <div className="messages__day">{formatDayLabel(message.createdAt)}</div> : null}
            <MessageBubble
              message={message}
              isOut={isOut}
              peer={peer}
              grouped={grouped}
              showAvatar={!isOut && !grouped}
              onRetry={onRetry}
            />
          </div>
        );
      })}
      <div ref={bottomRef} style={{ height: 1 }} />
      {showJump ? (
        <button
          type="button"
          className="icon-btn"
          style={{ position: 'sticky', bottom: 8, alignSelf: 'center', background: 'var(--bg-raised)' }}
          onClick={() => {
            shouldStickToBottom.current = true;
            bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
          }}
          aria-label="Jump to the latest message"
        >
          <ArrowDown size={18} />
        </button>
      ) : null}
    </div>
  );
}

export default MessageList;
