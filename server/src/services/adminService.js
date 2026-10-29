import config from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { hashPassword } from './authService.js';
import { adminUser } from '../utils/serialize.js';
import { sanitizeText } from '../utils/validation.js';
import logger from '../utils/logger.js';

function serializeAudit(log) {
  return {
    id: log._id || log.id,
    actor: log.actor,
    action: log.action,
    targetUser: log.targetUser || null,
    metadata: log.metadata || {},
    createdAt: log.createdAt
  };
}

async function writeAudit(store, { actor, action, targetUser = null, metadata = {} }) {
  try {
    await store.createAuditLog({ actor, action, targetUser, metadata });
  } catch (error) {
    logger.error('Failed to write audit log', { action, error: error.message });
  }
}

async function loadTarget(store, userId) {
  const user = await store.findUserById(userId);
  if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
  return user;
}

async function guardLastAdmin(store, user) {
  if (user.role === 'admin' && (user.status || 'active') === 'active') {
    const count = await store.countActiveAdmins();
    if (count <= 1) {
      throw ApiError.forbidden('The last active administrator cannot be removed or demoted', {
        code: 'LAST_ADMIN'
      });
    }
  }
}

/**
 * Promote an existing account listed in BOOTSTRAP_ADMIN_USERNAME / EMAIL.
 * Never creates a user and never accepts a password from the environment.
 */
export async function bootstrapAdmin(store) {
  const username = String(config.admin.bootstrapUsername || '').trim();
  const email = String(config.admin.bootstrapEmail || '').trim().toLowerCase();
  if (!username && !email) return null;

  const user = username
    ? await store.findUserByUsername(username)
    : await store.findUserByEmail(email);
  if (!user) {
    logger.warn('Admin bootstrap skipped: no matching user. Register the account first, then restart.');
    return null;
  }
  if (user.role === 'admin') return user;

  const updated = await store.updateUser(user._id, { role: 'admin' });
  await writeAudit(store, {
    actor: user._id,
    action: 'admin.bootstrap',
    targetUser: user._id,
    metadata: { via: username ? 'username' : 'email' }
  });
  logger.info('Bootstrapped administrator from environment', { userId: user._id });
  return updated;
}

export async function adminOverview(store) {
  const counts = await store.countUsersByStatus();
  const { logs, total } = await store.listAuditLogs({ limit: 25, offset: 0 });
  return { counts, recentAudit: logs.map(serializeAudit), auditTotal: total };
}

export async function listAdminUsers(store, { q = '', page = 1, limit = 20, status = 'all' }) {
  const offset = (page - 1) * limit;
  const { users, total } = await store.listUsersAdmin({ query: q, status, limit, offset });
  return {
    users: users.map(adminUser),
    total,
    page,
    pageSize: limit,
    hasMore: offset + users.length < total
  };
}

export async function listAudit(store, { page = 1, limit = 30 } = {}) {
  const offset = (page - 1) * limit;
  const { logs, total } = await store.listAuditLogs({ limit, offset });
  return {
    logs: logs.map(serializeAudit),
    total,
    page,
    pageSize: limit,
    hasMore: offset + logs.length < total
  };
}

export async function createAdminUser(store, actorId, data) {
  const existing = await store.existsUser({ username: data.username, email: data.email });
  const usernameTaken = existing.some((row) => row.username === data.username.toLowerCase());
  const emailTaken = existing.some((row) => row.email === data.email.toLowerCase());
  if (usernameTaken || emailTaken) {
    const details = {};
    if (usernameTaken) details.username = 'This username is already taken.';
    if (emailTaken) details.email = 'An account with this email already exists';
    throw new ApiError(409, usernameTaken ? 'This username is already taken.' : 'That account already exists', {
      code: usernameTaken ? 'USERNAME_TAKEN' : 'ACCOUNT_EXISTS',
      details
    });
  }

  const displayName = sanitizeText(data.displayName || data.username).slice(0, 48) || data.username;
  const user = await store.createUser({
    username: data.username,
    usernameLower: data.username.toLowerCase(),
    email: data.email,
    passwordHash: await hashPassword(data.password),
    displayName,
    role: data.role === 'admin' ? 'admin' : 'user',
    status: 'active'
  });
  await writeAudit(store, {
    actor: actorId,
    action: 'admin.user.create',
    targetUser: user._id,
    metadata: { username: user.username, role: user.role }
  });
  logger.info('Admin created a user', { actorId, userId: user._id });
  return adminUser(user);
}

export async function setUserStatus(store, actorId, userId, status) {
  const user = await loadTarget(store, userId);
  if (status !== 'active') await guardLastAdmin(store, user);
  if (actorId === userId && status !== 'active') {
    throw ApiError.forbidden('You cannot suspend or delete your own account', { code: 'SELF_MODIFY' });
  }

  const patch = { status };
  if (status === 'suspended' || status === 'deleted') {
    patch.tokenVersion = (user.tokenVersion || 0) + 1;
  }
  if (status === 'deleted') {
    patch.avatarUrl = '';
  }

  const updated = await store.updateUser(userId, patch);
  await store.revokeAllForUser(userId).catch(() => {});

  const action =
    status === 'active' ? 'admin.user.reactivate' : status === 'suspended' ? 'admin.user.suspend' : 'admin.user.delete';
  await writeAudit(store, {
    actor: actorId,
    action,
    targetUser: userId,
    metadata: { from: user.status || 'active', to: status }
  });
  return adminUser(updated);
}

export async function setUserRole(store, actorId, userId, role) {
  const user = await loadTarget(store, userId);
  if (user.role === 'admin' && role !== 'admin') await guardLastAdmin(store, user);
  if (actorId === userId) {
    throw ApiError.forbidden('You cannot change your own role', { code: 'SELF_MODIFY' });
  }
  const updated = await store.updateUser(userId, { role });
  await writeAudit(store, {
    actor: actorId,
    action: 'admin.user.role',
    targetUser: userId,
    metadata: { from: user.role || 'user', to: role }
  });
  return adminUser(updated);
}

export default {
  bootstrapAdmin,
  adminOverview,
  listAdminUsers,
  listAudit,
  createAdminUser,
  setUserStatus,
  setUserRole
};
