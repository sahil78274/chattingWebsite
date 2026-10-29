import { MessagesSquare, Search, ShieldCheck, Zap } from 'lucide-react';

export function EmptyChatState({ onFindPeople, userName }) {
  return (
    <div className="empty-state">
      <div className="empty-state__inner">
        <span className="empty-state__icon">
          <MessagesSquare size={32} />
        </span>
        <h3>{userName ? `Welcome back, ${userName}` : 'Your conversations live here'}</h3>
        <p>
          Select a thread, or search for someone by username to start a private conversation. Messages
          arrive instantly and stay in your history.
        </p>
        <div className="empty-state__tips">
          <span className="chip">
            <Zap size={13} /> Real-time delivery
          </span>
          <span className="chip">
            <ShieldCheck size={13} /> Private by default
          </span>
          <span className="chip">
            <Search size={13} /> Search by @username
          </span>
        </div>
        {onFindPeople ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={onFindPeople} style={{ marginTop: 6 }}>
            <Search size={15} /> Find people
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default EmptyChatState;
