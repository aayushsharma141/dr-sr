#!/usr/bin/env node
'use strict';

/**
 * Console account recovery tool. This is the sanctioned way back in when every
 * administrator account is locked out — deliberately a local, filesystem-level
 * operation, not something reachable over HTTP.
 *
 *   npm run users                       # list accounts
 *   npm run users -- reset <username>   # set a new password + re-enable
 *   npm run users -- add-admin <username> "<Full name>"
 */
require('../src/lib/env').loadEnv();

const config = require('../src/config');
const { openDatabase } = require('../src/db');
const { hashPassword, checkPasswordPolicy } = require('../src/lib/crypto');
const { ask, fail, heading } = require('./_prompt');

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const store = openDatabase();
  const db = store.db;
  const audit = store.audit;

  const list = () => {
    heading('Staff accounts');
    const rows = db.prepare('SELECT * FROM users ORDER BY role, full_name').all();
    for (const row of rows) {
      const state = row.is_active ? 'active' : 'DISABLED';
      const lock = row.locked_until && new Date(row.locked_until) > new Date() ? ' LOCKED' : '';
      console.log(`  ${row.username.padEnd(16)} ${row.role.padEnd(10)} ${state}${lock}  ${row.full_name}`);
    }
    console.log('\n  Reset a password:  npm run users -- reset <username>\n');
  };

  if (!command || command === 'list') {
    list();
    store.close();
    return;
  }

  if (command === 'reset') {
    const username = String(rest[0] || '').toLowerCase();
    if (!username) fail('Which account?  npm run users -- reset <username>');
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) fail(`No account called "${username}".`);

    heading(`Reset password for ${user.full_name} (${user.username})`);
    console.log('  This also unlocks the account, re-enables it, and signs out');
    console.log('  every existing session for it.\n');
    let password = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      password = await ask('  New password (min 12 chars): ', { mask: true });
      const policy = checkPasswordPolicy(password, { username: user.username, fullName: user.full_name });
      if (policy.ok) break;
      console.log(`  ✖ ${policy.errors[0]}`);
      password = '';
    }
    if (!password) fail('No acceptable password supplied. Nothing was changed.');

    const hash = await hashPassword(password);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0,
        locked_until = NULL, is_active = 1, password_changed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(hash, now, now, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    audit.record({
      actorName: 'console',
      actorRole: 'system',
      action: 'user.password_reset_console',
      entityType: 'user',
      entityId: user.id,
      detail: { username: user.username, ip: 'console' },
    });
    console.log('\n  ✔ Password reset. The person must choose a new password at next sign-in.\n');
    store.close();
    return;
  }

  if (command === 'add-admin') {
    const username = String(rest[0] || '').toLowerCase();
    const fullName = rest[1] || '';
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) fail('Username: 3-40 chars, letters, numbers, dot, dash, underscore.');
    if (fullName.length < 3) fail('Provide a full name: npm run users -- add-admin <username> "<Full name>"');
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) fail('That username already exists.');

    heading(`Create administrator "${username}"`);
    let password = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      password = await ask('  Password (min 12 chars): ', { mask: true });
      const policy = checkPasswordPolicy(password, { username, fullName });
      if (policy.ok) break;
      console.log(`  ✖ ${policy.errors[0]}`);
      password = '';
    }
    if (!password) fail('No acceptable password supplied. Nothing was created.');

    const hash = await hashPassword(password);
    const now = new Date().toISOString();
    const info = db.prepare(
      `INSERT INTO users (username, full_name, role, password_hash, designation, is_active,
         must_change_password, password_changed_at, created_at, updated_at)
       VALUES (?,?, 'admin', ?, 'Administrator', 1, 1, ?, ?, ?)`,
    ).run(username, fullName, hash, now, now, now);
    store.setMeta('setup_completed', '1');
    audit.record({
      actorName: 'console',
      actorRole: 'system',
      action: 'user.create_console',
      entityType: 'user',
      entityId: Number(info.lastInsertRowid),
      detail: { username, role: 'admin' },
    });
    console.log('\n  ✔ Administrator created. They must set a new password at first sign-in.\n');
    store.close();
    return;
  }

  console.log(`\nUnknown command "${command}".\n`);
  list();
  store.close();
  process.exit(1);
}

main().catch((err) => fail(err.stack || err.message));
