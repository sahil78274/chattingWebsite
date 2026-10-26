import mongoose from 'mongoose';
import { connectMongo, disconnectMongo } from '../../config/db.js';
// Ensure all Mongoose models are registered before store methods access mongoose.models
import '../../models/User.js';
import '../../models/Conversation.js';
import '../../models/Message.js';
import '../../models/tokens.js';

const MONGO_DUPLICATE_KEY = 11000;

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
    return typeof doc.toObject === 'function' ? doc.toObject() : doc;
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
    if (!id) return null;
    const user = await mongoose.models.User.findById(id).lean({ virtuals: true });
    return user ? { ...user, id: user._id } : null;
  }

  async findUserByIdWithSecrets(id) {
    if (!id) return null;
    const user = await mongoose.models.User.findById(id).select('+passwordHash').lean();
    return user ? { ...user, id: user._id } : null;
  }

  async findUserByUsername(username) {
    if (!username) return null;
    const user = await mongoose.models.User.findOne({ usernameLower: username.toLowerCase() })
      .select('+passwordHash')
      .lean({
        virtuals: true
      });
    return user ? { ...user, id: user._id } : null;
  }

  async findUserByEmail(email) {
    if (!email) return null;
    const user = await mongoose.models.User.findOne({ email: email.toLowerCase() })
      .select('+passwordHash')
      .lean({ virtuals: true });
    return user ? { ...user, id: user._id } : null;
  }

  async existsUser({ username, email }) {
    const queries = [];
    if (username) queries.push({ usernameLower: username.toLowerCase() });
    if (email) queries.push({ email: email.toLowerCase() });
    if (!queries.length) return [];
    const users = await mongoose.models.User.find({ $or: queries })
      .select('username email')
      .lean();
    return users.map((u) => ({
      username: u.username.toLowerCase(),
      email: u.email.toLowerCase()
    }));
  }

  async updateUser(id, patch) {
    return MongoStore.guard(async () => {
      const user = await mongoose.models.User.findByIdAndUpdate(id, { $set: patch }, { new: true })
        .lean({ virtuals: true });
      return user ? { ...user, id: user._id } : null;
    });
  }

  async updateUsers(ids, patch) {
    await mongoose.models.User.updateMany({ _id: { $in: ids } }, { $set: patch });
  }

  async setPresence(id, online, when = new Date()) {
    await mongoose.models.User.updateOne(
      { _id: id },
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
    const filter = { _id: { $ne: excludeId } };
    if (/^[a-f0-9]{24}$/i.test(trimmed)) {
      filter.$or = [{ _id: lower }, { usernameLower: { $regex: `^${escaped.toLowerCase()}` } }];
    } else {
      filter.usernameLower = { $regex: `^${escaped.toLowerCase()}` };
    }
    const results = await mongoose.models.User.find(filter)
      .sort({ usernameLower: 1 })
      .skip(offset)
      .limit(limit)
      .lean({ virtuals: true });
    return results.map((u) => ({ ...u, id: u._id }));
  }

  // --------------------------------------------------------- conversations
  async createConversation(data) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Conversation.create(data);
      return MongoStore.plain(doc);
    });
  }

  async findConversationById(id) {
    if (!id) return null;
    return MongoStore.plain(await mongoose.models.Conversation.findById(id).lean());
  }

  async findConversationByPair(pairKey) {
    return MongoStore.plain(await mongoose.models.Conversation.findOne({ pairKey }).lean());
  }

  async listConversationsForUser(userId) {
    return MongoStore.many(
      await mongoose.models.Conversation.find({
        participants: { $elemMatch: { user: userId, hiddenAt: null } }
      })
        .sort({ lastMessageAt: -1 })
        .limit(200)
        .lean()
    );
  }

  async updateConversation(id, patch) {
    return MongoStore.guard(async () => {
      const doc = await mongoose.models.Conversation.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
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

      // $inc with arrayFilters keeps concurrent senders from overwriting each
      // other's unread counters (a read-modify-write on the whole array would).
      await Conversation.updateOne(
        { _id: conversationId, 'participants.user': recipientId },
        { $inc: { 'participants.$[recipient].unreadCount': 1 } },
        { arrayFilters: [{ 'recipient.user': recipientId }] }
      );

      // A new message surfaces the thread again for both participants.
      await Conversation.updateOne(
        { _id: conversationId },
        {
          $set: {
            'participants.$[].hiddenAt': null,
            lastMessage: {
              text: message.text.slice(0, 160),
              senderId,
              messageId: message.id ?? message._id,
              createdAt
            },
            lastMessageAt: createdAt
          }
        }
      );

      const doc = await Conversation.findById(conversationId).lean();
      return MongoStore.plain(doc);
    });
  }

  async resetUnread(conversationId, userId, at = new Date()) {
    return MongoStore.guard(async () => {
      const { Conversation } = mongoose.models;
      await Conversation.updateOne(
        { _id: conversationId, 'participants.user': userId },
        {
          $set: {
            'participants.$[reader].unreadCount': 0,
            'participants.$[reader].lastReadAt': at
          }
        },
        { arrayFilters: [{ 'reader.user': userId }] }
      );
      return MongoStore.plain(await Conversation.findById(conversationId).lean());
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
      await mongoose.models.Message.findOne({ conversation: conversationId, sender: senderId, clientId }).lean()
    );
  }

  async findMessageById(id) {
    if (!id) return null;
    return MongoStore.plain(await mongoose.models.Message.findById(id).lean());
  }

  async listMessages({ conversationId, limit, before, beforeId }) {
    const filter = { conversation: conversationId };
    if (before) {
      // Compound cursor: everything strictly older, plus older ids that share
      // the exact boundary millisecond. No message can be skipped or repeated.
      const boundary = new Date(before);
      filter.$or = beforeId
        ? [{ createdAt: { $lt: boundary } }, { createdAt: boundary, _id: { $lt: beforeId } }]
        : [{ createdAt: { $lt: boundary } }];
    }
    const docs = await mongoose.models.Message.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
    return docs.reverse();
  }

  async updateMessages(filter, patch) {
    return MongoStore.guard(async () => {
      const result = await mongoose.models.Message.updateMany(filter, { $set: patch });
      return result.modifiedCount ?? 0;
    });
  }

  async markDeliveredToUser({ conversationId, recipientId }) {
    return this.updateMessages(
      { conversation: conversationId, sender: { $ne: recipientId }, deliveredAt: null },
      { deliveredAt: new Date() }
    );
  }

  async markReadByUser({ conversationId, readerId, at = new Date() }) {
    return MongoStore.guard(async () => {
      const result = await mongoose.models.Message.updateMany(
        {
          conversation: conversationId,
          sender: { $ne: readerId },
          $or: [{ readAt: null }, { readAt: { $exists: false } }]
        },
        { $set: { readAt: at, deliveredAt: at } }
      );
      return result.modifiedCount ?? 0;
    });
  }

  async countUnreadForUser({ conversationId, userId }) {
    return mongoose.models.Message.countDocuments({
      conversation: conversationId,
      sender: { $ne: userId },
      readAt: null
    });
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
    const block = await mongoose.models.Block.findOne({
      $or: [
        { blocker: a, blocked: b },
        { blocker: b, blocked: a }
      ]
    }).lean();
    return Boolean(block);
  }

  async listBlockedUsers(userId) {
    const blocks = await mongoose.models.Block.find({ blocker: userId }).lean();
    return blocks.map((b) => b.blocked);
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
