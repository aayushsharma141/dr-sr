'use strict';

/**
 * Patient documents (scans, lab reports, consent forms).
 *
 * Files arrive as a raw request body (no multipart parser needed), are
 * encrypted with AES-256-GCM before touching the disk, and are only ever
 * served back through an authenticated, audited endpoint - never from a
 * static directory.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { ApiError } = require('../lib/http');
const { audit, idParam } = require('../lib/request');
const { encryptBuffer, decryptBuffer, sha256hex } = require('../lib/crypto');
const { requirePerm } = require('../auth');

const CATEGORIES = ['lab', 'imaging', 'consent', 'referral', 'insurance', 'other'];

const SNIFF = [
  { mime: 'application/pdf', test: (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'image/bmp', test: (b) => b.length > 2 && b.subarray(0, 2).toString('latin1') === 'BM' },
  { mime: 'image/tiff', test: (b) => b.length > 4 && (b.subarray(0, 4).toString('latin1') === 'II*\u0000' || b.subarray(0, 4).toString('latin1') === 'MM\u0000*') },
];

/** Types whose bytes we can verify; a mismatch is always rejected. */
const SNIFFABLE = new Set(SNIFF.map((s) => s.mime));

function sniffMime(buffer) {
  for (const { mime, test } of SNIFF) {
    try {
      if (test(buffer)) return mime;
    } catch { /* ignore */ }
  }
  return null;
}

function safeName(name) {
  const base = String(name || 'document')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-() ]+/g, '_')
    .slice(0, 120)
    .trim();
  return base || 'document';
}

module.exports = function attachmentRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  // Upload: POST /api/patients/:id/attachments  (raw body)
  router.post(
    '/patients/:id/attachments',
    requirePerm('attachment.write'),
    express.raw({ type: () => true, limit: ctx.config.uploads.maxBytes }),
    (req, res) => {
      const patientId = idParam(req);
      const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
      if (!patient) throw new ApiError(404, 'Patient not found.');

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError(400, 'No file content was received.');
      if (body.length > ctx.config.uploads.maxBytes) {
        throw new ApiError(413, `File is larger than the ${Math.round(ctx.config.uploads.maxBytes / 1024 / 1024)} MB limit.`);
      }

      const originalName = safeName(req.get('x-file-name'));
      const declaredMime = String(req.get('x-file-type') || 'application/octet-stream').toLowerCase().split(';')[0];
      const sniffed = sniffMime(body);

      // Formats we can recognise by their magic bytes must actually match what
      // the browser claimed - this stops "it's a PNG, honest" uploads.
      if (SNIFFABLE.has(declaredMime) && sniffed !== declaredMime) {
        throw new ApiError(415, 'The file content does not match its declared type.');
      }
      const mime = sniffed || declaredMime;
      if (!ctx.config.uploads.allowed.has(mime)) {
        throw new ApiError(415, `Files of type "${mime}" are not allowed. Upload a PDF or an image.`);
      }

      const category = CATEGORIES.includes(String(req.get('x-category'))) ? String(req.get('x-category')) : 'other';
      const title = String(req.get('x-title') || '').slice(0, 200) || null;
      const visitIdHeader = req.get('x-visit-id');
      let visitId = visitIdHeader ? Number(visitIdHeader) : null;
      if (visitId && !db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(visitId, patientId)) {
        visitId = null;
      }

      const storedName = `${crypto.randomUUID()}.khc`;
      const filePath = path.join(ctx.config.paths.uploads, storedName);
      fs.mkdirSync(ctx.config.paths.uploads, { recursive: true });
      const ciphertext = encryptBuffer(body, ctx.keys.attachments);
      fs.writeFileSync(filePath, ciphertext, { mode: 0o600 });

      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO attachments (patient_id, visit_id, category, title, original_name, stored_name, mime_type,
             size_bytes, sha256, uploaded_by, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(patientId, visitId, category, title, originalName, storedName, mime, body.length,
          sha256hex(body), req.user.id, now);

      audit(ctx, req, {
        action: 'document.upload',
        entityType: 'attachment',
        entityId: info.lastInsertRowid,
        patientId,
        detail: { originalName, mime, sizeBytes: body.length, category, sha256: sha256hex(body).slice(0, 16) },
      });

      res.status(201).json({
        attachment: {
          id: info.lastInsertRowid, originalName, mimeType: mime, sizeBytes: body.length,
          category, title, createdAt: now,
        },
      });
    },
  );

  // List for a patient
  router.get('/patients/:id/attachments', requirePerm('attachment.read'), (req, res) => {
    const patientId = idParam(req);
    const rows = db
      .prepare(
        `SELECT a.*, u.full_name AS uploaded_by_name FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
         WHERE a.patient_id = ? AND a.is_deleted = 0 ORDER BY a.created_at DESC`,
      )
      .all(patientId);
    res.json({
      attachments: rows.map((a) => ({
        id: a.id,
        visitId: a.visit_id,
        category: a.category,
        title: a.title,
        originalName: a.original_name,
        mimeType: a.mime_type,
        sizeBytes: a.size_bytes,
        uploadedByName: a.uploaded_by_name,
        createdAt: a.created_at,
      })),
    });
  });

  // Download (audited)
  router.get('/attachments/:id', requirePerm('attachment.read'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM attachments WHERE id = ? AND is_deleted = 0').get(id);
    if (!row) throw new ApiError(404, 'Document not found.');
    const filePath = path.join(ctx.config.paths.uploads, row.stored_name);
    if (!fs.existsSync(filePath)) throw new ApiError(410, 'The stored file is missing from the server. Restore it from a backup.');

    const plaintext = decryptBuffer(fs.readFileSync(filePath), ctx.keys.attachments);
    const hash = sha256hex(plaintext);
    if (hash !== row.sha256) {
      audit(ctx, req, {
        action: 'document.integrity_failure', entityType: 'attachment', entityId: id, patientId: row.patient_id,
        detail: { expected: row.sha256.slice(0, 16), actual: hash.slice(0, 16) },
      });
      throw new ApiError(500, 'This document failed its integrity check and was not opened. Notify your administrator.');
    }

    audit(ctx, req, {
      action: req.query.view === '1' ? 'document.view' : 'document.download',
      entityType: 'attachment',
      entityId: id,
      patientId: row.patient_id,
      detail: { originalName: row.original_name },
    });

    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-store');
    const disposition = req.query.view === '1' ? 'inline' : 'attachment';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(row.original_name)}"; filename*=UTF-8''${encodeURIComponent(row.original_name)}`,
    );
    res.send(plaintext);
  });

  router.delete('/attachments/:id', requirePerm('attachment.write'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM attachments WHERE id = ? AND is_deleted = 0').get(id);
    if (!row) throw new ApiError(404, 'Document not found.');
    const now = new Date().toISOString();
    db.prepare('UPDATE attachments SET is_deleted = 1, deleted_by = ?, deleted_at = ? WHERE id = ?')
      .run(req.user.id, now, id);
    // The ciphertext stays on disk so a restore of an older backup remains
    // consistent; the row is what gates access.
    audit(ctx, req, {
      action: 'document.delete', entityType: 'attachment', entityId: id, patientId: row.patient_id,
      detail: { originalName: row.original_name },
    });
    res.json({ ok: true });
  });

  return router;
};
