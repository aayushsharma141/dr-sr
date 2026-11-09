'use strict';

/**
 * Database bootstrap: opens SQLite, applies the schema, keeps app_meta
 * bookkeeping, and exposes small helpers (timestamps, atomic counters).
 *
 * SQLite is used deliberately: a single file, no service to install, no
 * network port, trivially backed up, and with WAL enabled it comfortably
 * handles the read/write load of 3-5 reception and doctor workstations.
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const config = require('./config');
const log = require('./lib/logger');
const { createAuditLog } = require('./lib/audit');

// ---------------------------------------------------------------------------
// Schema versions (SW-10)
//
// schema.sql is the frozen v1 baseline. Every later change is a numbered file
// in src/migrations (002-name.sql, 003-name.sql, ...). Each migration runs in
// its own transaction and bumps app_meta.schema_version. Before upgrading a
// database that already holds data, an encrypted backup is written to
// data/backups so the previous state can always be restored.
// ---------------------------------------------------------------------------
const BASELINE_VERSION = 1;
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function loadMigrations(dir = MIGRATIONS_DIR) {
  let files = [];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const list = files
    .filter((name) => /^\d{3}-[a-z0-9-]+\.sql$/.test(name))
    .map((name) => ({
      version: Number(name.slice(0, 3)),
      name,
      sql: fs.readFileSync(path.join(dir, name), 'utf8'),
    }))
    .sort((a, b) => a.version - b.version);
  list.forEach((migration, index) => {
    const expected = BASELINE_VERSION + 1 + index;
    if (migration.version !== expected) {
      throw new Error(`Migration numbering is broken at ${migration.name}: expected ${String(expected).padStart(3, '0')}.`);
    }
  });
  return list;
}

const MIGRATIONS = loadMigrations();
const SCHEMA_VERSION = MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : BASELINE_VERSION;

const DEFAULT_SETTINGS = {
  hospital_name: 'Kalyan Hospital',
  // Identity as configured in the v3 app (clinic_settings seed). Phone, e-mail and
  // registration number are left blank until the hospital supplies them.
  hospital_tagline: 'Physiotherapy Department · Sri Vashishtha Kalyan Trust',
  hospital_address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
  hospital_phone: '',
  hospital_email: '',
  hospital_registration: '',
  // Bilingual identity and print settings, ported from the v3 clinic_settings
  // defaults (tag v3-fastapi-final) and the clinic addresses in PROJECT.md.
  hospital_name_hi: 'कल्याण हॉस्पिटल',
  trust_name: 'Sri Vashishtha Kalyan Trust',
  trust_name_hi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
  location_line: 'Ara, Bhojpur, Bihar',
  hospital_address_hi: 'नवादा थाना के सामने वाली गली, आरा, भोजपुर (802301)',
  clinic2_address: '',
  clinic2_address_hi: 'श्रीरामपुर रोड, गड़हनी, उदवन्तनगर, भोजपुर (802206)',
  print_header_en: '',
  print_header_hi: '',
  print_footer_en: '',
  print_footer_hi: '',
  receipt_cycle: 'financial_year', // D-05: Indian financial year (1 Apr - 31 Mar)
  consultation_validity_days: '7',
  currency: 'INR',
  mrn_prefix: 'KH',
  invoice_prefix: 'INV',
  receipt_prefix: 'RCPT',
  visit_prefix: 'V',
  opd_fee_default: '0',
  session_idle_minutes: String(config.session.idleMinutes),
  backup_retention: String(config.backup.retention),
  disclaimer: 'Demo deployment seeded with synthetic test data only. No real patient information.',
  synthetic_data: 'false',
};

function nowIso() {
  return new Date().toISOString();
}

let instance = null;

function openDatabase(options = {}) {
  const dbPath = options.dbPath || config.paths.db;
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath, { fileMustExist: false });
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 8000');
  db.pragma('temp_store = MEMORY');
  db.pragma('trusted_schema = OFF');

  // Restrict permissions on the data directory (POSIX; on Windows the ACL of
  // the parent folder governs access - see docs/DEPLOYMENT.md).
  try {
    if (process.platform !== 'win32') {
      fs.chmodSync(dir, 0o700);
      if (fs.existsSync(dbPath)) fs.chmodSync(dbPath, 0o600);
    }
  } catch (err) {
    log.warn('Could not tighten data directory permissions', err.message);
  }

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  // --- schema version bookkeeping -----------------------------------------
  const getMeta = (key) => {
    const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
    return row ? row.value : null;
  };
  const setMeta = (key, value) => {
    db.prepare(
      `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value === null || value === undefined ? null : String(value), nowIso());
  };

  const migrations = options.migrations || MIGRATIONS;
  const targetVersion = migrations.length ? migrations[migrations.length - 1].version : BASELINE_VERSION;
  let currentVersion = Number(getMeta('schema_version') || 0);
  if (!currentVersion) {
    // A brand-new file (or one created before versioning) starts at the baseline.
    setMeta('schema_version', BASELINE_VERSION);
    currentVersion = BASELINE_VERSION;
  } else if (currentVersion > targetVersion) {
    db.close();
    throw new Error(
      `Database schema v${currentVersion} is newer than this application (v${targetVersion}). ` +
        'Upgrade the application before starting it.',
    );
  }

  if (!getMeta('instance_id')) {
    setMeta('instance_id', require('node:crypto').randomUUID());
  }
  const existingCreated = getMeta('created_at');
  if (!existingCreated) setMeta('created_at', nowIso());

  // --- default settings ----------------------------------------------------
  const insertSetting = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING',
  );
  const seededSettings = db.transaction(() => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(key, value, nowIso());
  });
  seededSettings();

  // The service catalogue starts empty: Kalyan's real fees are entered by the
  // administrator (OD-10). Demo prices live only in scripts/seed.js.

  // --- helpers -------------------------------------------------------------
  const audit = createAuditLog(db);

  const stampStmt = db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = CAST(app_meta.value AS INTEGER) + 1, updated_at = excluded.updated_at
     RETURNING value`,
  );

  /** Atomically increments a named counter and returns the new value. */
  function nextSequence(key) {
    const row = stampStmt.get(key, '1', nowIso());
    return Number(row.value);
  }

  function getSetting(key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row && row.value !== null ? row.value : fallback;
  }

  function getSettings() {
    const out = {};
    for (const row of db.prepare('SELECT key, value FROM settings ORDER BY key').all()) out[row.key] = row.value;
    return out;
  }

  function setSetting(key, value, actorId) {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value === null ? null : String(value), nowIso());
  }

  function checkpoint() {
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (err) {
      log.warn('WAL checkpoint failed', err.message);
    }
  }

  function integrityCheck() {
    try {
      const res = db.pragma('quick_check', { simple: true });
      return res === 'ok';
    } catch {
      return false;
    }
  }

  instance = {
    db,
    dbPath,
    audit,
    nowIso,
    nextSequence,
    getMeta,
    setMeta,
    getSetting,
    getSettings,
    setSetting,
    checkpoint,
    integrityCheck,
    schemaVersion: currentVersion,
    lastUpgrade: null,
    close() {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch { /* ignore */ }
      db.close();
    },
  };

  const pending = migrations.filter((m) => m.version > currentVersion);
  if (pending.length) {
    try {
      instance.lastUpgrade = applyMigrations(instance, pending, currentVersion, options);
    } catch (err) {
      try { db.close(); } catch { /* ignore */ }
      instance = null;
      throw err;
    }
  }
  return instance;
}

