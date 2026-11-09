'use strict';

const { ApiError, forbidden } = require('./http');

/** Audit a request-scoped action. */
function audit(ctx, req, entry) {
  return ctx.audit.record({
    actorId: req.user ? req.user.id : null,
    actorName: req.user ? req.user.fullName : entry.actorName || null,
    actorRole: req.user ? req.user.role : entry.actorRole || null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    patientId: entry.patientId,
    ip: req.ipAddress || req.ip,
    userAgent: req.get ? req.get('user-agent') : undefined,
    detail: entry.detail,
  });
}

function idParam(req, name = 'id') {
  const raw = req.params[name];
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'Not found.');
  return n;
}

function requirePatientAccess(ctx, req, patientId) {
  const patient = ctx.db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
  if (!patient) throw new ApiError(404, 'Patient not found.');
  return patient;
}

module.exports = { audit, idParam, requirePatientAccess, forbidden };
