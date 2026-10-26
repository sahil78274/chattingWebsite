import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import ApiError from './ApiError.js';

export const ACCESS_COOKIE = 'connectly_at';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id || user.id, tokenVersion: user.tokenVersion || 0, type: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl, issuer: 'connectly' }
  );
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'connectly' });
    if (payload.type !== 'access' || !payload.sub) throw new ApiError(401, 'Invalid session');
    return payload;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'TokenExpiredError') {
      throw new ApiError(401, 'Session expired', { code: 'TOKEN_EXPIRED' });
    }
    throw new ApiError(401, 'Invalid session', { code: 'INVALID_TOKEN' });
  }
}

export function newRefreshTokenValue() {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function refreshExpiryDate() {
  return new Date(Date.now() + config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000);
}

export function newFamilyId() {
  return crypto.randomUUID();
}

export function setRefreshCookie(res, token) {
  res.cookie(config.cookies.refreshName, token, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain,
    path: config.cookies.path,
    maxAge: config.jwt.refreshTtlDays * 24 * 60 * 60 * 1000
  });
}

export function clearRefreshCookie(res) {
  res.clearCookie(config.cookies.refreshName, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain,
    path: config.cookies.path
  });
}

/** Short-lived cookie used only on the frontend origin so SPA reloads can bootstrap. */
export function setAccessCookie(res, token) {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: false,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain,
    path: '/',
    maxAge: config.jwt.accessTtlMs
  });
}

export function clearAccessCookie(res) {
  res.clearCookie(ACCESS_COOKIE, {
    httpOnly: false,
    secure: config.cookies.secure,
    sameSite: config.cookies.sameSite,
    domain: config.cookies.domain,
    path: '/'
  });
}

export function extractAccessToken(req) {
  const header = req.headers?.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE];
  return null;
}
