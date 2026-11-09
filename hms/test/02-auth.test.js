'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeStaff, userVersion } = require('../test-support/helpers');

test('authentication and sessions', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin, user: adminUser } = await setupAdmin(env);
  await makeStaff(env, admin, { username: 'desk0', role: 'reception', password: 'Sunrise-Desk-2026!' });

  await t.test('wrong password does not reveal whether the account exists', async () => {
    const c = env.client();
    const known = await c.post('/api/auth/login', { username: 'admin', password: 'wrong-password-x' });
    const unknown = await c.post('/api/auth/login', { username: 'nobody', password: 'wrong-password-x' });
    assert.equal(known.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(known.body.error.message, unknown.body.error.message);
  });

  await t.test('login returns a token and sets an HttpOnly cookie', async () => {
    const c = env.client();
    const res = await c.request('POST', '/api/auth/login', {
      body: { username: 'admin', password: 'Sunrise-Clinic-2026!' },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token.length > 30);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
  });

  await t.test('a cookie-authenticated write without a CSRF token is rejected', async () => {
    const c = env.client();
    await c.login('desk0', 'Sunrise-Desk-2026!');
    const blocked = await c.request('POST', '/api/patients', {
      body: { firstName: 'Csrf', lastName: 'Probe', dob: '1990-01-01', phone: '9000000001' },
      cookieAuth: true,
    });
    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error.message, /CSRF/);

    // With the CSRF header present the same cookie call succeeds.
    const ok = await c.request('POST', '/api/patients', {
      body: { firstName: 'Csrf', lastName: 'Probe', dob: '1990-01-01', phone: '9000000001' },
      headers: { 'x-csrf-token': c.csrf },
      cookieAuth: true,
    });
    assert.equal(ok.status, 201);
  });

  await t.test('a forged Origin header is refused', async () => {
    const res = await admin.request('POST', '/api/auth/logout', { headers: { origin: 'http://evil.example' } });
    assert.equal(res.status, 403);
  });

  await t.test('role permissions are enforced server-side', async () => {
    const { client: reception } = await makeStaff(env, admin, { username: 'reception1', role: 'reception' });

    const patient = await reception.post('/api/patients', {
      firstName: 'Ravi', lastName: 'Kumar', dob: '1985-03-02', sex: 'male', phone: '9812345678',
    });
    assert.equal(patient.status, 201, 'reception can register patients');

    const denied = await reception.get('/api/admin/users');
    assert.equal(denied.status, 403);

    const auditDenied = await reception.get('/api/admin/audit');
    assert.equal(auditDenied.status, 403);

    const visit = await reception.post('/api/visits', { patientId: patient.body.patient.id });
    assert.equal(visit.status, 201);

    const note = await reception.post(`/api/visits/${visit.body.visit.id}/notes`, {
      noteType: 'progress', body: 'Reception should not be able to write this.',
    });
    assert.equal(note.status, 403, 'reception cannot write clinical notes');
  });

  await t.test('the nurse role no longer exists (ADR-17)', async () => {
    const res = await admin.post('/api/admin/users', {
      username: 'nurse9', fullName: 'Synthetic Nurse', role: 'nurse', password: 'Sunrise-Staff-2026!',
    });
    assert.equal(res.status, 400);
    const roles = (await admin.get('/api/admin/users')).body.roles.map((r) => r.role).sort();
    assert.deepEqual(roles, ['admin', 'doctor', 'reception']);
  });

  await t.test('changing a password revokes other sessions', async () => {
    const { client: desk } = await makeStaff(env, admin, {
      username: 'desk2', role: 'reception', password: 'Sunrise-Front2-2026!',
    });
    const otherTab = env.client();
    await otherTab.login('desk2', 'Sunrise-Front2-2026!');

    const change = await desk.post('/api/auth/change-password', {
      currentPassword: 'Sunrise-Front2-2026!',
      newPassword: 'Sunrise-Front2-2027!',
    });
    assert.equal(change.status, 200);

    const stale = await otherTab.get('/api/auth/me');
    assert.equal(stale.status, 401, 'the other session is no longer valid');
    const current = await desk.get('/api/auth/me');
    assert.equal(current.status, 200, 'the session that changed the password survives');
  });

  await t.test('deactivating a user kills their sessions immediately', async () => {
    const { client: doctor, user } = await makeStaff(env, admin, { username: 'doctor1', role: 'doctor' });
    assert.equal((await doctor.get('/api/auth/me')).status, 200);
    const deactivate = await admin.patch(`/api/admin/users/${user.id}`, {
      isActive: false, version: await userVersion(admin, user.id),
    });
    assert.equal(deactivate.status, 200);
    assert.equal((await doctor.get('/api/auth/me')).status, 401);
    const login = await env.client().post('/api/auth/login', { username: 'doctor1', password: 'Sunrise-Staff-2026!' });
    assert.equal(login.status, 401);
  });

  await t.test('an admin cannot deactivate themselves or drop the last admin', async () => {
    const version = await userVersion(admin, adminUser.id);
    const self = await admin.patch(`/api/admin/users/${adminUser.id}`, { isActive: false, version });
    assert.equal(self.status, 409);
    const demote = await admin.patch(`/api/admin/users/${adminUser.id}`, { role: 'reception', version });
    assert.equal(demote.status, 409);
  });

  await t.test('an account locks after five wrong passwords (D-07)', async () => {
    await makeStaff(env, admin, { username: 'desk3', role: 'reception', password: 'Sunrise-Front3-2026!' });
    const c = env.client();
    const statuses = [];
    for (let i = 0; i < 5; i += 1) {
      statuses.push((await c.post('/api/auth/login', { username: 'desk3', password: `wrong-${i}-xyz` })).status);
    }
    assert.deepEqual(statuses, [401, 401, 401, 401, 423]);
    const right = await c.post('/api/auth/login', { username: 'desk3', password: 'Sunrise-Front3-2026!' });
    assert.equal(right.status, 423, 'even the right password is refused while locked');
  });

  await t.test('logout invalidates the token', async () => {
    const c = env.client();
    await c.login('admin', 'Sunrise-Clinic-2026!');
    assert.equal((await c.get('/api/auth/me')).status, 200);
    const out = await c.post('/api/auth/logout');
    assert.equal(out.status, 200);
    assert.equal((await c.get('/api/auth/me')).status, 401);
  });
});
