import { memo } from 'react';
import { AlertCircle, Check, CheckCheck, Clock, RotateCw } from 'lucide-react';
import { Avatar } from './Avatar.jsx';
import { formatTime } from '../lib/format.js';
import { messageStatus } from '../lib/messages.js';

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

function MessageBubbleComponent({ message, isOut, peer, showAvatar, grouped, onRetry }) {
  const classes = [
    'message-row',
    isOut ? 'message-row--out' : 'message-row--in',
    grouped ? 'message-row--grouped' : ''
  ]
    .filter(Boolean)
    .join(' ');

  const status = messageStatus(message);

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
        data-status={status}
      >
        <span className="bubble__text">{message.text}</span>
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
