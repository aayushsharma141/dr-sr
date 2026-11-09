'use strict';

/**
 * First-run bootstrap.
 *
 * The *only* way to create the first administrator is to type the one-time
 * setup code that the server prints on its own console. That code never
 * leaves the machine running the server (it is stored hashed, is single-use,
 * expires, and is destroyed the moment setup completes).
 *
 * After setup, this router answers 410 Gone for the completion endpoint and
 * `setupRequired: false` for the status endpoint - there is no way back in
 * through HTTP.
 */
const express = require('express');
const { logoUrl } = require('./branding');

const { ApiError, Validator } = require('../lib/http');
const { audit } = require('../lib/request');
const { sha256hex, constantTimeEqual, randomCode, hashPassword, checkPasswordPolicy } = require('../lib/crypto');
const { setupRequired } = require('../auth');

const MAX_CODE_ATTEMPTS = 10;

function generateSetupCode(ctx) {
  const code = randomCode(2, 4);
  const expires = new Date(Date.now() + ctx.config.bootstrap.codeTtlMinutes * 60 * 1000).toISOString();
  ctx.store.setMeta('bootstrap_code_hash', sha256hex(code));
  ctx.store.setMeta('bootstrap_code_expires_at', expires);
  ctx.store.setMeta('bootstrap_code_attempts', '0');
  return { code, expires };
}

function clearSetupCode(ctx) {
  ctx.store.setMeta('bootstrap_code_hash', null);
  ctx.store.setMeta('bootstrap_code_expires_at', null);
  ctx.store.setMeta('bootstrap_code_attempts', '0');
}

function codeExpired(ctx) {
  const expires = ctx.store.getMeta('bootstrap_code_expires_at');
  if (!expires) return true;
  return new Date(expires).getTime() <= Date.now();
}

module.exports = function bootstrapRoutes(ctx) {
  const router = express.Router();

  router.get('/status', (req, res) => {
    const required = setupRequired(ctx.db);
    // A brand new server may sit idle for hours before someone opens the setup
    // page; if the printed code has expired, print a fresh one on the console.
    if (required && ctx.refreshSetupCode) ctx.refreshSetupCode();
    res.json({
      setupRequired: required,
      hospitalName: ctx.store.getSetting('hospital_name', 'Kalyan Hospital'),
      hospitalNameHi: ctx.store.getSetting('hospital_name_hi', ''),
      hospitalTagline: ctx.store.getSetting('hospital_tagline', ''),
      logoUrl: logoUrl(ctx.store),
      version: ctx.config.version,
    });
  });

  router.post('/complete', async (req, res) => {
    if (!setupRequired(ctx.db)) {
      throw new ApiError(410, 'Setup is already complete. This endpoint is permanently disabled.');
    }

    const attempts = Number(ctx.store.getMeta('bootstrap_code_attempts') || 0);
    if (attempts >= MAX_CODE_ATTEMPTS) {
      throw new ApiError(429, 'Too many incorrect setup codes. Restart the server to issue a new code.');
    }

    const v = new Validator(req.body);
    const code = v.str('code', { required: true, max: 64, label: 'Setup code' });
    const fullName = v.str('fullName', { required: true, min: 3, max: 120, label: 'Full name' });
    const username = v.str('username', { required: true, min: 3, max: 40, label: 'Username' });
    const password = v.str('password', { required: true, max: 200, label: 'Password' });
    const hospitalName = v.str('hospitalName', { max: 120, label: 'Hospital name' });
    v.throwIfInvalid();

    if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'username', message: 'Use letters, numbers, dot, dash or underscore only.' }],
      });
    }

    const policy = checkPasswordPolicy(password, { username, fullName });
    if (!policy.ok) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'password', message: policy.errors[0] }],
      });
    }

    const storedHash = ctx.store.getMeta('bootstrap_code_hash');
    if (!storedHash || codeExpired(ctx)) {
      throw new ApiError(410, 'The setup code has expired. Restart the server to print a new one.');
    }

    const submitted = sha256hex(String(code).trim().toUpperCase());
    if (!constantTimeEqual(submitted, storedHash)) {
      ctx.store.setMeta('bootstrap_code_attempts', String(attempts + 1));
      throw new ApiError(400, 'That setup code is not correct.', {
        code: 'validation_failed',
        details: [{ field: 'code', message: 'Check the code printed on the server console.' }],
      });
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const lowerUsername = username.toLowerCase();

    const result = ctx.db.transaction(() => {
      const info = ctx.db
        .prepare(
          `INSERT INTO users (username, full_name, role, password_hash, designation, is_active,
                              must_change_password, password_changed_at, created_at, updated_at)
           VALUES (?, ?, 'admin', ?, 'Administrator', 1, 0, ?, ?, ?)`,
        )
        .run(lowerUsername, fullName, passwordHash, now, now, now);
      if (hospitalName) ctx.store.setSetting('hospital_name', hospitalName);
      ctx.store.setMeta('setup_completed', '1');
      ctx.store.setMeta('setup_completed_at', now);
      clearSetupCode(ctx);
      return ctx.db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
    })();

    audit(ctx, { user: null, ipAddress: req.ip, get: (h) => req.get(h) }, {
      action: 'setup.complete',
      actorName: fullName,
      actorRole: 'admin',
      entityType: 'user',
      entityId: result.id,
      detail: { username: lowerUsername },
    });
    // Record it again with the actor attached, so the trail shows who it was.
    audit(ctx, { user: { id: result.id, fullName, role: 'admin' }, ipAddress: req.ip, get: (h) => req.get(h) }, {
      action: 'session.login',
      entityType: 'user',
      entityId: result.id,
      detail: { initial: true },
    });

    const { createSession, publicUser } = require('../auth');
    const session = createSession(ctx.db, result.id, req);
    res.status(201).json({
      user: publicUser(result),
      token: session.token,
      csrf: session.csrf,
      expiresAt: session.expiresAt,
    });
  });

  return router;
};

module.exports.generateSetupCode = generateSetupCode;
module.exports.clearSetupCode = clearSetupCode;
module.exports.codeExpired = codeExpired;
