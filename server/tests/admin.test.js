import test, { before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { startTestServer, createAccount, STRONG_PASSWORD } from './helpers.js';

let ctx;
let admin;
let alice;
let bob;

before(async () => {
  ctx = await startTestServer();
  alice = await createAccount(ctx, request, { username: 'alice_admin_spec' });
  bob = await createAccount(ctx, request, { username: 'bob_admin_spec' });
  admin = await createAccount(ctx, request, { username: 'root_admin_spec' });
  // Server-side promotion, mirrors BOOTSTRAP_ADMIN_USERNAME. Never via the API.
  await ctx.store.updateUser(admin.user.id, { role: 'admin' });
});

after(async () => {
  await ctx.close();
});

describe('Admin authorization', () => {
  test('unauthenticated visitors get 401 on every admin endpoint', async () => {
    for (const [method, path] of [
      ['get', '/api/admin/overview'],
      ['get', '/api/admin/me'],
      ['get', '/api/admin/users'],
      ['get', '/api/admin/reports'],
      ['get', '/api/admin/audit']
    ]) {
      const res = await request(ctx.url)[method](path);
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.body.error.code, 'NO_TOKEN');
    }
  });

  test('ordinary users get 403 even when calling the API directly', async () => {
    const getOverview = await alice.agent.get('/api/admin/overview');
    assert.equal(getOverview.status, 403);
    assert.equal(getOverview.body.error.code, 'ADMIN_ONLY');

    const reports = await alice.agent.get('/api/admin/reports');
    assert.equal(reports.status, 403);

    const users = await alice.agent.get('/api/admin/users');
    assert.equal(users.status, 403);

    const ownPromotion = await alice.agent
      .patch(`/api/admin/users/${alice.user.id}/role`)
      .send({ role: 'admin' });
    assert.equal(ownPromotion.status, 403);

    const profile = await alice.agent.get('/api/admin/me');
    assert.equal(profile.status, 403);
  });

  test('registration and profile updates cannot escalate to admin', async () => {
    const signup = await request(ctx.url).post('/api/auth/register').send({
      username: 'sneaky_signup',
      email: 'sneaky_signup@example.com',
      password: STRONG_PASSWORD,
      confirmPassword: STRONG_PASSWORD,
      role: 'admin',
      isAdmin: true
    });
    assert.equal(signup.status, 201);
    assert.equal(signup.body.user.role, 'user');
    assert.equal(signup.body.user.status, 'active');

    const agent = request.agent(ctx.url);
    const login = await agent
      .post('/api/auth/login')
      .send({ identifier: 'sneaky_signup', password: STRONG_PASSWORD });
    assert.equal(login.status, 200);

    const patch = await agent.patch('/api/auth/me').send({ role: 'admin', status: 'active' });
    assert.ok([200, 400].includes(patch.status));
    if (patch.status === 200) assert.equal(patch.body.user.role, 'user');

    const stored = await ctx.store.findUserByUsername('sneaky_signup');
    assert.equal(stored.role, 'user');

    const forbidden = await agent.get('/api/admin/overview');
    assert.equal(forbidden.status, 403);
  });

  test('a suspended administrator loses access immediately', async () => {
    const temp = await createAccount(ctx, request, { username: 'temp_admin_spec' });
    await ctx.store.updateUser(temp.user.id, { role: 'admin' });
    const allowed = await temp.agent.get('/api/admin/overview');
    assert.equal(allowed.status, 200);

    await ctx.store.updateUser(temp.user.id, { status: 'suspended', tokenVersion: 1 });
    const denied = await temp.agent.get('/api/admin/overview');
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error.code, 'ACCOUNT_SUSPENDED');

    // Restore as a plain user so this account never counts as a second admin.
    await ctx.store.updateUser(temp.user.id, { status: 'active', role: 'user' });
  });
});

