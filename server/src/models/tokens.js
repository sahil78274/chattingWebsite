import mongoose from 'mongoose';
import { newId } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

/**
 * Refresh tokens are stored as SHA-256 hashes only. Each login creates a token
 * "family"; rotating a token issues a new one in the same family and revokes the
 * previous one. If a revoked token is replayed we revoke the whole family (theft
 * detection) and force a fresh login.
 */
const refreshTokenSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    user: { type: String, required: true, ref: 'User' },
    tokenHash: { type: String, required: true },
    familyId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    replacedByHash: { type: String, default: null },
    userAgent: { type: String, default: '', maxlength: 300 }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'refreshtokens' }
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_token_hash' });
refreshTokenSchema.index({ familyId: 1 }, { name: 'family' });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiry' });
refreshTokenSchema.index({ user: 1 }, { name: 'by_user' });

const passwordResetTokenSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    user: { type: String, required: true, ref: 'User' },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'passwordresettokens' }
);

passwordResetTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_reset_hash' });
passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_reset_expiry' });

const blockSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    blocker: { type: String, required: true, ref: 'User' },
    blocked: { type: String, required: true, ref: 'User' }
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false, collection: 'blocks' }
);

blockSchema.index({ blocker: 1, blocked: 1 }, { unique: true, name: 'uniq_block' });
blockSchema.index({ blocked: 1 }, { name: 'blocked_lookup' });

const reportSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    reporter: { type: String, required: true, ref: 'User' },
    reportedUser: { type: String, required: true, ref: 'User' },
    conversation: { type: String, default: null },
    message: { type: String, default: null },
    reason: {
      type: String,
      required: true,
      enum: ['spam', 'harassment', 'impersonation', 'inappropriate', 'other']
    },
    details: { type: String, default: '', maxlength: 1000 },
    status: { type: String, enum: ['open', 'reviewed', 'closed'], default: 'open' }
  },
  { timestamps: true, versionKey: false, collection: 'reports' }
);

reportSchema.index({ status: 1, createdAt: -1 }, { name: 'status_recent' });
reportSchema.index({ reportedUser: 1 }, { name: 'by_reported_user' });

export const RefreshToken = models.RefreshToken || model('RefreshToken', refreshTokenSchema);
export const PasswordResetToken =
  models.PasswordResetToken || model('PasswordResetToken', passwordResetTokenSchema);
export const Block = models.Block || model('Block', blockSchema);
export const Report = models.Report || model('Report', reportSchema);

export default {
  RefreshToken,
  PasswordResetToken,
  Block,
  Report
};
