import mongoose from 'mongoose';
import { newId } from '../utils/ids.js';

const { Schema, model, models } = mongoose;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const DISPLAY_NAME_MAX = 48;
export const BIO_MAX = 280;

const AVATAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f97316',
  '#14b8a6',
  '#0ea5e9',
  '#22c55e',
  '#eab308',
  '#ef4444',
  '#a855f7'
];

const userSchema = new Schema(
  {
    _id: { type: String, default: () => newId() },
    username: {
      type: String,
      required: true,
      trim: true,
      minlength: USERNAME_MIN,
      maxlength: USERNAME_MAX,
      match: /^[a-zA-Z0-9_.]+$/
    },
    // Lower-cased copy used for case-insensitive uniqueness and lookup.
    usernameLower: { type: String, required: true, lowercase: true, trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Enter a valid email address']
    },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: DISPLAY_NAME_MAX },
    bio: { type: String, default: '', maxlength: BIO_MAX, trim: true },
    avatarUrl: { type: String, default: '', maxlength: 500 },
    avatarColor: {
      type: String,
      enum: AVATAR_COLORS,
      default: () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
    },
    privacy: {
      lastSeen: { type: String, enum: ['everyone', 'nobody'], default: 'everyone' }
    },
    presence: {
      online: { type: Boolean, default: false },
      lastSeen: { type: Date, default: () => new Date() }
    },
    // Incremented on "logout everywhere" / password change to invalidate
    // every previously issued access token.
    tokenVersion: { type: Number, default: 0 }
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'users',
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

userSchema.index({ usernameLower: 1 }, { unique: true, name: 'uniq_username' });
userSchema.index({ email: 1 }, { unique: true, name: 'uniq_email' });
// Supports partial (prefix) username search and id lookups without collection scans.
userSchema.index({ usernameLower: 1, _id: 1 }, { name: 'username_search' });

export const AVATAR_COLOR_OPTIONS = AVATAR_COLORS;
export const User = models.User || model('User', userSchema);
export default User;
