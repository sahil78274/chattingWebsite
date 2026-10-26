import { useRef, useState } from 'react';
import { Camera, Loader2, Upload } from 'lucide-react';
import { Modal } from './Modal.jsx';
import { Avatar } from './Avatar.jsx';
import { TextField } from './TextField.jsx';
import { api, resolveAssetUrl } from '../services/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { AVATAR_COLORS } from '../lib/constants.js';

export function EditProfileModal({ onClose }) {
  const { user, updateUser } = useAuth();
  const { notify } = useToast();
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [bio, setBio] = useState(user.bio || '');
  const [avatarColor, setAvatarColor] = useState(user.avatarColor || AVATAR_COLORS[0]);
  const [previewUrl, setPreviewUrl] = useState(user.avatarUrl || '');
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  function onPickFile(event) {
    const picked = event.target.files?.[0];
    if (!picked) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(picked.type)) {
      setErrors((current) => ({ ...current, avatar: 'Choose a JPEG, PNG, WebP or GIF image' }));
      return;
    }
    if (picked.size > 2 * 1024 * 1024) {
      setErrors((current) => ({ ...current, avatar: 'Image must be smaller than 2MB' }));
      return;
    }
    setErrors((current) => ({ ...current, avatar: undefined }));
    setFile(picked);
    setPreviewUrl(URL.createObjectURL(picked));
  }

  async function save(event) {
    event.preventDefault();
    const nextErrors = {};
    if (displayName.trim().length < 2) nextErrors.displayName = 'Display name must be at least 2 characters';
    if (bio.length > 280) nextErrors.bio = 'Bio must be 280 characters or fewer';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    try {
      let updatedUser = user;
      if (file) {
        const uploaded = await api.uploadAvatar(file);
        updatedUser = uploaded.user;
        notify.success('Profile picture updated');
        setFile(null);
      } else {
        const { user: next } = await api.updateProfile({
          displayName: displayName.trim(),
          bio: bio.trim(),
          avatarColor
        });
        updatedUser = next;
        notify.success('Profile updated');
      }
      // Persist text fields too when an avatar was uploaded in the same step.
      if (file && (displayName.trim() !== user.displayName || bio.trim() !== user.bio)) {
        const { user: finalUser } = await api.updateProfile({
          displayName: displayName.trim(),
          bio: bio.trim(),
          avatarColor
        });
        updatedUser = finalUser;
      }
      updateUser(updatedUser);
      onClose();
    } catch (error) {
      setErrors(error.details || {});
      notify.error(error.message || 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Edit profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" form="edit-profile-form" className="btn btn--primary" disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : null}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-profile-form" className="form" onSubmit={save}>
        <div className="profile-head">
          <Avatar user={{ ...user, avatarUrl: previewUrl, avatarColor }} size="xl" />
          <div style={{ display: 'grid', gap: 8 }}>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={14} /> Change picture
            </button>
            <span className="field__hint">JPEG, PNG, WebP or GIF · max 2MB</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={onPickFile}
              className="sr-only"
              aria-label="Upload profile picture"
            />
          </div>
        </div>
        {errors.avatar ? <span className="field__error">{errors.avatar}</span> : null}

        <div className="avatar-picker">
          <span className="modal__section-title">Avatar colour</span>
          <div className="swatches">
            {AVATAR_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className={`swatch${avatarColor === color && !file ? ' is-selected' : ''}`}
                style={{ background: color }}
                onClick={() => {
                  setAvatarColor(color);
                  setPreviewUrl('');
                  setFile(null);
                }}
                aria-label={`Use ${color} as avatar colour`}
                aria-pressed={avatarColor === color && !file}
              />
            ))}
          </div>
        </div>

        <TextField
          label="Display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          error={errors.displayName}
          maxLength={48}
          autoComplete="name"
        />
        <div className="field">
          <label className="field__label" htmlFor="bio">
            <span>Bio</span>
            <span className="field__hint">{bio.length}/280</span>
          </label>
          <textarea
            id="bio"
            className={`input${errors.bio ? ' input--invalid' : ''}`}
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            maxLength={280}
            placeholder="A short line about you (optional)"
            rows={3}
          />
          {errors.bio ? <span className="field__error">{errors.bio}</span> : null}
        </div>

        <div className="toggle-row">
          <div className="toggle-row__text">
            <span className="toggle-row__label">Username</span>
            <span className="toggle-row__hint">
              @{user.username} · your permanent unique handle
            </span>
          </div>
          <span className="badge-soft">Fixed</span>
        </div>

        {resolveAssetUrl(user.avatarUrl) ? (
          <span className="field__hint">
            <Upload size={12} aria-hidden /> Current picture is stored on the API server.
          </span>
        ) : null}
      </form>
    </Modal>
  );
}

export default EditProfileModal;
