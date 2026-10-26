import { useState } from 'react';
import { Bell, BellOff, Loader2, LogOut, Monitor, Moon, ShieldCheck, Sun, Volume2, VolumeX } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { PasswordField } from './PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { api } from '../services/api.js';
import { passwordStrength } from '../lib/format.js';

export function SettingsModal({ onClose, notificationsEnabled, onToggleNotifications, notificationSupported, soundEnabled, onToggleSound, mutedCount, onClearMutes }) {
  const { user, updateUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const { notify } = useToast();
  const [tab, setTab] = useState('general');
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [savingPassword, setSavingPassword] = useState(false);

  async function setLastSeen(value) {
    setPrivacyBusy(true);
    try {
      const { user: next } = await api.updateProfile({ privacy: { lastSeen: value } });
      updateUser(next);
      notify.success(value === 'everyone' ? 'Everyone can now see your last seen' : 'Your last seen is now hidden');
    } catch (error) {
      notify.error(error.message || 'Could not update privacy');
    } finally {
      setPrivacyBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setErrors({});
    if (passwords.newPassword !== passwords.confirmPassword) {
      setErrors({ confirmPassword: 'Passwords do not match' });
      return;
    }
    setSavingPassword(true);
    try {
      await api.changePassword(passwords);
      notify.success('Password changed. Please sign in again.');
      await logout();
    } catch (error) {
      setErrors(error.details || { currentPassword: error.message });
    } finally {
      setSavingPassword(false);
    }
  }

  async function logoutEverywhere() {
    try {
      await api.logoutAll();
    } catch { /* ignore */ }
    await logout();
  }

  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="form" style={{ gap: 14 }}>
        <span className="modal__section-title">Appearance</span>
        <div className="toggle-row">
          <div className="toggle-row__text">
            <span className="toggle-row__label">Theme</span>
            <span className="toggle-row__hint">Light by default. Toggle for dark mode.</span>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className={`icon-btn icon-btn--sm${theme === 'dark' ? ' is-active' : ''}`} onClick={() => setTheme('dark')} aria-label="Use dark theme" aria-pressed={theme === 'dark'}><Moon size={16} /></button>
            <button type="button" className={`icon-btn icon-btn--sm${theme === 'light' ? ' is-active' : ''}`} onClick={() => setTheme('light')} aria-label="Use light theme" aria-pressed={theme === 'light'}><Sun size={16} /></button>
            <button type="button" className={`icon-btn icon-btn--sm${theme === 'system' ? ' is-active' : ''}`} onClick={() => setTheme(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')} aria-label="Match system theme"><Monitor size={16} /></button>
          </div>
        </div>

        <span className="modal__section-title">Notifications</span>
        <div className="toggle-row">
          <div className="toggle-row__text">
            <span className="toggle-row__label">Browser notifications</span>
            <span className="toggle-row__hint">{notificationSupported ? 'New messages when tab is in background.' : 'Not supported in this browser.'}</span>
          </div>
          <button type="button" className={`switch${notificationsEnabled ? ' is-on' : ''}`} onClick={onToggleNotifications} role="switch" aria-checked={notificationsEnabled} aria-label="Toggle browser notifications" disabled={!notificationSupported}><span className="sr-only">{notificationsEnabled ? 'On' : 'Off'}</span></button>
        </div>
        <div className="toggle-row">
          <div className="toggle-row__text">
            <span className="toggle-row__label">Message sounds</span>
            <span className="toggle-row__hint">Play a subtle sound for new messages.</span>
          </div>
          <button type="button" className={`switch${soundEnabled ? ' is-on' : ''}`} onClick={onToggleSound} role="switch" aria-checked={soundEnabled} aria-label="Toggle message sounds"><span className="sr-only">{soundEnabled ? 'On' : 'Off'}</span></button>
        </div>
        {mutedCount > 0 ? (
          <div className="toggle-row">
            <div className="toggle-row__text">
              <span className="toggle-row__label">Muted conversations</span>
              <span className="toggle-row__hint">{mutedCount} conversation{mutedCount === 1 ? '' : 's'} muted locally.</span>
            </div>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onClearMutes}>Unmute all</button>
          </div>
        ) : (
          <p className="field__hint">Tip: mute a conversation from its header menu to suppress browser notifications and sounds while keeping unread counts.</p>
        )}
        <p className="field__hint">Browser notifications require HTTPS (or localhost) and explicit permission. We request permission only after you click Enable. If denied, enable them in browser settings.</p>

        <span className="modal__section-title">Privacy</span>
        <div className="toggle-row">
          <div className="toggle-row__text">
            <span className="toggle-row__label">Last seen</span>
            <span className="toggle-row__hint">{user.privacy?.lastSeen === 'nobody' ? 'Hidden from everyone.' : 'Shown to people you talk to.'}</span>
          </div>
          <button type="button" className={`switch${user.privacy?.lastSeen !== 'nobody' ? ' is-on' : ''}`} onClick={() => setLastSeen(user.privacy?.lastSeen === 'nobody' ? 'everyone' : 'nobody')} role="switch" aria-checked={user.privacy?.lastSeen !== 'nobody'} aria-label="Show my last seen" disabled={privacyBusy}><span className="sr-only">Toggle last seen</span></button>
        </div>

        <div className="divider" />
        <span className="modal__section-title">Security</span>
        {tab === 'general' ? (
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => setTab('password')} style={{ justifySelf: 'start' }}><ShieldCheck size={15} /> Change password</button>
        ) : (
          <form className="form" onSubmit={changePassword} style={{ gap: 12 }}>
            <PasswordField label="Current password" value={passwords.currentPassword} onChange={(event) => setPasswords((c) => ({ ...c, currentPassword: event.target.value }))} error={errors.currentPassword} autoComplete="current-password" />
            <PasswordField label="New password" value={passwords.newPassword} onChange={(event) => setPasswords((c) => ({ ...c, newPassword: event.target.value }))} error={errors.newPassword} autoComplete="new-password" showStrength strength={passwordStrength(passwords.newPassword)} hint="8+ characters, letters and numbers" />
            <PasswordField label="Confirm new password" value={passwords.confirmPassword} onChange={(event) => setPasswords((c) => ({ ...c, confirmPassword: event.target.value }))} error={errors.confirmPassword} autoComplete="new-password" />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn--primary btn--sm" disabled={savingPassword}>{savingPassword ? <Loader2 size={14} className="spin" /> : null} Update password</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTab('general')}>Cancel</button>
            </div>
          </form>
        )}
        <button type="button" className="btn btn--ghost btn--sm" onClick={logoutEverywhere} style={{ justifySelf: 'start' }}><LogOut size={15} /> Sign out of all devices</button>

        <div className="divider" />
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}><Bell size={12} aria-hidden /> Messages are stored on the Connectly server over HTTPS. Private to your conversations, not end-to-end encrypted.</p>
        {!notificationSupported ? <p className="muted" style={{ fontSize: 12.5 }}><BellOff size={12} aria-hidden /> Requires HTTPS or localhost + permission.</p> : null}
        <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <Volume2 size={12} aria-hidden /> Sounds use a tiny Web Audio tone — no external files. Muted state and sound preference are stored locally; server unread counts remain accurate.
        </p>
      </div>
    </Modal>
  );
}

export default SettingsModal;
