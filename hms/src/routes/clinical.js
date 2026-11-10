'use strict';

/**
 * Clinical routes: visits, vitals, notes, diagnoses, prescriptions.
 * Mounted at /api.
 *
 * Rules (ADR-27 Phase 1):
 *  - Clinical content (vitals, notes, diagnoses, prescriptions, closing
 *    summary) is returned only to roles with clinical.read (D-04 / EG-16).
 *  - Doctors change only the clinical record of visits assigned to them, and
 *    only while the visit is open (SW-11).
 *  - Nothing clinical is ever deleted: wrong entries are cancelled with a
 *    reason and stay visible on the record (SW-12, invariant 12).
 *  - Edits must send the version they last saw; stale edits get 409 (SW-13).
 */
const express = require('express');

const { Validator, ApiError } = require('../lib/http');
const { pagination } = require('../lib/http');
const {
  audit, idParam, expectedVersion, updateVersioned, assertActiveDoctor, assertOwnVisit, assertVisitOpen,
} = require('../lib/request');
const { requirePerm } = require('../auth');
const { mapVitalsRow } = require('./patients');

const VISIT_TYPES = ['opd', 'ipd', 'emergency', 'follow_up', 'teleconsult'];
// 'nursing' notes exist in old demo data only; Kalyan Hospital has no nurse role.
const NOTE_TYPES = ['consultation', 'progress', 'procedure', 'discharge', 'other'];

// Kalyan Hospital's departments. SW-21 replaces this list with the
// departments table (codes, Hindi names, active flag, doctor membership).
const DEPARTMENTS = ['Physiotherapy', 'Ophthalmology'];

function canReadClinical(req) {
  return req.user.permissions.includes('clinical.read');
}

function cancelReason(body) {
  const v = new Validator(body);
  const reason = v.str('reason', { required: true, min: 5, max: 300, label: 'Reason' });
  v.throwIfInvalid();
  return reason;
}

function cancelledFields(row, nameById) {
  return {
    cancelledAt: row.cancelled_at || null,
    cancelReason: row.cancel_reason || null,
    cancelledByName: row.cancelled_by ? nameById(row.cancelled_by) : null,
  };
}

