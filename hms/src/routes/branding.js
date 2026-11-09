'use strict';

/**
 * Public branding: the hospital logo shown on the sign-in page, the sidebar
 * and printouts. It is not patient data, so no session is needed. Mounted at
 * /api/branding.
 */
const express = require('express');

const { ApiError } = require('../lib/http');

function logoUrl(store) {
  if (!store.getMeta('branding_logo')) return null;
  return `/api/branding/logo?v=${store.getMeta('branding_logo_version') || 1}`;
}

function brandingRoutes(ctx) {
  const router = express.Router();

  router.get('/logo', (_req, res) => {
    const data = ctx.store.getMeta('branding_logo');
    if (!data) throw new ApiError(404, 'No logo has been uploaded.');
    const body = Buffer.from(data, 'base64');
    res.setHeader('Content-Type', ctx.store.getMeta('branding_logo_mime') || 'application/octet-stream');
    res.setHeader('Content-Length', String(body.length));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(body);
  });

  return router;
}

module.exports = brandingRoutes;
module.exports.logoUrl = logoUrl;
