'use strict';

/**
 * Express application assembly. Kept separate from server.js so the test
 * suite can boot an isolated instance against a temporary database.
 */
const express = require('express');
const path = require('node:path');
const crypto = require('node:crypto');

const { ApiError } = require('./lib/http');
const { authenticate } = require('./auth');
const log = require('./lib/logger');

const bootstrapRoutes = require('./routes/bootstrap');
const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const clinicalRoutes = require('./routes/clinical');
const attachmentRoutes = require('./routes/attachments');
const appointmentRoutes = require('./routes/appointments');
const billingRoutes = require('./routes/billing');
const dashboardRoutes = require('./routes/dashboard');
const adminRoutes = require('./routes/admin');

function securityHeaders(config) {
  return (req, res, next) => {
    const csp = [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors " + config.security.frameAncestors,
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', csp);
    if (!config.security.frameAncestors.includes('*') && !config.security.frameAncestors.includes('http')) {
      res.setHeader('X-Frame-Options', 'DENY');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('X-Request-Id', req.requestId || crypto.randomUUID());
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

function originGuard(config) {
  const trusted = new Set(config.security.trustedOrigins);
  return (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (!origin) return next(); // non-browser client (scripts, curl)
    const host = req.get('host');
    const expected = [`http://${host}`, `https://${host}`];
    if (expected.includes(origin) || trusted.has(origin)) return next();
    next(new ApiError(403, 'Cross-origin request blocked.'));
  };
}

function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.session) return next(); // unauthenticated endpoints check their own inputs
  if (req.authVia === 'cookie') {
    const header = req.get('x-csrf-token');
    if (!header || header !== req.session.csrf) {
      return next(new ApiError(403, 'Missing or invalid CSRF token. Reload the page and try again.'));
    }
  }
  next();
}

function createApp(ctx) {
  const app = express();
  const { config } = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('etag', 'strong');

  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID();
    next();
  });
  app.use(securityHeaders(config));
  app.use(express.json({ limit: '1mb' }));
  app.use(originGuard(config));
  app.use(authenticate(ctx.db));
  app.use(csrfGuard);

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: config.version,
      serverTime: new Date().toISOString(),
      database: ctx.store.integrityCheck() ? 'ok' : 'failed',
    });
  });

  app.use('/api/bootstrap', bootstrapRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api', dashboardRoutes(ctx));
  app.use('/api/patients', patientRoutes(ctx));
  app.use('/api', clinicalRoutes(ctx));
  app.use('/api', attachmentRoutes(ctx));
  app.use('/api', appointmentRoutes(ctx));
  app.use('/api', billingRoutes(ctx));
  app.use('/api/admin', adminRoutes(ctx));

  app.use('/api', (req, _res, next) => {
    next(new ApiError(404, `Unknown API route: ${req.method} /api${req.path}`));
  });

  // ---------------------------------------------------------------------------
  // Static app shell
  // ---------------------------------------------------------------------------
  app.use(
    express.static(config.paths.public, {
      index: false,
      etag: true,
      lastModified: true,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=60');
      },
    }),
  );

  // SPA fallback - every non-API GET renders the shell (hash based routing).
  app.get('/{*splat}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(config.paths.public, 'index.html'), (err) => {
      if (err) next(err);
    });
  });

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: { code: 'payload_too_large', message: 'That file or request is too large.' } });
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: { code: 'bad_json', message: 'The request body was not valid JSON.' } });
    }
    if (err instanceof ApiError) {
      return res.status(err.status).json({
        error: { code: err.code, message: err.message, details: err.details },
      });
    }
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      log.warn('Constraint violation', { path: req.path, code: err.code });
      return res.status(409).json({
        error: { code: 'conflict', message: 'That change conflicts with existing data.' },
      });
    }
    log.error(`Unhandled error on ${req.method} ${req.originalUrl}`, err && err.stack ? err.stack : String(err));
    res.status(500).json({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on the server. The error has been logged.',
        requestId: req.requestId,
      },
    });
  });

  return app;
}

module.exports = { createApp };
