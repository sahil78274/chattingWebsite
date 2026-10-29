import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConversationReceipt,
  conversationKey,
  findMessageIndex,
  isId,
  mergeMessageRecord,
  mergeServerMessage,
  messageStatus,
  reconcileMessages
} from './messages.js';

const THREAD = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const ALICE = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const BOB = 'cccccccccccccccccccccccc';

function msg(overrides = {}) {
  return {
    id: overrides.id || 'msg-1',
    clientId: overrides.clientId || 'client-1',
    conversationId: THREAD,
    senderId: ALICE,
    text: 'hello',
    createdAt: '2026-10-29T10:00:00.000Z',
    deliveredAt: null,
    readAt: null,
    ...overrides
  };
}

test('optimistic send is replaced by the canonical server message via clientId', () => {
  const optimistic = msg({ id: 'temp-client-1', clientId: 'client-1', pending: true });
  const server = msg({ id: 'permanent-id', clientId: 'client-1', pending: false });
  const merged = mergeServerMessage([optimistic], server);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'permanent-id');
  assert.equal(merged[0].pending, false);
  assert.equal(merged[0].text, 'hello');
});

test('ack and socket delivery of the same message do not duplicate it', () => {
  const optimistic = msg({ id: 'temp-client-1', clientId: 'client-1', pending: true });
  const server = msg({ id: 'permanent-id', clientId: 'client-1' });
  const afterAck = mergeServerMessage([optimistic], server);
  const afterSocket = mergeServerMessage(afterAck, server);
  assert.equal(afterSocket.length, 1);
  assert.equal(afterSocket[0].id, 'permanent-id');
});

test('a stale history fetch cannot drop a message that was just sent', () => {
  const older = msg({ id: 'old', clientId: 'c-old', text: 'earlier', createdAt: '2026-10-29T09:00:00.000Z' });
  const justSent = msg({
    id: 'new-id',
    clientId: 'c-new',
    text: 'just sent',
    createdAt: '2026-10-29T10:05:00.000Z',
    pending: false
  });
  const staleServerPage = [older];
  const reconciled = reconcileMessages([older, justSent], staleServerPage, THREAD);
  assert.equal(reconciled.some((item) => item.id === 'new-id'), true);
  assert.equal(reconciled.some((item) => item.id === 'old'), true);
});

test('reconnect snapshot keeps older paginated messages that are not on the latest page', () => {
  const older = msg({ id: 'page-2', clientId: 'c-2', text: 'from earlier page', createdAt: '2026-10-29T08:00:00.000Z' });
  const latest = msg({ id: 'page-1', clientId: 'c-1', text: 'latest', createdAt: '2026-10-29T10:00:00.000Z' });
  const reconciled = reconcileMessages([older, latest], [latest], THREAD);
  assert.deepEqual(
    reconciled.map((item) => item.id),
    ['page-2', 'page-1']
  );
});

test('receipts are monotonic: read is never downgraded to delivered or sent', () => {
  const local = msg({ id: 'm1', deliveredAt: '2026-10-29T10:00:01.000Z', readAt: '2026-10-29T10:00:02.000Z' });
  const incoming = msg({ id: 'm1', deliveredAt: null, readAt: null });
  const merged = mergeMessageRecord(local, incoming);
  assert.equal(merged.readAt, '2026-10-29T10:00:02.000Z');
  assert.equal(merged.deliveredAt, '2026-10-29T10:00:01.000Z');
  assert.equal(messageStatus(merged), 'read');
});

test('a read receipt implies delivered', () => {
  const local = msg({ id: 'm1' });
  const updated = applyConversationReceipt([local], {
    conversationId: THREAD,
    viewerId: ALICE,
    readAt: '2026-10-29T10:00:05.000Z'
  });
  assert.equal(updated[0].readAt, '2026-10-29T10:00:05.000Z');
  assert.equal(updated[0].deliveredAt, '2026-10-29T10:00:05.000Z');
  assert.equal(messageStatus(updated[0]), 'read');
});

test('receipts only apply to the current user\'s outgoing messages', () => {
  const mine = msg({ id: 'mine', senderId: ALICE });
  const theirs = msg({ id: 'theirs', senderId: BOB, clientId: 'c-bob' });
  const updated = applyConversationReceipt([mine, theirs], {
    conversationId: THREAD,
    viewerId: ALICE,
    deliveredAt: '2026-10-29T10:00:03.000Z'
  });
  assert.equal(updated[0].deliveredAt, '2026-10-29T10:00:03.000Z');
  assert.equal(updated[1].deliveredAt, null);
});

test('failed messages are not silently marked delivered', () => {
  const failed = msg({ id: 'temp-x', pending: false, failed: true, deliveredAt: null });
  const updated = applyConversationReceipt([failed], {
    conversationId: THREAD,
    viewerId: ALICE,
    deliveredAt: '2026-10-29T10:00:03.000Z'
  });
  assert.equal(updated[0].failed, true);
  assert.equal(updated[0].deliveredAt, null);
});

test('findMessageIndex matches temp ids by clientId rather than the placeholder id', () => {
  const list = [msg({ id: 'temp-client-1', clientId: 'client-1', pending: true })];
  assert.equal(findMessageIndex(list, msg({ id: 'permanent-id', clientId: 'client-1' })), 0);
});

test('status helper reports pending, sent, delivered and read in order', () => {
  assert.equal(messageStatus(msg({ pending: true })), 'pending');
  assert.equal(messageStatus(msg()), 'sent');
  assert.equal(messageStatus(msg({ deliveredAt: '2026-10-29T10:00:01.000Z' })), 'delivered');
  assert.equal(
    messageStatus(msg({ deliveredAt: '2026-10-29T10:00:01.000Z', readAt: '2026-10-29T10:00:02.000Z' })),
    'read'
  );
  assert.equal(messageStatus(msg({ failed: true })), 'failed');
});

test('conversationKey reads id, _id or $oid and rejects objects without an id', () => {
  const hex = 'a'.repeat(24);
  assert.equal(conversationKey(hex), hex);
  assert.equal(conversationKey({ id: hex }), hex);
  assert.equal(conversationKey({ _id: hex }), hex);
  assert.equal(conversationKey({ $oid: hex }), hex);
  assert.equal(conversationKey({}), '');
  assert.equal(isId(hex), true);
  assert.equal(isId('z'.repeat(24)), false);
  assert.equal(isId('not-an-id'), false);
});