module.exports = function clinicalRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;
  const userName = (id) => {
    const row = db.prepare('SELECT full_name FROM users WHERE id = ?').get(id);
    return row ? row.full_name : null;
  };
  const loadVisit = (id) => {
    const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(id);
    if (!visit) throw new ApiError(404, 'Visit not found.');
    return visit;
  };

  // Lightweight staff directory for doctor pickers (no account details).
  router.get('/staff/doctors', requirePerm('visit.read', 'appointment.read', 'appointment.write'), (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, full_name, specialty, role, designation FROM users
         WHERE is_active = 1 AND role = 'doctor' ORDER BY full_name`,
      )
      .all();
    res.json({
      doctors: rows.map((r) => ({
        id: r.id, fullName: r.full_name, specialty: r.specialty, role: r.role, designation: r.designation,
      })),
    });
  });

  router.get('/meta/clinical', requirePerm('clinical.read', 'visit.read'), (_req, res) => {
    res.json({ departments: DEPARTMENTS, visitTypes: VISIT_TYPES, noteTypes: NOTE_TYPES });
  });

  // ---------------------------------------------------------------------------
  // Visits
  // ---------------------------------------------------------------------------
  router.get('/visits', requirePerm('visit.read'), (req, res) => {
    const { limit, offset } = pagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const where = [];
    const params = { limit, offset };

    if (req.query.patientId) {
      where.push('v.patient_id = @patientId');
      params.patientId = Number(req.query.patientId);
    }
    if (req.query.doctorId) {
      where.push('v.doctor_id = @doctorId');
      params.doctorId = Number(req.query.doctorId);
    }
    if (req.query.status && ['open', 'closed', 'cancelled'].includes(String(req.query.status))) {
      where.push('v.status = @status');
      params.status = String(req.query.status);
    }
    if (req.query.date) {
      where.push("date(v.created_at,'+05:30') = @date");
      params.date = String(req.query.date).slice(0, 10);
    }
    if (req.query.from) {
      where.push("date(v.created_at,'+05:30') >= @from");
      params.from = String(req.query.from).slice(0, 10);
    }
    if (req.query.to) {
      where.push("date(v.created_at,'+05:30') <= @to");
      params.to = String(req.query.to).slice(0, 10);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `SELECT v.*, p.mrn, p.full_name AS patient_name, p.dob, p.age_years, p.sex, p.phone,
                u.full_name AS doctor_name
         FROM visits v
         JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.doctor_id
         ${whereSql}
         ORDER BY v.created_at DESC
         LIMIT @limit OFFSET @offset`,
      )
      .all(params);

    res.json({
      visits: rows.map((v) => ({
        id: v.id,
        visitNo: v.visit_no,
        patientId: v.patient_id,
        mrn: v.mrn,
        patientName: v.patient_name,
        age: v.dob ? null : v.age_years,
        sex: v.sex,
        phone: v.phone,
        visitType: v.visit_type,
        department: v.department,
        doctorId: v.doctor_id,
        doctorName: v.doctor_name,
        status: v.status,
        chiefComplaint: v.chief_complaint,
        createdAt: v.created_at,
        closedAt: v.closed_at,
        followUpDate: v.follow_up_date,
        version: v.version,
      })),
    });
  });

  router.post('/visits', requirePerm('visit.write'), (req, res) => {
    const v = new Validator(req.body);
    const patientId = v.int('patientId', { required: true, min: 1, label: 'Patient' });
    const visitType = v.enumOf('visitType', VISIT_TYPES) || 'opd';
    const department = v.str('department', { max: 80 });
    const doctorId = v.int('doctorId', { min: 1 });
    const chiefComplaint = v.str('chiefComplaint', { max: 1000 });
    v.throwIfInvalid();

    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new ApiError(404, 'Patient not found.');
    if (!patient.is_active) throw new ApiError(409, 'This patient record is archived.');

    const existing = db.prepare("SELECT id, visit_no FROM visits WHERE patient_id = ? AND status = 'open'").get(patientId);
    if (existing) {
      throw new ApiError(409, `This patient already has an open visit (${existing.visit_no}).`);
    }
    assertActiveDoctor(db, doctorId);

    const now = new Date().toISOString();
    const prefix = ctx.store.getSetting('visit_prefix', 'V');
    const seq = ctx.store.nextSequence('seq:visit');
    const visitNo = `${prefix}-${String(seq).padStart(6, '0')}`;

    const info = db
      .prepare(
        `INSERT INTO visits (visit_no, patient_id, visit_type, department, doctor_id, status, chief_complaint,
          checked_in_at, created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,'open',?,?,?,?,?)`,
      )
      .run(visitNo, patientId, visitType, department, doctorId, chiefComplaint, now, req.user.id, now, now);

    audit(ctx, req, {
      action: 'visit.open',
      entityType: 'visit',
      entityId: info.lastInsertRowid,
      patientId,
      detail: { visitNo, visitType, department, doctorId },
    });
    res.status(201).json({ visit: { id: info.lastInsertRowid, visitNo, patientId, status: 'open', version: 1 } });
  });

  router.get('/visits/:id', requirePerm('visit.read'), (req, res) => {
    const id = idParam(req);
    const visit = db
      .prepare(
        `SELECT v.*, p.mrn, p.full_name AS patient_name, p.dob, p.age_years, p.sex, p.phone,
                u.full_name AS doctor_name
         FROM visits v JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.doctor_id WHERE v.id = ?`,
      )
      .get(id);
    if (!visit) throw new ApiError(404, 'Visit not found.');

    const clinical = canReadClinical(req);
    const payload = {
      visit: {
        id: visit.id,
        visitNo: visit.visit_no,
        patientId: visit.patient_id,
        mrn: visit.mrn,
        patientName: visit.patient_name,
        age: visit.dob ? null : visit.age_years,
        sex: visit.sex,
        phone: visit.phone,
        visitType: visit.visit_type,
        department: visit.department,
        doctorId: visit.doctor_id,
        doctorName: visit.doctor_name,
        status: visit.status,
        chiefComplaint: visit.chief_complaint,
        createdAt: visit.created_at,
        seenAt: visit.seen_at,
        closedAt: visit.closed_at,
        followUpDate: visit.follow_up_date,
        version: visit.version,
      },
    };

    if (clinical) {
      payload.visit.outcome = visit.outcome;
      payload.visit.dischargeSummary = visit.discharge_summary;
      payload.vitals = db
        .prepare(
          `SELECT vt.*, u.full_name AS recorded_by_name FROM vitals vt
           LEFT JOIN users u ON u.id = vt.recorded_by WHERE vt.visit_id = ? ORDER BY vt.recorded_at DESC`,
        )
        .all(id)
        .map((r) => ({ ...mapVitalsRow(r), recordedByName: r.recorded_by_name }));
      payload.notes = db
        .prepare(
          `SELECT n.*, u.full_name AS author_name FROM clinical_notes n
           LEFT JOIN users u ON u.id = n.author_id WHERE n.visit_id = ? ORDER BY n.created_at DESC`,
        )
        .all(id)
        .map((n) => ({
          id: n.id, noteType: n.note_type, subject: n.subject, body: n.body,
          authorId: n.author_id, authorName: n.author_name, signedAt: n.signed_at,
          createdAt: n.created_at, updatedAt: n.updated_at, version: n.version,
          ...cancelledFields(n, userName),
        }));
      payload.diagnoses = db
        .prepare('SELECT * FROM diagnoses WHERE visit_id = ? ORDER BY created_at ASC')
        .all(id)
        .map((d) => ({
          id: d.id, code: d.code, description: d.description, kind: d.kind, createdAt: d.created_at,
          ...cancelledFields(d, userName),
        }));
      payload.prescriptions = db
        .prepare('SELECT * FROM prescriptions WHERE visit_id = ? ORDER BY created_at ASC')
        .all(id)
        .map((r) => ({ ...mapPrescription(r), ...cancelledFields(r, userName) }));
    }

    audit(ctx, req, {
      action: 'visit.view', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { visitNo: visit.visit_no },
    });
    res.json(payload);
  });

  router.patch('/visits/:id', requirePerm('visit.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    if (visit.status !== 'open') throw new ApiError(409, 'This visit is closed and can no longer be edited.');

    const v = new Validator(req.body);
    const version = expectedVersion(v);
    const department = v.str('department', { max: 80 });
    const chiefComplaint = v.str('chiefComplaint', { max: 1000 });
    const doctorId = v.int('doctorId', { min: 1 });
    const followUpDate = v.date('followUpDate');
    const dischargeSummary = v.str('dischargeSummary', { max: 8000 });
    const outcome = v.str('outcome', { max: 120 });
    v.throwIfInvalid();

    const patch = {};
    if (department !== undefined && department !== null) patch.department = department;
    if (chiefComplaint !== undefined && chiefComplaint !== null) patch.chief_complaint = chiefComplaint;
    if (doctorId !== undefined && doctorId !== null) {
      assertActiveDoctor(db, doctorId);
      patch.doctor_id = doctorId;
    }
    const clinicalPatch = {};
    if (followUpDate !== undefined) clinicalPatch.follow_up_date = followUpDate;
    if (dischargeSummary !== undefined && dischargeSummary !== null) clinicalPatch.discharge_summary = dischargeSummary;
    if (outcome !== undefined && outcome !== null) clinicalPatch.outcome = outcome;
    if (Object.keys(clinicalPatch).length) {
      if (!req.user.permissions.includes('clinical.write')) {
        throw new ApiError(403, 'Only the treating doctor can record the outcome, follow-up or closing summary.');
      }
      assertOwnVisit(req, visit);
      Object.assign(patch, clinicalPatch);
    }
    if (!Object.keys(patch).length) return res.json({ ok: true, unchanged: true, version: visit.version });

    patch.updated_by = req.user.id;
    patch.updated_at = new Date().toISOString();
    updateVersioned(db, 'visits', id, version, patch);

    audit(ctx, req, {
      action: 'visit.update', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { fields: Object.keys(patch).filter((k) => !['updated_by', 'updated_at'].includes(k)) },
    });
    res.json({ ok: true, version: loadVisit(id).version });
  });

  // Closing a visit records its outcome, so it is the treating doctor's step.
  router.post('/visits/:id/close', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    if (visit.status !== 'open') throw new ApiError(409, 'This visit is already closed.');
    assertOwnVisit(req, visit);

    const v = new Validator(req.body);
    const followUpDate = v.date('followUpDate');
    const outcome = v.str('outcome', { max: 120 });
    const dischargeSummary = v.str('dischargeSummary', { max: 8000 });
    v.throwIfInvalid();

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE visits SET status = 'closed', closed_at = ?, follow_up_date = COALESCE(?, follow_up_date),
        outcome = COALESCE(?, outcome), discharge_summary = COALESCE(?, discharge_summary),
        updated_by = ?, updated_at = ? WHERE id = ?`,
    ).run(now, followUpDate, outcome, dischargeSummary, req.user.id, now, id);

    audit(ctx, req, {
      action: 'visit.close', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { visitNo: visit.visit_no, outcome, followUpDate },
    });
    res.json({ ok: true, closedAt: now });
  });

  // ---------------------------------------------------------------------------
  // Vitals
  // ---------------------------------------------------------------------------
  router.post('/visits/:id/vitals', requirePerm('vitals.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    if (visit.status !== 'open') throw new ApiError(409, 'This visit is closed.');
    assertOwnVisit(req, visit);

    const v = new Validator(req.body);
    const fields = {
      temperature_c: v.num('temperatureC', { min: 25, max: 45, label: 'Temperature' }),
      pulse_bpm: v.int('pulseBpm', { min: 20, max: 300, label: 'Pulse' }),
      resp_rate: v.int('respRate', { min: 5, max: 90, label: 'Respiratory rate' }),
      bp_systolic: v.int('bpSystolic', { min: 40, max: 300, label: 'Systolic BP' }),
      bp_diastolic: v.int('bpDiastolic', { min: 20, max: 220, label: 'Diastolic BP' }),
      spo2: v.int('spo2', { min: 30, max: 100, label: 'SpO₂' }),
      weight_kg: v.num('weightKg', { min: 0.5, max: 400, label: 'Weight' }),
      height_cm: v.num('heightCm', { min: 20, max: 260, label: 'Height' }),
      pain_score: v.int('painScore', { min: 0, max: 10, label: 'Pain score' }),
      notes: v.str('notes', { max: 500 }),
    };
    v.throwIfInvalid();

    const values = Object.entries(fields).map(([, value]) => (value === undefined ? null : value));
    const provided = Object.entries(fields).filter(([key, value]) => key !== 'notes' && value !== null && value !== undefined);
    if (provided.length === 0) {
      throw new ApiError(400, 'Enter at least one vital sign.');
    }
    if ((fields.bp_systolic && !fields.bp_diastolic) || (!fields.bp_systolic && fields.bp_diastolic)) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'bpSystolic', message: 'Enter both systolic and diastolic blood pressure.' }],
      });
    }
    if (fields.bp_systolic && fields.bp_diastolic && fields.bp_systolic <= fields.bp_diastolic) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'bpSystolic', message: 'Systolic must be higher than diastolic.' }],
      });
    }

    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO vitals (patient_id, visit_id, recorded_at, recorded_by, temperature_c, pulse_bpm, resp_rate,
           bp_systolic, bp_diastolic, spo2, weight_kg, height_cm, pain_score, notes, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(visit.patient_id, id, now, req.user.id, ...values, now);

    audit(ctx, req, {
      action: 'vitals.record', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { vitalId: info.lastInsertRowid, values: Object.fromEntries(provided) },
    });
    res.status(201).json({ id: info.lastInsertRowid, recordedAt: now });
  });

  router.get('/vitals', requirePerm('clinical.read'), (req, res) => {
    const patientId = Number(req.query.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) throw new ApiError(400, 'patientId is required.');
    const rows = db
      .prepare(
        `SELECT vt.*, u.full_name AS recorded_by_name FROM vitals vt
         LEFT JOIN users u ON u.id = vt.recorded_by
         WHERE vt.patient_id = ? ORDER BY vt.recorded_at DESC LIMIT 100`,
      )
      .all(patientId);
    res.json({ vitals: rows.map((r) => ({ ...mapVitalsRow(r), recordedByName: r.recorded_by_name })) });
  });

  // ---------------------------------------------------------------------------
  // Clinical notes
  // ---------------------------------------------------------------------------
  router.post('/visits/:id/notes', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    assertVisitOpen(visit);
    assertOwnVisit(req, visit);

    const v = new Validator(req.body);
    const noteType = v.enumOf('noteType', NOTE_TYPES) || 'progress';
    const subject = v.str('subject', { max: 160 });
    const body = v.str('body', { required: true, min: 3, max: 20000, label: 'Note' });
    v.throwIfInvalid();

    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO clinical_notes (patient_id, visit_id, author_id, note_type, subject, body, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(visit.patient_id, id, req.user.id, noteType, subject, body, now, now);
    db.prepare('UPDATE visits SET seen_at = COALESCE(seen_at, ?) WHERE id = ?').run(now, id);

    audit(ctx, req, {
      action: 'note.create', entityType: 'note', entityId: info.lastInsertRowid,
      patientId: visit.patient_id, detail: { noteType, visitId: id },
    });
    res.status(201).json({ id: info.lastInsertRowid, createdAt: now, version: 1 });
  });

  const NOTE_VERBS = {
    edit: 'edited',
    sign: 'signed',
    cancel: 'cancelled',
  };
  const loadOwnDraftNote = (req, id, verb) => {
    const note = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(id);
    if (!note) throw new ApiError(404, 'Note not found.');
    if (note.cancelled_at) throw new ApiError(409, 'This note was cancelled.');
    if (note.signed_at) throw new ApiError(409, `Signed notes cannot be ${NOTE_VERBS[verb]}.`);
    if (note.author_id !== req.user.id) throw new ApiError(403, `Only the author can ${verb} this note.`);
    return note;
  };

  router.patch('/notes/:id', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const note = loadOwnDraftNote(req, id, 'edit');
    const v = new Validator(req.body);
    const version = expectedVersion(v);
    const subject = v.str('subject', { max: 160 });
    const body = v.str('body', { max: 20000 });
    v.throwIfInvalid();

    const patch = { updated_at: new Date().toISOString() };
    if (subject !== undefined && subject !== null) patch.subject = subject;
    if (body !== undefined && body !== null) patch.body = body;
    updateVersioned(db, 'clinical_notes', id, version, patch);
    audit(ctx, req, { action: 'note.update', entityType: 'note', entityId: id, patientId: note.patient_id });
    res.json({ ok: true, version: db.prepare('SELECT version FROM clinical_notes WHERE id = ?').get(id).version });
  });

  router.post('/notes/:id/sign', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const existing = db.prepare('SELECT * FROM clinical_notes WHERE id = ?').get(id);
    if (!existing) throw new ApiError(404, 'Note not found.');
    if (existing.signed_at) return res.json({ ok: true, signedAt: existing.signed_at });
    const note = loadOwnDraftNote(req, id, 'sign');
    const now = new Date().toISOString();
    db.prepare('UPDATE clinical_notes SET signed_at = ?, signed_by = ?, updated_at = ? WHERE id = ?')
      .run(now, req.user.id, now, id);
    audit(ctx, req, {
      action: 'note.sign', entityType: 'note', entityId: id, patientId: note.patient_id,
      detail: { visitId: note.visit_id },
    });
    res.json({ ok: true, signedAt: now });
  });

  // An unsigned draft can be withdrawn by its author; it stays on the record.
  router.post('/notes/:id/cancel', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const note = loadOwnDraftNote(req, id, 'cancel');
    const reason = cancelReason(req.body);
    const now = new Date().toISOString();
    db.prepare('UPDATE clinical_notes SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ? WHERE id = ?')
      .run(now, req.user.id, reason, now, id);
    audit(ctx, req, {
      action: 'note.cancel', entityType: 'note', entityId: id, patientId: note.patient_id,
      detail: { visitId: note.visit_id, reason },
    });
    res.json({ ok: true, cancelledAt: now });
  });

  // ---------------------------------------------------------------------------
  // Diagnoses
  // ---------------------------------------------------------------------------
  router.post('/visits/:id/diagnoses', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    assertVisitOpen(visit);
    assertOwnVisit(req, visit);
    const v = new Validator(req.body);
    const description = v.str('description', { required: true, max: 300, label: 'Diagnosis' });
    const code = v.str('code', { max: 20 });
    const kind = v.enumOf('kind', ['primary', 'secondary', 'provisional']) || 'primary';
    v.throwIfInvalid();

    const info = db
      .prepare('INSERT INTO diagnoses (patient_id, visit_id, code, description, kind, recorded_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(visit.patient_id, id, code, description, kind, req.user.id, new Date().toISOString());
    audit(ctx, req, {
      action: 'diagnosis.add', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { description, code, kind },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.post('/visits/:id/diagnoses/:diagnosisId/cancel', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const diagnosisId = idParam(req, 'diagnosisId');
    const visit = loadVisit(id);
    assertVisitOpen(visit);
    assertOwnVisit(req, visit);
    const row = db.prepare('SELECT * FROM diagnoses WHERE id = ? AND visit_id = ?').get(diagnosisId, id);
    if (!row) throw new ApiError(404, 'Diagnosis not found.');
    if (row.cancelled_at) throw new ApiError(409, 'This diagnosis is already cancelled.');
    const reason = cancelReason(req.body);
    const now = new Date().toISOString();
    db.prepare('UPDATE diagnoses SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?')
      .run(now, req.user.id, reason, diagnosisId);
    audit(ctx, req, {
      action: 'diagnosis.cancel', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { diagnosisId, description: row.description, reason },
    });
    res.json({ ok: true, cancelledAt: now });
  });

  // ---------------------------------------------------------------------------
  // Prescriptions
  // ---------------------------------------------------------------------------
  router.post('/visits/:id/prescriptions', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const visit = loadVisit(id);
    assertVisitOpen(visit);
    assertOwnVisit(req, visit);
    const v = new Validator(req.body);
    const drugName = v.str('drugName', { required: true, max: 160, label: 'Medicine' });
    const strength = v.str('strength', { max: 40 });
    const form = v.str('form', { max: 40 });
    const dose = v.str('dose', { max: 60 });
    const route = v.str('route', { max: 40 });
    const frequency = v.str('frequency', { max: 60 });
    const durationDays = v.int('durationDays', { min: 0, max: 365 });
    const instructions = v.str('instructions', { max: 300 });
    v.throwIfInvalid();

    const info = db
      .prepare(
        `INSERT INTO prescriptions (patient_id, visit_id, drug_name, strength, form, dose, route, frequency,
           duration_days, instructions, prescribed_by, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(visit.patient_id, id, drugName, strength, form, dose, route, frequency, durationDays,
        instructions, req.user.id, new Date().toISOString());
    audit(ctx, req, {
      action: 'prescription.add', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { drugName },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.post('/visits/:id/prescriptions/:rxId/cancel', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const rxId = idParam(req, 'rxId');
    const visit = loadVisit(id);
    assertVisitOpen(visit);
    assertOwnVisit(req, visit);
    const row = db.prepare('SELECT * FROM prescriptions WHERE id = ? AND visit_id = ?').get(rxId, id);
    if (!row) throw new ApiError(404, 'Prescription not found.');
    if (row.cancelled_at) throw new ApiError(409, 'This prescription line is already cancelled.');
    const reason = cancelReason(req.body);
    const now = new Date().toISOString();
    db.prepare('UPDATE prescriptions SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?')
      .run(now, req.user.id, reason, rxId);
    audit(ctx, req, {
      action: 'prescription.cancel', entityType: 'visit', entityId: id, patientId: visit.patient_id,
      detail: { rxId, drugName: row.drug_name, reason },
    });
    res.json({ ok: true, cancelledAt: now });
  });

  // Patient-level prescription history (for the chart "Medications" tab).
  router.get('/patients/:id/prescriptions', requirePerm('clinical.read'), (req, res) => {
    const id = idParam(req);
    const rows = db
      .prepare(
        `SELECT r.*, u.full_name AS prescribed_by_name, v.visit_no FROM prescriptions r
         LEFT JOIN users u ON u.id = r.prescribed_by
         LEFT JOIN visits v ON v.id = r.visit_id
         WHERE r.patient_id = ? ORDER BY r.created_at DESC LIMIT 200`,
      )
      .all(id);
    res.json({
      prescriptions: rows.map((r) => ({
        ...mapPrescription(r),
        ...cancelledFields(r, userName),
        prescribedByName: r.prescribed_by_name,
        visitNo: r.visit_no,
      })),
    });
  });

  // Clinical rows are never deleted (SW-12). Old clients get a clear answer.
  const noDelete = (_req, _res) => {
    throw new ApiError(405, 'Clinical records cannot be deleted. Cancel the entry with a reason instead.', {
      code: 'method_not_allowed',
    });
  };
  router.delete('/notes/:id', requirePerm('clinical.write'), noDelete);
  router.delete('/visits/:id/diagnoses/:diagnosisId', requirePerm('clinical.write'), noDelete);
  router.delete('/visits/:id/prescriptions/:rxId', requirePerm('clinical.write'), noDelete);

  return router;
};

function mapPrescription(r) {
  return {
    id: r.id,
    drugName: r.drug_name,
    strength: r.strength,
    form: r.form,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    durationDays: r.duration_days,
    instructions: r.instructions,
    createdAt: r.created_at,
  };
}
