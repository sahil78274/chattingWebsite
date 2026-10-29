import { useCallback, useEffect, useRef, useState } from 'react';
import { Ban, SendHorizontal, X } from 'lucide-react';

const MAX_LENGTH = 4000;

export function Composer({
  conversationId,
  onSend,
  disabled = false,
  disabledReason,
  onTyping,
  onStopTyping,
  draft,
  replyTo,
  onClearReply,
  editing,
  onCancelEdit
}) {
  const [value, setValue] = useState(draft || '');
  const textareaRef = useRef(null);
  const typingTimeout = useRef(null);
  const typingActive = useRef(false);

  useEffect(() => {
    setValue(editing?.text || draft || '');
    typingActive.current = false;
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [conversationId, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => clearTimeout(typingTimeout.current), []);

  const autoGrow = useCallback(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = 'auto';
    node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
  }, []);

  useEffect(autoGrow, [value, autoGrow]);

  function stopTyping() {
    if (!typingActive.current) return;
    typingActive.current = false;
    clearTimeout(typingTimeout.current);
    onStopTyping?.();
  }

  function handleChange(event) {
    const next = event.target.value;
    setValue(next);

    if (next.trim()) {
      if (!typingActive.current) {
        typingActive.current = true;
        onTyping?.();
      }
      clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(stopTyping, 1800);
    } else {
      stopTyping();
    }
  }

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    if (text.length > MAX_LENGTH) return;
    onSend(text);
    if (!editing) setValue('');
    stopTyping();
    requestAnimationFrame(() => {
      autoGrow();
      textareaRef.current?.focus();
    });
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape' && (editing || replyTo)) {
      event.preventDefault();
      onCancelEdit?.();
      onClearReply?.();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  if (disabled) {
    return (
      <div className="composer">
        <div className="composer__notice">
          <Ban size={16} aria-hidden />
          <span>{disabledReason || 'You cannot send messages in this conversation right now.'}</span>
        </div>
      </div>
    );
  }

  const remaining = MAX_LENGTH - value.length;
  const banner = editing
    ? { title: 'Editing message', body: editing.text, onClear: onCancelEdit }
    : replyTo
      ? { title: 'Replying', body: replyTo.text, onClear: onClearReply }
      : null;

  return (
    <div className="composer">
      {banner ? (
        <div className="composer__banner">
          <div>
            <strong>{banner.title}</strong>
            <p>{banner.body}</p>
          </div>
          <button type="button" className="icon-btn icon-btn--sm" onClick={banner.onClear} aria-label="Cancel">
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className="composer__form">
        <label className="sr-only" htmlFor="composer-input">
          Write a message
        </label>
        <textarea
          id="composer-input"
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={stopTyping}
          placeholder={editing ? 'Edit your message…' : 'Write a message…'}
          rows={1}
          maxLength={MAX_LENGTH + 200}
          autoComplete="off"
        />
        <button
          type="button"
          className="composer__send"
          onClick={submit}
          disabled={!value.trim() || value.length > MAX_LENGTH}
          aria-label={editing ? 'Save edit' : 'Send message'}
          title={editing ? 'Save edit (Enter)' : 'Send message (Enter)'}
        >
          <SendHorizontal size={18} />
        </button>
      </div>
      <div className="composer__hint">
        <span>Enter to send · Shift + Enter for a new line</span>
        <span
          className={`composer__count${remaining < 200 ? ' is-near-limit' : ''}${
            remaining < 0 ? ' is-over' : ''
          }`}
        >
          {value.length > 0 ? `${value.length} / ${MAX_LENGTH}` : ''}
        </span>
      </div>
    </div>
  );
}

export default Composer;
