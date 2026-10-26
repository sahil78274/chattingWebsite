import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {
  startTestServer,
  createAccount,
  connectSocket,
  emitWithAck,
  waitForEvent,
  closeSockets
} from './helpers.js';

let ctx;
let alice;
let bob;

before(async () => {
  ctx = await startTestServer();
  alice = await createAccount(ctx, request, { username: 'alice_chat' });
  bob = await createAccount(ctx, request, { username: 'bob_chat' });
});

after(async () => {
  await ctx.close();
});

async function startConversation(from, to) {
  const res = await from.agent.post(`/api/users/${to.user.id}/conversation`);
  assert.equal(res.status, 201);
  return res.body.conversation;
}

describe('User search', () => {
  test('finds users by partial username and by id, excluding the viewer', async () => {
    const byPartial = await alice.agent.get('/api/users/search?q=bob_ch');
    assert.equal(byPartial.status, 200);
    assert.ok(byPartial.body.results.some((u) => u.username === 'bob_chat'));

    const byId = await alice.agent.get(`/api/users/search?q=${bob.user.id}`);
    assert.equal(byId.status, 200);
    assert.equal(byId.body.results[0].username, 'bob_chat');

    const selfSearch = await alice.agent.get('/api/users/search?q=alice_chat');
    assert.equal(selfSearch.body.results.length, 0);
  });

  test('validates the search query and limits result size', async () => {
    const empty = await alice.agent.get('/api/users/search?q=');
    assert.equal(empty.status, 400);

    const huge = await alice.agent.get(`/api/users/search?q=${'a'.repeat(60)}`);
    assert.equal(huge.status, 400);

    const limited = await alice.agent.get('/api/users/search?q=user&limit=500');
    assert.equal(limited.status, 400); // zod max(20)
  });
});

describe('Conversations', () => {
  test('creates exactly one conversation per pair, even when created twice', async () => {
    const first = await startConversation(alice, bob);
    const second = await startConversation(alice, bob);
    const reversed = await bob.agent.post(`/api/users/${alice.user.id}/conversation`);
    assert.equal(first.id, second.id);
    assert.equal(first.id, reversed.body.conversation.id);

    const list = await alice.agent.get('/api/conversations');
    const matching = list.body.conversations.filter((c) => c.peer.id === bob.user.id);
    assert.equal(matching.length, 1);
  });

  test('rejects starting a conversation with yourself', async () => {
    const res = await alice.agent.post(`/api/users/${alice.user.id}/conversation`);
    assert.equal(res.status, 400);
  });

  test('new messages update the preview, ordering and unread count', async () => {
    const conversation = await startConversation(alice, bob);
    await bob.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Hello Alice, this is Bob.' });

    const aliceList = await alice.agent.get('/api/conversations');
    const entry = aliceList.body.conversations.find((c) => c.id === conversation.id);
    assert.equal(entry.lastMessage.text, 'Hello Alice, this is Bob.');
    assert.equal(entry.unreadCount, 1);

    const read = await alice.agent.post(`/api/conversations/${conversation.id}/read`);
    assert.equal(read.status, 200);

    const afterRead = await alice.agent.get('/api/conversations');
    const confirm = afterRead.body.conversations.find((c) => c.id === conversation.id);
    assert.equal(confirm.unreadCount, 0);
  });

  test('hiding a conversation only affects the user who hid it', async () => {
    const conversation = await startConversation(alice, bob);
    const hidden = await alice.agent.delete(`/api/conversations/${conversation.id}`);
    assert.equal(hidden.status, 200);

    const aliceList = await alice.agent.get('/api/conversations');
    assert.equal(aliceList.body.conversations.some((c) => c.id === conversation.id), false);

    const bobList = await bob.agent.get('/api/conversations');
    assert.equal(bobList.body.conversations.some((c) => c.id === conversation.id), true);

    // Re-opening from search restores it for Alice without creating a new thread.
    const reopened = await alice.agent.post(`/api/users/${bob.user.id}/conversation`);
    assert.equal(reopened.body.conversation.id, conversation.id);
  });
});

describe('Authorization', () => {
  test('a third user cannot read, send to, or open a private conversation', async () => {
    const outsider = await createAccount(ctx, request, { username: 'outsider_chat' });
    const conversation = await startConversation(alice, bob);
    await alice.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Private message' });

    const read = await outsider.agent.get(`/api/conversations/${conversation.id}/messages`);
    assert.equal(read.status, 403);

    const send = await outsider.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'I should not be here' });
    assert.equal(send.status, 403);

    const details = await outsider.agent.get(`/api/conversations/${conversation.id}`);
    assert.equal(details.status, 403);

    const list = await outsider.agent.get('/api/conversations');
    assert.equal(list.body.conversations.length, 0);
  });

  test('rejects unauthenticated sockets', async () => {
    await assert.rejects(() => connectSocket(ctx, 'not-a-real-token'));
  });
});

