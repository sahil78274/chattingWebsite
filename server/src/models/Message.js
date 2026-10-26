import mongoose from 'mongoose';
import { newId } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

export const MESSAGE_MAX_LENGTH = 4000;
export const MESSAGE_MIN_LENGTH = 1;

const messageSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    conversation: { type: String, required: true, ref: 'Conversation' },
    sender: { type: String, required: true, ref: 'User' },
    text: {
      type: String,
      required: true,
      trim: true,
      minlength: MESSAGE_MIN_LENGTH,
      maxlength: MESSAGE_MAX_LENGTH
    },
    // Client supplied idempotency key. Retries / reconnects reuse the same key so
    // the unique index below prevents duplicate messages.
    clientId: { type: String, default: null, maxlength: 80 },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    editedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'messages' }
);

// Chat history pagination (newest first) inside one conversation.
messageSchema.index({ conversation: 1, createdAt: -1 }, { name: 'conversation_recent' });
// Idempotency guard for retried sends from the same sender.
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
    text: this.text,
    clientId: this.clientId || null,
    createdAt: this.createdAt,
    deliveredAt: this.deliveredAt || null,
    readAt: this.readAt || null
  };
};

export const Message = models.Message || model('Message', messageSchema);
export default Message;
