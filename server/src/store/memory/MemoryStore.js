import { UniqueViolationError } from '../mongo/MongoStore.js';
import { newId } from '../../utils/ids.js';

/**
 * In-memory implementation of the store facade.
 *
 * Why it exists: it lets the app (and the automated test suite) run end-to-end
 * on a machine that has no reachable MongoDB server, and it is used as an
 * explicit demo mode only when MONGODB_URI is not configured. MongoDB Atlas via
 * `MongoStore` is the production data path; both expose the same API and are
 * exercised by the same tests (`DB_DRIVER=memory` and `DB_DRIVER=mongo`).
 *
 * Data lives in process memory and is lost on restart - never use it in
 * production (the server logs a loud warning when it does).
 */
const clone = (value) => (value === undefined ? undefined : structuredClone(value));

const collator = new Intl.Collator('en', { sensitivity: 'base' });

function matchMessage(msg, filter) {
  if (filter.conversation && msg.conversation !== filter.conversation) return false;
  if (filter.sender && typeof filter.sender === 'object') {
    if (filter.sender.$ne && msg.sender === filter.sender.$ne) return false;
  } else if (filter.sender && msg.sender !== filter.sender) return false;
  if (filter.deliveredAt === null && msg.deliveredAt !== null) return false;
  if (filter.readAt === null && msg.readAt !== null) return false;
  if (filter.createdAt?.$lt && !(new Date(msg.createdAt) < new Date(filter.createdAt.$lt))) return false;
  if (filter.createdAt?.$lte && !(new Date(msg.createdAt) <= new Date(filter.createdAt.$lte))) return false;
  if (filter.$or && !filter.$or.some((clause) => matchMessage(msg, clause))) return false;
  return true;
}

export class MemoryStore {
  constructor() {
    this.driver = 'memory';
    this.users = new Map();
    this.conversations = new Map();
    this.messages = new Map();
    this.blocks = new Map();
    this.reports = new Map();
    this.refreshTokens = new Map();
    this.passwordResetTokens = new Map();
  }

  async connect() {
    /* nothing to do */
  }

  async disconnect() {
    /* nothing to do */
  }

  async reset() {
    for (const map of [
      this.users,
      this.conversations,
      this.messages,
      this.blocks,
      this.reports,
      this.refreshTokens,
      this.passwordResetTokens
    ]) {
      map.clear();
    }
  }

  _assertUniqueUser(user, ignoreId = null) {
    for (const existing of this.users.values()) {
      if (existing._id === ignoreId) continue;
      if (existing.usernameLower === user.usernameLower.toLowerCase()) {
        throw new UniqueViolationError('Username is already taken', 'usernameLower');
      }
      if (existing.email === user.email.toLowerCase()) {
        throw new UniqueViolationError('Email is already registered', 'email');
      }
    }
  }

  // ---------------------------------------------------------------- users
  async createUser(data) {
    const now = new Date();
    const user = {
      _id: data._id || newId(),
      bio: '',
      avatarUrl: '',
      avatarColor: '#6366f1',
      privacy: { lastSeen: 'everyone' },
      presence: { online: false, lastSeen: now },
      tokenVersion: 0,
      ...clone(data),
      usernameLower: data.username.toLowerCase(),
      email: data.email.toLowerCase(),
      createdAt: now,
      updatedAt: now
    };
    this._assertUniqueUser(user);
    this.users.set(user._id, user);
    return clone(user);
  }

  async findUserById(id) {
    return clone(this.users.get(id) || null);
  }

  async findUserByIdWithSecrets(id) {
    return clone(this.users.get(id) || null);
  }

  async findUserByUsername(username) {
    if (!username) return null;
    const lower = username.toLowerCase();
    for (const user of this.users.values()) {
      if (user.usernameLower === lower) return clone(user);
    }
    return null;
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const lower = email.toLowerCase();
    for (const user of this.users.values()) {
      if (user.email === lower) return clone(user);
    }
    return null;
  }

  async existsUser({ username, email }) {
    const found = [];
    for (const user of this.users.values()) {
      if (username && user.usernameLower === username.toLowerCase()) {
        found.push({ username: user.usernameLower, email: user.email });
      } else if (email && user.email === email.toLowerCase()) {
        found.push({ username: user.usernameLower, email: user.email });
      }
    }
    return found;
  }

  async updateUser(id, patch) {
    const user = this.users.get(id);
    if (!user) return null;
    const next = { ...user, ...clone(patch), updatedAt: new Date() };
    if (patch.username) next.usernameLower = patch.username.toLowerCase();
    if (patch.username || patch.email) this._assertUniqueUser(next, id);
    this.users.set(id, next);
    return clone(next);
  }

  async updateUsers(ids, patch) {
    for (const id of ids) {
      const user = this.users.get(id);
      if (user) this.users.set(id, { ...user, ...clone(patch), updatedAt: new Date() });
    }
  }