describe('Real-time messaging', () => {
  test('delivers messages instantly, persists them and sends receipts', async () => {
    const conversation = await startConversation(alice, bob);

    const aliceSocket = await connectSocket(ctx, alice.token);
    const bobSocket = await connectSocket(ctx, bob.token);

    try {
      const joinA = await emitWithAck(aliceSocket, 'conversation:join', { conversationId: conversation.id });
      assert.equal(joinA.ok, true);
      const joinB = await emitWithAck(bobSocket, 'conversation:join', { conversationId: conversation.id });
      assert.equal(joinB.ok, true);

      const incoming = waitForEvent(bobSocket, 'message:new', {
        predicate: (payload) => payload.message.text === 'Realtime hello from Alice'
      });

      const ack = await emitWithAck(aliceSocket, 'message:send', {
        conversationId: conversation.id,
        text: 'Realtime hello from Alice',
        clientId: 'client-1'
      });
      assert.equal(ack.ok, true);
      assert.ok(ack.message.id);

      const received = await incoming;
      assert.equal(received.message.senderId, alice.user.id);
      assert.equal(received.message.text, 'Realtime hello from Alice');
      assert.ok(received.message.createdAt);

      // Server-generated timestamp and id (never trusted from the client).
      assert.notEqual(received.message.id, 'client-1');

      // Bob reads it -> Alice receives a read receipt.
      const readEvent = waitForEvent(aliceSocket, 'message:read', {
        predicate: (payload) => payload.conversationId === conversation.id
      });
      const readAck = await emitWithAck(bobSocket, 'message:read', { conversationId: conversation.id });
      assert.equal(readAck.ok, true);
      const receipt = await readEvent;
      assert.equal(receipt.readerId, bob.user.id);

      // History survives a "refresh".
      const history = await bob.agent.get(`/api/conversations/${conversation.id}/messages`);
      assert.equal(history.status, 200);
      const stored = history.body.messages.find((m) => m.text === 'Realtime hello from Alice');
      assert.ok(stored);
      assert.equal(stored.senderId, alice.user.id);
      assert.ok(stored.readAt, 'read timestamp should be stored');
    } finally {
      closeSockets(aliceSocket, bobSocket);
    }
  });

  test('is idempotent for retried sends with the same client id', async () => {
    const conversation = await startConversation(alice, bob);
    const socket = await connectSocket(ctx, alice.token);
    try {
      const payload = {
        conversationId: conversation.id,
        text: 'Only once please',
        clientId: 'retry-key-1'
      };
      const first = await emitWithAck(socket, 'message:send', payload);
      const second = await emitWithAck(socket, 'message:send', payload);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      assert.equal(first.message.id, second.message.id);
      assert.equal(second.duplicate, true);

      const stored = ctx.store.messages
        ? [...ctx.store.messages.values()].filter((m) => m.text === 'Only once please')
        : null;
      if (stored) assert.equal(stored.length, 1);
    } finally {
      closeSockets(socket);
    }
  });

  test('validates message content and enforces the length limit', async () => {
    const conversation = await startConversation(alice, bob);
    const socket = await connectSocket(ctx, alice.token);
    try {
      const empty = await emitWithAck(socket, 'message:send', {
        conversationId: conversation.id,
        text: '    '
      });
      assert.equal(empty.ok, false);

      const tooLong = await emitWithAck(socket, 'message:send', {
        conversationId: conversation.id,
        text: 'x'.repeat(4001)
      });
      assert.equal(tooLong.ok, false);

      const badId = await emitWithAck(socket, 'message:send', {
        conversationId: 'not-an-id',
        text: 'hello'
      });
      assert.equal(badId.ok, false);
    } finally {
      closeSockets(socket);
    }
  });

  test('a user cannot join rooms they are not part of, nor receive those messages', async () => {
    const conversation = await startConversation(alice, bob);
    const outsider = await createAccount(ctx, request, { username: 'spy_user' });
    const outsiderSocket = await connectSocket(ctx, outsider.token);
    const aliceSocket = await connectSocket(ctx, alice.token);

    try {
      const join = await emitWithAck(outsiderSocket, 'conversation:join', {
        conversationId: conversation.id
      });
      assert.equal(join.ok, false);
      assert.equal(join.error.status, 403);

      const leaked = [];
      outsiderSocket.on('message:new', (payload) => leaked.push(payload));

      await emitWithAck(aliceSocket, 'message:send', {
        conversationId: conversation.id,
        text: 'This should stay private'
      });

      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(leaked.length, 0);
    } finally {
      closeSockets(aliceSocket, outsiderSocket);
    }
  });

  test('presence updates are broadcast to conversation peers only', async () => {
    const carol = await createAccount(ctx, request, { username: 'carol_presence' });
    const stranger = await createAccount(ctx, request, { username: 'stranger_presence' });
    await startConversation(alice, carol);

    const carolSocket = await connectSocket(ctx, carol.token);
    const strangerSocket = await connectSocket(ctx, stranger.token);
    try {
      const strangerEvents = [];
      strangerSocket.on('presence:update', (payload) => strangerEvents.push(payload));

      const offline = waitForEvent(carolSocket, 'presence:update', {
        predicate: (payload) => payload.userId === alice.user.id
      });
      const aliceSocket = await connectSocket(ctx, alice.token);
      const event = await offline;
      assert.equal(event.online, true);

      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.equal(
        strangerEvents.some((e) => e.userId === alice.user.id),
        false,
        'a user with no conversation with Alice must not learn her presence'
      );
      closeSockets(aliceSocket);
    } finally {
      closeSockets(carolSocket, strangerSocket);
    }
  });
});

describe('Blocking', () => {
  test('blocked users cannot message each other', async () => {
    const conversation = await startConversation(alice, bob);
    const blocked = await alice.agent.post(`/api/users/${bob.user.id}/block`);
    assert.equal(blocked.status, 200);

    const attempt = await bob.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Are you there?' });
    assert.equal(attempt.status, 403);
    assert.equal(attempt.body.error.code, 'BLOCKED');

    const blocks = await alice.agent.get('/api/conversations/blocks');
    assert.equal(blocks.body.blocked.some((u) => u.id === bob.user.id), true);

    await alice.agent.delete(`/api/users/${bob.user.id}/block`);
    const unblocked = await bob.agent
      .post(`/api/conversations/${conversation.id}/messages`)
      .send({ text: 'Back online' });
    assert.equal(unblocked.status, 201);
  });
});
