'use strict';

const express = require('express');
const config = require('../config');
const { ApiError, Validator } = require('../lib/http');
const { audit } = require('../lib/request');
const { checkPasswordPolicy, hashPassword, verifyPassword } = require('../lib/crypto');
const {
  authenticateUser,
  requireAuth,
  createSession,
  destructiveSession,
  publicUser,
  permissionsFor,
  ROLE_LABELS,
} = require('../auth');

const FAIL_MESSAGES = {
  invalid: 'Incorrect username or password.',
  inactive: 'This account has been deactivated. Contact your administrator.',
  locked: 'This account is temporarily locked after repeated failed attempts. Try again later.',
};

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, new Date(expiresAt).getTime() - Date.now());
  res.cookie(config.session.cookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false, // LAN deployments are plain HTTP; see docs/SECURITY.md
    path: '/',
    maxAge,
  });
}

function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, { path: '/' });
}

function publicSettings(store) {
  const s = store.getSettings();
  return {
    hospitalName: s.hospital_name || 'Kalyan Hospital',
    hospitalTagline: s.hospital_tagline || '',
    hospitalAddress: s.hospital_address || '',
    hospitalPhone: s.hospital_phone || '',
    hospitalEmail: s.hospital_email || '',
    hospitalRegistration: s.hospital_registration || '',
    currency: s.currency || 'INR',
    disclaimer: s.disclaimer || '',
    syntheticData: s.synthetic_data === 'true',
    sessionIdleMinutes: Number(s.session_idle_minutes || config.session.idleMinutes),
    // Clinic timezone. Timestamps are stored in UTC; the browser formats them
    // in this zone so every workstation shows the same clock regardless of the
    // PC's own Windows time settings.
    timezone: config.timezone,
  };
}

module.exports = function authRoutes(ctx) {
  const router = express.Router();

  router.post('/login', async (req, res) => {
    const v = new Validator(req.body);
    const username = v.str('username', { required: true, max: 60, label: 'Username' });
    const password = v.str('password', { required: true, max: 200, trim: false, label: 'Password' });
    v.throwIfInvalid();

    const result = await authenticateUser(ctx.db, { username, password, req });
    if (!result.ok) {
      audit(ctx, req, {
        action: 'auth.login_failed',
        actorName: username,
        detail: { reason: result.reason, lockedUntil: result.lockedUntil },
      });
      // Deliberately generic for a wrong password vs unknown user.
      const message =
        result.reason === 'invalid' ? FAIL_MESSAGES.invalid : FAIL_MESSAGES[result.reason] || FAIL_MESSAGES.invalid;
      throw new ApiError(result.reason === 'locked' ? 423 : 401, message);
    }

    setSessionCookie(res, result.session.token, result.session.expiresAt);
    audit(ctx, req, {
      action: 'auth.login',
      entityType: 'user',
      entityId: result.user.id,
      detail: { username: result.user.username, role: result.role },
    });
    res.json({
      user: result.user,
      token: result.session.token,
      csrf: result.session.csrf,
      expiresAt: result.session.expiresAt,
      settings: publicSettings(ctx.store),
    });
  });

  router.post('/logout', (req, res) => {
    if (req.session) {
      destructiveSession(ctx.db, req.session.token);
      audit(ctx, req, { action: 'auth.logout', entityType: 'user', entityId: req.user.id });
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({
      user: req.user,
      settings: publicSettings(ctx.store),
      serverTime: new Date().toISOString(),
      version: ctx.config.version,
      setupComplete: true,
    });
  });

  router.post('/change-password', requireAuth, async (req, res) => {
    const v = new Validator(req.body);
    const currentPassword = v.str('currentPassword', { required: true, max: 200, trim: false, label: 'Current password' });
    const newPassword = v.str('newPassword', { required: true, max: 200, trim: false, label: 'New password' });
    v.throwIfInvalid();

    const row = ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    const valid = await verifyPassword(currentPassword, row.password_hash);
    if (!valid) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'currentPassword', message: 'Current password is incorrect.' }],
      });
    }
    if (currentPassword === newPassword) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'newPassword', message: 'Choose a password different from the current one.' }],
      });
    }
    const policy = checkPasswordPolicy(newPassword, { username: row.username, fullName: row.full_name });
    if (!policy.ok) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'newPassword', message: policy.errors[0] }],
      });
    }

    const passwordHash = await hashPassword(newPassword);
    const now = new Date().toISOString();
    ctx.db
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, password_changed_at = ?, updated_at = ? WHERE id = ?',
      )
      .run(passwordHash, now, now, req.user.id);

    // Invalidate every other session for this account, keep the current one.
    ctx.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(req.user.id, req.session.tokenHash);

    audit(ctx, req, { action: 'auth.password_changed', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true, user: { ...req.user, mustChangePassword: false } });
  });

  router.get('/sessions', requireAuth, (req, res) => {
    const rows = ctx.db
      .prepare(
        `SELECT token_hash, created_at, last_seen_at, expires_at, ip, user_agent
         FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC`,
      )
      .all(req.user.id);
    res.json({
      sessions: rows.map((r) => ({
        id: r.token_hash.slice(0, 12),
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        ip: r.ip,
        userAgent: r.user_agent,
        current: r.token_hash === req.session.tokenHash,
      })),
    });
  });

  router.post('/sessions/revoke-others', requireAuth, (req, res) => {
    const info = ctx.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(req.user.id, req.session.tokenHash);
    audit(ctx, req, {
      action: 'auth.sessions_revoked',
      entityType: 'user',
      entityId: req.user.id,
      detail: { revoked: info.changes },
    });
    res.json({ ok: true, revoked: info.changes });
  });

  router.get('/roles', requireAuth, (req, res) => {
    res.json({
      roles: Object.keys(ROLE_LABELS).map((role) => ({
        role,
        label: ROLE_LABELS[role],
        permissions: permissionsFor(role),
      })),
    });
  });

  // Convenience: refresh the current session token (used after setup).
  router.post('/session/refresh', requireAuth, (req, res) => {
    destructiveSession(ctx.db, req.session.token);
    const session = createSession(ctx.db, req.user.id, req);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ token: session.token, csrf: session.csrf, expiresAt: session.expiresAt });
  });

  return router;
};

module.exports.publicSettings = publicSettings;
module.exports.setSessionCookie = setSessionCookie;
