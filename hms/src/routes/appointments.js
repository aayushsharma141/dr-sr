'use strict';

const express = require('express');

const { Validator, ApiError } = require('../lib/http');
const { audit, idParam, expectedVersion, updateVersioned, assertActiveDoctor } = require('../lib/request');
const { requirePerm } = require('../auth');
const { todayLocal } = require('../lib/domain');

const STATUSES = ['scheduled', 'arrived', 'completed', 'cancelled', 'no_show'];

module.exports = function appointmentRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  router.get('/appointments', requirePerm('appointment.read', 'visit.read'), (req, res) => {
    const date = String(req.query.date || '').slice(0, 10) || todayLocal();
    const doctorId = req.query.doctorId ? Number(req.query.doctorId) : null;
    const rows = db
      .prepare(
        `SELECT a.*, p.mrn, p.full_name AS patient_name, p.phone, p.dob, p.age_years, p.sex,
                u.full_name AS doctor_name
         FROM appointments a
         JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.doctor_id
         WHERE date(a.scheduled_at,'+05:30') = @date
           AND (@doctorId IS NULL OR a.doctor_id = @doctorId)
         ORDER BY a.scheduled_at ASC`,
      )
      .all({ date, doctorId });

    res.json({
      date,
      appointments: rows.map((a) => ({
        id: a.id,
        patientId: a.patient_id,
        mrn: a.mrn,
        patientName: a.patient_name,
        phone: a.phone,
        age: a.dob ? null : a.age_years,
        dob: a.dob,
        sex: a.sex,
        doctorId: a.doctor_id,
        doctorName: a.doctor_name,
        scheduledAt: a.scheduled_at,
        durationMin: a.duration_min,
        reason: a.reason,
        status: a.status,
        visitId: a.visit_id,
        notes: a.notes,
        version: a.version,
      })),
    });
  });

  router.post('/appointments', requirePerm('appointment.write'), (req, res) => {
    const v = new Validator(req.body);
    const patientId = v.int('patientId', { required: true, min: 1, label: 'Patient' });
    const doctorId = v.int('doctorId', { min: 1 });
    const scheduledAt = v.isoDateTime('scheduledAt', { required: true, label: 'Appointment time' });
    const durationMin = v.int('durationMin', { min: 5, max: 240 }) || 15;
    const reason = v.str('reason', { max: 300 });
    const notes = v.str('notes', { max: 1000 });
    v.throwIfInvalid();

    const patient = db.prepare('SELECT id, is_active FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new ApiError(404, 'Patient not found.');
    if (!patient.is_active) throw new ApiError(409, 'This patient record is archived.');
    assertActiveDoctor(db, doctorId);

    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO appointments (patient_id, doctor_id, scheduled_at, duration_min, reason, status, notes,
            created_by, created_at, updated_at)
         VALUES (?,?,?,?,?, 'scheduled', ?, ?, ?, ?)`,
      )
      .run(patientId, doctorId, scheduledAt, durationMin, reason, notes, req.user.id, now, now);

    audit(ctx, req, {
      action: 'appointment.create', entityType: 'appointment', entityId: info.lastInsertRowid,
      patientId, detail: { scheduledAt, doctorId },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.patch('/appointments/:id', requirePerm('appointment.write'), (req, res) => {
    const id = idParam(req);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) throw new ApiError(404, 'Appointment not found.');

    const v = new Validator(req.body);
    const version = expectedVersion(v);
    const status = v.enumOf('status', STATUSES);
    const scheduledAt = v.isoDateTime('scheduledAt');
    const doctorId = v.int('doctorId', { min: 1 });
    const durationMin = v.int('durationMin', { min: 5, max: 240 });
    const reason = v.str('reason', { max: 300 });
    const notes = v.str('notes', { max: 1000 });
    v.throwIfInvalid();

    const patch = { updated_at: new Date().toISOString() };
    if (status) patch.status = status;
    if (scheduledAt) patch.scheduled_at = scheduledAt;
    if (doctorId) {
      assertActiveDoctor(db, doctorId);
      patch.doctor_id = doctorId;
    }
    if (durationMin) patch.duration_min = durationMin;
    if (reason !== undefined && reason !== null) patch.reason = reason;
    if (notes !== undefined && notes !== null) patch.notes = notes;

    updateVersioned(db, 'appointments', id, version, patch);

    audit(ctx, req, {
      action: 'appointment.update', entityType: 'appointment', entityId: id, patientId: appt.patient_id,
      detail: { status, scheduledAt },
    });
    res.json({ ok: true, version: db.prepare('SELECT version FROM appointments WHERE id = ?').get(id).version });
  });

  // Check a patient in: creates the open visit and links it to the appointment.
  router.post('/appointments/:id/check-in', requirePerm('visit.write'), (req, res) => {
    const id = idParam(req);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) throw new ApiError(404, 'Appointment not found.');
    if (appt.visit_id) throw new ApiError(409, 'This appointment has already been checked in.');

    const open = db.prepare("SELECT id, visit_no FROM visits WHERE patient_id = ? AND status = 'open'").get(appt.patient_id);
    if (open) throw new ApiError(409, `This patient already has an open visit (${open.visit_no}).`);

    const now = new Date().toISOString();
    const prefix = ctx.store.getSetting('visit_prefix', 'V');
    const seq = ctx.store.nextSequence('seq:visit');
    const visitNo = `${prefix}-${String(seq).padStart(6, '0')}`;

    const result = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO visits (visit_no, patient_id, visit_type, doctor_id, status, chief_complaint,
             checked_in_at, created_by, created_at, updated_at)
           VALUES (?,?, 'opd', ?, 'open', ?, ?, ?, ?, ?)`,
        )
        .run(visitNo, appt.patient_id, appt.doctor_id, appt.reason, now, req.user.id, now, now);
      const visitId = Number(info.lastInsertRowid);
      db.prepare("UPDATE appointments SET status = 'arrived', visit_id = ?, updated_at = ? WHERE id = ?")
        .run(visitId, now, id);
      return visitId;
    })();

    audit(ctx, req, {
      action: 'appointment.check_in', entityType: 'appointment', entityId: id, patientId: appt.patient_id,
      detail: { visitId: result, visitNo },
    });
    res.status(201).json({ visitId: result, visitNo });
  });

  router.delete('/appointments/:id', requirePerm('appointment.write'), (req, res) => {
    const id = idParam(req);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) throw new ApiError(404, 'Appointment not found.');
    if (appt.visit_id) throw new ApiError(409, 'This appointment is linked to a visit and cannot be deleted. Mark it cancelled instead.');
    db.prepare("UPDATE appointments SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    audit(ctx, req, {
      action: 'appointment.cancel', entityType: 'appointment', entityId: id, patientId: appt.patient_id,
    });
    res.json({ ok: true });
  });

  return router;
};
