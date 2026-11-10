'use strict';

/**
 * SW-10: numbered schema upgrades with an automatic encrypted backup first.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { config } = require('../test-support/helpers');
const Database = require('better-sqlite3');
const { openDatabase, SCHEMA_VERSION, loadMigrations } = require('../src/db');
const { loadOrCreateKey, decryptBuffer } = require('../src/lib/crypto');
const { readTar } = require('../src/lib/tar');

const SCHEMA_V1 = fs.readFileSync(path.join(__dirname, '..', 'src', 'schema.sql'), 'utf8');

/** Builds a database exactly as the v1 app left it, with some data in it. */
function makeV1Database(file) {
  const db = new Database(file);
  db.exec(SCHEMA_V1);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO app_meta (key, value, updated_at) VALUES ('schema_version', '1', ?)").run(now);
  db.prepare(`INSERT INTO users (username, full_name, role, password_hash, created_at, updated_at)
              VALUES ('olddoc', 'Dr Old', 'doctor', 'x', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO users (username, full_name, role, password_hash, created_at, updated_at)
              VALUES ('oldnurse', 'Old Nurse', 'nurse', 'x', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO patients (mrn, first_name, full_name, phone, created_at, updated_at)
              VALUES ('KH-000001', 'Sunita', 'Sunita Devi', '9800000001', ?, ?)`).run(now, now);
  db.prepare(`INSERT INTO backups (filename, kind, size_bytes, sha256, created_at)
              VALUES ('older.khb', 'manual', 10, 'abc', ?)`).run(now);
  db.close();
}

