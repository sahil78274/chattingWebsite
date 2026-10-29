import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../config/db.js';
import { normalizeId } from '../../utils/ids.js';
// Ensure all Mongoose models are registered before store methods access mongoose.models
import '../../models/User.js';
import '../../models/Conversation.js';
import '../../models/Message.js';
import '../../models/tokens.js';
import '../../models/AuditLog.js';

const MONGO_DUPLICATE_KEY = 11000;

/**
 * Production sets `mongoose.set('sanitizeFilter', true)` which wraps any nested
 * object whose keys start with `$` in `$eq`. That turns a legitimate
 * `{ deletedFor: { $nin: [userId] } }` into `{ deletedFor: { $eq: { $nin: [...] } } }`,
 * Mongoose then CastErrors trying to cast that object to String, and the API
 * maps every CastError to "Invalid identifier".
 *
 * Store methods only receive already-validated ids — never raw request bodies —
 * so these operators are always server-built. Mark them trusted (and disable
 * sanitizeFilter on the query) so Atlas reads keep working.
 */
function op(value) {
  return mongoose.trusted(value);
}

const NO_SANITIZE = { sanitizeFilter: false };

export class UniqueViolationError extends Error {
  constructor(message = 'Value must be unique', field) {
    super(message);
    this.name = 'UniqueViolationError';
    this.field = field;
  }
}

function duplicateField(error) {
  if (error?.code !== MONGO_DUPLICATE_KEY) return null;
  const pattern = error.keyPattern || {};
  return Object.keys(pattern)[0] || null;
}

/**
 * Store facade backed by Mongoose models (MongoDB Atlas).
 * Every method returns plain JSON objects so routes/controllers never depend on
 * Mongoose documents.
 */
export class MongoStore {
  constructor() {
    this.driver = 'mongo';
  }

  get models() {
    return mongoose.models;
  }

  async connect(uri) {
    await connectMongo(uri);
  }

  async disconnect() {
    await disconnectMongo();
  }

  async reset() {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  }

  static async guard(fn) {
    try {
      return await fn();
    } catch (error) {
      if (error?.code === MONGO_DUPLICATE_KEY) {
        throw new UniqueViolationError('Value must be unique', duplicateField(error));
      }
      throw error;
    }
  }

  static plain(doc) {
    if (!doc) return null;
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
    if (obj._id != null) obj._id = normalizeId(obj._id);
    if (obj.id == null && obj._id) obj.id = obj._id;
    else if (obj.id != null) obj.id = normalizeId(obj.id);
    if (obj.conversation != null) obj.conversation = normalizeId(obj.conversation);
    if (obj.sender != null) obj.sender = normalizeId(obj.sender);
    if (obj.user != null && typeof obj.user !== 'object') obj.user = normalizeId(obj.user);
    if (Array.isArray(obj.participants)) {
      obj.participants = obj.participants.map((participant) =>
        participant && typeof participant === 'object'
          ? { ...participant, user: participant.user != null ? normalizeId(participant.user) : participant.user }
          : participant
      );
    }
    return obj;
  }

  static many(docs) {
    return (docs || []).map((doc) => MongoStore.plain(doc));
  }

  // ---------------------------------------------------------------- users
  async createUser(data) {
    return MongoStore.guard(async () => {
      const { User } = mongoose.models;
      const user = await User.create({ ...data, usernameLower: data.username.toLowerCase() });
      return MongoStore.plain(user);
    });
  }

  async findUserById(id) {
    const str = normalizeId(id);
    if (!str) return null;
    const user = await mongoose.models.User.findById(str).lean({ virtuals: true });
    if (!user) return null;
    const plain = MongoStore.plain(user);
    return { ...plain, id: plain._id };
  }

  async findUserByIdWithSecrets(id) {
    const str = normalizeId(id);
    if (!str) return null;
    const user = await mongoose.models.User.findById(str).select('+passwordHash').lean();
    if (!user) return null;
    const plain = MongoStore.plain(user);
    return { ...plain, id: plain._id };
  }

  async findUserByUsername(username) {
    if (!username) return null;
    const user = await mongoose.models.User.findOne({ usernameLower: username.toLowerCase() })
      .select('+passwordHash')
      .lean({
        virtuals: true
      });
    if (!user) return null;
    const plain = MongoStore.plain(user);
    return { ...plain, id: plain._id };
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const user = await mongoose.models.User.findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .lean({ virtuals: true });
    if (!user) return null;
    const plain = MongoStore.plain(user);
    return { ...plain, id: plain._id };
  }

