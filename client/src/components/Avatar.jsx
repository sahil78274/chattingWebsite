import { initialsOf } from '../lib/format.js';
import { resolveAssetUrl } from '../services/api.js';

/**
 * Avatar with image + initials fallback and optional presence dot.
 * `user` may be null (renders a neutral placeholder).
 */
export function Avatar({ user, size = 'md', showPresence = false, className = '', alt }) {
  const classes = ['avatar', `avatar--${size}`, className].filter(Boolean).join(' ');
  const initials = initialsOf(user);
  const background = user?.avatarColor || 'var(--brand-500)';

  return (
    <span
      className={classes}
      style={user?.avatarUrl ? undefined : { background }}
      aria-hidden={alt === false ? 'true' : undefined}
    >
      {user?.avatarUrl ? (
        <img src={resolveAssetUrl(user.avatarUrl)} alt={alt || `${user.displayName || user.username} avatar`} loading="lazy" />
      ) : (
        <span>{initials}</span>
      )}
      {showPresence ? (
        <span
          className={`avatar__presence${user?.online ? ' avatar__presence--online' : ''}`}
          title={user?.online ? 'Online' : 'Offline'}
        />
      ) : null}
    </span>
  );
}

export default Avatar;