/**
 * Applies pending migrations in order. A database that already holds staff
 * accounts is backed up first (encrypted, data/backups); if that backup cannot
 * be written the upgrade is refused and the database is left untouched.
 */
function applyMigrations(store, pending, fromVersion, options = {}) {
  const { db } = store;
  const toVersion = pending[pending.length - 1].version;
  const hasData = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;

  let backup = null;
  if (hasData && options.preUpgradeBackup !== false) {
    const backups = require('./lib/backup');
    const { loadOrCreateKey } = require('./lib/crypto');
    const key = options.backupKey || loadOrCreateKey(config.paths.keys, 'backup.key');
    backup = backups.writeUnrecordedBackup(
      { db, config, store: { ...store, schemaVersion: fromVersion }, keys: { backup: key } },
      { kind: 'pre_upgrade', note: `Automatic backup before upgrading the database from v${fromVersion} to v${toVersion}` },
    );
    log.info(`Pre-upgrade backup written: ${backup.filename}`);
  }

  let reached = fromVersion;
  for (const migration of pending) {
    try {
      db.transaction(() => {
        db.exec(migration.sql);
        store.setMeta('schema_version', migration.version);
      })();
      reached = migration.version;
      log.info(`Database upgraded to schema v${migration.version} (${migration.name})`);
    } catch (err) {
      const where = backup ? ` The pre-upgrade backup is data/backups/${backup.filename}.` : '';
      throw new Error(
        `Database upgrade ${migration.name} failed: ${err.message}. ` +
          `The database is still at schema v${reached}.${where}`,
      );
    }
  }
  store.schemaVersion = reached;

  if (backup) {
    db.prepare(
      `INSERT INTO backups (filename, kind, size_bytes, sha256, encrypted, status, created_by, created_at, note)
       VALUES (?, 'pre_upgrade', ?, ?, 1, 'ok', NULL, ?, ?)`,
    ).run(backup.filename, backup.sizeBytes, backup.sha256, nowIso(), backup.note);
  }
  if (hasData) {
    store.audit.record({
      actorId: null,
      actorName: 'System',
      actorRole: 'system',
      action: 'system.upgrade',
      entityType: 'database',
      detail: { fromVersion, toVersion: reached, backup: backup ? backup.filename : null },
    });
  }
  return { fromVersion, toVersion: reached, backup };
}

function getDb() {
  if (!instance) throw new Error('Database not opened yet');
  return instance;
}

module.exports = {
  openDatabase, getDb, nowIso, loadMigrations, SCHEMA_VERSION, BASELINE_VERSION, DEFAULT_SETTINGS,
};
