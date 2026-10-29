import ApiError from '../utils/ApiError.js';
import { getStore } from '../store/index.js';
import { parseOrThrow, parseId, searchSchema } from '../utils/validation.js';
import { publicUser } from '../utils/serialize.js';
import { searchUsersForViewer } from '../services/chatService.js';
import config from '../config/env.js';

export async function searchUsers(req, res) {
  const { q, page, limit } = parseOrThrow(searchSchema, req.query, ApiError);
  const cappedLimit = Math.min(limit, config.limits.searchPageSize);
  const data = await searchUsersForViewer(getStore(), {
    query: q,
    viewerId: req.user._id,
    page,
    limit: cappedLimit
  });
  res.json(data);
}

export async function getUser(req, res) {
  const id = parseId(req.params.userId, ApiError);
  const user = await getStore().findUserById(id);
  if (!user) throw ApiError.notFound('User not found', { code: 'USER_NOT_FOUND' });
  const store = getStore();
  const blockedByMe = Boolean(await store.findBlock(req.user._id, id));
  const blockedMe = Boolean(await store.findBlock(id, req.user._id));
  res.json({ user: publicUser(user), blockedByMe, blockedMe });
}

export async function getConfig(_req, res) {
  res.json({
    brand: config.brand,
    appUrl: config.appUrl,
    mailConfigured: config.mail.configured,
    limits: {
      messageMaxLength: config.limits.messageMaxLength,
      avatarMaxBytes: config.limits.avatarMaxBytes,
      searchPageSize: config.limits.searchPageSize
    }
  });
}
