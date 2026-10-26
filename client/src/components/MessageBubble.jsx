import { memo } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatTime } from '../lib/format.js';

function StatusIcon({ message, isOut }) {
  if (!isOut) return null;
  if (message.pending) {
    return (
      <span className="bubble__state" title="Sending">
        <Clock aria-hidden />
      </span>
    );
  }
  if (message.failed) {
    return (
      <span className="bubble__state" title="Not sent" style={{ color: '#fca5a5' }}>
        <AlertCircle aria-hidden />
      </span>
    );
  }
  if (message.readAt) {
    return (
      <span className="bubble__state bubble__state--read" title="Read">
        <CheckCheck aria-hidden />
      </span>
    );
  }
  if (message.deliveredAt) {
    return (
      <span className="bubble__state" title="Delivered">
        <CheckCheck aria-hidden />
      </span>
    );
  }
  return (
    <span className="bubble__state" title="Sent">
      <Check aria-hidden />
    </span>
  );
}

function MessageBubbleComponent({ message, isOut, peer, showAvatar, grouped, onRetry }) {
  const classes = [
    'message-row',
    isOut ? 'message-row--out' : 'message-row--in',
    grouped ? 'message-row--grouped' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes}>
      {!isOut ? (
        showAvatar ? <Avatar user={peer} size="xs" alt={false} /> : <span className="message-row__spacer" aria-hidden />
      ) : null}

      <div
        className={[
          'bubble',
          message.pending ? 'bubble--pending' : '',
          message.failed ? 'bubble--failed' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        data-message-id={message.id}
      >
        <span>{message.text}</span>
        <span className="bubble__meta">
          {message.failed && onRetry ? (
            <button type="button" className="bubble__retry" onClick={() => onRetry(message)}>
              <RotateCw size={11} aria-hidden /> Not sent — retry
            </button>
          ) : null}
          <span>{message.pending ? 'sending…' : formatTime(message.createdAt)}</span>
          <StatusIcon message={message} isOut={isOut} />
        </span>
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
export default MessageBubble;
