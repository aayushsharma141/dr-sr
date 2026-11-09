'use strict';

/**
 * Administration: staff accounts, audit trail, backups, hospital settings.
 * Mounted at /api/admin. Every route requires an administrative permission.
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

const { Validator, ApiError, pagination, toCsv } = require('../lib/http');
const { audit, idParam } = require('../lib/request');
const { hashPassword, checkPasswordPolicy, sha256hex } = require('../lib/crypto');
const { requirePerm } = require('../auth');
const { ROLES, ROLE_LABELS, permissionsFor } = require('../auth');
const backups = require('../lib/backup');

const SETTINGS_ALLOWED = new Set([
  'hospital_name', 'hospital_tagline', 'hospital_address', 'hospital_phone', 'hospital_email',
  'hospital_registration', 'mrn_prefix', 'invoice_prefix', 'receipt_prefix', 'visit_prefix',
  'opd_fee_default', 'session_idle_minutes', 'backup_retention', 'disclaimer', 'synthetic_data',
]);

function mapUser(row) {
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
    isActive: !!row.is_active,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    permissions: permissionsFor(row.role),
  };
}

module.exports = function adminRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  // ---------------------------------------------------------------------------
  // Staff accounts
  // ---------------------------------------------------------------------------
  router.get('/users', requirePerm('user.manage'), (_req, res) => {
    const rows = db.prepare('SELECT * FROM users ORDER BY is_active DESC, full_name').all();
    res.json({ users: rows.map(mapUser), roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })) });
  });

  router.post('/users', requirePerm('user.manage'), async (req, res) => {
    const v = new Validator(req.body);
    const username = v.str('username', { required: true, min: 3, max: 40, label: 'Username' });
    const fullName = v.str('fullName', { required: true, min: 3, max: 120, label: 'Full name' });
    const role = v.enumOf('role', ROLES, { required: true, label: 'Role' });
    const password = v.str('password', { required: true, max: 200, trim: false, label: 'Temporary password' });
    const designation = v.str('designation', { max: 80 });
    const specialty = v.str('specialty', { max: 80 });
    const registrationNo = v.str('registrationNo', { max: 60 });
    const phone = v.phone('phone');
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
    const lower = username.toLowerCase();
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(lower)) {
      throw new ApiError(409, 'That username is already taken.');
    }

    const passwordHash = await hashPassword(password);
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO users (username, full_name, role, password_hash, designation, specialty, registration_no,
            phone, is_active, must_change_password, password_changed_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,1,1,?,?,?,?)`,
      )
      .run(lower, fullName, role, passwordHash, designation, specialty, registrationNo, phone,
        now, req.user.id, now, now);

    audit(ctx, req, {
      action: 'user.create', entityType: 'user', entityId: info.lastInsertRowid,
      detail: { username: lower, role, fullName },
    });
    res.status(201).json({ user: mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)) });
  });

  router.patch('/users/:id', requirePerm('user.manage'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'User not found.');

    const v = new Validator(req.body);
    const fullName = v.str('fullName', { max: 120 });
    const role = v.enumOf('role', ROLES);
    const designation = v.str('designation', { max: 80 });
    const specialty = v.str('specialty', { max: 80 });
    const registrationNo = v.str('registrationNo', { max: 60 });
    const phone = v.phone('phone');
    const isActive = v.bool('isActive');
    v.throwIfInvalid();

    // Guard rails: never lock the system out of itself.
    if (row.id === req.user.id && (role && role !== 'admin')) {
      throw new ApiError(409, 'You cannot change your own role. Ask another administrator.');
    }
    if (row.id === req.user.id && isActive === false) {
      throw new ApiError(409, 'You cannot deactivate your own account.');
    }
    if (role && role !== 'admin' && row.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;
      if (admins <= 1) throw new ApiError(409, 'At least one active administrator is required.');
    }
    if (isActive === false && row.role === 'admin') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get().n;
      if (admins <= 1) throw new ApiError(409, 'At least one active administrator is required.');
    }

    const patch = { updated_at: new Date().toISOString(), updated_by: undefined };
    delete patch.updated_by;
    if (fullName) patch.full_name = fullName;
    if (role) patch.role = role;
    if (designation !== undefined && designation !== null) patch.designation = designation;
    if (specialty !== undefined && specialty !== null) patch.specialty = specialty;
    if (registrationNo !== undefined && registrationNo !== null) patch.registration_no = registrationNo;
    if (phone !== undefined && phone !== null) patch.phone = phone;
    if (isActive !== null && isActive !== undefined) patch.is_active = isActive ? 1 : 0;

    db.prepare(`UPDATE users SET ${Object.keys(patch).map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`)
      .run({ ...patch, id });

    if (isActive === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    audit(ctx, req, {
      action: 'user.update', entityType: 'user', entityId: id,
      detail: { fields: Object.keys(patch), role, isActive },
    });
    res.json({ user: mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)) });
  });

  router.post('/users/:id/reset-password', requirePerm('user.manage'), async (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'User not found.');
    const v = new Validator(req.body);
    const newPassword = v.str('newPassword', { required: true, max: 200, trim: false, label: 'New password' });
    v.throwIfInvalid();
    const policy = checkPasswordPolicy(newPassword, { username: row.username, fullName: row.full_name });
    if (!policy.ok) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'newPassword', message: policy.errors[0] }],
      });
    }
    const passwordHash = await hashPassword(newPassword);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE users SET password_hash = ?, must_change_password = 1, failed_login_count = 0, locked_until = NULL,
        password_changed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(passwordHash, now, now, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);

    audit(ctx, req, { action: 'user.password_reset', entityType: 'user', entityId: id, detail: { username: row.username } });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Audit trail
  // ---------------------------------------------------------------------------
  function auditQuery(query) {
    const { limit, page, offset } = pagination(query, { defaultLimit: 50, maxLimit: 500 });
    const where = [];
    const params = {};
    if (query.actorId) { where.push('actor_id = @actorId'); params.actorId = Number(query.actorId); }
    if (query.action) { where.push('action LIKE @action'); params.action = `%${String(query.action).slice(0, 60)}%`; }
    if (query.patientId) { where.push('patient_id = @patientId'); params.patientId = Number(query.patientId); }
    if (query.from) { where.push("date(at,'localtime') >= @from"); params.from = String(query.from).slice(0, 10); }
    if (query.to) { where.push("date(at,'localtime') <= @to"); params.to = String(query.to).slice(0, 10); }
    if (query.q) {
      where.push('(actor_name LIKE @q OR detail_json LIKE @q OR entity_id LIKE @q)');
      params.q = `%${String(query.q).slice(0, 60)}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS n FROM audit_log ${whereSql}`).get(params).n;
    const rows = db
      .prepare(`SELECT * FROM audit_log ${whereSql} ORDER BY id DESC LIMIT @limit OFFSET @offset`)
      .all({ ...params, limit, offset });
    return { rows, total, page, limit };
  }

  router.get('/audit', requirePerm('audit.read'), (req, res) => {
    const { rows, total, page, limit } = auditQuery(req.query);
    res.json({
      events: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        patientId: r.patient_id,
        ip: r.ip,
        detail: r.detail_json ? JSON.parse(r.detail_json) : null,
        hash: r.hash.slice(0, 16),
      })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  });

  router.get('/audit/export', requirePerm('audit.read', 'export.data'), (req, res) => {
    const { rows } = auditQuery({ ...req.query, limit: 500, page: 1 });
    const csv = toCsv(
      [
        { key: 'id', label: 'ID' },
        { key: 'at', label: 'Timestamp (UTC)' },
        { key: 'actor_name', label: 'User' },
        { key: 'actor_role', label: 'Role' },
        { key: 'action', label: 'Action' },
        { key: 'entity_type', label: 'Entity' },
        { key: 'entity_id', label: 'Entity ID' },
        { key: 'patient_id', label: 'Patient ID' },
        { key: 'ip', label: 'IP address' },
        { key: 'detail_json', label: 'Detail' },
        { key: 'hash', label: 'Chain hash' },
      ],
      rows,
    );
    audit(ctx, req, { action: 'audit.export', detail: { rows: rows.length } });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  });

  router.get('/audit/verify', requirePerm('audit.read'), (_req, res) => {
    res.json(ctx.audit.verifyChain());
  });

  // ---------------------------------------------------------------------------
  // Backups
  // ---------------------------------------------------------------------------
  router.get('/backups', requirePerm('backup.manage'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT b.*, u.full_name AS created_by_name FROM backups b
         LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 100`,
      )
      .all();
    const last = rows.find((r) => r.status === 'ok') || null;
    res.json({
      backups: rows.map((b) => ({
        id: b.id,
        filename: b.filename,
        kind: b.kind,
        sizeBytes: b.size_bytes,
        status: b.status,
        createdByName: b.created_by_name,
        createdAt: b.created_at,
        note: b.note,
      })),
      lastBackupAt: last ? last.created_at : null,
      retention: Number(ctx.store.getSetting('backup_retention', '30')),
    });
  });

  router.post('/backups', requirePerm('backup.manage'), (req, res) => {
    const result = backups.createBackup(ctx, { kind: 'manual', actorId: req.user.id, note: 'Manual backup from admin console' });
    audit(ctx, req, {
      action: 'backup.create', entityType: 'backup', entityId: result.id,
      detail: { filename: result.filename, sizeBytes: result.sizeBytes, durationMs: result.durationMs },
    });
    res.status(201).json({ backup: { id: result.id, filename: result.filename, sizeBytes: result.sizeBytes } });
  });

  router.post('/backups/:id/export', requirePerm('backup.manage'), (req, res) => {
    const id = idParam(req);
    const v = new Validator(req.body);
    const passphrase = v.str('passphrase', { required: true, min: 10, max: 200, trim: false, label: 'Passphrase' });
    v.throwIfInvalid();
    let payload;
    try {
      payload = backups.exportBackup(ctx, id, passphrase);
    } catch (err) {
      throw new ApiError(400, err.message);
    }
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
    audit(ctx, req, {
      action: 'backup.export', entityType: 'backup', entityId: id, detail: { filename: row.filename },
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.filename.replace('.khb', '')}-export.khb"`);
    res.send(payload);
  });

  router.get('/system', requirePerm('backup.manage', 'audit.read'), (_req, res) => {
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    const lastBackup = db
      .prepare("SELECT created_at, status FROM backups WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1")
      .get();
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(ctx.store.dbPath).size;
      const wal = `${ctx.store.dbPath}-wal`;
      if (fs.existsSync(wal)) dbSizeBytes += fs.statSync(wal).size;
    } catch { /* ignore */ }
    res.json({
      version: ctx.config.version,
      schemaVersion: ctx.store.schemaVersion,
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.round(process.uptime()),
      dataDir: ctx.config.paths.data,
      dbSizeBytes,
      integrity: ctx.store.integrityCheck() ? 'ok' : 'failed',
      auditChain: ctx.audit.verifyChain({ limit: 5000 }),
      counts: {
        users: count('users'),
        patients: count('patients'),
        visits: count('visits'),
        documents: count('attachments'),
        invoices: count('invoices'),
        auditEvents: count('audit_log'),
      },
      lastBackupAt: lastBackup ? lastBackup.created_at : null,
      syntheticData: ctx.store.getSetting('synthetic_data') === 'true',
      backupsScheduled: ctx.config.backup.scheduleEnabled,
      backupHour: ctx.config.backup.hour,
      retention: Number(ctx.store.getSetting('backup_retention', '30')),
    });
  });

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------
  router.get('/settings', requirePerm('settings.manage'), (_req, res) => {
    res.json({ settings: ctx.store.getSettings() });
  });

  router.patch('/settings', requirePerm('settings.manage'), (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const changed = [];
    for (const [key, value] of Object.entries(body)) {
      if (!SETTINGS_ALLOWED.has(key)) continue;
      const str = value === null || value === undefined ? '' : String(value).slice(0, 500);
      ctx.store.setSetting(key, str);
      changed.push(key);
    }
    if (changed.length === 0) throw new ApiError(400, 'No recognised settings were supplied.');
    audit(ctx, req, { action: 'settings.update', detail: { keys: changed } });
    res.json({ ok: true, settings: ctx.store.getSettings() });
  });

  return router;
};

module.exports.mapUser = mapUser;
module.exports.SETTINGS_ALLOWED = SETTINGS_ALLOWED;
