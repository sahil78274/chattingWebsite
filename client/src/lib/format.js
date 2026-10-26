export function initialsOf(user) {
  if (!user) return '?';
  if (user.initials) return user.initials;
  const source = String(user.displayName || user.username || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const timeFormat = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true
});

const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
});

export function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return timeFormat.format(date);
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function isSameDay(a, b) {
  return startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();
}

export function formatDayLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((today - target) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return date.toLocaleDateString('en-IN', { weekday: 'long' });
  return dateFormat.format(date);
}

/** Compact timestamp used in the conversation list. */
export function formatListTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (isSameDay(date, new Date())) return formatTime(date);
  const yesterday = new Date(Date.now() - 86_400_000);
  if (isSameDay(date, yesterday)) return 'Yesterday';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: '2-digit' })
  });
}

export function formatLastSeen(user) {
  if (!user) return '';
  if (user.online) return 'Online';
  if (user.lastSeenHidden) return 'Last seen hidden';
  if (!user.lastSeen) return 'Offline';
  const date = new Date(user.lastSeen);
  if (Number.isNaN(date.getTime())) return 'Offline';
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return 'Last seen just now';
  if (diff < 3_600_000) return `Last seen ${Math.floor(diff / 60_000)}m ago`;
  if (isSameDay(date, new Date())) return `Last seen today at ${formatTime(date)}`;
  if (isSameDay(date, new Date(Date.now() - 86_400_000))) return `Last seen yesterday`;
  return `Last seen ${dateFormat.format(date)}`;
}

export function truncate(text, max = 90) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function passwordStrength(password) {
  const value = String(password || '');
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/[0-9]/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(score, 4);
}
