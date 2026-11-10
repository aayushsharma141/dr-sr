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

  router.get('/departments', (req, res) => {
    const rows = db.prepare('SELECT id, code, name_en, name_hi, is_active FROM departments WHERE is_active = 1 ORDER BY id').all();
    res.json({ departments: rows });
  });

  router.get('/doctors', (req, res) => {
    const rows = db.prepare(
      `SELECT u.id, u.full_name, u.role, u.designation, u.specialty, u.registration_no,
              u.department_id, u.department_code, u.consultation_fee_paise, u.revisit_fee_paise,
              d.name_en AS department_name_en, d.name_hi AS department_name_hi
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.role = 'doctor' AND u.is_active = 1
       ORDER BY u.full_name COLLATE NOCASE`,
    ).all();

    // User rule: NEVER show fee at doctor screen. Only reception and admin see fees.
    const canSeeFees = req.user && req.user.role !== 'doctor';
    const doctors = rows.map((d) => ({
      id: d.id,
      fullName: d.full_name,
      designation: d.designation,
      specialty: d.specialty,
      registrationNo: d.registration_no,
      departmentId: d.department_id,
      departmentCode: d.department_code,
      departmentName: d.department_name_en || d.specialty || '',
      departmentNameHi: d.department_name_hi || '',
      consultationFeePaise: canSeeFees ? (d.consultation_fee_paise || 0) : null,
      revisitFeePaise: canSeeFees ? (d.revisit_fee_paise || 0) : null,
    }));
    res.json({ doctors });
  });

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
        departmentId: a.department_id,
        scheduledAt: a.scheduled_at,
        durationMin: a.duration_min,
        reason: a.reason,
        status: a.status,
        token: a.token,
        isWalkin: !!a.is_walkin,
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
    const departmentId = v.int('departmentId', { min: 1 });
    const isWalkin = v.bool('isWalkin');
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
        `INSERT INTO appointments (patient_id, doctor_id, department_id, is_walkin, scheduled_at, duration_min, reason, status, notes,
            created_by, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'scheduled', ?, ?, ?, ?)`,
      )
      .run(patientId, doctorId, departmentId || null, isWalkin ? 1 : 0, scheduledAt, durationMin, reason, notes, req.user.id, now, now);

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

  // Check a patient in: creates/links open visit, allocates per-doctor token, creates consultation, and auto-charges fee (SW-22, SW-23, D4)
  router.post('/appointments/:id/check-in', requirePerm('visit.write'), (req, res) => {
    const id = idParam(req);
    const appt = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id);
    if (!appt) throw new ApiError(404, 'Appointment not found.');
    if (appt.visit_id) throw new ApiError(409, 'This appointment has already been checked in.');

    const doctorId = appt.doctor_id;
    if (!doctorId) {
      throw new ApiError(400, 'Cannot check in an appointment without an assigned doctor.');
    }
    assertActiveDoctor(db, doctorId);

    const today = todayLocal();
    const now = new Date().toISOString();

    const result = db.transaction(() => {
      // Invariant 2 & 3: Find open visit for today or create new
      let open = db.prepare(
        "SELECT id, visit_no FROM visits WHERE patient_id = ? AND status = 'open' AND date(created_at, '+05:30') = ? ORDER BY id DESC LIMIT 1",
      ).get(appt.patient_id, today);

      let visitId;
      let visitNo;
      if (open) {
        visitId = open.id;
        visitNo = open.visit_no;
      } else {
        const prefix = ctx.store.getSetting('visit_prefix', 'V');
        const seq = ctx.store.nextSequence('seq:visit');
        visitNo = `${prefix}-${String(seq).padStart(6, '0')}`;
        const info = db
          .prepare(
            `INSERT INTO visits (visit_no, patient_id, visit_type, doctor_id, status, chief_complaint,
               checked_in_at, created_by, created_at, updated_at)
             VALUES (?, ?, 'opd', ?, 'open', ?, ?, ?, ?, ?)`,
          )
          .run(visitNo, appt.patient_id, doctorId, appt.reason, now, req.user.id, now, now);
        visitId = Number(info.lastInsertRowid);
      }

      // ADR-26: Monotonic per-doctor daily token
      const token = ctx.store.nextSequence(`seq:token:${doctorId}:${today}`);

      // Invariant 3 & 5: Create consultation under the visit
      const consultInfo = db
        .prepare(
          `INSERT INTO consultations (visit_id, doctor_id, department_id, appointment_id, token, status, chief_complaint, created_at)
           VALUES (?, ?, (SELECT department_id FROM users WHERE id = ?), ?, ?, 'pending', ?, ?)`,
        )
        .run(visitId, doctorId, doctorId, id, token, appt.reason || '', now);
      const consultationId = Number(consultInfo.lastInsertRowid);

      // Update appointment status to arrived with token
      db.prepare("UPDATE appointments SET status = 'arrived', token = ?, visit_id = ?, updated_at = ? WHERE id = ?")
        .run(token, visitId, now, id);

      // D4: Consultation fee once or revisit fee at check-in (reception only)
      const validityDays = Number(ctx.store.getSetting('consultation_validity_days', 7));
      const docRow = db
        .prepare('SELECT id, full_name, consultation_fee_paise, revisit_fee_paise FROM users WHERE id = ?')
        .get(doctorId);
      const defaultOpdFee = Number(ctx.store.getSetting('opd_fee_default', 0));

      const recentConsult = db
        .prepare(
          `SELECT c.id FROM consultations c
           JOIN visits v ON v.id = c.visit_id
           WHERE v.patient_id = ? AND c.doctor_id = ?
             AND date(c.created_at, '+05:30') >= date(?, '+05:30', ? || ' days')
             AND c.id <> ?
           LIMIT 1`,
        )
        .get(appt.patient_id, doctorId, today, -validityDays, consultationId);

      const isRevisit = !!recentConsult;
      const feePaise = isRevisit
        ? (docRow?.revisit_fee_paise || 0)
        : (docRow?.consultation_fee_paise || defaultOpdFee || 0);

      if (feePaise > 0) {
        const desc = isRevisit
          ? `Revisit fee - ${docRow.full_name}`
          : `Consultation fee - ${docRow.full_name}`;

        let inv = db
          .prepare("SELECT id, total_paise, balance_paise FROM invoices WHERE visit_id = ? AND status IN ('open','partially_paid') ORDER BY id DESC LIMIT 1")
          .get(visitId);

        if (inv) {
          db.prepare(
            `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paise, line_total_paise)
             VALUES (?, ?, 1, ?, ?)`,
          ).run(inv.id, desc, feePaise, feePaise);
          db.prepare(
            `UPDATE invoices
             SET subtotal_paise = subtotal_paise + ?,
                 total_paise = total_paise + ?,
                 balance_paise = balance_paise + ?,
                 status = 'open',
                 updated_at = ?
             WHERE id = ?`,
          ).run(feePaise, feePaise, feePaise, now, inv.id);
        } else {
          const invPrefix = ctx.store.getSetting('invoice_prefix', 'INV');
          const invSeq = ctx.store.nextSequence('seq:invoice');
          const invNo = `${invPrefix}-${String(invSeq).padStart(6, '0')}`;
          const invInfo = db.prepare(
            `INSERT INTO invoices (invoice_no, patient_id, visit_id, subtotal_paise, discount_paise, tax_paise,
               total_paise, balance_paise, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'open', ?, ?, ?)`,
          ).run(invNo, appt.patient_id, visitId, feePaise, feePaise, feePaise, req.user.id, now, now);
          db.prepare(
            `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paise, line_total_paise)
             VALUES (?, ?, 1, ?, ?)`,
          ).run(invInfo.lastInsertRowid, desc, feePaise, feePaise);
        }
      }

      return { visitId, visitNo, consultationId, token, feePaise, isRevisit };
    })();

    audit(ctx, req, {
      action: 'appointment.check_in', entityType: 'appointment', entityId: id, patientId: appt.patient_id,
      detail: { visitId: result.visitId, visitNo: result.visitNo, token: result.token, isRevisit: result.isRevisit },
    });

    const resp = {
      visitId: result.visitId,
      visitNo: result.visitNo,
      consultationId: result.consultationId,
      token: result.token,
      isRevisit: result.isRevisit,
    };
    // Rule: doctor screen must NEVER see fees
    if (req.user.role !== 'doctor') {
      resp.feePaise = result.feePaise;
    }
    res.status(201).json(resp);
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