test('schema upgrades', async (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kh-upgrade-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));

  await t.test('migrations are numbered without gaps from 002', () => {
    const list = loadMigrations();
    assert.ok(list.length >= 1);
    list.forEach((m, i) => assert.equal(m.version, 2 + i, m.name));
    assert.equal(SCHEMA_VERSION, list[list.length - 1].version);
  });

  await t.test('a fresh database is created at the latest version without a backup', () => {
    const store = openDatabase({ dbPath: path.join(work, 'fresh.db') });
    try {
      assert.equal(Number(store.getMeta('schema_version')), SCHEMA_VERSION);
      assert.equal(store.lastUpgrade.backup, null);
      assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'system.upgrade'").get().n, 0);
    } finally {
      store.close();
    }
  });

  await t.test('a v1 database with data is backed up, then upgraded and audited', () => {
    const file = path.join(work, 'v1.db');
    makeV1Database(file);
    const before = new Set(fs.existsSync(config.paths.backups) ? fs.readdirSync(config.paths.backups) : []);

    const store = openDatabase({ dbPath: file });
    try {
      assert.equal(Number(store.getMeta('schema_version')), SCHEMA_VERSION);
      assert.equal(store.schemaVersion, SCHEMA_VERSION);
      const { backup } = store.lastUpgrade;
      assert.ok(backup && backup.filename, 'a pre-upgrade backup was written');
      assert.ok(!before.has(backup.filename));

      // The backup holds the database as it was before the upgrade.
      const encrypted = fs.readFileSync(path.join(config.paths.backups, backup.filename));
      const tar = decryptBuffer(encrypted, loadOrCreateKey(config.paths.keys, 'backup.key'));
      const entries = readTar(tar);
      const manifest = JSON.parse(entries.find((e) => e.name === 'MANIFEST.json').data.toString('utf8'));
      assert.equal(manifest.schemaVersion, 1);
      assert.equal(manifest.kind, 'pre_upgrade');
      assert.equal(manifest.totals.patients, 1);

      const rows = store.db.prepare('SELECT filename, kind FROM backups ORDER BY id').all();
      assert.deepEqual(rows.map((r) => r.kind), ['manual', 'pre_upgrade'], 'old backup rows survive the table rebuild');

      const audit = store.db.prepare("SELECT detail_json FROM audit_log WHERE action = 'system.upgrade'").get();
      assert.deepEqual(JSON.parse(audit.detail_json), { backup: backup.filename, fromVersion: 1, toVersion: SCHEMA_VERSION });

      // Data is intact; nurse accounts are switched off, not deleted.
      assert.equal(store.db.prepare('SELECT full_name FROM patients').get().full_name, 'Sunita Devi');
      assert.equal(store.db.prepare("SELECT is_active FROM users WHERE username = 'oldnurse'").get().is_active, 0);
    } finally {
      store.close();
    }

    const again = openDatabase({ dbPath: file });
    try {
      assert.equal(again.lastUpgrade, null, 'reopening an up-to-date database changes nothing');
    } finally {
      again.close();
    }
  });

  await t.test('a failed upgrade leaves the database at its previous version', () => {
    const file = path.join(work, 'v1-broken.db');
    makeV1Database(file);
    const real = loadMigrations();
    const broken = [...real, { version: real.length + 2, name: `${String(real.length + 2).padStart(3, '0')}-broken.sql`, sql: 'CREATE TABLE ok_part (id INTEGER); THIS IS NOT SQL;' }];

    assert.throws(
      () => openDatabase({ dbPath: file, migrations: broken }),
      new RegExp(`broken\\.sql failed.*still at schema v${SCHEMA_VERSION}`, 's'),
    );
    const raw = new Database(file, { readonly: true });
    try {
      assert.equal(raw.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'").get().value, String(SCHEMA_VERSION));
      const partial = raw.prepare("SELECT name FROM sqlite_master WHERE name = 'ok_part'").get();
      assert.equal(partial, undefined, 'the failed step left nothing behind');
    } finally {
      raw.close();
    }
  });

  await t.test('a database newer than the application is refused', () => {
    const file = path.join(work, 'future.db');
    const store = openDatabase({ dbPath: file });
    store.setMeta('schema_version', SCHEMA_VERSION + 5);
    store.close();
    assert.throws(() => openDatabase({ dbPath: file }), /newer than this application/);
  });

  await t.test('the database itself refuses to delete clinical or financial rows', () => {
    const store = openDatabase({ dbPath: path.join(work, 'guards.db') });
    try {
      const now = new Date().toISOString();
      const run = (sql, ...args) => store.db.prepare(sql).run(...args);
      run(`INSERT INTO patients (id, mrn, first_name, full_name, created_at, updated_at) VALUES (1, 'KH-1', 'A', 'A', ?, ?)`, now, now);
      run(`INSERT INTO visits (id, visit_no, patient_id, created_at, updated_at) VALUES (1, 'V-1', 1, ?, ?)`, now, now);
      run(`INSERT INTO clinical_notes (patient_id, visit_id, body, created_at, updated_at) VALUES (1, 1, 'x', ?, ?)`, now, now);
      run(`INSERT INTO diagnoses (patient_id, visit_id, description, created_at) VALUES (1, 1, 'x', ?)`, now);
      run(`INSERT INTO prescriptions (patient_id, visit_id, drug_name, created_at) VALUES (1, 1, 'x', ?)`, now);
      run(`INSERT INTO vitals (patient_id, visit_id, recorded_at, pulse_bpm, created_at) VALUES (1, 1, ?, 70, ?)`, now, now);
      run(`INSERT INTO invoices (id, invoice_no, patient_id, created_at, updated_at) VALUES (1, 'INV-1', 1, ?, ?)`, now, now);
      run(`INSERT INTO invoice_items (invoice_id, description) VALUES (1, 'x')`);
      run(`INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paise, received_at, created_at) VALUES ('R-1', 1, 1, 100, ?, ?)`, now, now);

      for (const table of ['clinical_notes', 'diagnoses', 'prescriptions', 'vitals', 'invoices', 'invoice_items', 'payments']) {
        assert.throws(() => store.db.prepare(`DELETE FROM ${table}`).run(), /cannot be deleted/, table);
      }
      assert.throws(
        () => store.db.prepare(`INSERT INTO users (username, full_name, role, password_hash, created_at, updated_at)
                                VALUES ('n', 'N', 'nurse', 'x', 'now', 'now')`).run(),
        /nurse role is not used/,
      );
    } finally {
      store.close();
    }
  });
});
