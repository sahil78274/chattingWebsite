import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestServer,
  createAccount,
  connectSocket,
  emitWithAck,
  waitForEvent,
  closeSockets,
  STRONG_PASSWORD
} from './helpers.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let ctx;
let alice;
let bob;

before(async () => {
  ctx = await startTestServer();
  alice = await createAccount(ctx, request, { username: 'alice_feat' });
  bob = await createAccount(ctx, request, { username: 'bob_feat' });
});

after(async () => {
  await ctx.close();
});

async function startConversation(from, to) {
  const res = await from.agent.post(`/api/users/${to.user.id}/conversation`);
  assert.equal(res.status, 201);
  return res.body.conversation;
}

describe('Identity', () => {
  test('display names may be identical while usernames stay unique case-insensitively', async () => {
    const first = await createAccount(ctx, request, { username: 'name_one' });
    const renamed = await first.agent.patch('/api/auth/me').send({ displayName: 'Same Face' });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.user.displayName, 'Same Face');
    assert.equal(renamed.body.user.username, 'name_one');

    const second = await createAccount(ctx, request, { username: 'name_two' });
    const also = await second.agent.patch('/api/auth/me').send({ displayName: 'Same Face' });
    assert.equal(also.status, 200);
    assert.equal(also.body.user.displayName, 'Same Face');
    assert.notEqual(also.body.user.username, first.user.username);

    const clash = await request(ctx.url).post('/api/auth/register').send({
      username: 'Name_One',
      email: 'nameone-clash@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.error.message, 'This username is already taken.');
  });

  test('self profile includes role; other users never see emails', async () => {
    const me = await alice.agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.role, 'user');
    assert.ok(me.body.user.email);

    const other = await alice.agent.get(`/api/users/${bob.user.id}`);
    assert.equal(other.status, 200);
    assert.equal(other.body.user.email, undefined);
    assert.equal(other.body.user.role, undefined);
  });
});