describe('Admin dashboard and user management', () => {
  test('overview reports real database counts and recent registrations', async () => {
    const conversation = await alice.agent.post(`/api/users/${bob.user.id}/conversation`);
    assert.equal(conversation.status, 201);
    const conversationId = conversation.body.conversation.id;

    const message = await alice.agent
      .post(`/api/conversations/${conversationId}/messages`)
      .send({ text: 'hello admin dashboard' });
    assert.equal(message.status, 201);

    const res = await admin.agent.get('/api/admin/overview');
    assert.equal(res.status, 200);
    assert.ok(res.body.counts.total >= 4);
    assert.equal(res.body.totals.users, res.body.counts.total);
    assert.ok(res.body.totals.conversations >= 1);
    assert.ok(res.body.totals.messages >= 1);
    assert.ok(Array.isArray(res.body.recentRegistrations));
    assert.ok(res.body.recentRegistrations.length > 0);
    assert.equal(res.body.recentRegistrations[0].role !== undefined, true);
    assert.ok(res.body.reports && typeof res.body.reports.open === 'number');

    const leaked = JSON.stringify(res.body);
    assert.ok(!leaked.includes('passwordHash'));
    assert.ok(!leaked.includes('tokenVersion'));
  });

  test('user search and pagination are server-side', async () => {
    const res = await admin.agent.get('/api/admin/users?limit=2&page=1');
    assert.equal(res.status, 200);
    assert.equal(res.body.pageSize, 2);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.users.length, 2);
    assert.ok(res.body.total >= 4);
    assert.equal(res.body.hasMore, true);

    const second = await admin.agent.get('/api/admin/users?limit=2&page=2');
    assert.equal(second.status, 200);
    assert.equal(second.body.page, 2);
    assert.notEqual(second.body.users[0].id, res.body.users[0].id);

    const search = await admin.agent.get('/api/admin/users?q=alice_admin');
    assert.equal(search.status, 200);
    assert.equal(search.body.users.length, 1);
    assert.equal(search.body.users[0].username, 'alice_admin_spec');

    const filter = await admin.agent.get('/api/admin/users?status=suspended');
    assert.equal(filter.status, 200);
    assert.equal(filter.body.users.length, 0);
  });

  test('admin profile is authenticated and free of secrets', async () => {
    const res = await admin.agent.get('/api/admin/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, 'root_admin_spec');
    assert.equal(res.body.user.role, 'admin');
    assert.ok(res.body.user.email);
    assert.equal(res.body.user.passwordHash, undefined);
    assert.equal(res.body.user.tokenVersion, undefined);
  });

  test('a logged-out administrator session can no longer read admin data', async () => {
    const temp = await createAccount(ctx, request, { username: 'logout_admin_spec' });
    await ctx.store.updateUser(temp.user.id, { role: 'admin' });
    assert.equal((await temp.agent.get('/api/admin/overview')).status, 200);

    const out = await temp.agent.post('/api/auth/logout');
    assert.equal(out.status, 200);

    const after = await temp.agent.get('/api/admin/overview');
    assert.equal(after.status, 401);

    await ctx.store.updateUser(temp.user.id, { role: 'user' });
  });
});

describe('Admin moderation of reports', () => {
  test('reports are listed without private message contents and can be triaged', async () => {
    const report = await bob.agent.post(`/api/users/${alice.user.id}/report`).send({
      reason: 'spam',
      details: 'Repeated promotional messages'
    });
    assert.equal(report.status, 201);
    const reportId = report.body.reportId;
    assert.ok(reportId);

    const list = await admin.agent.get('/api/admin/reports?status=open');
    assert.equal(list.status, 200);
    const row = list.body.reports.find((item) => item.id === reportId);
    assert.ok(row, 'report should be visible to the administrator');
    assert.equal(row.reason, 'spam');
    assert.equal(row.details, 'Repeated promotional messages');
    assert.equal(row.status, 'open');
    assert.equal(row.reporter.username, 'bob_admin_spec');
    assert.equal(row.reportedUser.username, 'alice_admin_spec');
    assert.equal(row.message, undefined);
    assert.equal(row.messageText, undefined);
    assert.equal(row.conversation, undefined);
    assert.equal(row.reporter.email, undefined);

    const reviewed = await admin.agent
      .patch(`/api/admin/reports/${reportId}`)
      .send({ status: 'reviewed' });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.report.status, 'reviewed');

    const openAgain = await admin.agent.get('/api/admin/reports?status=open');
    assert.ok(!openAgain.body.reports.some((item) => item.id === reportId));

    const reviewedList = await admin.agent.get('/api/admin/reports?status=reviewed');
    assert.ok(reviewedList.body.reports.some((item) => item.id === reportId));

    const audit = await admin.agent.get('/api/admin/audit');
    assert.ok(audit.body.logs.some((log) => log.action === 'admin.report.update'));
  });

  test('invalid report updates are rejected without touching the database', async () => {
    const badStatus = await admin.agent.patch('/api/admin/reports/000000000000000000000001').send({
      status: 'deleted'
    });
    assert.equal(badStatus.status, 400);

    const missing = await admin.agent.patch('/api/admin/reports/000000000000000000000001').send({
      status: 'closed'
    });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'REPORT_NOT_FOUND');
  });
});

