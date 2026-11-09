'use strict';

/**
 * Test harness: boots a fully isolated server (own temp data directory, own
 * SQLite file, own keys) on an ephemeral port and provides a small HTTP client.
 */
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

if (!process.env.KH_DATA_DIR) {
  process.env.KH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-test-'));
}
process.env.PORT = '0';

const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { loadOrCreateKey } = require('../src/lib/crypto');
const { createApp } = require('../src/app');
const { generateSetupCode } = require('../src/routes/bootstrap');

class Client {
  constructor(base) {
    this.base = base;
    this.token = null;
    this.csrf = null;
    this.cookies = [];
  }

  headers(extra = {}) {
    const h = { ...extra };
    if (this.token) h['x-session-token'] = this.token;
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    return h;
  }

  async request(method, url, { body, headers = {}, raw, cookieAuth = false } = {}) {
    const init = { method, headers: this.headers({ origin: this.base, ...headers }) };
    if (cookieAuth && this.cookie) {
      delete init.headers['x-session-token'];
      if (!headers['x-csrf-token']) delete init.headers['x-csrf-token'];
      init.headers.cookie = this.cookie;
    }
    if (raw !== undefined) {
      init.body = raw;
    } else if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(this.base + url, init);
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, headers: res.headers };
  }

  get(url, opts) { return this.request('GET', url, opts); }
  post(url, body, opts = {}) { return this.request('POST', url, { ...opts, body }); }
  patch(url, body, opts = {}) { return this.request('PATCH', url, { ...opts, body }); }
  del(url, opts) { return this.request('DELETE', url, opts); }

  async login(username, password) {
    const res = await this.post('/api/auth/login', { username, password });
    if (res.status === 200) {
      this.token = res.body.token;
      this.csrf = res.body.csrf;
    }
    return res;
  }
}

async function boot() {
  const store = openDatabase();
  const ctx = {
    config,
    db: store.db,
    store,
    audit: store.audit,
    keys: {
      attachments: loadOrCreateKey(config.paths.keys, 'attachments.key'),
      backup: loadOrCreateKey(config.paths.keys, 'backup.key'),
    },
  };
  // Mirror server startup: a first-run server prints a code and stores its hash.
  const needsSetup = store.db.prepare("SELECT value FROM app_meta WHERE key = 'setup_completed'").get();
  let setupCode = null;
  if (!needsSetup) {
    setupCode = generateSetupCode(ctx).code;
    ctx.refreshSetupCode = () => null;
  }

  const app = createApp(ctx);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    ctx,
    server,
    base,
    setupCode,
    client: () => new Client(base),
    async close() {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}

/** Runs first-run setup and returns a logged-in client. */
async function setupAdmin(env, overrides = {}) {
  const client = env.client();
  const payload = {
    code: env.setupCode,
    fullName: 'Alok Ranjan',
    username: 'admin',
    password: 'Sunrise-Clinic-2026!',
    hospitalName: 'Kalyan Hospital',
    ...overrides,
  };
  const res = await client.post('/api/bootstrap/complete', payload);
  if (res.status !== 201) {
    throw new Error(`setup failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  client.token = res.body.token;
  client.csrf = res.body.csrf;
  return { client, user: res.body.user };
}

/** Creates an extra staff account via the admin API and returns a logged-in client. */
async function makeStaff(env, adminClient, { username, role, password = 'Sunrise-Staff-2026!', fullName }) {
  const created = await adminClient.post('/api/admin/users', {
    username,
    fullName: fullName || 'Synthetic Tester',
    role,
    password,
  });
  if (created.status !== 201) throw new Error(`create user failed: ${JSON.stringify(created.body)}`);
  const client = env.client();
  const login = await client.login(username, password);
  if (login.status !== 200) throw new Error(`login failed: ${JSON.stringify(login.body)}`);
  return { client, user: login.body.user, password };
}

async function createPatient(client, overrides = {}) {
  const res = await client.post('/api/patients', {
    firstName: 'Test',
    lastName: 'Patient',
    dob: '1990-05-12',
    sex: 'female',
    phone: '9876543210',
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`create patient failed: ${JSON.stringify(res.body)}`);
  return res.body.patient;
}

/** Current version of a staff account, as the admin screen would see it. */
async function userVersion(adminClient, userId) {
  const res = await adminClient.get('/api/admin/users');
  const user = res.body.users.find((u) => u.id === userId);
  if (!user) throw new Error(`user ${userId} not found`);
  return user.version;
}

/**
 * The three Kalyan roles as logged-in clients: reception registers and bills,
 * the doctor writes clinical records, the admin administers (ADR-17).
 */
async function makeTeam(env, adminClient, suffix = '') {
  const reception = await makeStaff(env, adminClient, { username: `desk${suffix}`, role: 'reception', fullName: 'Kiran Kumari' });
  const doctor = await makeStaff(env, adminClient, { username: `doc${suffix}`, role: 'doctor', fullName: 'Dr Anil Verma' });
  return { reception: reception.client, doctor: doctor.client, doctorUser: doctor.user, receptionUser: reception.user };
}

/** Reception opens a visit for the patient, assigned to the doctor. */
async function openVisit(receptionClient, patientId, doctorId, extra = {}) {
  const res = await receptionClient.post('/api/visits', { patientId, doctorId, visitType: 'opd', ...extra });
  if (res.status !== 201) throw new Error(`open visit failed: ${JSON.stringify(res.body)}`);
  return res.body.visit;
}

module.exports = {
  boot, setupAdmin, makeStaff, createPatient, userVersion, makeTeam, openVisit, Client, config,
};
