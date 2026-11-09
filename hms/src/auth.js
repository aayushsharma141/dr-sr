'use strict';

/**
 * Authentication, authorisation and session management.
 *
 * Sessions are opaque random tokens. Only a SHA-256 hash of the token is kept
 * in the database, so a leak of the DB file does not hand out live sessions.
 * The browser keeps the raw token in sessionStorage (cleared when the tab
 * closes) and sends it as a header; an HttpOnly cookie is set as a fallback so
 * same-site navigation and page reloads work without JavaScript state.
 */
const config = require('./config');
const {
  randomToken,
  sha256hex,
  hashPassword,
  verifyPassword,
  dummyVerify,
} = require('./lib/crypto');
const { unauthorized, forbidden, ApiError } = require('./lib/http');

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
const PERMISSIONS = [
  'patient.read',
  'patient.write',
  'clinical.read',
  'clinical.write',
  'vitals.write',
  'attachment.read',
  'attachment.write',
  'visit.read',
  'visit.write',
  'appointment.read',
  'appointment.write',
  'billing.read',       // invoices, payments, dues, day report
  'invoice.write',      // raise invoices (charges)
  'payment.collect',    // take money at the desk (invariant 6)
  'payment.reverse',    // void a payment or invoice with a reason (D-06)
  'billing.catalogue',  // services and fees (OD-10)
  'report.read',
  'export.data',
  'user.manage',
  'audit.read',
  'backup.manage',
  'settings.manage',
];

// Ported from the approved v3 matrix (backend/src/kalyan_api/core/permissions.py,
// tag v3-fastapi-final):
//  - ADR-17: three roles only.
//  - D-04 / EG-16: Admin and Reception see no clinical content.
//  - ADR-23: Reception is the only role that collects payments; Admin reverses
//    them with a reason (D-06); Doctors have no billing access.
//  - Doctors read clinical records and write only their own (enforced per
//    record in the routes; D2 read scope still awaits sign-off).
const ROLE_PERMISSIONS = {
  admin: [
    'patient.read',
    'visit.read',
    'appointment.read',
    'billing.read', 'payment.reverse', 'billing.catalogue',
    'report.read', 'export.data',
    'user.manage', 'audit.read', 'backup.manage', 'settings.manage',
  ],
  reception: [
    'patient.read', 'patient.write',
    'attachment.read', 'attachment.write',
    'visit.read', 'visit.write',
    'appointment.read', 'appointment.write',
    'billing.read', 'invoice.write', 'payment.collect',
    'report.read',
  ],
  doctor: [
    'patient.read',
    'clinical.read', 'clinical.write', 'vitals.write',
    'attachment.read', 'attachment.write',
    'visit.read', 'visit.write',
    'appointment.read', 'appointment.write',
  ],
};

const ROLES = Object.keys(ROLE_PERMISSIONS);

const ROLE_LABELS = {
  admin: 'Administrator',
  doctor: 'Doctor',
  reception: 'Reception',
};

/**
 * Idle timeout in minutes: the administrator's setting when it is valid,
 * otherwise the configured default (30, decision D-07).
 */
function idleMinutes(db) {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'session_idle_minutes'").get();
    const n = Number(row && row.value);
    if (Number.isInteger(n) && n >= 5 && n <= 240) return n;
  } catch { /* settings table not created yet */ }
  return config.session.idleMinutes;
}

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function userCan(user, permission) {
  if (!user) return false;
  return permissionsFor(user.role).includes(permission);
}

// ---------------------------------------------------------------------------
// Bootstrap state
// ---------------------------------------------------------------------------
function hasAnyUser(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

function setupRequired(db) {
  const meta = db.prepare("SELECT value FROM app_meta WHERE key = 'setup_completed'").get();
  if (meta && meta.value === '1') return false;
  return !hasAnyUser(db);
}

// ---------------------------------------------------------------------------
// Login throttling (in-memory; intentionally resets on restart)
// ---------------------------------------------------------------------------
function createThrottle() {
  const buckets = new Map();

  function hit(key, windowMs) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      const fresh = { start: now, count: 1 };
      buckets.set(key, fresh);
      return fresh.count;
    }
    entry.count += 1;
    return entry.count;
  }

  function peek(key, windowMs) {
    const entry = buckets.get(key);
    if (!entry || Date.now() - entry.start > windowMs) return 0;
    return entry.count;
  }

  function reset(key) {
    buckets.delete(key);
  }

  // Opportunistic cleanup so the map cannot grow without bound.
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of buckets) {
      if (now - entry.start > 60 * 60 * 1000) buckets.delete(key);
    }
  }, 10 * 60 * 1000).unref();

  return { hit, peek, reset };
}

const throttle = createThrottle();

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
const SELECT_USER = `
  SELECT id, username, full_name, role, designation, specialty, registration_no, phone,
         is_active, must_change_password, last_login_at, password_changed_at
  FROM users WHERE id = ?`;

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    designation: row.designation,
    specialty: row.specialty,
    registrationNo: row.registration_no,
    phone: row.phone,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at,
    permissions: permissionsFor(row.role),
  };
}

function createSession(db, userId, req) {
  const token = randomToken(32);
  const csrf = randomToken(18);
  const now = new Date();
  const idleMs = idleMinutes(db) * 60 * 1000;
  const maxMs = config.session.maxHours * 60 * 60 * 1000;
  const expiresAt = new Date(Math.min(now.getTime() + idleMs, now.getTime() + maxMs)).toISOString();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sha256hex(token),
    userId,
    csrf,
    now.toISOString(),
    now.toISOString(),
    expiresAt,
    clientIp(req),
    String(req.headers['user-agent'] || '').slice(0, 300),
  );
  return { token, csrf, expiresAt };
}

