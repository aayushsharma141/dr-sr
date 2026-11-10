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

// ---------------------------------------------------------------------------
// Edit conflicts (SW-13, D-08)
// ---------------------------------------------------------------------------
const CONFLICT_MESSAGE =
  'Someone else changed this record while you were editing it. Reload to see the latest version, then make your change again.';

function versionConflict(currentVersion) {
  return new ApiError(409, CONFLICT_MESSAGE, { code: 'version_conflict', details: { currentVersion } });
}

/** Reads the `version` the client last saw; every versioned edit must send it. */
function expectedVersion(v) {
  return v.int('version', { required: true, min: 1, label: 'Record version' });
}

/**
 * Applies `patch` only if the row is still at `version`. The schema triggers
 * bump the version; a stale client gets 409 version_conflict instead of
 * silently overwriting someone else's change.
 */
function updateVersioned(db, table, id, version, patch) {
  const columns = Object.keys(patch);
  if (!columns.length) return;
  const info = db
    .prepare(`UPDATE ${table} SET ${columns.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @__id AND version = @__version`)
    .run({ ...patch, __id: id, __version: version });
  if (!info.changes) {
    const row = db.prepare(`SELECT version FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new ApiError(404, 'Record not found.');
    throw versionConflict(row.version);
  }
}

// ---------------------------------------------------------------------------
// People and ownership
// ---------------------------------------------------------------------------
/** A doctor id must name an active account with the doctor role. */
function assertActiveDoctor(db, doctorId) {
  if (doctorId === undefined || doctorId === null) return;
  const doc = db.prepare('SELECT id, role, is_active FROM users WHERE id = ?').get(doctorId);
  if (!doc || doc.role !== 'doctor' || !doc.is_active) {
    throw new ApiError(400, 'Please correct the highlighted fields.', {
      code: 'validation_failed',
      details: [{ field: 'doctorId', message: 'Choose an active doctor.' }],
    });
  }
}

/**
 * Doctors read every chart (D2) but change only their own consultations (SW-22 / Invariant 3).
 * A doctor can edit if they are the primary doctor on the visit OR have an active consultation under it.
 */
function assertOwnVisit(req, visit, db = null) {
  if (visit.doctor_id === req.user.id) return;
  if (db && visit.id) {
    const consult = db.prepare('SELECT id FROM consultations WHERE visit_id = ? AND doctor_id = ? LIMIT 1').get(visit.id, req.user.id);
    if (consult) return;
  }
  if (!visit.doctor_id) {
    throw new ApiError(403, 'This visit has no doctor assigned yet. Reception must assign a doctor first.');
  }
  throw new ApiError(403, 'Only the doctor assigned to this visit can change its clinical record.');
}

function assertVisitOpen(visit) {
  if (visit.status !== 'open') {
    throw new ApiError(409, 'This visit is closed. Its clinical record can no longer be changed.');
  }
}

module.exports = {
  audit, idParam, requirePatientAccess, forbidden,
  versionConflict, expectedVersion, updateVersioned, assertActiveDoctor, assertOwnVisit, assertVisitOpen,
};
