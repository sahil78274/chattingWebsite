import { useEffect, useState } from 'react';
import { initialsOf } from '../lib/format.js';
import { resolveAssetUrl } from '../services/api.js';

/**
 * Avatar with image + initials fallback and optional presence dot.
 * `user` may be null (renders a neutral placeholder).
 * Temporary blob: URLs are only used as a local preview while uploading —
 * the stored `avatarUrl` is always a server or object-storage path.
 */
export function Avatar({ user, size = 'md', showPresence = false, className = '', alt }) {
  const classes = ['avatar', `avatar--${size}`, className].filter(Boolean).join(' ');
  const initials = initialsOf(user);
  const background = user?.avatarColor || 'var(--brand-500)';
  const src = user?.avatarUrl ? resolveAssetUrl(user.avatarUrl) : '';
  const [phase, setPhase] = useState(src ? 'loading' : 'empty');

  useEffect(() => {
    setPhase(src ? 'loading' : 'empty');
  }, [src]);

  const showImage = Boolean(src) && phase !== 'error';

  return (
    <span
      className={classes}
      style={showImage && phase === 'ready' ? undefined : { background }}
      aria-hidden={alt === false ? 'true' : undefined}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt || `${user.displayName || user.username} avatar`}
          loading="lazy"
          onLoad={() => setPhase('ready')}
          onError={() => setPhase('error')}
        />
      ) : (
        <span>{initials}</span>
      )}
      {phase === 'loading' && showImage ? <span className="avatar__loading" aria-hidden /> : null}
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
