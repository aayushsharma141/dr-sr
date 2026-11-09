'use strict';

/**
 * Central configuration. Everything is optional; sensible defaults are baked
 * in so a clinic PC needs nothing but `npm start`.
 */
const path = require('node:path');

// Clinic-local timezone. Set before anything formats a date so that SQLite's
// 'localtime' modifier and JavaScript agree on what "today" means.
if (!process.env.TZ) process.env.TZ = 'Asia/Kolkata';

const ROOT = path.resolve(__dirname, '..');
const NODE_ENV = process.env.NODE_ENV || 'production';
const isProd = NODE_ENV === 'production';

function num(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const dataDir = path.resolve(process.env.KH_DATA_DIR || path.join(ROOT, 'data'));

// Allowed origins for state-changing requests. Same-origin always allowed.
const trustedOrigins = String(process.env.KH_TRUSTED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const config = {
  root: ROOT,
  env: NODE_ENV,
  isProd,
  version: require('../package.json').version,
  appName: 'Kalyan Hospital',

  host: process.env.KH_HOST || '0.0.0.0',
  port: num('PORT', num('KH_PORT', 3000)),

  paths: {
    data: dataDir,
    db: path.join(dataDir, 'kalyan.db'),
    uploads: path.join(dataDir, 'uploads'),
    backups: path.join(dataDir, 'backups'),
    keys: path.join(dataDir, 'keys'),
    logs: path.join(dataDir, 'logs'),
    public: path.join(ROOT, 'public'),
  },

  session: {
    idleMinutes: num('KH_SESSION_IDLE_MIN', 30), // D-07: 30-minute idle timeout
    maxHours: num('KH_SESSION_MAX_HOURS', 12),
    cookieName: 'kh_sid',
  },

  scryptN: num('KH_SCRYPT_N', 32768),

  bootstrap: {
    // The one-time setup code printed on the server console stays valid for
    // this long; restarting the server issues a fresh one.
    codeTtlMinutes: num('KH_BOOTSTRAP_TTL_MIN', 60),
  },

  security: {
    trustedOrigins,
    frameAncestors: process.env.KH_FRAME_ANCESTORS || "'none'",
    // Login throttling (per client IP + per account).
    loginMaxAttempts: 8,
    loginWindowMinutes: 10,
    accountLockThreshold: 5, // D-07: lock after 5 wrong passwords ...
    accountLockMinutes: 15, // ... for 15 minutes (or until an admin resets it)
  },

  uploads: {
    maxBytes: num('KH_MAX_UPLOAD_MB', 25) * 1024 * 1024,
    allowed: new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/tiff',
      'image/bmp',
      'text/plain',
      'text/csv',
      'application/dicom',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]),
  },

  backup: {
    hour: num('KH_BACKUP_HOUR', 22),
    retention: num('KH_BACKUP_RETENTION', 30),
    scheduleEnabled: process.env.KH_BACKUP_SCHEDULE !== 'off',
  },

  timezone: process.env.TZ || 'Asia/Kolkata',
};

config.paths.uploadMaxBytes = config.uploads.maxBytes;

module.exports = config;
