'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin } = require('../test-support/helpers');

test('first-run bootstrap', async (t) => {
  const env = await boot();
  t.after(() => env.close());

  await t.test('reports that setup is required before any account exists', async () => {
    const client = env.client();
    const res = await client.get('/api/bootstrap/status');
    assert.equal(res.status, 200);
    assert.equal(res.body.setupRequired, true);
  });

  await t.test('the API is otherwise closed', async () => {
    const client = env.client();
    const res = await client.get('/api/patients');
    assert.equal(res.status, 401);
    const res2 = await client.get('/api/dashboard');
    assert.equal(res2.status, 401);
  });

  await t.test('a wrong setup code is rejected', async () => {
    const client = env.client();
    const res = await client.post('/api/bootstrap/complete', {
      code: 'AAAA-BBBB',
      fullName: 'Somebody Else',
      username: 'intruder',
      password: 'Another-Password-99!',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'code');
  });

  await t.test('a weak administrator password is rejected', async () => {
    const client = env.client();
    const res = await client.post('/api/bootstrap/complete', {
      code: env.setupCode,
      fullName: 'Alok Ranjan',
      username: 'admin',
      password: 'password123',
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'password');
  });

  let admin;
  await t.test('the printed code creates the first administrator', async () => {
    admin = await setupAdmin(env);
    assert.equal(admin.user.role, 'admin');
    assert.equal(admin.user.username, 'admin');
    assert.ok(admin.user.permissions.includes('user.manage'));
  });

  await t.test('the new administrator can use the API', async () => {
    const res = await admin.client.get('/api/auth/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.setupComplete, true);
    assert.equal(res.body.settings.hospitalName, 'Kalyan Hospital');
  });

  await t.test('public bootstrap is permanently disabled afterwards', async () => {
    const client = env.client();
    const status = await client.get('/api/bootstrap/status');
    assert.equal(status.body.setupRequired, false);

    const again = await client.post('/api/bootstrap/complete', {
      code: env.setupCode,
      fullName: 'Second Admin',
      username: 'admin2',
      password: 'Another-Strong-Pass-1!',
    });
    assert.equal(again.status, 410);

    // Even with a re-generated code, the endpoint stays closed.
    const meta = env.ctx.store.getMeta('bootstrap_code_hash');
    assert.equal(meta, null);
  });

  await t.test('only one admin exists and audit chain records setup', async () => {
    const users = await admin.client.get('/api/admin/users');
    assert.equal(users.status, 200);
    assert.equal(users.body.users.filter((u) => u.role === 'admin').length, 1);

    const verify = await admin.client.get('/api/admin/audit/verify');
    assert.equal(verify.status, 200);
    assert.equal(verify.body.ok, true);

    const audit = await admin.client.get('/api/admin/audit?action=setup');
    assert.equal(audit.status, 200);
    assert.ok(audit.body.events.some((e) => e.action === 'setup.complete'));
  });
});
