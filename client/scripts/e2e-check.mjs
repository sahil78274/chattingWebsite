/**
 * Live end-to-end smoke check against a running Connectly stack (through the
 * Vite dev proxy, i.e. exactly what a browser sees in development).
 *
 *   node e2e-check.mjs            # defaults to http://127.0.0.1:5173
 *
 * It simulates two independent browser sessions: register + search + open a
 * conversation + real-time messages in both directions + history + denied
 * access for a third account + refresh-token rotation.
 */
import { io } from 'socket.io-client';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:5173';
const suffix = Math.random().toString(36).slice(2, 7);
const password = 'Connectly123';
let failures = 0;

function check(label, condition, extra) {
  const status = condition ? 'PASS' : 'FAIL';
  if (!condition) failures += 1;
  console.log(`${status}  ${label}${extra && !condition ? ` -> ${JSON.stringify(extra)}` : ''}`);
}

async function call(path, { method = 'GET', body, token, cookie } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() || [] };
}

async function register(username) {
  const res = await call('/auth/register', {
    method: 'POST',
    body: {
      username,
      email: `${username}@example.com`,
      password,
      confirmPassword: password
    }
  });
  if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.data)}`);
  return res;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ['websocket'], reconnection: false });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once(socket, event, predicate = () => true, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeout);
    socket.on(event, (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const emitAck = (socket, event, payload) =>
  new Promise((resolve) => socket.emit(event, payload, resolve));

async function main() {
  const aName = `e2e_a_${suffix}`;
  const bName = `e2e_b_${suffix}`;
  const cName = `e2e_c_${suffix}`;

  const a = await register(aName);
  const b = await register(bName);
  const c = await register(cName);
  check('two accounts created in separate sessions', a.status === 201 && b.status === 201);

  const search = await call(`/users/search?q=${encodeURIComponent(bName.slice(0, 8))}`, {
    token: a.data.accessToken
  });
  check(
    'user A finds user B by partial username',
    search.status === 200 && search.data.results.some((u) => u.username === bName)
  );
  check(
    'search results exclude the viewer and hide emails',
    !search.data.results.some((u) => u.username === aName) &&
      search.data.results.every((u) => u.email === undefined)
  );

  const started = await call(`/users/${b.data.user.id}/conversation`, {
    method: 'POST',
    token: a.data.accessToken
  });
  const conversationId = started.data?.conversation?.id;
  check('conversation created from search result', started.status === 201 && Boolean(conversationId));

  const again = await call(`/users/${b.data.user.id}/conversation`, {
    method: 'POST',
    token: a.data.accessToken
  });
  check('re-opening does not create a duplicate conversation', again.data?.conversation?.id === conversationId);

  const socketA = await connect(a.data.accessToken);
  const socketB = await connect(b.data.accessToken);
  check('both users connect authenticated sockets', socketA.connected && socketB.connected);

  await emitAck(socketA, 'conversation:join', { conversationId });
  await emitAck(socketB, 'conversation:join', { conversationId });

  const receivedByB = once(socketB, 'message:new', (p) => p.message.text === 'Hello from A');
  const ackA = await emitAck(socketA, 'message:send', {
    conversationId,
    text: 'Hello from A',
    clientId: `cli-${suffix}-1`
  });
  const delivered = await receivedByB;
  check('user B receives A\'s message in real time', ackA.ok && delivered.message.senderId === a.data.user.id);

  const receivedByA = once(socketA, 'message:new', (p) => p.message.text === 'Reply from B');
  const readReceipt = once(socketA, 'message:read', (p) => p.conversationId === conversationId);
  await emitAck(socketB, 'message:send', { conversationId, text: 'Reply from B', clientId: `cli-${suffix}-2` });
  const reply = await receivedByA;
  check('user A receives B\'s reply in real time', reply.message.senderId === b.data.user.id);

  await emitAck(socketB, 'message:read', { conversationId });
  await readReceipt;
  check('read receipt is delivered back to the sender', true);

  // History after a "refresh".
  const historyA = await call(`/conversations/${conversationId}/messages`, { token: a.data.accessToken });
  const historyB = await call(`/conversations/${conversationId}/messages`, { token: b.data.accessToken });
  check(
    'persisted history is returned to both participants',
    historyA.status === 200 &&
      historyB.status === 200 &&
      historyA.data.messages.length === 2 &&
      historyB.data.messages.length === 2
  );
  check(
    'history carries read receipts and server timestamps',
    historyA.data.messages.every((m) => m.createdAt && m.id) &&
      historyA.data.messages.some((m) => m.readAt)
  );

  const listA = await call('/conversations', { token: a.data.accessToken });
  check(
    'conversation list shows the latest message preview',
    listA.data.conversations[0]?.lastMessage?.text === 'Reply from B'
  );

  const outsider = await call(`/conversations/${conversationId}/messages`, { token: c.data.accessToken });
  check('third user is denied access to the private conversation', outsider.status === 403);

  const outsiderSend = await call(`/conversations/${conversationId}/messages`, {
    method: 'POST',
    token: c.data.accessToken,
    body: { text: 'intruder' }
  });
  check('third user cannot post into the conversation', outsiderSend.status === 403);

  const spySocket = await connect(c.data.accessToken);
  const spyJoin = await emitAck(spySocket, 'conversation:join', { conversationId });
  check('socket room join is rejected for non-members', spyJoin.ok === false && spyJoin.error.status === 403);

  // Refresh-token rotation using the httpOnly cookie.
  const refreshCookie = b.setCookie?.find((value) => value.startsWith('connectly_rt='));
  if (refreshCookie) {
    const cookie = refreshCookie.split(';')[0];
    const rotated = await call('/auth/refresh', { method: 'POST', cookie });
    check('refresh cookie issues a new access token', rotated.status === 200 && Boolean(rotated.data.accessToken));
    const replay = await call('/auth/refresh', { method: 'POST', cookie });
    check('replayed refresh token is rejected', replay.status === 401);
  } else {
    check('refresh cookie was set on registration', false, b.setCookie);
  }

  const meB = await call('/auth/me', { token: b.data.accessToken });
  check('session survives and /auth/me returns the profile', meB.status === 200 && meB.data.user.username === bName);

  const unauth = await call('/conversations');
  check('unauthenticated requests are rejected', unauth.status === 401);

  socketA.close();
  socketB.close();
  spySocket.close();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E FAILED:', error);
  process.exit(1);
});