describe('Administrator bootstrap', () => {
  test('promotes only an explicitly configured account, only when no active admin exists', async () => {
    const { default: config } = await import('../src/config/env.js');
    const { bootstrapAdmin } = await import('../src/services/adminService.js');

    const candidate = await createAccount(ctx, request, { username: 'bootstrap_candidate' });
    config.admin.bootstrapUsername = candidate.username;

    try {
      // An active administrator already exists, so nothing is promoted even
      // though the environment variable names this account.
      const skipped = await bootstrapAdmin(ctx.store);
      assert.equal(skipped, null);
      assert.equal((await ctx.store.findUserByUsername('bootstrap_candidate')).role, 'user');

      // Simulate a fresh deployment with no administrators at all.
      const all = await ctx.store.listUsersAdmin({ limit: 50 });
      for (const row of all.users) await ctx.store.updateUser(row._id || row.id, { role: 'user' });

      const promoted = await bootstrapAdmin(ctx.store);
      assert.equal(promoted.role, 'admin');
      assert.equal((await ctx.store.findUserByUsername('bootstrap_candidate')).role, 'admin');

      // Idempotent: a second boot leaves the account as-is.
      const again = await bootstrapAdmin(ctx.store);
      assert.equal(again.role, 'admin');

      // The bootstrap never invented a password or created a new account.
      const candidateRecord = await ctx.store.findUserByUsername('bootstrap_candidate');
      assert.ok(candidateRecord.passwordHash);
      assert.equal(candidateRecord.username, 'bootstrap_candidate');
    } finally {
      config.admin.bootstrapUsername = '';
      // Restore the original administrator for clarity if the suite is re-run.
      await ctx.store.updateUser(admin.user.id, { role: 'admin' });
      await ctx.store.updateUser(candidate.user.id, { role: 'user' });
    }
  });
});

