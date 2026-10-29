import { randomBytes } from 'node:crypto';

const HEX = '0123456789abcdef';
const ID_PATTERN = /^[a-f0-9]{24}$/i;

/**
 * Generates a 24 character hexadecimal identifier that follows the same shape as
 * a MongoDB ObjectId, so ids stay URL-safe, sortable by creation time and unique
 * across every process. We generate them ourselves (rather than relying on the
 * database) so in-memory and MongoDB backed runs behave identically.
 */
export function newId() {
  const seconds = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const bytes = randomBytes(8);
  let rest = '';
  for (const byte of bytes) {
    rest += HEX[(byte >> 4) & 0xf] + HEX[byte & 0xf];
  }
  return (seconds + rest).slice(0, 24);
}

export function isId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * Coerce store/driver values (hex string, ObjectId, `{ $oid }`, nested `_id`)
 * to the canonical 24-char hex string this app uses on the wire.
 */
export function normalizeId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString();
    if (typeof value.$oid === 'string') return value.$oid.trim();
    if (value._id != null && value._id !== value) return normalizeId(value._id);
    if (value.id != null && value.id !== value) return normalizeId(value.id);
  }
  const asString = String(value);
  return asString === '[object Object]' ? '' : asString;
}

export function idsEqual(a, b) {
  if (a == null || b == null) return false;
  const left = normalizeId(a);
  const right = normalizeId(b);
  return Boolean(left) && left === right;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function pairKeyFor(a, b) {
  return [normalizeId(a) || a, normalizeId(b) || b].sort().join(':');
}

export default { newId, isId, normalizeId, idsEqual, randomToken, pairKeyFor };
