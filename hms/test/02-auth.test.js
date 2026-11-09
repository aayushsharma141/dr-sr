'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeStaff } = require('../test-support/helpers');

test('authentication and sessions', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);

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
    await c.login('admin', 'Sunrise-Clinic-2026!');
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
      firstName: 'Ravi', lastName: 'Patil', dob: '1985-03-02', sex: 'male', phone: '9812345678',
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

  await t.test('changing a password revokes other sessions', async () => {
    const { client: nurse } = await makeStaff(env, admin, {
      username: 'nurse1', role: 'nurse', password: 'Sunrise-Nurse-2026!',
    });
    const otherTab = env.client();
    await otherTab.login('nurse1', 'Sunrise-Nurse-2026!');

    const change = await nurse.post('/api/auth/change-password', {
      currentPassword: 'Sunrise-Nurse-2026!',
      newPassword: 'Sunrise-Nurse-2027!',
    });
    assert.equal(change.status, 200);

    const stale = await otherTab.get('/api/auth/me');
    assert.equal(stale.status, 401, 'the other session is no longer valid');
    const current = await nurse.get('/api/auth/me');
    assert.equal(current.status, 200, 'the session that changed the password survives');
  });

  await t.test('deactivating a user kills their sessions immediately', async () => {
    const { client: doctor, user } = await makeStaff(env, admin, { username: 'doctor1', role: 'doctor' });
    assert.equal((await doctor.get('/api/auth/me')).status, 200);
    const deactivate = await admin.patch(`/api/admin/users/${user.id}`, { isActive: false });
    assert.equal(deactivate.status, 200);
    assert.equal((await doctor.get('/api/auth/me')).status, 401);
    const login = await env.client().post('/api/auth/login', { username: 'doctor1', password: 'Sunrise-Staff-2026!' });
    assert.equal(login.status, 401);
  });

  await t.test('an admin cannot deactivate themselves or drop the last admin', async () => {
    const me = await admin.get('/api/auth/me');
    const self = await admin.patch(`/api/admin/users/${me.body.user.id}`, { isActive: false });
    assert.equal(self.status, 409);
    const demote = await admin.patch(`/api/admin/users/${me.body.user.id}`, { role: 'reception' });
    assert.equal(demote.status, 409);
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
