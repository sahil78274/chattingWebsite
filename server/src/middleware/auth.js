import ApiError from '../utils/ApiError.js';
import { extractAccessToken, verifyAccessToken } from '../utils/tokens.js';
import { getStore } from '../store/index.js';

async function resolveUser(token) {
  const payload = verifyAccessToken(token);
  const user = await getStore().findUserById(payload.sub);
  if (!user) throw ApiError.unauthorized('Account no longer exists', { code: 'ACCOUNT_MISSING' });
  if ((user.tokenVersion || 0) !== (payload.tokenVersion || 0)) {
    throw ApiError.unauthorized('Session is no longer valid, please sign in again', {
      code: 'SESSION_REVOKED'
    });
  }
  return user;
}

/** Requires a valid access token (Authorization: Bearer ... or the SPA cookie). */
export async function requireAuth(req, res, next) {
  try {
    const token = extractAccessToken(req);
    if (!token) throw ApiError.unauthorized('Please sign in to continue', { code: 'NO_TOKEN' });
    req.user = await resolveUser(token);
    next();
  } catch (error) {
    next(error);
  }
}

/** Attaches req.user when a valid token is present, otherwise continues anonymously. */
export async function optionalAuth(req, res, next) {
  try {
    const token = extractAccessToken(req);
    if (token) req.user = await resolveUser(token);
  } catch {
    // Ignore invalid tokens for optional routes.
  }
  next();
}

export async function requireSameUser(req, res, next) {
  if (!req.user) return next(ApiError.unauthorized('Please sign in to continue'));
  if (req.user._id !== req.params.userId) {
    return next(ApiError.forbidden('You can only access your own account'));
  }
  return next();
}

export default { requireAuth, optionalAuth, requireSameUser };
