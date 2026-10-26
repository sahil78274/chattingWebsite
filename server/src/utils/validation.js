import { z } from 'zod';
import { USERNAME_MAX, USERNAME_MIN, DISPLAY_NAME_MAX, BIO_MAX } from '../models/User.js';
import { MESSAGE_MAX_LENGTH } from '../models/Message.js';

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'api',
  'connectly',
  'help',
  'login',
  'register',
  'root',
  'settings',
  'signup',
  'support',
  'system',
  'me',
  'search',
  'chat',
  'null',
  'undefined'
]);

export const usernameSchema = z
  .string({ required_error: 'Username is required' })
  .trim()
  .min(USERNAME_MIN, `Username must be at least ${USERNAME_MIN} characters`)
  .max(USERNAME_MAX, `Username must be at most ${USERNAME_MAX} characters`)
  .regex(/^[a-zA-Z0-9_.]+$/, 'Username may only contain letters, numbers, dots and underscores')
  .refine((value) => !/[._]{2,}/.test(value), 'Username cannot contain repeated dots or underscores')
  .refine((value) => !/^[._]|[._]$/.test(value), 'Username cannot start or end with a dot or underscore')
  .refine((value) => !RESERVED_USERNAMES.has(value.toLowerCase()), 'That username is reserved');

export const emailSchema = z
  .string({ required_error: 'Email is required' })
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254, 'Email is too long');

export const passwordSchema = z
  .string({ required_error: 'Password is required' })
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .refine((value) => /[a-zA-Z]/.test(value), 'Password must contain at least one letter')
  .refine((value) => /[0-9]/.test(value), 'Password must contain at least one number');

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string({ required_error: 'Please confirm your password' })
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match'
  });

export const loginSchema = z.object({
  identifier: z
    .string({ required_error: 'Email or username is required' })
    .trim()
    .min(1, 'Email or username is required')
    .max(254),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required')
});

export const updateProfileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, 'Display name must be at least 2 characters')
      .max(DISPLAY_NAME_MAX, `Display name must be at most ${DISPLAY_NAME_MAX} characters`)
      .optional(),
    bio: z.string().trim().max(BIO_MAX, `Bio must be at most ${BIO_MAX} characters`).optional(),
    avatarUrl: z.string().trim().max(500).optional(),
    privacy: z
      .object({
        lastSeen: z.enum(['everyone', 'nobody'])
      })
      .partial()
      .optional()
  })
  .refine((data) => Object.keys(data).length > 0, 'Nothing to update');

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match'
  });

export const searchSchema = z.object({
  q: z
    .string({ required_error: 'Search query is required' })
    .trim()
    .min(1, 'Enter at least one character')
    .max(40, 'Search query is too long'),
  page: z.coerce.number().int().min(1).max(50).default(1),
  limit: z.coerce.number().int().min(1).max(20).default(10)
});

export const sendMessageSchema = z.object({
  text: z
    .string({ required_error: 'Message text is required' })
    .min(1, 'Message cannot be empty')
    .max(MESSAGE_MAX_LENGTH, `Message must be at most ${MESSAGE_MAX_LENGTH} characters`)
    .refine((value) => value.trim().length > 0, 'Message cannot be empty'),
  clientId: z.string().trim().max(80).optional()
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(10, 'Reset token is invalid').max(200),
    password: passwordSchema,
    confirmPassword: z.string()
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match'
  });

export const reportSchema = z.object({
  reason: z.enum(['spam', 'harassment', 'impersonation', 'inappropriate', 'other']),
  details: z.string().trim().max(1000).optional(),
  messageId: z.string().length(24).optional(),
  conversationId: z.string().length(24).optional()
});

export const idSchema = z.string().trim().length(24, 'Invalid identifier');

export const avatarColorSchema = z.enum([
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
]);

/**
 * Strips control characters (except newlines/tabs) and trims surrounding
 * whitespace. Rendering is always done as text in React, never as HTML.
 */
export function sanitizeText(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
}

/** Parses `input` with a zod schema and throws a 400 ApiError with field details. */
export function parseOrThrow(schema, input, ApiError) {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  throw new ApiError(400, 'Please check the highlighted fields', {
    code: 'VALIDATION_ERROR',
    details: fieldErrors
  });
}