describe('Profile photos', () => {
  test('stores a durable avatar URL and serves the bytes after a later request', async () => {
    const account = await createAccount(ctx, request, { username: 'avatar_person' });
    const uploaded = await account.agent
      .post('/api/auth/me/avatar')
      .attach('avatar', TINY_PNG, { filename: 'me.png', contentType: 'image/png' });
    assert.equal(uploaded.status, 201);
    const url = uploaded.body.user.avatarUrl || uploaded.body.avatarUrl;
    assert.ok(url);
    assert.equal(url.startsWith('blob:'), false);
    assert.match(url, /^\/uploads\//);

    const me = await account.agent.get('/api/auth/me');
    assert.equal(me.body.user.avatarUrl, url);

    const bytes = await request(ctx.url).get(url);
    assert.equal(bytes.status, 200);
    assert.match(bytes.headers['content-type'], /image\//);
    assert.ok(bytes.body.length > 0);

    const bad = await account.agent
      .post('/api/auth/me/avatar')
      .attach('avatar', Buffer.from('not-an-image'), { filename: 'x.txt', contentType: 'text/plain' });
    assert.equal(bad.status, 400);
  });
});

describe('Message history, replies, edit, delete, reactions, forward', () => {
  test('history is restored from the server after a later fetch', async () => {
    const conversation = await startConversation(alice, bob);
    const sent = await alice.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Keep this forever', clientId: 'hist-1' });
    assert.equal(sent.status, 201);

    const history = await bob.agent.get(`/api/conversations/${conversation.id}/messages`);
    assert.equal(history.status, 200);
    assert.ok(history.body.messages.some((m) => m.text === 'Keep this forever'));

    const again = await alice.agent.get(`/api/conversations/${conversation.id}/messages`);
    assert.ok(again.body.messages.some((m) => m.id === sent.body.message.id));
  });

  test('replies, edits own messages, and refuses edits from the peer', async () => {
    const conversation = await startConversation(alice, bob);
    const original = await alice.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Original line' });
    const originalId = original.body.message.id;

    const reply = await bob.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Replying to you', replyToId: originalId });
    assert.equal(reply.status, 201);
    assert.equal(reply.body.message.replyTo.id, originalId);

    const edited = await alice.agent
      .patch(`/api/conversations/${conversation.id}/messages/${originalId}`)
      .send({ text: 'Edited line' });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.message.text, 'Edited line');
    assert.ok(edited.body.message.editedAt);

    const stolen = await bob.agent
      .patch(`/api/conversations/${conversation.id}/messages/${originalId}`)
      .send({ text: 'Nope' });
    assert.equal(stolen.status, 403);
  });

  test('delete-for-me hides a row only for that user; delete-for-everyone tombstones it', async () => {
    const conversation = await startConversation(alice, bob);
    const mine = await alice.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Only Alice should lose this' });
    const theirs = await bob.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Bob said this' });

    const hide = await alice.agent
      .delete(`/api/conversations/${conversation.id}/messages/${theirs.body.message.id}`)
      .send({ scope: 'me' });
    assert.equal(hide.status, 200);

    const aliceView = await alice.agent.get(`/api/conversations/${conversation.id}/messages`);
    assert.equal(
      aliceView.body.messages.some((m) => m.id === theirs.body.message.id),
      false
    );
    const bobView = await bob.agent.get(`/api/conversations/${conversation.id}/messages`);
    assert.equal(
      bobView.body.messages.some((m) => m.id === theirs.body.message.id),
      true
    );

    const everyone = await alice.agent
      .delete(`/api/conversations/${conversation.id}/messages/${mine.body.message.id}`)
      .send({ scope: 'everyone' });
    assert.equal(everyone.status, 200);
    assert.equal(everyone.body.message.deleted, true);
    assert.equal(everyone.body.message.text, '');

    const bobSeesTombstone = await bob.agent.get(`/api/conversations/${conversation.id}/messages`);
    const row = bobSeesTombstone.body.messages.find((m) => m.id === mine.body.message.id);
    assert.ok(row);
    assert.equal(row.deleted, true);
    assert.equal(row.text, '');

    const notOwner = await bob.agent
      .delete(`/api/conversations/${conversation.id}/messages/${mine.body.message.id}`)
      .send({ scope: 'everyone' });
    assert.equal(notOwner.status, 403);
  });

  test('toggles a reaction and syncs it over the socket', async () => {
    const conversation = await startConversation(alice, bob);
    const sent = await alice.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'React to me' });
    const messageId = sent.body.message.id;

    const aliceSocket = await connectSocket(ctx, alice.token);
    const bobSocket = await connectSocket(ctx, bob.token);
    try {
      const updated = waitForEvent(aliceSocket, 'message:updated', {
        predicate: (payload) => payload.message?.id === messageId
      });
      const ack = await emitWithAck(bobSocket, 'message:react', {
        conversationId: conversation.id,
        messageId,
        emoji: '👍'
      });
      assert.equal(ack.ok, true);
      assert.equal(ack.message.reactions.some((r) => r.emoji === '👍' && r.count === 1), true);

      const event = await updated;
      assert.equal(event.message.reactions.some((r) => r.emoji === '👍'), true);

      const stored = await alice.agent.get(`/api/conversations/${conversation.id}/messages`);
      const row = stored.body.messages.find((m) => m.id === messageId);
      assert.equal(row.reactions.some((r) => r.emoji === '👍' && r.count === 1), true);

      const again = await bob.agent
        .post(`/api/conversations/${conversation.id}/messages/${messageId}/reactions`)
        .send({ emoji: '👍' });
      assert.equal(again.body.message.reactions.some((r) => r.emoji === '👍'), false);
    } finally {
      closeSockets(aliceSocket, bobSocket);
    }
  });

  test('forwards a message into another conversation', async () => {
    const carol = await createAccount(ctx, request, { username: 'carol_fwd' });
    const withBob = await startConversation(alice, bob);
    const withCarol = await startConversation(alice, carol);
    const original = await alice.agent
      .post(`/api/conversations/${withBob.id}/messages`)
      .send({ text: 'Please forward this' });

    const forwarded = await alice.agent
      .post(`/api/conversations/${withBob.id}/messages/${original.body.message.id}/forward`)
      .send({ targetConversationId: withCarol.id });
    assert.equal(forwarded.status, 201);
    assert.equal(forwarded.body.message.text, 'Please forward this');
    assert.equal(forwarded.body.message.conversationId, withCarol.id);

    const carolHistory = await carol.agent.get(`/api/conversations/${withCarol.id}/messages`);
    assert.ok(carolHistory.body.messages.some((m) => m.text === 'Please forward this'));
  });

  test('receipts stay monotonic: sent → delivered → read, never reverse', async () => {
    const dana = await createAccount(ctx, request, { username: 'dana_ticks' });
    const conversation = await startConversation(alice, dana);
    const aliceSocket = await connectSocket(ctx, alice.token);
    try {
      const sent = await emitWithAck(aliceSocket, 'message:send', {
        conversationId: conversation.id,
        text: 'Tick check',
        clientId: `tick-${Date.now()}`
      });
      assert.equal(sent.message.status, 'sent');
      assert.equal(sent.message.deliveredAt, null);
      assert.equal(sent.message.readAt, null);

      const deliveredEvent = waitForEvent(aliceSocket, 'receipt:delivered', {
        predicate: (payload) => payload.conversationId === conversation.id
      });
      const danaSocket = await connectSocket(ctx, dana.token);
      try {
        await deliveredEvent;
        const afterDeliver = await alice.agent.get(`/api/conversations/${conversation.id}/messages`);
        const row = afterDeliver.body.messages.find((m) => m.text === 'Tick check');
        assert.equal(row.status, 'delivered');
        assert.equal(row.readAt, null);

        const readEvent = waitForEvent(aliceSocket, 'message:read', {
          predicate: (payload) => payload.conversationId === conversation.id
        });
        await emitWithAck(danaSocket, 'message:read', { conversationId: conversation.id });
        await readEvent;
        const afterRead = await alice.agent.get(`/api/conversations/${conversation.id}/messages`);
        const readRow = afterRead.body.messages.find((m) => m.text === 'Tick check');
        assert.equal(readRow.status, 'read');
        assert.ok(readRow.deliveredAt);
        assert.ok(readRow.readAt);
      } finally {
        closeSockets(danaSocket);
      }
    } finally {
      closeSockets(aliceSocket);
    }
  });
});