function clientIp(req) {
  const raw = req.ip || req.socket?.remoteAddress || '';
  return raw.replace(/^::ffff:/, '').slice(0, 60);
}

function extractToken(req) {
  const header = req.get('x-session-token');
  if (header && header.length <= 200) return header;
  const auth = req.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const cookie = req.headers.cookie;
  if (cookie) {
    for (const part of cookie.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === config.session.cookieName) return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function destructiveSession(db, token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256hex(token));
}

function purgeExpiredSessions(db) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}

/**
 * Resolves the caller's identity. Returns null when there is no valid session.
 */
function resolveSession(db, req) {
  const token = extractToken(req);
  if (!token) return null;
  const tokenHash = sha256hex(token);
  const row = db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.csrf_token, s.created_at, s.last_seen_at, s.expires_at,
              u.id AS uid, u.username, u.full_name, u.role, u.is_active, u.must_change_password,
              u.designation, u.specialty, u.registration_no, u.phone, u.last_login_at, u.password_changed_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return null;
  if (!row.is_active) {
    destructiveSession(db, token);
    return null;
  }
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) {
    destructiveSession(db, token);
    return null;
  }
  // Sliding idle window, capped by the absolute lifetime.
  const idleMs = idleMinutes(db) * 60 * 1000;
  const maxMs = config.session.maxHours * 60 * 60 * 1000;
  const absoluteEnd = new Date(row.created_at).getTime() + maxMs;
  const nextExpiry = new Date(Math.min(now + idleMs, absoluteEnd)).toISOString();
  const lastSeen = new Date(row.last_seen_at).getTime();
  if (now - lastSeen > 20000) {
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      nextExpiry,
      tokenHash,
    );
  }
  const user = {
    id: row.uid,
    username: row.username,
    fullName: row.full_name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role] || row.role,
    designation: row.designation,
    specialty: row.specialty,
    registrationNo: row.registration_no,
    phone: row.phone,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at,
    permissions: permissionsFor(row.role),
  };
  return { user, session: { token, tokenHash, csrf: row.csrf_token, expiresAt: row.expires_at } };
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
function authenticate(db) {
  return (req, _res, next) => {
    const resolved = resolveSession(db, req);
    if (resolved) {
      req.user = resolved.user;
      req.session = resolved.session;
      req.ipAddress = clientIp(req);
      // How the caller proved who they are. Header tokens cannot be replayed
      // by a third-party site, cookie-based calls need the CSRF token.
      const bearer = String(req.get('authorization') || '').toLowerCase().startsWith('bearer ');
      req.authVia = req.get('x-session-token') || bearer ? 'header' : 'cookie';
    }
    next();
  };
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized('Your session has expired. Please sign in again.'));
  next();
}

function requirePerm(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized('Your session has expired. Please sign in again.'));
    if (perms.some((p) => userCan(req.user, p))) return next();
    next(forbidden());
  };
}

function requireAllPerms(...perms) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized('Your session has expired. Please sign in again.'));
    if (perms.every((p) => userCan(req.user, p))) return next();
    next(forbidden());
  };
}

function assertPerm(user, ...perms) {
  if (!perms.some((p) => userCan(user, p))) throw forbidden();
}

// ---------------------------------------------------------------------------
// Login / logout
// ---------------------------------------------------------------------------
async function authenticateUser(db, { username, password, req }) {
  const ip = clientIp(req);
  const windowMs = config.security.loginWindowMinutes * 60 * 1000;
  const ipKey = `ip:${ip}`;
  const userKey = `user:${String(username || '').toLowerCase()}`;

  if (throttle.peek(ipKey, windowMs) >= config.security.loginMaxAttempts ||
      throttle.peek(userKey, windowMs) >= config.security.loginMaxAttempts) {
    throw new ApiError(429, 'Too many sign-in attempts from this computer. Wait a few minutes and try again.');
  }

  const cleanUsername = String(username || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);

  if (!row) {
    throttle.hit(ipKey, windowMs);
    throttle.hit(userKey, windowMs);
    await dummyVerify(); // keep timing similar to a real check
    return { ok: false, reason: 'invalid' };
  }

  if (!row.is_active) {
    throttle.hit(ipKey, windowMs);
    return { ok: false, reason: 'inactive' };
  }

  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    return { ok: false, reason: 'locked', lockedUntil: row.locked_until };
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    throttle.hit(ipKey, windowMs);
    throttle.hit(userKey, windowMs);
    const failed = row.failed_login_count + 1;
    const lockUntil =
      failed >= config.security.accountLockThreshold
        ? new Date(Date.now() + config.security.accountLockMinutes * 60 * 1000).toISOString()
        : null;
    db.prepare('UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(
      lockUntil ? 0 : failed,
      lockUntil,
      new Date().toISOString(),
      row.id,
    );
    return { ok: false, reason: lockUntil ? 'locked' : 'invalid', lockedUntil: lockUntil };
  }

  throttle.reset(ipKey);
  throttle.reset(userKey);
  db.prepare(
    'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
  ).run(new Date().toISOString(), new Date().toISOString(), row.id);

  const session = createSession(db, row.id, req);
  const fresh = db.prepare(SELECT_USER).get(row.id);
  return { ok: true, user: publicUser(fresh), session, role: row.role };
}

module.exports = {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  ROLE_LABELS,
  ROLES,
  permissionsFor,
  userCan,
  hasAnyUser,
  setupRequired,
  createSession,
  resolveSession,
  destructiveSession,
  purgeExpiredSessions,
  authenticate,
  requireAuth,
  requirePerm,
  requireAllPerms,
  assertPerm,
  authenticateUser,
  publicUser,
  SELECT_USER,
  clientIp,
  hashPassword,
  throttle,
};
