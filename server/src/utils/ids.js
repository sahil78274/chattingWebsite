import { randomBytes } from 'node:crypto';

const HEX = '0123456789abcdef';

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
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function pairKeyFor(a, b) {
  return [a, b].sort().join(':');
}

export default { newId, isId, randomToken, pairKeyFor };
