import mongoose from 'mongoose';
import { newId } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

export const MESSAGE_MAX_LENGTH = 4000;
export const MESSAGE_MIN_LENGTH = 1;
export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '🎉', '👏', '💯'];

const reactionSchema = new Schema(
  {
    emoji: { type: String, required: true, maxlength: 16 },
    user: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() }
  },
  { _id: false }
);

const replyToSchema = new Schema(
  {
    id: { type: String, required: true },
    senderId: { type: String, required: true },
    text: { type: String, default: '', maxlength: 160 }
  },
  { _id: false }
);

const messageSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    conversation: { type: String, required: true, ref: 'Conversation' },
    sender: { type: String, required: true, ref: 'User' },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: 0,
      maxlength: MESSAGE_MAX_LENGTH
    },
    clientId: { type: String, default: null, maxlength: 80 },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    deletedFor: { type: [String], default: [] },
    replyTo: { type: replyToSchema, default: null },
    reactions: { type: [reactionSchema], default: [] }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'messages' }
);

messageSchema.index({ conversation: 1, createdAt: -1 }, { name: 'conversation_recent' });
messageSchema.index(
  { conversation: 1, sender: 1, clientId: 1 },
  {
    unique: true,
    name: 'uniq_client_message',
    partialFilterExpression: { clientId: { $type: 'string' } }
  }
);

messageSchema.methods.toJSONSafe = function toJSONSafe() {
  return {
    id: this._id,
    conversationId: this.conversation,
    senderId: this.sender,
    text: this.deletedAt ? '' : this.text,
    clientId: this.clientId || null,
    createdAt: this.createdAt,
    deliveredAt: this.deliveredAt || null,
    readAt: this.readAt || null,
    editedAt: this.editedAt || null,
    deletedAt: this.deletedAt || null,
    replyTo: this.replyTo || null,
    reactions: this.reactions || []
  };
};

export const Message = models.Message || model('Message', messageSchema);
export default Message;