describe('Admin dashboard', () => {
  test('ordinary users cannot open admin routes or promote themselves', async () => {
    const overview = await alice.agent.get('/api/admin/overview');
    assert.equal(overview.status, 403);

    const promote = await alice.agent
      .patch(`/api/admin/users/${alice.user.id}/role`)
      .send({ role: 'admin' });
    assert.equal(promote.status, 403);
  });

  test('admins can list emails, bootstrap is not a hidden client button, last admin is protected', async () => {
    const adminAccount = await createAccount(ctx, request, { username: 'site_admin' });
    await ctx.store.updateUser(adminAccount.user.id, { role: 'admin' });

    const overview = await adminAccount.agent.get('/api/admin/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.body.counts.total >= 2);

    const users = await adminAccount.agent.get('/api/admin/users?q=alice_feat');
    assert.equal(users.status, 200);
    const listed = users.body.users.find((u) => u.username === 'alice_feat');
    assert.ok(listed);
    assert.ok(listed.email);

    const lastDemote = await adminAccount.agent
      .patch(`/api/admin/users/${adminAccount.user.id}/role`)
      .send({ role: 'user' });
    assert.equal(lastDemote.status, 403);
    assert.equal(lastDemote.body.error.code, 'LAST_ADMIN');

    const lastDelete = await adminAccount.agent
      .patch(`/api/admin/users/${adminAccount.user.id}/status`)
      .send({ status: 'deleted' });
    assert.equal(lastDelete.status, 403);
    assert.equal(lastDelete.body.error.code, 'LAST_ADMIN');

    const target = await createAccount(ctx, request, { username: 'soon_suspended' });
    const suspended = await adminAccount.agent
      .patch(`/api/admin/users/${target.user.id}/status`)
      .send({ status: 'suspended' });
    assert.equal(suspended.status, 200);
    assert.equal(suspended.body.user.status, 'suspended');

    const login = await request(ctx.url).post('/api/auth/login').send({
      identifier: 'soon_suspended',
      password: STRONG_PASSWORD
    });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_SUSPENDED');

    const audit = await adminAccount.agent.get('/api/admin/audit');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.logs.some((row) => row.action === 'admin.user.suspend'));
  });
});
