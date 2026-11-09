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

const SCHEMA_VERSION = 1;

const DEFAULT_SETTINGS = {
  hospital_name: 'Kalyan Hospital',
  // Identity as configured in the v3 app (clinic_settings seed). Phone, e-mail and
  // registration number are left blank until the hospital supplies them.
  hospital_tagline: 'Physiotherapy Department · Sri Vashishtha Kalyan Trust',
  hospital_address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
  hospital_phone: '',
  hospital_email: '',
  hospital_registration: '',
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

  const existingVersion = getMeta('schema_version');
  if (!existingVersion) {
    setMeta('schema_version', SCHEMA_VERSION);
  } else if (Number(existingVersion) > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${existingVersion} is newer than this application (v${SCHEMA_VERSION}). ` +
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
    schemaVersion: SCHEMA_VERSION,
    close() {
      try {
        db.pragma('wal_checkpoint(TRUNCATE)');
      } catch { /* ignore */ }
      db.close();
    },
  };
  return instance;
}

function getDb() {
  if (!instance) throw new Error('Database not opened yet');
  return instance;
}

module.exports = { openDatabase, getDb, nowIso, SCHEMA_VERSION, DEFAULT_SETTINGS };
