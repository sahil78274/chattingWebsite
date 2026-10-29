import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestServer, createAccount, STRONG_PASSWORD } from './helpers.js';

let ctx;

before(async () => {
  ctx = await startTestServer();
});

after(async () => {
  await ctx.close();
});

describe('Registration', () => {
  test('creates an account and returns a safe profile', async () => {
    const res = await request(ctx.url).post('/api/auth/register').send({
      username: 'valid_user',
      email: 'valid@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.accessToken);
    assert.equal(res.body.user.username, 'valid_user');
    assert.equal(res.body.user.email, 'valid@example.com');
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.tokenVersion, undefined);
  });

  test('rejects weak passwords, mismatched confirmation and bad usernames', async () => {
    const weak = await request(ctx.url).post('/api/auth/register').send({
      username: 'weak_user',
      email: 'weak@example.com',
      password: 'short',
      confirmPassword: 'short'
    });
    assert.equal(weak.status, 400);
    assert.ok(weak.body.error.details.password);

    const mismatch = await request(ctx.url).post('/api/auth/register').send({
      username: 'mismatch_user',
      email: 'mismatch@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: 'Different123'
    });
    assert.equal(mismatch.status, 400);
    assert.ok(mismatch.body.error.details.confirmPassword);

    const badName = await request(ctx.url).post('/api/auth/register').send({
      username: 'has spaces!',
      email: 'spaces@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });
    assert.equal(badName.status, 400);
    assert.ok(badName.body.error.details.username);
  });

  test('prevents duplicate usernames and emails (case insensitive)', async () => {
    const account = await createAccount(ctx, request, { username: 'unique_person' });

    const duplicateName = await request(ctx.url).post('/api/auth/register').send({
      username: 'UNIQUE_PERSON',
      email: 'another@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });
    assert.equal(duplicateName.status, 409);
    assert.equal(duplicateName.body.error.message, 'This username is already taken.');
    assert.equal(duplicateName.body.error.details.username, 'This username is already taken.');

    const duplicateEmail = await request(ctx.url).post('/api/auth/register').send({
      username: 'another_person',
      email: account.email.toUpperCase(),
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });
    assert.equal(duplicateEmail.status, 409);
  });
});

describe('Login and sessions', () => {
  test('logs in by username or email and rejects bad credentials', async () => {
    const account = await createAccount(ctx, request, { username: 'login_person' });

    const byUsername = await request(ctx.url)
      .post('/api/auth/login')
      .send({ identifier: 'login_person', password: STRONG_PASSWORD });
    assert.equal(byUsername.status, 200);
    assert.ok(byUsername.body.accessToken);

    const byEmail = await request(ctx.url)
      .post('/api/auth/login')
      .send({ identifier: account.email, password: STRONG_PASSWORD });
    assert.equal(byEmail.status, 200);

    const wrongPassword = await request(ctx.url)
      .post('/api/auth/login')
      .send({ identifier: 'login_person', password: 'WrongPassword123' });
    assert.equal(wrongPassword.status, 401);
    assert.equal(wrongPassword.body.error.code, 'INVALID_CREDENTIALS');

    const unknownUser = await request(ctx.url)
      .post('/api/auth/login')
      .send({ identifier: 'nobody_here', password: STRONG_PASSWORD });
    assert.equal(unknownUser.status, 401);
    // Same message as a wrong password - no account enumeration.
    assert.equal(unknownUser.body.error.message, wrongPassword.body.error.message);
  });

  test('protects /api/auth/me and other private routes without a token', async () => {
    const me = await request(ctx.url).get('/api/auth/me');
    assert.equal(me.status, 401);

    const search = await request(ctx.url).get('/api/users/search?q=a');
    assert.equal(search.status, 401);

    const conversations = await request(ctx.url).get('/api/conversations');
    assert.equal(conversations.status, 401);
  });

  test('cookie based session survives a page reload and logout clears it', async () => {
    const account = await createAccount(ctx, request, { username: 'cookie_person' });

    const viaCookie = await account.agent.get('/api/auth/me');
    assert.equal(viaCookie.status, 200);
    assert.equal(viaCookie.body.user.username, 'cookie_person');

    const loggedOut = await account.agent.post('/api/auth/logout');
    assert.equal(loggedOut.status, 200);

    // The refresh cookie is gone, so a refresh attempt must fail.
    const refresh = await account.agent.post('/api/auth/refresh');
    assert.equal(refresh.status, 401);
  });

  test('rotates refresh tokens and detects replayed tokens', async () => {
    const agent = request.agent(ctx.url);
    await request(ctx.url).post('/api/auth/register').send({
      username: 'rotate_person',
      email: 'rotate@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD
    });
    const login = await agent
      .post('/api/auth/login')
      .send({ identifier: 'rotate_person', password: STRONG_PASSWORD });
    assert.equal(login.status, 200);

    const originalCookie = login.headers['set-cookie'].find((c) => c.startsWith('connectly_rt='));
    const originalToken = decodeURIComponent(originalCookie.split('=')[1].split(';')[0]);

    const firstRefresh = await agent.post('/api/auth/refresh');
    assert.equal(firstRefresh.status, 200);
    const rotatedCookie = firstRefresh.headers['set-cookie'].find((c) => c.startsWith('connectly_rt='));
    assert.notEqual(rotatedCookie, originalCookie);

    // Replaying the already-used token must be rejected and revoke the family.
    const replay = await request(ctx.url)
      .post('/api/auth/refresh')
      .set('Cookie', `connectly_rt=${originalToken}`);
    assert.equal(replay.status, 401);

    const afterReplay = await agent.post('/api/auth/refresh');
    assert.equal(afterReplay.status, 401);
  });
});

describe('Profile management', () => {
  test('updates display name, bio and last-seen privacy', async () => {
    const account = await createAccount(ctx, request);
    const res = await account.agent.patch('/api/auth/me').send({
      displayName: '  Test Person  ',
      bio: 'Hello from Sonipat',
      privacy: { lastSeen: 'nobody' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.displayName, 'Test Person');
    assert.equal(res.body.user.bio, 'Hello from Sonipat');
    assert.equal(res.body.user.privacy.lastSeen, 'nobody');
  });

  test('never exposes another user email through the profile endpoint', async () => {
    const viewer = await createAccount(ctx, request);
    const target = await createAccount(ctx, request);
    const res = await viewer.agent.get(`/api/users/${target.user.id}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, undefined);
  });

  test('changing the password invalidates existing sessions', async () => {
    const account = await createAccount(ctx, request);
    const otherSession = await request(ctx.url)
      .post('/api/auth/login')
      .send({ identifier: account.username, password: STRONG_PASSWORD });
    const otherToken = otherSession.body.accessToken;

    const changed = await account.agent.post('/api/auth/me/password').send({
      currentPassword: STRONG_PASSWORD,
      newPassword: 'NewPassword456',
      confirmPassword: 'NewPassword456'
    });
    assert.equal(changed.status, 200);

    const staleAccess = await request(ctx.url)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${otherToken}`);
    assert.equal(staleAccess.status, 401);
  });
});