  async setPresence(id, online, when = new Date()) {
    const user = this.users.get(id);
    if (!user) return;
    user.presence = { online, lastSeen: online ? user.presence?.lastSeen ?? when : when };
  }

  async resetPresence() {
    for (const user of this.users.values()) user.presence = { ...user.presence, online: false };
  }

  async searchUsers({ query, excludeId, limit, offset }) {
    const needle = String(query).toLowerCase();
    const isId = /^[a-f0-9]{24}$/i.test(needle);
    const matches = [...this.users.values()].filter((user) => {
      if (user._id === excludeId) return false;
      if (isId && user._id === needle) return true;
      return user.usernameLower.startsWith(needle);
    });
    matches.sort((a, b) => collator.compare(a.usernameLower, b.usernameLower));
    return clone(matches.slice(offset, offset + limit));
  }

  // --------------------------------------------------------- conversations
  async createConversation(data) {
    for (const existing of this.conversations.values()) {
      if (existing.pairKey === data.pairKey) {
        throw new UniqueViolationError('Conversation already exists', 'pairKey');
      }
    }
    const now = new Date();
    const conversation = {
      lastMessage: { text: '', senderId: null, messageId: null, createdAt: null },
      lastMessageAt: now,
      ...clone(data),
      createdAt: now,
      updatedAt: now
    };
    this.conversations.set(conversation._id, conversation);
    return clone(conversation);
  }

  async findConversationById(id) {
    return clone(this.conversations.get(id) || null);
  }

  async findConversationByPair(pairKey) {
    for (const conversation of this.conversations.values()) {
      if (conversation.pairKey === pairKey) return clone(conversation);
    }
    return null;
  }

