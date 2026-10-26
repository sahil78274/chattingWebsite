import http from 'node:http';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../src/app.js';
import { createSocketServer } from '../src/sockets/index.js';
import { getStore } from '../src/store/index.js';
import { resetRateLimiters } from '../src/middleware/rateLimit.js';
import { disconnectMongo } from '../src/config/db.js';

export const STRONG_PASSWORD = 'Connectly123';

/**
 * Boots the real Express app + Socket.IO server on an ephemeral port against a
 * clean store. Used by every test file.
 *
 * Run against MongoDB with: DB_DRIVER=mongo MONGODB_URI=... npm run test:mongo
 */
export async function startTestServer() {
  resetRateLimiters();
  const store = getStore();
  await store.reset();

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, store);
  app.set('io', io);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    app,
    server,
    io,
    store,
    port,
    url: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => server.close(resolve));
      if (store.driver === 'mongo') await disconnectMongo();
    }
  };
}

export function uniqueSuffix() {
  return Math.random().toString(36).slice(2, 8);
}

/** Registers a user and returns {agent, user, token, cookie}. */
export async function createAccount(ctx, request, { username, email, password = STRONG_PASSWORD } = {}) {
  const suffix = uniqueSuffix();
  const finalUsername = username || `user_${suffix}`;
  const finalEmail = email || `${finalUsername}@example.com`;
  const agent = request.agent(ctx.url);
  const res = await agent.post('/api/auth/register').send({
    username: finalUsername,
    email: finalEmail,
    password,
    confirmPassword: password
  });
  if (res.status !== 201) {
    throw new Error(`Registration failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return {
    agent,
    user: res.body.user,
    token: res.body.accessToken,
    username: finalUsername,
    email: finalEmail,
    password
  };
}

export function connectSocket(ctx, token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(ctx.url, {
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: 5000
    });
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', (error) => reject(error));
  });
}

export function emitWithAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ack of ${event}`)), timeoutMs);
    socket.emit(event, payload, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

export function waitForEvent(socket, event, { timeoutMs = 5000, predicate = () => true } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for socket event "${event}"`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

export function closeSockets(...sockets) {
  for (const socket of sockets) socket?.close();
}