describe('ADMIN_EMAIL bootstrap', () => {
  /** Clears the administrator role from every account so bootstrap can run. */
  async function clearAdmins() {
    const all = await ctx.store.listUsersAdmin({ limit: 100, status: 'all' });
    for (const row of all.users) {
      if (row.role === 'admin') await ctx.store.updateUser(row._id || row.id, { role: 'user' });
    }
  }

  async function withConfig(patch, fn) {
    const { default: config } = await import('../src/config/env.js');
    const previous = {
      email: config.admin.email,
      bootstrapUsername: config.admin.bootstrapUsername,
      bootstrapEmail: config.admin.bootstrapEmail
    };
    config.admin.email = patch.email ?? '';
    config.admin.bootstrapUsername = patch.bootstrapUsername ?? '';
    config.admin.bootstrapEmail = patch.bootstrapEmail ?? '';
    try {
      return await fn(config);
    } finally {
      config.admin.email = previous.email;
      config.admin.bootstrapUsername = previous.bootstrapUsername;
      config.admin.bootstrapEmail = previous.bootstrapEmail;
      // Always leave a working administrator behind for any later test.
      await ctx.store.updateUser(admin.user.id, { role: 'admin' });
    }
  }

  test('no configured email is a silent no-op', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    await withConfig({}, async () => {
      assert.equal(await bootstrapAdmin(ctx.store), null);
    });
  });

  test('promotes only the account registered with ADMIN_EMAIL', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const target = await createAccount(ctx, request, { username: 'email_admin_target' });
    const bystander = await createAccount(ctx, request, { username: 'email_admin_bystander' });
    const before = await ctx.store.findUserByUsername('email_admin_target');

    await withConfig({ email: target.email }, async () => {
      await clearAdmins();
      const promoted = await bootstrapAdmin(ctx.store);
      assert.equal(promoted.role, 'admin');
      assert.equal(promoted._id || promoted.id, target.user.id);

      const stored = await ctx.store.findUserByUsername('email_admin_target');
      assert.equal(stored.role, 'admin');
      // Password is never touched and no account is created.
      assert.equal(stored.passwordHash, before.passwordHash);
      assert.equal((await ctx.store.findUserByUsername('email_admin_bystander')).role, 'user');
      assert.equal((await ctx.store.findUserByUsername('email_admin_target')).email, target.email);

      // Idempotent on a second boot.
      const again = await bootstrapAdmin(ctx.store);
      assert.equal(again.role, 'admin');

      // The promoted account can log in with its EXISTING password.
      const login = await request(ctx.url)
        .post('/api/auth/login')
        .send({ identifier: target.email, password: STRONG_PASSWORD });
      assert.equal(login.status, 200);
      assert.equal(login.body.user.role, 'admin');

      const dashboard = await request(ctx.url)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${login.body.accessToken}`);
      assert.equal(dashboard.status, 200);

      // Everyone else is still refused.
      const normal = await request(ctx.url)
        .get('/api/admin/overview')
        .set('Authorization', `Bearer ${(await request(ctx.url).post('/api/auth/login').send({ identifier: 'email_admin_bystander', password: STRONG_PASSWORD })).body.accessToken}`);
      assert.equal(normal.status, 403);
    });

    await ctx.store.updateUser(bystander.user.id, { role: 'user' });
  });

  test('email matching follows the signup normalisation rules', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const target = await createAccount(ctx, request, { username: 'mixed_case_email' });

    await withConfig({ email: `  ${target.email.toUpperCase()}  ` }, async () => {
      await clearAdmins();
      const promoted = await bootstrapAdmin(ctx.store);
      assert.ok(promoted, 'mixed-case / padded ADMIN_EMAIL should still match');
      assert.equal((await ctx.store.findUserByUsername('mixed_case_email')).role, 'admin');
    });
  });

  test('an unknown or malformed ADMIN_EMAIL never creates or promotes anyone', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const totalBefore = (await ctx.store.listUsersAdmin({ limit: 100, status: 'all' })).total;

    await withConfig({ email: 'nobody-registered-at-all@example.com' }, async () => {
      await clearAdmins();
      assert.equal(await bootstrapAdmin(ctx.store), null);
      assert.equal(
        await ctx.store.findUserByEmail('nobody-registered-at-all@example.com'),
        null,
        'bootstrap must never create an account'
      );
      assert.equal(await ctx.store.countActiveAdmins(), 0);
    });

    await withConfig({ email: 'not-an-email' }, async () => {
      await clearAdmins();
      assert.equal(await bootstrapAdmin(ctx.store), null);
      assert.equal(await ctx.store.countActiveAdmins(), 0);
      // A malformed value is treated like "no target", so the legacy
      // variables are not silently used instead.
      assert.equal(await bootstrapAdmin(ctx.store), null);
    });

    const totalAfter = (await ctx.store.listUsersAdmin({ limit: 100, status: 'all' })).total;
    assert.equal(totalAfter, totalBefore);
  });

  test('an existing administrator is neither overwritten nor demoted', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const challenger = await createAccount(ctx, request, { username: 'challenger_account' });

    await ctx.store.updateUser(admin.user.id, { role: 'admin', status: 'active' });
    await withConfig({ email: challenger.email }, async () => {
      assert.equal(await bootstrapAdmin(ctx.store), null);
      assert.equal((await ctx.store.findUserByUsername('challenger_account')).role, 'user');
      assert.equal((await ctx.store.findUserByUsername('root_admin_spec')).role, 'admin');
    });
  });

  test('a suspended account is not promoted', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const victim = await createAccount(ctx, request, { username: 'suspended_target' });
    await ctx.store.updateUser(victim.user.id, { status: 'suspended' });

    await withConfig({ email: victim.email }, async () => {
      await clearAdmins();
      assert.equal(await bootstrapAdmin(ctx.store), null);
      assert.equal((await ctx.store.findUserByUsername('suspended_target')).role, 'user');
    });

    await ctx.store.updateUser(victim.user.id, { status: 'active' });
  });

  test('ADMIN_EMAIL wins over the legacy bootstrap variables', async () => {
    const { bootstrapAdmin } = await import('../src/services/adminService.js');
    const wanted = await createAccount(ctx, request, { username: 'wanted_admin' });
    const legacy = await createAccount(ctx, request, { username: 'legacy_admin' });

    await withConfig({ email: wanted.email, bootstrapUsername: legacy.username }, async () => {
      await clearAdmins();
      const promoted = await bootstrapAdmin(ctx.store);
      assert.equal(promoted._id || promoted.id, wanted.user.id);
      assert.equal((await ctx.store.findUserByUsername('legacy_admin')).role, 'user');
    });

    await ctx.store.updateUser(wanted.user.id, { role: 'user' });
    await ctx.store.updateUser(legacy.user.id, { role: 'user' });
  });
});