  async existsUser({ username, email }) {
    const queries = [];
    if (username) queries.push({ usernameLower: username.toLowerCase() });
    if (email) queries.push({ email: email.toLowerCase() });
    if (!queries.length) return [];
    const users = await mongoose.models.User.find({ $or: queries })
      .setOptions(NO_SANITIZE)
      .select('username email')
      .lean();
    return users.map((u) => ({
      username: u.username.toLowerCase(),
      email: u.email.toLowerCase()
    }));
  }

  async updateUser(id, patch) {
    return MongoStore.guard(async () => {
      const user = await mongoose.models.User.findByIdAndUpdate(normalizeId(id), { $set: patch }, { new: true })
        .lean({ virtuals: true });
      if (!user) return null;
      const plain = MongoStore.plain(user);
      return { ...plain, id: plain._id };
    });
  }

  async updateUsers(ids, patch) {
    const list = (ids || []).map((id) => normalizeId(id)).filter(Boolean);
    if (!list.length) return;
    await mongoose.models.User.updateMany({ _id: op({ $in: list }) }, { $set: patch }, NO_SANITIZE);
  }

  async setPresence(id, online, when = new Date()) {
    await mongoose.models.User.updateOne(
      { _id: normalizeId(id) },
      { $set: { 'presence.online': online, ...(online ? {} : { 'presence.lastSeen': when }) } }
    );
  }

  async resetPresence() {
    await mongoose.models.User.updateMany({}, { $set: { 'presence.online': false } });
  }

  async searchUsers({ query, excludeId, limit, offset }) {
    const trimmed = String(query).trim();
    if (!trimmed) return [];
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const lower = trimmed.toLowerCase();
    // Native RegExp values and explicitly trusted server-derived operators are
    // not rewritten by Mongoose's production `sanitizeFilter` protection.
    const usernamePrefix = new RegExp(`^${escaped.toLowerCase()}`);
    const filter = excludeId ? { _id: op({ $ne: normalizeId(excludeId) }) } : {};
    filter.status = 'active';
    if (/^[a-f0-9]{24}$/i.test(trimmed)) {
      filter.$or = [{ _id: lower }, { usernameLower: usernamePrefix }];
    } else {
      filter.usernameLower = usernamePrefix;
    }
    const results = await mongoose.models.User.find(filter)
      .setOptions(NO_SANITIZE)
      .sort({ usernameLower: 1 })
      .skip(offset)
      .limit(limit)
      .lean({ virtuals: true });
    return results.map((u) => {
      const plain = MongoStore.plain(u);
      return { ...plain, id: plain._id };
    });
  }

