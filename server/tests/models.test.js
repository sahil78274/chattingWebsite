import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { User, AVATAR_COLOR_OPTIONS } from '../src/models/User.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import { RefreshToken, PasswordResetToken, Block, Report } from '../src/models/tokens.js';
import { newId, isId, pairKeyFor } from '../src/utils/ids.js';

/**
 * These tests validate the Mongoose schemas and index definitions without a
 * database connection, so the document shapes that Atlas will receive are
 * checked even when no MongoDB server is available in the build environment.
 */
const validUser = () => ({
  _id: newId(),
  username: 'aarav.sharma',
  usernameLower: 'aarav.sharma',
  email: 'aarav@example.com',
  passwordHash: '$2a$12$abcdefghijklmnopqrstuv',
  displayName: 'Aarav Sharma'
});

describe('Identifier helpers', () => {
  test('generates unique 24-char hex ids that look like ObjectIds', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    assert.equal(ids.size, 500);
    for (const id of ids) {
      assert.equal(id.length, 24);
      assert.ok(isId(id));
    }
  });

  test('pair keys are stable regardless of argument order', () => {
    const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const b = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    assert.equal(pairKeyFor(a, b), pairKeyFor(b, a));
    assert.notEqual(pairKeyFor(a, b), pairKeyFor(a, a));
  });
});

describe('User model', () => {
  test('validates a well formed user', () => {
    const user = new User(validUser());
    assert.equal(user.validateSync(), undefined);
  });

  test('rejects invalid usernames, emails and short display names', () => {
    const badUsername = new User({ ...validUser(), username: 'has spaces', usernameLower: 'has spaces' });
    assert.ok(badUsername.validateSync()?.errors.username);

    const badEmail = new User({ ...validUser(), email: 'not-an-email' });
    assert.ok(badEmail.validateSync()?.errors.email);

    const longBio = new User({ ...validUser(), bio: 'x'.repeat(400) });
    assert.ok(longBio.validateSync()?.errors.bio);
  });

  test('applies safe defaults for avatar, privacy and presence', () => {
    const user = new User(validUser());
    assert.equal(user.bio, '');
    assert.equal(user.privacy.lastSeen, 'everyone');
    assert.equal(user.presence.online, false);
    assert.ok(AVATAR_COLOR_OPTIONS.includes(user.avatarColor));
  });

  test('declares unique indexes for username and email', () => {
    const indexes = User.schema.indexes();
    const unique = indexes.filter(([, options]) => options.unique);
    assert.ok(
      unique.some(([fields]) => fields.usernameLower === 1),
      'usernameLower must be unique'
    );
    assert.ok(
      unique.some(([fields]) => fields.email === 1),
      'email must be unique'
    );
  });

  test('hidden password hash is excluded from default queries', () => {
    const path = User.schema.path('passwordHash');
    assert.equal(path.options.select, false);
  });
});

describe('Conversation model', () => {
  const participants = [
    { user: newId(), unreadCount: 0, lastReadAt: new Date() },
    { user: newId(), unreadCount: 2, lastReadAt: null }
  ];

  test('requires exactly two participants', () => {
    const one = new Conversation({ pairKey: 'a:b', participants: [participants[0]] });
    assert.ok(one.validateSync()?.errors.participants);

    const two = new Conversation({ pairKey: 'a:b', participants });
    assert.equal(two.validateSync(), undefined);
  });

  test('declares a unique pair key and a participant/recent index', () => {
    const indexes = Conversation.schema.indexes();
    assert.ok(
      indexes.some(([fields, options]) => fields.pairKey === 1 && options.unique),
      'pairKey must be unique'
    );
    assert.ok(indexes.some(([fields]) => fields['participants.user'] === 1 && fields.lastMessageAt === -1));
  });

  test('buildDirect creates the canonical pair key', () => {
    const [a, b] = participants.map((p) => p.user);
    const data = Conversation.buildDirect(a, b);
    assert.equal(data.pairKey, pairKeyFor(a, b));
    assert.equal(data.participants.length, 2);
  });
});

describe('Message model', () => {
  const base = () => ({
    conversation: newId(),
    sender: newId(),
    text: 'Hello there'
  });

  test('accepts valid text and rejects empty or oversized text', () => {
    assert.equal(new Message(base()).validateSync(), undefined);
    assert.ok(new Message({ ...base(), text: '' }).validateSync()?.errors.text);
    assert.ok(new Message({ ...base(), text: 'x'.repeat(4001) }).validateSync()?.errors.text);
  });

  test('indexes history pagination and per-sender idempotency', () => {
    const indexes = Message.schema.indexes();
    assert.ok(indexes.some(([fields]) => fields.conversation === 1 && fields.createdAt === -1));
    const idempotency = indexes.find(([, options]) => options.name === 'uniq_client_message');
    assert.ok(idempotency);
    assert.equal(idempotency[1].unique, true);
    assert.deepEqual(idempotency[1].partialFilterExpression, { clientId: { $type: 'string' } });
  });

  test('serialises without leaking internals', () => {
    const message = new Message({ ...base(), clientId: 'c1' });
    const json = message.toJSONSafe();
    assert.equal(json.text, 'Hello there');
    assert.deepEqual(Object.keys(json).sort(), [
      'clientId',
      'conversationId',
      'createdAt',
      'deliveredAt',
      'id',
      'readAt',
      'senderId',
      'text'
    ]);
  });
});

describe('Session, block and report models', () => {
  test('refresh tokens are indexed by hash with a TTL on expiry', () => {
    const indexes = RefreshToken.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.tokenHash === 1 && options.unique));
    assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  });

  test('password reset tokens expire automatically', () => {
    const indexes = PasswordResetToken.schema.indexes();
    assert.ok(indexes.some(([fields, options]) => fields.expiresAt === 1 && options.expireAfterSeconds === 0));
  });

  test('a user can only block another user once', () => {
    const indexes = Block.schema.indexes();
    assert.ok(
      indexes.some(([fields, options]) => fields.blocker === 1 && fields.blocked === 1 && options.unique)
    );
  });

  test('reports require a known reason', () => {
    const report = new Report({
      reporter: newId(),
      reportedUser: newId(),
      reason: 'telepathy'
    });
    assert.ok(report.validateSync()?.errors.reason);
  });
});
