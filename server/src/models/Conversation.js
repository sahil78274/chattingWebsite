import mongoose from 'mongoose';
import { newId, pairKeyFor } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

const participantSchema = new Schema(
  {
    user: { type: String, required: true, ref: 'User' },
    unreadCount: { type: Number, default: 0, min: 0 },
    lastReadAt: { type: Date, default: null },
    // Set when a user removes the thread from their own list. The other
    // participant's copy of the history is untouched.
    hiddenAt: { type: Date, default: null },
    joinedAt: { type: Date, default: () => new Date() }
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    // Sorted "userA:userB" key. The unique index guarantees exactly one direct
    // conversation per pair even under concurrent creation attempts.
    pairKey: { type: String, required: true },
    type: { type: String, enum: ['direct'], default: 'direct' },
    participants: {
      type: [participantSchema],
      validate: {
        validator: (value) => Array.isArray(value) && value.length === 2,
        message: 'A direct conversation must have exactly two participants'
      }
    },
    lastMessage: {
      text: { type: String, default: '' },
      senderId: { type: String, default: null },
      messageId: { type: String, default: null },
      createdAt: { type: Date, default: null }
    },
    lastMessageAt: { type: Date, default: () => new Date() }
  },
  { timestamps: true, versionKey: false, collection: 'conversations' }
);

conversationSchema.index({ pairKey: 1 }, { unique: true, name: 'uniq_pair' });
conversationSchema.index({ 'participants.user': 1, lastMessageAt: -1 }, { name: 'participant_recent' });

conversationSchema.methods.participantFor = function participantFor(userId) {
  return this.participants.find((p) => p.user === userId) || null;
};

conversationSchema.methods.otherParticipantId = function otherParticipantId(userId) {
  const other = this.participants.find((p) => p.user !== userId);
  return other ? other.user : null;
};

conversationSchema.methods.isMember = function isMember(userId) {
  return this.participants.some((p) => p.user === userId);
};

conversationSchema.statics.buildDirect = function buildDirect(userA, userB) {
  return {
    _id: newId(),
    pairKey: pairKeyFor(userA, userB),
    type: 'direct',
    participants: [
      { user: userA, unreadCount: 0, lastReadAt: new Date() },
      { user: userB, unreadCount: 0, lastReadAt: new Date() }
    ],
    lastMessage: { text: '', senderId: null, messageId: null, createdAt: null },
    lastMessageAt: new Date()
  };
};

export const Conversation = models.Conversation || model('Conversation', conversationSchema);
export default Conversation;
