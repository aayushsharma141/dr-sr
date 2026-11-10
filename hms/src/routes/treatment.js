'use strict';

/**
 * Physiotherapy treatment plans and sessions (SW-26, AGENTS.md Invariant 11).
 *
 * Rules:
 *  - Doctors manage treatment plans and log sessions (clinical.write).
 *  - Invariant 11: completed_sessions is incremented ONLY upon finalised treatment session.
 *  - D4 rule: package price charged at plan start (reception handles billing).
 *  - Fee privacy: doctors NEVER see fees, prices, or invoice data.
 */
const express = require('express');

const { Validator, ApiError } = require('../lib/http');
const { audit, idParam, expectedVersion, updateVersioned, assertActiveDoctor } = require('../lib/request');
const { requirePerm } = require('../auth');
const { todayLocal } = require('../lib/domain');

module.exports = function treatmentRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  function canSeeFees(req) {
    return req.user && req.user.role !== 'doctor';
  }

  function mapPlan(p, req) {
    const showFee = canSeeFees(req);
    return {
      id: p.id,
      patientId: p.patient_id,
      patientUrn: p.mrn,
      patientName: p.patient_name,
      doctorId: p.doctor_id,
      doctorName: p.doctor_name,
      visitId: p.visit_id,
      planName: p.plan_name,
      conditionDiagnosis: p.condition_diagnosis,
      referredBy: p.referred_by,
      totalSessions: p.total_sessions,
      completedSessions: p.completed_sessions,
      agreedPricePaise: showFee ? p.agreed_price_paise : null,
      status: p.status,
      cancellationReason: p.cancellation_reason,
      version: p.version,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  function mapSession(s) {
    let modalities = [];
    try {
      modalities = JSON.parse(s.modalities || '[]');
    } catch {
      modalities = [];
    }
    return {
      id: s.id,
      treatmentPlanId: s.treatment_plan_id,
      patientId: s.patient_id,
      doctorId: s.doctor_id,
      doctorName: s.doctor_name,
      sessionNumber: s.session_number,
      sessionDate: s.session_date,
      vasScore: s.vas_score,
      modalities,
      clinicalNotes: s.clinical_notes,
      isFinalised: !!s.is_finalised,
      createdBy: s.created_by,
      createdByName: s.created_by_name,
      createdAt: s.created_at,
      version: s.version,
    };
  }

  // ---------------------------------------------------------------------------
  // Treatment Plans list
  // ---------------------------------------------------------------------------
  router.get('/treatment-plans', requirePerm('clinical.read', 'visit.read'), (req, res) => {
    const patientId = req.query.patientId ? Number(req.query.patientId) : null;
    const doctorId = req.query.doctorId ? Number(req.query.doctorId) : null;
    const status = req.query.status ? String(req.query.status) : null;

    const where = ['1=1'];
    const params = {};
    if (patientId) {
      where.push('tp.patient_id = @patientId');
      params.patientId = patientId;
    }
    if (doctorId) {
      where.push('tp.doctor_id = @doctorId');
      params.doctorId = doctorId;
    }
    if (status) {
      where.push('tp.status = @status');
      params.status = status;
    }

    const rows = db
      .prepare(
        `SELECT tp.*, p.mrn, p.full_name AS patient_name, u.full_name AS doctor_name
         FROM treatment_plans tp
         JOIN patients p ON p.id = tp.patient_id
         LEFT JOIN users u ON u.id = tp.doctor_id
         WHERE ${where.join(' AND ')}
         ORDER BY tp.created_at DESC`,
      )
      .all(params);

    res.json({
      treatmentPlans: rows.map((r) => mapPlan(r, req)),
    });
  });

  // ---------------------------------------------------------------------------
  // Create Treatment Plan (SW-26, D4)
  // ---------------------------------------------------------------------------
  router.post('/treatment-plans', requirePerm('clinical.write'), (req, res) => {
    if (req.user.role !== 'doctor') {
      throw new ApiError(403, 'Only doctors can create physiotherapy treatment plans.');
    }

    const v = new Validator(req.body);
    const patientId = v.int('patientId', { required: true, min: 1, label: 'Patient' });
    const planName = v.str('planName', { required: true, max: 120, label: 'Plan name' });
    const conditionDiagnosis = v.str('conditionDiagnosis', { max: 300 }) || '';
    const referredBy = v.str('referredBy', { max: 120 }) || '';
    const totalSessions = v.int('totalSessions', { required: true, min: 1, max: 100, label: 'Total sessions' });
    const agreedPricePaise = v.int('agreedPricePaise', { min: 0 }) || 0;
    const visitId = v.int('visitId', { min: 1 });
    v.throwIfInvalid();

    const patient = db.prepare('SELECT id, is_active FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new ApiError(404, 'Patient not found.');
    if (!patient.is_active) throw new ApiError(409, 'This patient record is archived.');

    const now = new Date().toISOString();

    const result = db.transaction(() => {
      const planInfo = db
        .prepare(
          `INSERT INTO treatment_plans (patient_id, doctor_id, visit_id, plan_name, condition_diagnosis,
             referred_by, total_sessions, completed_sessions, agreed_price_paise, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)`,
        )
        .run(patientId, req.user.id, visitId || null, planName, conditionDiagnosis, referredBy, totalSessions, agreedPricePaise, now, now);

      const planId = Number(planInfo.lastInsertRowid);

      // D4: Auto-create charge / invoice for physio package at plan start
      let invoiceId = null;
      if (agreedPricePaise > 0) {
        const desc = `Physiotherapy Package - ${planName} (${totalSessions} sessions)`;
        let inv = null;
        if (visitId) {
          inv = db
            .prepare("SELECT id FROM invoices WHERE visit_id = ? AND status IN ('open','partially_paid') ORDER BY id DESC LIMIT 1")
            .get(visitId);
        }

        if (inv) {
          invoiceId = inv.id;
          db.prepare(
            `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paise, line_total_paise)
             VALUES (?, ?, 1, ?, ?)`,
          ).run(inv.id, desc, agreedPricePaise, agreedPricePaise);
          db.prepare(
            `UPDATE invoices
             SET subtotal_paise = subtotal_paise + ?,
                 total_paise = total_paise + ?,
                 balance_paise = balance_paise + ?,
                 status = 'open',
                 updated_at = ?
             WHERE id = ?`,
          ).run(agreedPricePaise, agreedPricePaise, agreedPricePaise, now, inv.id);
        } else {
          const invPrefix = ctx.store.getSetting('invoice_prefix', 'INV');
          const invSeq = ctx.store.nextSequence('seq:invoice');
          const invNo = `${invPrefix}-${String(invSeq).padStart(6, '0')}`;
          const invInfo = db.prepare(
            `INSERT INTO invoices (invoice_no, patient_id, visit_id, subtotal_paise, discount_paise, tax_paise,
               total_paise, balance_paise, status, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, 0, ?, ?, 'open', ?, ?, ?)`,
          ).run(invNo, patientId, visitId || null, agreedPricePaise, agreedPricePaise, agreedPricePaise, req.user.id, now, now);
          invoiceId = Number(invInfo.lastInsertRowid);
          db.prepare(
            `INSERT INTO invoice_items (invoice_id, description, qty, unit_price_paise, line_total_paise)
             VALUES (?, ?, 1, ?, ?)`,
          ).run(invoiceId, desc, agreedPricePaise, agreedPricePaise);
        }
      }

      return { planId, invoiceId };
    })();

    audit(ctx, req, {
      action: 'treatment_plan.create',
      entityType: 'treatment_plan',
      entityId: result.planId,
      patientId,
      detail: { planName, totalSessions, visitId, agreedPricePaise },
    });

    const row = db
      .prepare(
        `SELECT tp.*, p.mrn, p.full_name AS patient_name, u.full_name AS doctor_name
         FROM treatment_plans tp
         JOIN patients p ON p.id = tp.patient_id
         LEFT JOIN users u ON u.id = tp.doctor_id
         WHERE tp.id = ?`,
      )
      .get(result.planId);

    const out = mapPlan(row, req);
    if (canSeeFees(req) && result.invoiceId) {
      out.invoiceId = result.invoiceId;
    }
    res.status(201).json({ treatmentPlan: out });
  });

  // ---------------------------------------------------------------------------
  // Read one Treatment Plan
  // ---------------------------------------------------------------------------
  router.get('/treatment-plans/:id', requirePerm('clinical.read', 'visit.read'), (req, res) => {
    const id = idParam(req);
    const row = db
      .prepare(
        `SELECT tp.*, p.mrn, p.full_name AS patient_name, u.full_name AS doctor_name
         FROM treatment_plans tp
         JOIN patients p ON p.id = tp.patient_id
         LEFT JOIN users u ON u.id = tp.doctor_id
         WHERE tp.id = ?`,
      )
      .get(id);
    if (!row) throw new ApiError(404, 'Treatment plan not found.');

    const sessions = db
      .prepare(
        `SELECT ts.*, u.full_name AS doctor_name, cb.full_name AS created_by_name
         FROM treatment_sessions ts
         LEFT JOIN users u ON u.id = ts.doctor_id
         LEFT JOIN users cb ON cb.id = ts.created_by
         WHERE ts.treatment_plan_id = ?
         ORDER BY ts.session_number ASC`,
      )
      .all(id)
      .map(mapSession);

    // Load addenda
    for (const s of sessions) {
      s.addenda = db
        .prepare(
          `SELECT a.*, u.full_name AS author_name
           FROM treatment_session_addenda a
           LEFT JOIN users u ON u.id = a.author_id
           WHERE a.treatment_session_id = ?
           ORDER BY a.created_at ASC`,
        )
        .all(s.id)
        .map((a) => ({
          id: a.id,
          treatmentSessionId: a.treatment_session_id,
          authorId: a.author_id,
          authorName: a.author_name,
          note: a.note,
          createdAt: a.created_at,
        }));
    }

    res.json({
      treatmentPlan: mapPlan(row, req),
      sessions,
    });
  });

  // ---------------------------------------------------------------------------
  // Log Treatment Session (SW-26, AGENTS.md Invariant 11)
  // ---------------------------------------------------------------------------
  router.post('/treatment-plans/:id/sessions', requirePerm('clinical.write'), (req, res) => {
    if (req.user.role !== 'doctor') {
      throw new ApiError(403, 'Only doctors can log physiotherapy treatment sessions.');
    }
    const planId = idParam(req);
    const plan = db.prepare('SELECT * FROM treatment_plans WHERE id = ?').get(planId);
    if (!plan) throw new ApiError(404, 'Treatment plan not found.');

    if (plan.status !== 'active') {
      throw new ApiError(422, `Cannot log session: plan is ${plan.status}.`);
    }
    if (plan.completed_sessions >= plan.total_sessions) {
      throw new ApiError(422, 'All sessions for this treatment plan have already been completed.');
    }

    const v = new Validator(req.body);
    const sessionDate = v.date('sessionDate') || todayLocal();
    const vasScore = v.int('vasScore', { min: 0, max: 10, label: 'VAS pain score' });
    const modalities = Array.isArray(req.body.modalities)
      ? req.body.modalities.map(String).slice(0, 10)
      : [];
    const clinicalNotes = v.str('clinicalNotes', { max: 2000 }) || '';
    v.throwIfInvalid();

    const now = new Date().toISOString();
    const nextSessionNumber = plan.completed_sessions + 1;

    const result = db.transaction(() => {
      // Concurrency lock: re-verify completed_sessions
      const freshPlan = db.prepare('SELECT completed_sessions, total_sessions FROM treatment_plans WHERE id = ?').get(planId);
      if (freshPlan.completed_sessions >= freshPlan.total_sessions) {
        throw new ApiError(422, 'All sessions for this plan have already been completed.');
      }

      const info = db
        .prepare(
          `INSERT INTO treatment_sessions (treatment_plan_id, patient_id, doctor_id, session_number,
             session_date, vas_score, modalities, clinical_notes, is_finalised, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        )
        .run(
          planId,
          plan.patient_id,
          req.user.id,
          nextSessionNumber,
          sessionDate,
          vasScore !== undefined ? vasScore : null,
          JSON.stringify(modalities),
          clinicalNotes,
          req.user.id,
          now,
          now,
        );

      return { sessionId: Number(info.lastInsertRowid), sessionNumber: nextSessionNumber };
    })();

    audit(ctx, req, {
      action: 'treatment_session.log',
      entityType: 'treatment_session',
      entityId: result.sessionId,
      patientId: plan.patient_id,
      detail: { treatmentPlanId: planId, sessionNumber: result.sessionNumber, vasScore },
    });

    const sessionRow = db
      .prepare(
        `SELECT ts.*, u.full_name AS doctor_name, cb.full_name AS created_by_name
         FROM treatment_sessions ts
         LEFT JOIN users u ON u.id = ts.doctor_id
         LEFT JOIN users cb ON cb.id = ts.created_by
         WHERE ts.id = ?`,
      )
      .get(result.sessionId);

    res.status(201).json({ session: mapSession(sessionRow) });
  });

  // ---------------------------------------------------------------------------
  // Session Addenda (SW-26)
  // ---------------------------------------------------------------------------
  router.post('/treatment-sessions/:id/addenda', requirePerm('clinical.write'), (req, res) => {
    const sessionId = idParam(req);
    const sessionRow = db.prepare('SELECT * FROM treatment_sessions WHERE id = ?').get(sessionId);
    if (!sessionRow) throw new ApiError(404, 'Treatment session not found.');

    const v = new Validator(req.body);
    const note = v.str('note', { required: true, min: 3, max: 2000, label: 'Addendum note' });
    v.throwIfInvalid();

    const now = new Date().toISOString();
    const info = db
      .prepare(
        'INSERT INTO treatment_session_addenda (treatment_session_id, author_id, note, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(sessionId, req.user.id, note, now);

    audit(ctx, req, {
      action: 'treatment_session.addendum',
      entityType: 'treatment_session',
      entityId: sessionId,
      patientId: sessionRow.patient_id,
      detail: { note },
    });

    res.status(201).json({
      addendum: {
        id: Number(info.lastInsertRowid),
        treatmentSessionId: sessionId,
        authorId: req.user.id,
        authorName: req.user.fullName,
        note,
        createdAt: now,
      },
    });
  });

  return router;
};
