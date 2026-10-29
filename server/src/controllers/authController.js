import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { getStore } from '../store/index.js';
import {
  changePassword,
  createPasswordReset,
  loginUser,
  logoutSession,
  refreshSession,
  registerUser,
  resetPassword
} from '../services/authService.js';
import {
  avatarColorSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  parseOrThrow,
  registerSchema,
  resetPasswordSchema,
  sanitizeText,
  updateProfileSchema
} from '../utils/validation.js';
import { selfUser } from '../utils/serialize.js';
import {
  clearAccessCookie,
  clearRefreshCookie,
  setAccessCookie,
  setRefreshCookie
} from '../utils/tokens.js';
import { mailConfigured, sendPasswordResetEmail } from '../utils/mailer.js';
import { saveAvatar } from '../services/media.js';
import logger from '../utils/logger.js';

function meta(req) {
  return { userAgent: req.headers['user-agent'] || '' };
}

function attachSession(res, { accessToken, refreshToken }) {
  setRefreshCookie(res, refreshToken);
  setAccessCookie(res, accessToken);
}

export async function register(req, res) {
  const data = parseOrThrow(registerSchema, req.body, ApiError);
  const store = getStore();
  const result = await registerUser(store, data, meta(req));
  attachSession(res, result);
  logger.info('User registered', { userId: result.user._id });
  res.status(201).json({ user: selfUser(result.user), accessToken: result.accessToken });
}

export async function login(req, res) {
  const data = parseOrThrow(loginSchema, req.body, ApiError);
  const store = getStore();
  const result = await loginUser(store, { ...data, identifier: data.identifier.trim() }, meta(req));
  if (result.user.tokenVersion == null) result.user.tokenVersion = 0;
  attachSession(res, result);
  logger.info('User logged in', { userId: result.user._id });
  res.json({ user: selfUser(result.user), accessToken: result.accessToken });
}

export async function refresh(req, res) {
  const store = getStore();
  const raw = req.cookies?.[config.cookies.refreshName] || req.body?.refreshToken;
  const result = await refreshSession(store, raw, meta(req));
  if (result.user.tokenVersion == null) result.user.tokenVersion = 0;
  attachSession(res, result);
  res.json({ user: selfUser(result.user), accessToken: result.accessToken });
}

export async function logout(req, res) {
  const store = getStore();
  const raw = req.cookies?.[config.cookies.refreshName];
  await logoutSession(store, raw);
  clearRefreshCookie(res);
  clearAccessCookie(res);
  res.json({ ok: true });
}

export async function logoutAll(req, res) {
  const store = getStore();
  await store.revokeAllForUser(req.user._id);
  await store.updateUser(req.user._id, { tokenVersion: (req.user.tokenVersion || 0) + 1 });
  clearRefreshCookie(res);
  clearAccessCookie(res);
  logger.info('All sessions revoked', { userId: req.user._id });
  res.json({ ok: true });
}

export async function me(req, res) {
  // Fetch a fresh copy so presence/lastSeen reflect the latest state.
  const user = await getStore().findUserById(req.user._id);
  res.json({ user: selfUser(user) });
}

export async function updateProfile(req, res) {
  const store = getStore();
  const data = parseOrThrow(updateProfileSchema, req.body, ApiError);
  const patch = {};

  if (data.displayName !== undefined) patch.displayName = sanitizeText(data.displayName);
  if (data.bio !== undefined) patch.bio = sanitizeText(data.bio);
  if (data.avatarUrl !== undefined) {
    // Only allow clearing the picture or pointing at our own upload endpoint.
    if (data.avatarUrl) {
      const fromUploads = data.avatarUrl.startsWith(`${config.uploads.publicPath}/`);
      const fromS3 = Boolean(config.s3.publicBaseUrl) && data.avatarUrl.startsWith(config.s3.publicBaseUrl);
      if (!fromUploads && !fromS3) {
        throw ApiError.badRequest('Invalid avatar URL', { code: 'INVALID_AVATAR' });
      }
    }
    patch.avatarUrl = data.avatarUrl;
  }
  if (data.privacy?.lastSeen) patch.privacy = { lastSeen: data.privacy.lastSeen };

  const updated = await store.updateUser(req.user._id, patch);
  res.json({ user: selfUser(updated) });
}

export async function uploadAvatar(req, res, next) {
  try {
    if (!req.file?.buffer) throw ApiError.badRequest('Please choose an image to upload', { code: 'NO_FILE' });
    const stored = await saveAvatar({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      userId: req.user._id
    });
    const updated = await getStore().updateUser(req.user._id, { avatarUrl: stored.url });
    res.status(201).json({ user: selfUser(updated), avatarUrl: stored.url });
  } catch (error) {
    next(error);
  }
}

export async function setAvatarColor(req, res) {
  const color = parseOrThrow(avatarColorSchema, req.body?.avatarColor, ApiError);
  const updated = await getStore().updateUser(req.user._id, { avatarColor: color, avatarUrl: '' });
  res.json({ user: selfUser(updated) });
}

export async function updatePassword(req, res) {
  const data = parseOrThrow(changePasswordSchema, req.body, ApiError);
  await changePassword(getStore(), req.user, data);
  clearRefreshCookie(res);
  clearAccessCookie(res);
  res.json({ ok: true, message: 'Password updated. Please sign in again.' });
}

export async function forgotPassword(req, res) {
  const { email } = parseOrThrow(forgotPasswordSchema, req.body, ApiError);
  const store = getStore();
  const result = await createPasswordReset(store, email, { appUrl: config.appUrl });

  let delivered = false;
  if (result.user && mailConfigured() && result.resetUrl) {
    try {
      const mail = await sendPasswordResetEmail({
        to: result.user.email,
        username: result.user.displayName || result.user.username,
        resetUrl: result.resetUrl
      });
      delivered = mail.delivered;
    } catch (error) {
      logger.error('Failed to send password reset email', { error: error.message });
    }
  }

  const body = {
    ok: true,
    message: 'If an account exists for that email, a reset link has been created.',
    emailDelivery: delivered ? 'sent' : mailConfigured() ? 'failed' : 'not_configured'
  };

  // Without SMTP the link can only be surfaced safely outside production.
  if (!delivered && !config.isProd && result.resetUrl) {
    body.devResetUrl = result.resetUrl;
    body.message =
      'Email delivery is not configured, so the reset link is returned here for local development only.';
  }

  res.json(body);
}

export async function resetPasswordHandler(req, res) {
  const data = parseOrThrow(resetPasswordSchema, req.body, ApiError);
  await resetPassword(getStore(), data);
  clearRefreshCookie(res);
  clearAccessCookie(res);
  res.json({ ok: true, message: 'Password reset. You can now sign in.' });
}
