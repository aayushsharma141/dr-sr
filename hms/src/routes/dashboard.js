'use strict';

const express = require('express');
const { requireAuth } = require('../auth');
const { todayLocal } = require('../lib/domain');

module.exports = function dashboardRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  router.get('/dashboard', requireAuth, (req, res) => {
    const today = todayLocal();

    const appointmentsToday = db
      .prepare("SELECT COUNT(*) AS n FROM appointments WHERE date(scheduled_at,'+05:30') = ? AND status NOT IN ('cancelled')")
      .get(today).n;
    const openVisits = db.prepare("SELECT COUNT(*) AS n FROM visits WHERE status = 'open'").get().n;
    const patientsToday = db.prepare("SELECT COUNT(*) AS n FROM patients WHERE date(created_at,'+05:30') = ?").get(today).n;
    const collections = db
      .prepare("SELECT COALESCE(SUM(amount_paise),0) AS n FROM payments WHERE is_void = 0 AND date(received_at,'+05:30') = ?")
      .get(today).n;
    const outstanding = db
      .prepare("SELECT COALESCE(SUM(balance_paise),0) AS n, COUNT(*) AS c FROM invoices WHERE status IN ('open','partially_paid')")
      .get();

    const queue = db
      .prepare(
        `SELECT v.id, v.visit_no, v.visit_type, v.chief_complaint, v.created_at, v.seen_at,
                p.id AS patient_id, p.mrn, p.full_name, p.dob, p.age_years, p.sex,
                u.full_name AS doctor_name
         FROM visits v JOIN patients p ON p.id = v.patient_id
         LEFT JOIN users u ON u.id = v.doctor_id
         WHERE v.status = 'open' ORDER BY v.created_at ASC LIMIT 25`,
      )
      .all();

    const upcoming = db
      .prepare(
        `SELECT a.id, a.scheduled_at, a.status, a.reason, p.id AS patient_id, p.mrn, p.full_name,
                u.full_name AS doctor_name
         FROM appointments a JOIN patients p ON p.id = a.patient_id
         LEFT JOIN users u ON u.id = a.doctor_id
         WHERE date(a.scheduled_at,'+05:30') = ? AND a.status IN ('scheduled','arrived')
         ORDER BY a.scheduled_at ASC LIMIT 12`,
      )
      .all(today);

    const recentPatients = db
      .prepare(
        `SELECT id, mrn, full_name, dob, age_years, sex, phone, created_at FROM patients
         ORDER BY created_at DESC LIMIT 8`,
      )
      .all();

    const canSeeMoney = req.user.permissions.includes('billing.read');
    res.json({
      today,
      stats: {
        appointmentsToday,
        openVisits,
        patientsToday,
        collectionsTodayPaise: canSeeMoney ? collections : null,
        outstandingPaise: canSeeMoney ? outstanding.n : null,
        outstandingCount: canSeeMoney ? outstanding.c : null,
      },
      queue: queue.map((q) => ({
        visitId: q.id,
        visitNo: q.visit_no,
        visitType: q.visit_type,
        chiefComplaint: q.chief_complaint,
        createdAt: q.created_at,
        seen: !!q.seen_at,
        patientId: q.patient_id,
        mrn: q.mrn,
        patientName: q.full_name,
        age: q.dob ? null : q.age_years,
        dob: q.dob,
        sex: q.sex,
        doctorName: q.doctor_name,
      })),
      upcoming: upcoming.map((a) => ({
        id: a.id,
        patientId: a.patient_id,
        mrn: a.mrn,
        patientName: a.full_name,
        scheduledAt: a.scheduled_at,
        status: a.status,
        reason: a.reason,
        doctorName: a.doctor_name,
      })),
      recentPatients: recentPatients.map((p) => ({
        id: p.id, mrn: p.mrn, fullName: p.full_name, dob: p.dob, ageYears: p.age_years,
        sex: p.sex, phone: p.phone, createdAt: p.created_at,
      })),
    });
  });

  return router;
};