  // --------------------------------------------------------- conversations
  async createConversation(data) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Conversation.create(data);
      return MongoStore.plain(doc);
    });
  }

  async findConversationById(id) {
    const str = normalizeId(id);
    if (!str) return null;
    return MongoStore.plain(await mongoose.models.Conversation.findById(str).lean());
  }

  async findConversationByPair(pairKey) {
    return MongoStore.plain(await mongoose.models.Conversation.findOne({ pairKey }).lean());
  }

  async listConversationsForUser(userId) {
    const uid = normalizeId(userId);
    return MongoStore.many(
      await mongoose.models.Conversation.find({
        participants: op({ $elemMatch: { user: uid, hiddenAt: null } })
      })
        .setOptions(NO_SANITIZE)
        .sort({ lastMessageAt: -1 })
        .limit(200)
        .lean()
    );
  }

  async updateConversation(id, patch) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Conversation.findByIdAndUpdate(normalizeId(id), { $set: patch }, { new: true }).lean();
      return MongoStore.plain(doc);
    });
  }

  /**
   * Atomically records a new message on the conversation document and bumps the
   * unread counter of the recipient only.
   */
  async applyNewMessageToConversation(conversationId, { recipientId, senderId, message }) {
    return MongoStore.guard(async () => {
      const { Conversation } = mongoose.models;
      const createdAt = message.createdAt || new Date();
      const conversationKey = normalizeId(conversationId);
      const recipientKey = normalizeId(recipientId);
      const senderKey = normalizeId(senderId);

      // $inc with arrayFilters keeps concurrent senders from overwriting each
      // other's unread counters (a read-modify-write on the whole array would).
      await Conversation.updateOne(
        { _id: conversationKey, 'participants.user': recipientKey },
        { $inc: { 'participants.$[recipient].unreadCount': 1 } },
        { arrayFilters: [{ 'recipient.user': recipientKey }], ...NO_SANITIZE }
      );

      // A new message surfaces the thread again for both participants.
      await Conversation.updateOne(
        { _id: conversationKey },
        {
          $set: {
            'participants.$[].hiddenAt': null,
            lastMessage: {
              text: message.text.slice(0, 160),
              senderId: senderKey,
              messageId: normalizeId(message.id ?? message._id),
              createdAt
            },
            lastMessageAt: createdAt
          }
        }
      );

      const doc = await Conversation.findById(conversationKey).lean();
      return MongoStore.plain(doc);
    });
  }

  async resetUnread(conversationId, userId, at = new Date()) {
    return MongoStore.guard(async () => {
      const { Conversation } = mongoose.models;
      const conversationKey = normalizeId(conversationId);
      const userKey = normalizeId(userId);
      await Conversation.updateOne(
        { _id: conversationKey, 'participants.user': userKey },
        {
          $set: {
            'participants.$[reader].unreadCount': 0,
            'participants.$[reader].lastReadAt': at
          }
        },
        { arrayFilters: [{ 'reader.user': userKey }], ...NO_SANITIZE }
      );
      return MongoStore.plain(await Conversation.findById(conversationKey).lean());
    });
  }

  // -------------------------------------------------------------- messages
  async createMessage(data) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Message.create(data);
      return MongoStore.plain(doc);
    });
  }

  async findMessageByClientId({ conversationId, senderId, clientId }) {
    return MongoStore.plain(
      await mongoose.models.Message.findOne({
        conversation: normalizeId(conversationId),
        sender: normalizeId(senderId),
        clientId
      }).lean()
    );
  }

  async findMessageById(id) {
    const str = normalizeId(id);
    if (!str) return null;
    return MongoStore.plain(await mongoose.models.Message.findById(str).lean());
  }

  async listMessages({ conversationId, limit, before, beforeId, viewerId }) {
    const filter = { conversation: normalizeId(conversationId) };
    if (viewerId) filter.deletedFor = op({ $nin: [normalizeId(viewerId)] });
    if (before) {
      const boundary = new Date(before);
      const beforeKey = beforeId ? normalizeId(beforeId) : '';
      filter.$or = op(
        beforeKey
          ? [{ createdAt: { $lt: boundary } }, { createdAt: boundary, _id: { $lt: beforeKey } }]
          : [{ createdAt: { $lt: boundary } }]
      );
    }
    const docs = await mongoose.models.Message.find(filter)
      .setOptions(NO_SANITIZE)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .lean();
    return MongoStore.many(docs).reverse();
  }

  async updateMessage(id, patch) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Message.findByIdAndUpdate(normalizeId(id), { $set: patch }, { new: true }).lean();
      return MongoStore.plain(doc);
    });
  }

  async updateMessages(filter, patch) {
    return MongoStore.guard(async () => {
      const result = await mongoose.models.Message.updateMany(filter, { $set: patch }, NO_SANITIZE);
      return result.modifiedCount ?? 0;
    });
  }

  async markDeliveredToUser({ conversationId, recipientId }) {
    return this.updateMessages(
      {
        conversation: normalizeId(conversationId),
        sender: op({ $ne: normalizeId(recipientId) }),
        deliveredAt: null
      },
      { deliveredAt: new Date() }
    );
  }

  async markReadByUser({ conversationId, readerId, at = new Date() }) {
    return MongoStore.guard(async () => {
      const result = await mongoose.models.Message.updateMany(
        {
          conversation: normalizeId(conversationId),
          sender: op({ $ne: normalizeId(readerId) }),
          $or: op([{ readAt: null }, { readAt: { $exists: false } }])
        },
        { $set: { readAt: at, deliveredAt: at } },
        NO_SANITIZE
      );
      return result.modifiedCount ?? 0;
    });
  }

  async countUnreadForUser({ conversationId, userId }) {
    const userKey = normalizeId(userId);
    return mongoose.models.Message.countDocuments(
      {
        conversation: normalizeId(conversationId),
        sender: op({ $ne: userKey }),
        readAt: null,
        deletedAt: null,
        deletedFor: op({ $nin: [userKey] })
      },
      NO_SANITIZE
    );
  }

  async listUsersAdmin({ query = '', status = 'all', limit = 20, offset = 0 }) {
    const filter = {};
    if (status && status !== 'all') filter.status = status;
    const trimmed = String(query || '').trim();
    if (trimmed) {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const prefix = new RegExp(`^${escaped.toLowerCase()}`);
      const fuzzy = new RegExp(escaped, 'i');
      filter.$or = [{ usernameLower: prefix }, { displayName: fuzzy }, { email: trimmed.toLowerCase() }];
    }
    const users = await mongoose.models.User.find(filter)
      .setOptions(NO_SANITIZE)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean({ virtuals: true });
    const total = await mongoose.models.User.countDocuments(filter, NO_SANITIZE);
    return {
      users: users.map((u) => {
        const plain = MongoStore.plain(u);
        return { ...plain, id: plain._id };
      }),
      total
    };
  }

  async countUsersByStatus() {
    const [total, active, suspended, admins] = await Promise.all([
      mongoose.models.User.countDocuments({ status: op({ $ne: 'deleted' }) }, NO_SANITIZE),
      mongoose.models.User.countDocuments({ status: 'active' }),
      mongoose.models.User.countDocuments({ status: 'suspended' }),
      mongoose.models.User.countDocuments({ role: 'admin', status: 'active' })
    ]);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = await mongoose.models.User.countDocuments(
      {
        createdAt: op({ $gte: since }),
        status: op({ $ne: 'deleted' })
      },
      NO_SANITIZE
    );
    return { total, active, suspended, admins, recent };
  }

  async countActiveAdmins() {
    return mongoose.models.User.countDocuments({ role: 'admin', status: 'active' });
  }

  async createAuditLog(data) {
    const doc = await mongoose.models.AuditLog.create(data);
    return MongoStore.plain(doc);
  }

  async listAuditLogs({ limit = 30, offset = 0 }) {
    const rows = await mongoose.models.AuditLog.find({})
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();
    const total = await mongoose.models.AuditLog.countDocuments({});
    return { logs: MongoStore.many(rows), total };
  }

  // ---------------------------------------------------------------- blocks
  async createBlock(blockerId, blockedId) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Block.create({ blocker: blockerId, blocked: blockedId });
      return MongoStore.plain(doc);
    });
  }

  async deleteBlock(blockerId, blockedId) {
    await mongoose.models.Block.deleteOne({ blocker: blockerId, blocked: blockedId });
  }

  async findBlock(blockerId, blockedId) {
    return MongoStore.plain(await mongoose.models.Block.findOne({ blocker: blockerId, blocked: blockedId }).lean());
  }

  async isBlockedEitherWay(a, b) {
    const left = normalizeId(a);
    const right = normalizeId(b);
    const block = await mongoose.models.Block.findOne({
      $or: [
        { blocker: left, blocked: right },
        { blocker: right, blocked: left }
      ]
    })
      .setOptions(NO_SANITIZE)
      .lean();
    return Boolean(block);
  }

  async listBlockedUsers(userId) {
    const blocks = await mongoose.models.Block.find({ blocker: normalizeId(userId) }).lean();
    return blocks.map((b) => normalizeId(b.blocked));
  }

  // --------------------------------------------------------------- reports
  async createReport(data) {
    const doc = await mongoose.models.Report.create(data);
    return MongoStore.plain(doc);
  }

  // ---------------------------------------------------------- refresh tokens
  async createRefreshToken(data) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.RefreshToken.create(data);
      return MongoStore.plain(doc);
    });
  }

  async findRefreshTokenByHash(hash) {
    return MongoStore.plain(await mongoose.models.RefreshToken.findOne({ tokenHash: hash }).lean());
  }

  async revokeRefreshToken(hash, replacedByHash = null, revokedAt = new Date()) {
    await mongoose.models.RefreshToken.updateOne(
      { tokenHash: hash, revokedAt: null },
      { $set: { revokedAt, replacedByHash } }
    );
  }

  async revokeTokenFamily(familyId) {
    await mongoose.models.RefreshToken.updateMany(
      { familyId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  async revokeAllForUser(userId) {
    await mongoose.models.RefreshToken.updateMany(
      { user: userId, revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  // ---------------------------------------------------------- reset tokens
  async createPasswordResetToken(data) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.PasswordResetToken.create(data);
      return MongoStore.plain(doc);
    });
  }

  async findPasswordResetToken(hash) {
    return MongoStore.plain(
      await mongoose.models.PasswordResetToken.findOne({ tokenHash: hash }).lean()
    );
  }

  async consumePasswordResetToken(id, when = new Date()) {
    const result = await mongoose.models.PasswordResetToken.updateOne(
      { _id: id, usedAt: null },
      { $set: { usedAt: when } }
    );
    return (result.modifiedCount ?? 0) > 0;
  }

  async deletePasswordResetTokensForUser(userId) {
    await mongoose.models.PasswordResetToken.deleteMany({ user: userId, usedAt: null });
  }
}

export default MongoStore;
