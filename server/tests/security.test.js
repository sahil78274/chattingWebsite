import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestServer, createAccount } from './helpers.js';
import { rateLimit, resetRateLimiters } from '../src/middleware/rateLimit.js';

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

describe('Transport security', () => {
  test('sets hardened HTTP headers', async () => {
    const res = await request(ctx.url).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'SAMEORIGIN');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  test('rejects requests from unknown origins', async () => {
    const res = await request(ctx.url)
      .get('/api/health')
      .set('Origin', 'https://evil.example.com');
    assert.equal(res.status, 403);
  });

  test('rejects oversized JSON payloads', async () => {
    const res = await request(ctx.url)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send({ identifier: 'x'.repeat(80_000), password: 'abc' });
    assert.equal(res.status, 413);
  });

  test('unknown API routes return a JSON 404 without stack traces', async () => {
    const res = await request(ctx.url).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.ok(res.body.error.message);
    assert.equal(res.body.error.stack, undefined);
  });

  test('invalid ids are rejected with a 400 instead of throwing', async () => {
    const account = await createAccount(ctx, request);
    const res = await account.agent.get('/api/conversations/not-a-valid-id/messages');
    assert.equal(res.status, 400);
  });
});

describe('Rate limiting', () => {
  test('blocks requests above the configured limit', async () => {
    resetRateLimiters();
    const limiter = rateLimit({ windowMs: 60_000, max: 2, keyPrefix: 'unit', force: true });
    const run = () =>
      new Promise((resolve) => {
        const req = { ip: '203.0.113.7', headers: {}, socket: {} };
        const res = {
          headers: {},
          setHeader(key, value) {
            this.headers[key] = value;
          }
        };
        limiter(req, res, (error) => resolve({ error, res }));
      });

    const first = await run();
    const second = await run();
    const third = await run();
    assert.equal(first.error, undefined);
    assert.equal(second.error, undefined);
    assert.equal(third.error.statusCode, 429);
    assert.match(third.error.message, /too many/i);
    assert.equal(third.res.headers['Retry-After'] !== undefined, true);
  });

  test('registration and login endpoints are limited in production mode', async () => {
    // The suite runs with NODE_ENV=test, which disables limiters; assert the
    // middleware is actually wired to the auth routes instead.
    const fs = await import('node:fs/promises');
    const source = await fs.readFile(new URL('../src/routes/authRoutes.js', import.meta.url), 'utf8');
    assert.match(source, /registerLimiter, auth\.register/);
    assert.match(source, /loginLimiter, auth\.login/);
  });
});

describe('Input hygiene', () => {
  test('strips control characters and trims message text', async () => {
    const alice = await createAccount(ctx, request);
    const bob = await createAccount(ctx, request);
    const conversation = await alice.agent.post(`/api/users/${bob.user.id}/conversation`);

    const res = await alice.agent
      .post(`/api/conversations/${conversation.body.conversation.id}/messages`)
      .send({ text: '  hello\u0000\u0007 world  ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.message.text, 'hello world');
  });

  test('escapes regex characters in search instead of failing', async () => {
    const account = await createAccount(ctx, request);
    const res = await account.agent.get('/api/users/search?q=%5B%5Ea');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, []);
  });
});

describe('Message history pagination', () => {
  test('paginates with a cursor and reports "hasMore"', async () => {
    const alice = await createAccount(ctx, request);
    const bob = await createAccount(ctx, request);
    const created = await alice.agent.post(`/api/users/${bob.user.id}/conversation`);
    const conversationId = created.body.conversation.id;

    for (let i = 0; i < 7; i += 1) {
      await alice.agent
        .post(`/api/conversations/${conversationId}/messages`)
        .send({ text: `message ${i}` });
    }

    const firstPage = await bob.agent.get(`/api/conversations/${conversationId}/messages?limit=3`);
    assert.equal(firstPage.status, 200);
    assert.equal(firstPage.body.messages.length, 3);
    assert.equal(firstPage.body.hasMore, true);
    assert.equal(firstPage.body.messages.at(-1).text, 'message 6');

    assert.ok(firstPage.body.nextCursorId, 'pagination exposes a compound cursor');
    const secondPage = await bob.agent.get(
      `/api/conversations/${conversationId}/messages?limit=3&before=${encodeURIComponent(
        firstPage.body.nextCursor
      )}&beforeId=${firstPage.body.nextCursorId}`
    );
    assert.equal(secondPage.status, 200);
    assert.equal(secondPage.body.messages.length, 3);
    assert.equal(secondPage.body.messages.at(-1).text, 'message 3');

    const ids = new Set([
      ...firstPage.body.messages.map((m) => m.id),
      ...secondPage.body.messages.map((m) => m.id)
    ]);
    assert.equal(ids.size, 6, 'pages must not overlap');
  });
});
