import { useEffect, useState } from 'react';
import { Ban, CalendarDays, Flag, Loader2, MessageSquare, ShieldOff, UserX } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { Avatar } from './Avatar.jsx';
import { formatLastSeen } from '../lib/format.js';
import { api } from '../services/api.js';
import { useToast } from '../context/ToastContext.jsx';

export function UserProfileModal({ user, onClose, onStartConversation, onReport, onBlockedChange }) {
  const [profile, setProfile] = useState(user);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const { notify } = useToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getUser(user.id)
      .then((data) => {
        if (cancelled) return;
        setProfile({ ...data.user, blockedByMe: data.blockedByMe, blockedMe: data.blockedMe });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  async function toggleBlock() {
    setBusy(true);
    try {
      if (profile.blockedByMe) {
        await api.unblockUser(profile.id);
        setProfile((current) => ({ ...current, blockedByMe: false }));
        notify.success(`Unblocked @${profile.username}`);
      } else {
        await api.blockUser(profile.id);
        setProfile((current) => ({ ...current, blockedByMe: true }));
        notify.success(`Blocked @${profile.username}. They can no longer message you.`);
      }
      onBlockedChange?.(profile.id, !profile.blockedByMe);
    } catch (error) {
      notify.error(error.message || 'Could not update the block');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => onStartConversation(profile)}
            disabled={profile.blockedByMe}
            title={profile.blockedByMe ? 'Unblock this user to message them' : undefined}
          >
            <MessageSquare size={16} /> Message
          </button>
        </>
      }
    >
      <div className="profile-head">
        <Avatar user={profile} size="xl" showPresence />
        <div className="profile-head__body">
          <h4>{profile.displayName}</h4>
          <div className="profile-head__handle">@{profile.username}</div>
          <div className="chat-header__status" style={{ marginTop: 4 }}>
            {loading ? (
              <>
                <Loader2 size={13} className="spin" aria-hidden /> Loading…
              </>
            ) : (
              formatLastSeen(profile)
            )}
          </div>
        </div>
      </div>

      {profile.bio ? <p className="text-secondary" style={{ fontSize: 14 }}>{profile.bio}</p> : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span className="badge-soft">
          <CalendarDays size={12} /> Joined{' '}
          {new Date(profile.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
        </span>
        <span className="badge-soft">ID · {String(profile.id).slice(-8)}</span>
        {profile.blockedByMe ? (
          <span className="badge-soft">
            <UserX size={12} /> You blocked them
          </span>
        ) : null}
        {profile.blockedMe ? (
          <span className="badge-soft">
            <ShieldOff size={12} /> Blocked you
          </span>
        ) : null}
      </div>

      <div className="divider" />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={toggleBlock} disabled={busy}>
          {busy ? <Loader2 size={14} className="spin" /> : <Ban size={14} />}
          {profile.blockedByMe ? 'Unblock user' : 'Block user'}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onReport(profile)}>
          <Flag size={14} /> Report
        </button>
      </div>
    </Modal>
  );
}

export default UserProfileModal;