  async listConversationsForUser(userId) {
    const list = [...this.conversations.values()].filter((conversation) =>
      conversation.participants.some((p) => p.user === userId && !p.hiddenAt)
    );
    list.sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));
    return clone(list.slice(0, 200));
  }

  async updateConversation(id, patch) {
    const conversation = this.conversations.get(id);
    if (!conversation) return null;
    const next = { ...conversation, ...clone(patch), updatedAt: new Date() };
    this.conversations.set(id, next);
    return clone(next);
  }

  async applyNewMessageToConversation(conversationId, { recipientId, senderId, message }) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    const participants = conversation.participants.map((p) => ({
      ...p,
      unreadCount: p.user === recipientId ? (p.unreadCount || 0) + 1 : p.unreadCount || 0,
      hiddenAt: null
    }));
    const next = {
      ...conversation,
      participants,
      lastMessage: {
        text: message.text.slice(0, 160),
        senderId,
        messageId: message.id ?? message._id,
        createdAt: message.createdAt
      },
      lastMessageAt: new Date(message.createdAt),
      updatedAt: new Date()
    };
    this.conversations.set(conversationId, next);
    return clone(next);
  }

  async resetUnread(conversationId, userId, at = new Date()) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return null;
    conversation.participants = conversation.participants.map((p) =>
      p.user === userId ? { ...p, unreadCount: 0, lastReadAt: at } : p
    );
    this.conversations.set(conversationId, conversation);
    return clone(conversation);
  }

  // -------------------------------------------------------------- messages
  async createMessage(data) {
    for (const message of this.messages.values()) {
      if (
        data.clientId &&
        message.conversation === data.conversation &&
        message.sender === data.sender &&
        message.clientId === data.clientId
      ) {
        throw new UniqueViolationError('Duplicate message', 'clientId');
      }
    }
    const message = {
      clientId: null,
      deliveredAt: null,
      readAt: null,
      editedAt: null,
      ...clone(data),
      _id: data._id || newId(),
      createdAt: data.createdAt ? new Date(data.createdAt) : new Date()
    };
    this.messages.set(message._id, message);
    return clone(message);
  }

  async findMessageByClientId({ conversationId, senderId, clientId }) {
    for (const message of this.messages.values()) {
      if (
        message.conversation === conversationId &&
        message.sender === senderId &&
        message.clientId === clientId
      ) {
        return clone(message);
      }
    }
    return null;
  }

  async findMessageById(id) {
    return clone(this.messages.get(id) || null);
  }

  async listMessages({ conversationId, limit, before, beforeId }) {
    const beforeTime = before ? new Date(before).getTime() : null;
    const list = [...this.messages.values()]
      .filter((message) => {
        if (message.conversation !== conversationId) return false;
        if (beforeTime === null) return true;
        const time = new Date(message.createdAt).getTime();
        if (time < beforeTime) return true;
        return Boolean(beforeId) && time === beforeTime && message._id < beforeId;
      })
      .sort((a, b) => {
        const delta = new Date(a.createdAt) - new Date(b.createdAt);
        return delta !== 0 ? delta : a._id < b._id ? -1 : 1;
      });
    return clone(list.slice(-limit));
  }

  async updateMessages(filter, patch) {
    let updated = 0;
    for (const [id, message] of this.messages.entries()) {
      if (filter.conversation && message.conversation !== filter.conversation) continue;
      if (filter.sender?.$ne && message.sender === filter.sender.$ne) continue;
      if (filter.deliveredAt === null && message.deliveredAt !== null) continue;
      if (filter.readAt === null && message.readAt !== null) continue;
      if (filter.$or && !filter.$or.some((clause) => matchMessage(message, clause))) continue;
      this.messages.set(id, { ...message, ...clone(patch) });
      updated += 1;
    }
    return updated;
  }

  async markDeliveredToUser({ conversationId, recipientId }) {
    return this.updateMessages(
      { conversation: conversationId, sender: { $ne: recipientId }, deliveredAt: null },
      { deliveredAt: new Date() }
    );
  }

  async markReadByUser({ conversationId, readerId, at = new Date() }) {
    return this.updateMessages(
      { conversation: conversationId, sender: { $ne: readerId }, readAt: null },
      { readAt: at, deliveredAt: at }
    );
  }

  async countUnreadForUser({ conversationId, userId }) {
    let count = 0;
    for (const message of this.messages.values()) {
      if (message.conversation === conversationId && message.sender !== userId && message.readAt === null) {
        count += 1;
      }
    }
    return count;
  }

  // ---------------------------------------------------------------- blocks
  async createBlock(blockerId, blockedId) {
    for (const block of this.blocks.values()) {
      if (block.blocker === blockerId && block.blocked === blockedId) {
        throw new UniqueViolationError('Already blocked', 'block');
      }
    }
    const id = newId();
    const block = { _id: id, blocker: blockerId, blocked: blockedId, createdAt: new Date() };
    this.blocks.set(id, block);
    return clone(block);
  }

  async deleteBlock(blockerId, blockedId) {
    for (const [id, block] of this.blocks.entries()) {
      if (block.blocker === blockerId && block.blocked === blockedId) this.blocks.delete(id);
    }
  }

  async findBlock(blockerId, blockedId) {
    for (const block of this.blocks.values()) {
      if (block.blocker === blockerId && block.blocked === blockedId) return clone(block);
    }
    return null;
  }

  async isBlockedEitherWay(a, b) {
    for (const block of this.blocks.values()) {
      if (
        (block.blocker === a && block.blocked === b) ||
        (block.blocker === b && block.blocked === a)
      ) {
        return true;
      }
    }
    return false;
  }

  async listBlockedUsers(userId) {
    return [...this.blocks.values()].filter((b) => b.blocker === userId).map((b) => b.blocked);
  }

  // --------------------------------------------------------------- reports
  async createReport(data) {
    const id = newId();
    const report = {
      _id: id,
      status: 'open',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...clone(data)
    };
    this.reports.set(id, report);
    return clone(report);
  }

  // ---------------------------------------------------------- refresh tokens
  async createRefreshToken(data) {
    const id = newId();
    const token = { _id: id, revokedAt: null, replacedByHash: null, createdAt: new Date(), ...clone(data) };
    this.refreshTokens.set(id, token);
    return clone(token);
  }

  async findRefreshTokenByHash(hash) {
    for (const token of this.refreshTokens.values()) {
      if (token.tokenHash === hash) return clone(token);
    }
    return null;
  }

  async revokeRefreshToken(hash, replacedByHash = null, revokedAt = new Date()) {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.tokenHash === hash && !token.revokedAt) {
        this.refreshTokens.set(id, { ...token, revokedAt, replacedByHash });
      }
    }
  }

  async revokeTokenFamily(familyId) {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.familyId === familyId && !token.revokedAt) {
        this.refreshTokens.set(id, { ...token, revokedAt: new Date() });
      }
    }
  }

  async revokeAllForUser(userId) {
    for (const [id, token] of this.refreshTokens.entries()) {
      if (token.user === userId && !token.revokedAt) {
        this.refreshTokens.set(id, { ...token, revokedAt: new Date() });
      }
    }
  }

  // ---------------------------------------------------------- reset tokens
  async createPasswordResetToken(data) {
    const id = newId();
    const token = { _id: id, usedAt: null, createdAt: new Date(), ...clone(data) };
    this.passwordResetTokens.set(id, token);
    return clone(token);
  }

  async findPasswordResetToken(hash) {
    for (const token of this.passwordResetTokens.values()) {
      if (token.tokenHash === hash) return clone(token);
    }
    return null;
  }

  async consumePasswordResetToken(id, when = new Date()) {
    const token = this.passwordResetTokens.get(id);
    if (!token || token.usedAt) return false;
    this.passwordResetTokens.set(id, { ...token, usedAt: when });
    return true;
  }

  async deletePasswordResetTokensForUser(userId) {
    for (const [id, token] of this.passwordResetTokens.entries()) {
      if (token.user === userId && !token.usedAt) this.passwordResetTokens.delete(id);
    }
  }
}

export default MemoryStore;
