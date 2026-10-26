import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import ApiError from '../utils/ApiError.js';
import {
  hashToken,
  newFamilyId,
  newRefreshTokenValue,
  refreshExpiryDate,
  signAccessToken
} from '../utils/tokens.js';
import { sanitizeText } from '../utils/validation.js';

const BCRYPT_ROUNDS = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

export async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(password, passwordHash);
}

async function issueTokens(store, user, { familyId = newFamilyId(), userAgent = '' } = {}) {
  const refreshToken = newRefreshTokenValue();
  await store.createRefreshToken({
    user: user._id || user.id,
    tokenHash: hashToken(refreshToken),
    familyId,
    expiresAt: refreshExpiryDate(),
    userAgent: String(userAgent).slice(0, 300)
  });
  return {
    accessToken: signAccessToken(user),
    refreshToken,
    familyId
  };
}

export async function registerUser(store, { username, email, password }, meta = {}) {
  const existing = await store.existsUser({ username, email });
  const usernameTaken = existing.some((row) => row.username === username.toLowerCase());
  const emailTaken = existing.some((row) => row.email === email.toLowerCase());
  if (usernameTaken || emailTaken) {
    const details = {};
    if (usernameTaken) details.username = 'That username is already taken';
    if (emailTaken) details.email = 'An account with this email already exists';
    throw new ApiError(409, 'That account already exists', { code: 'ACCOUNT_EXISTS', details });
  }

  const passwordHash = await hashPassword(password);
  const user = await store.createUser({
    username,
    usernameLower: username.toLowerCase(),
    email,
    passwordHash,
    displayName: sanitizeText(username).slice(0, 48) || username,
    avatarColor: pickAvatarColor(username)
  });

  const tokens = await issueTokens(store, user, meta);
  return { user, ...tokens };
}

export async function loginUser(store, { identifier, password }, meta = {}) {
  const isEmail = identifier.includes('@');
  const user = isEmail
    ? await store.findUserByEmail(identifier)
    : await store.findUserByUsername(identifier);

  const genericError = ApiError.unauthorized('Invalid email/username or password', {
    code: 'INVALID_CREDENTIALS'
  });

  if (!user) {
    // Constant-ish time: perform a hash comparison anyway so a missing account
    // is not obviously faster than a wrong password.
    await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
    throw genericError;
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw genericError;

  const tokens = await issueTokens(store, user, meta);
  return { user, ...tokens };
}

export async function refreshSession(store, rawToken, meta = {}) {
  if (!rawToken) throw ApiError.unauthorized('No refresh token provided', { code: 'NO_REFRESH_TOKEN' });

  const record = await store.findRefreshTokenByHash(hashToken(rawToken));
  if (!record) throw ApiError.unauthorized('Session is no longer valid', { code: 'INVALID_REFRESH' });

  if (record.revokedAt) {
    // Token replay: assume theft and invalidate the whole token family.
    await store.revokeTokenFamily(record.familyId);
    throw ApiError.unauthorized('Session was revoked. Please sign in again.', { code: 'REFRESH_REPLAYED' });
  }

  if (new Date(record.expiresAt).getTime() < Date.now()) {
    await store.revokeRefreshToken(record.tokenHash);
    throw ApiError.unauthorized('Session expired. Please sign in again.', { code: 'REFRESH_EXPIRED' });
  }

  const user = await store.findUserById(record.user);
  if (!user) {
    await store.revokeRefreshToken(record.tokenHash);
    throw ApiError.unauthorized('Account no longer exists', { code: 'INVALID_REFRESH' });
  }

  const newValue = newRefreshTokenValue();
  await store.revokeRefreshToken(record.tokenHash, hashToken(newValue));
  await store.createRefreshToken({
    user: user._id || user.id,
    tokenHash: hashToken(newValue),
    familyId: record.familyId,
    expiresAt: refreshExpiryDate(),
    userAgent: String(meta.userAgent || '').slice(0, 300)
  });

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: newValue,
    familyId: record.familyId
  };
}

export async function logoutSession(store, rawToken) {
  if (!rawToken) return;
  const record = await store.findRefreshTokenByHash(hashToken(rawToken));
  if (record && !record.revokedAt) await store.revokeRefreshToken(record.tokenHash);
}

export async function changePassword(store, user, { currentPassword, newPassword }) {
  const fresh = await store.findUserByIdWithSecrets(user._id || user.id);
  if (!fresh) throw ApiError.notFound('Account not found');
  const ok = await verifyPassword(currentPassword, fresh.passwordHash);
  if (!ok) {
    throw ApiError.badRequest('Current password is incorrect', { code: 'WRONG_PASSWORD' });
  }
  const passwordHash = await hashPassword(newPassword);
  const updated = await store.updateUser(fresh._id, {
    passwordHash,
    tokenVersion: (fresh.tokenVersion || 0) + 1
  });
  // Every existing session must be re-authenticated after a password change.
  await store.revokeAllForUser(fresh._id);
  return updated;
}

export async function createPasswordReset(store, email, { appUrl }) {
  const user = await store.findUserByEmail(email).catch(() => null);
  // Always resolve successfully so the endpoint cannot be used to enumerate accounts.
  if (!user) return { requested: true, delivered: false, resetUrl: null, token: null };

  const raw = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(raw);
  await store.deletePasswordResetTokensForUser(user._id);
  await store.createPasswordResetToken({
    user: user._id,
    tokenHash,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000)
  });
  const resetUrl = `${appUrl.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(raw)}`;
  return { requested: true, delivered: false, resetUrl, token: raw, user };
}

export async function resetPassword(store, { token, password }) {
  const record = await store.findPasswordResetToken(hashToken(token));
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now()) {
    throw ApiError.badRequest('This reset link is invalid or has expired', { code: 'INVALID_RESET_TOKEN' });
  }
  const consumed = await store.consumePasswordResetToken(record._id);
  if (!consumed) {
    throw ApiError.badRequest('This reset link has already been used', { code: 'INVALID_RESET_TOKEN' });
  }
  const user = await store.findUserById(record.user);
  if (!user) throw ApiError.badRequest('Account no longer exists', { code: 'INVALID_RESET_TOKEN' });

  const passwordHash = await hashPassword(password);
  await store.updateUser(user._id, { passwordHash, tokenVersion: (user.tokenVersion || 0) + 1 });
  await store.revokeAllForUser(user._id);
  return { ok: true };
}

const AVATAR_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#14b8a6', '#0ea5e9', '#22c55e', '#eab308', '#ef4444'];

export function pickAvatarColor(seed) {
  let total = 0;
  for (const ch of String(seed)) total += ch.charCodeAt(0);
  return AVATAR_COLORS[total % AVATAR_COLORS.length];
}

export default {
  hashPassword,
  verifyPassword,
  registerUser,
  loginUser,
  refreshSession,
  logoutSession,
  changePassword,
  createPasswordReset,
  resetPassword
};
