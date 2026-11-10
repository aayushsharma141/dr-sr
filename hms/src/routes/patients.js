'use strict';

const express = require('express');

const { Validator, ApiError, pagination, likePattern } = require('../lib/http');
const { audit, idParam, expectedVersion, updateVersioned } = require('../lib/request');
const { mapPatient, todayLocal } = require('../lib/domain');
const { requirePerm } = require('../auth');

const SEX = ['male', 'female', 'other', 'unknown'];

function buildPatientFields(v, { partial = false } = {}) {
  const opt = { required: false };
  const fields = {
    firstName: v.str('firstName', partial ? { max: 80 } : { required: true, max: 80, label: 'First name' }),
    lastName: v.str('lastName', { max: 80, label: 'Last name' }),
    dob: v.date('dob', { label: 'Date of birth' }),
    dobEstimated: v.bool('dobEstimated'),
    ageYears: v.int('ageYears', { min: 0, max: 130, label: 'Age' }),
    sex: v.enumOf('sex', SEX, { label: 'Sex' }),
    phone: v.phone('phone', { label: 'Phone' }),
    altPhone: v.phone('altPhone', { label: 'Alternate phone' }),
    email: v.email('email'),
    addressLine: v.str('addressLine', { max: 200, ...opt }),
    city: v.str('city', { max: 80, ...opt }),
    district: v.str('district', { max: 80, ...opt }),
    state: v.str('state', { max: 80, ...opt }),
    pincode: v.str('pincode', { max: 12, ...opt }),
    photoPath: v.str('photoPath', { max: 500, ...opt }),
    bloodGroup: v.str('bloodGroup', { max: 8, ...opt }),
    maritalStatus: v.str('maritalStatus', { max: 30, ...opt }),
    occupation: v.str('occupation', { max: 80, ...opt }),
    guardianName: v.str('guardianName', { max: 120, ...opt }),
    guardianRelation: v.str('guardianRelation', { max: 40, ...opt }),
    emergencyContactName: v.str('emergencyContactName', { max: 120, ...opt }),
    emergencyContactPhone: v.phone('emergencyContactPhone', { label: 'Emergency contact phone' }),
    idType: v.str('idType', { max: 40, ...opt }),
    idNumber: v.str('idNumber', { max: 60, ...opt }),
    allergiesSummary: v.str('allergiesSummary', { max: 2000, ...opt }),
    notes: v.str('notes', { max: 4000, ...opt }),
  };
  return fields;
}

module.exports = function patientRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  // ---------------------------------------------------------------------------
  // Duplicate check (SW-20)
  // ---------------------------------------------------------------------------
  router.get('/check-duplicate', requirePerm('patient.read'), (req, res) => {
    const name = String(req.query.name || '').trim().toLowerCase();
    const phone = String(req.query.phone || '').trim().replace(/\D/g, '').slice(-10);
    if (!name || !phone) return res.json({ hasDuplicate: false, matchingPatient: null });

    const normName = name.replace(/\s+/g, ' ');
    const row = db
      .prepare(
        `SELECT p.* FROM patients p
         WHERE p.is_active = 1
           AND LOWER(TRIM(p.full_name)) = @normName
           AND (p.phone LIKE @phoneSuffix OR p.alt_phone LIKE @phoneSuffix)
         LIMIT 1`,
      )
      .get({ normName, phoneSuffix: `%${phone}` });

    if (row) {
      return res.json({ hasDuplicate: true, matchingPatient: mapPatient(row) });
    }
    res.json({ hasDuplicate: false, matchingPatient: null });
  });

  // ---------------------------------------------------------------------------
  // Search / list
  // ---------------------------------------------------------------------------
  router.get('/', requirePerm('patient.read'), (req, res) => {
    const { limit, page, offset } = pagination(req.query, { defaultLimit: 20, maxLimit: 100 });
    const q = String(req.query.q || '').trim().slice(0, 80);
    const includeInactive = String(req.query.includeInactive || '') === 'true';

    const where = [includeInactive ? '1=1' : 'p.is_active = 1'];
    const params = {};
    if (q) {
      where.push('(p.full_name LIKE @like OR p.mrn LIKE @like OR p.phone LIKE @like OR p.alt_phone LIKE @like)');
      params.like = likePattern(q);
    }
    const whereSql = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM patients p WHERE ${whereSql}`).get(params).n;
    const rows = db
      .prepare(
        `SELECT p.*, 
                (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
                (SELECT MAX(v.created_at) FROM visits v WHERE v.patient_id = p.id) AS last_visit_at,
                (SELECT COALESCE(SUM(i.balance_paise),0) FROM invoices i
                  WHERE i.patient_id = p.id AND i.status <> 'void') AS balance_paise
         FROM patients p
         WHERE ${whereSql}
         ORDER BY p.full_name COLLATE NOCASE ASC
         LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset });

    const patients = rows.map((row) => ({
      ...mapPatient(row),
      visitCount: row.visit_count,
      lastVisitAt: row.last_visit_at,
      // Doctors have no billing access (ADR-23).
      balancePaise: req.user.permissions.includes('billing.read') ? row.balance_paise : null,
    }));

    if (q) {
      audit(ctx, req, { action: 'patient.search', detail: { q, results: patients.length } });
    }
    res.json({ patients, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) });
  });

  // ---------------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------------
  router.post('/', requirePerm('patient.write'), (req, res) => {
    const v = new Validator(req.body);
    const f = buildPatientFields(v);
    const allergiesSummary = f.allergiesSummary;
    const notes = f.notes;
    v.throwIfInvalid();

    if (!f.firstName) throw new ApiError(400, 'Please correct the highlighted fields.', {
      code: 'validation_failed',
      details: [{ field: 'firstName', message: 'First name is required.' }],
    });
    if (!f.dob && (f.ageYears === null || f.ageYears === undefined)) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'dob', message: 'Enter a date of birth, or an approximate age.' }],
      });
    }
    if (!f.phone) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'phone', message: 'A contact phone number is required.' }],
      });
    }

    const now = new Date().toISOString();
    const year = todayLocal().slice(0, 4);
    const seq = ctx.store.nextSequence(`seq:urn:${year}`);
    const mrn = `KH-${year}-${String(seq).padStart(4, '0')}`;
    const fullName = [f.firstName, f.lastName].filter(Boolean).join(' ');

    const info = db
      .prepare(
        `INSERT INTO patients (mrn, first_name, last_name, full_name, dob, dob_estimated, age_years, sex,
          phone, alt_phone, email, address_line, city, district, state, pincode, photo_path, blood_group, marital_status, occupation,
          guardian_name, guardian_relation, emergency_contact_name, emergency_contact_phone, id_type, id_number,
          allergies_summary, notes, created_by, updated_by, created_at, updated_at)
         VALUES (@mrn,@firstName,@lastName,@fullName,@dob,@dobEstimated,@ageYears,@sex,
          @phone,@altPhone,@email,@addressLine,@city,@district,@state,@pincode,@photoPath,@bloodGroup,@maritalStatus,@occupation,
          @guardianName,@guardianRelation,@emergencyContactName,@emergencyContactPhone,@idType,@idNumber,
          @allergiesSummary,@notes,@userId,@userId,@now,@now)`,
      )
      .run({
        mrn,
        firstName: f.firstName,
        lastName: f.lastName || '',
        fullName,
        dob: f.dob,
        dobEstimated: f.dobEstimated ? 1 : 0,
        ageYears: f.dob ? null : f.ageYears,
        sex: f.sex || 'unknown',
        phone: f.phone,
        altPhone: f.altPhone,
        email: f.email,
        addressLine: f.addressLine,
        city: f.city,
        district: f.district || 'Bhojpur',
        state: f.state || 'Bihar',
        pincode: f.pincode,
        photoPath: f.photoPath || null,
        bloodGroup: f.bloodGroup,
        maritalStatus: f.maritalStatus,
        occupation: f.occupation,
        guardianName: f.guardianName,
        guardianRelation: f.guardianRelation,
        emergencyContactName: f.emergencyContactName,
        emergencyContactPhone: f.emergencyContactPhone,
        idType: f.idType,
        idNumber: f.idNumber,
        allergiesSummary,
        notes,
        userId: req.user.id,
        now,
      });

    const patient = db.prepare('SELECT * FROM patients WHERE id = ?').get(info.lastInsertRowid);
    audit(ctx, req, {
      action: 'patient.create',
      entityType: 'patient',
      entityId: patient.id,
      patientId: patient.id,
      detail: { mrn: patient.mrn, name: patient.full_name },
    });
    res.status(201).json({ patient: mapPatient(patient) });
  });

  // ---------------------------------------------------------------------------
  // Read one
  // ---------------------------------------------------------------------------
  router.get('/:id', requirePerm('patient.read'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Patient not found.');

    const allergies = db
      .prepare(
        `SELECT a.*, u.full_name AS recorded_by_name FROM patient_allergies a
         LEFT JOIN users u ON u.id = a.recorded_by
         WHERE a.patient_id = ? AND a.is_active = 1 ORDER BY a.created_at DESC`,
      )
      .all(id)
      .map((a) => ({
        id: a.id, substance: a.substance, reaction: a.reaction, severity: a.severity,
        recordedByName: a.recorded_by_name, createdAt: a.created_at,
      }));

    const can = (perm) => req.user.permissions.includes(perm);
    const conditions = !can('clinical.read') ? [] : db
      .prepare(
        `SELECT c.*, u.full_name AS recorded_by_name FROM patient_conditions c
         LEFT JOIN users u ON u.id = c.recorded_by
         WHERE c.patient_id = ? ORDER BY c.status ASC, c.created_at DESC`,
      )
      .all(id)
      .map((c) => ({
        id: c.id, condition: c.condition, sinceDate: c.since_date, status: c.status,
        notes: c.notes, recordedByName: c.recorded_by_name, createdAt: c.created_at,
      }));

    // Vitals and the problem list are clinical content (D-04 / EG-16).
    const latestVitals = !can('clinical.read') ? null : db
      .prepare('SELECT * FROM vitals WHERE patient_id = ? ORDER BY recorded_at DESC LIMIT 1')
      .get(id);

    const stats = {
      visitCount: db.prepare('SELECT COUNT(*) AS n FROM visits WHERE patient_id = ?').get(id).n,
      openVisit: db
        .prepare("SELECT id, visit_no, doctor_id FROM visits WHERE patient_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1")
        .get(id) || null,
      // Doctors have no billing access (ADR-23); Admin has no document access.
      balancePaise: !can('billing.read') ? null : db
        .prepare("SELECT COALESCE(SUM(balance_paise),0) AS n FROM invoices WHERE patient_id = ? AND status <> 'void'")
        .get(id).n,
      documentCount: !can('attachment.read') ? null : db
        .prepare('SELECT COUNT(*) AS n FROM attachments WHERE patient_id = ? AND is_deleted = 0')
        .get(id).n,
    };

    audit(ctx, req, {
      action: 'patient.view',
      entityType: 'patient',
      entityId: id,
      patientId: id,
      detail: { mrn: row.mrn },
    });

    res.json({
      patient: mapPatient(row),
      allergies,
      conditions,
      latestVitals: latestVitals ? mapVitalsRow(latestVitals) : null,
      stats,
      permissions: req.user.permissions,
    });
  });

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  router.patch('/:id', requirePerm('patient.write'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Patient not found.');

    const v = new Validator(req.body);
    const version = expectedVersion(v);
    const f = buildPatientFields(v, { partial: true });
    v.throwIfInvalid();

    const patch = {};
    const map = {
      firstName: 'first_name', lastName: 'last_name', dob: 'dob', dobEstimated: 'dob_estimated',
      ageYears: 'age_years', sex: 'sex', phone: 'phone', altPhone: 'alt_phone', email: 'email',
      addressLine: 'address_line', city: 'city', district: 'district', state: 'state', pincode: 'pincode',
      photoPath: 'photo_path', bloodGroup: 'blood_group', maritalStatus: 'marital_status', occupation: 'occupation',
      guardianName: 'guardian_name', guardianRelation: 'guardian_relation',
      emergencyContactName: 'emergency_contact_name', emergencyContactPhone: 'emergency_contact_phone',
      idType: 'id_type', idNumber: 'id_number', allergiesSummary: 'allergies_summary', notes: 'notes',
    };
    for (const [camel, column] of Object.entries(map)) {
      if (f[camel] !== undefined) patch[column] = f[camel];
    }
    if (f.dobEstimated !== undefined && f.dobEstimated !== null) patch.dob_estimated = f.dobEstimated ? 1 : 0;
    if (Object.keys(patch).length === 0) {
      return res.json({ patient: mapPatient(row), unchanged: true });
    }

    // Keep the denormalised full_name in sync.
    const nextFirst = patch.first_name !== undefined ? patch.first_name : row.first_name;
    const nextLast = patch.last_name !== undefined ? patch.last_name : row.last_name;
    patch.full_name = [nextFirst, nextLast].filter(Boolean).join(' ');
    patch.updated_by = req.user.id;
    patch.updated_at = new Date().toISOString();

    updateVersioned(db, 'patients', id, version, patch);

    const changed = Object.keys(patch).filter((k) => !['updated_at', 'updated_by', 'full_name'].includes(k));
    audit(ctx, req, {
      action: 'patient.update',
      entityType: 'patient',
      entityId: id,
      patientId: id,
      detail: { fields: changed },
    });
    res.json({ patient: mapPatient(db.prepare('SELECT * FROM patients WHERE id = ?').get(id)) });
  });

  router.post('/:id/archive', requirePerm('patient.write'), (req, res) => {
    const id = idParam(req);
    const row = db.prepare('SELECT * FROM patients WHERE id = ?').get(id);
    if (!row) throw new ApiError(404, 'Patient not found.');
    const openVisit = db.prepare("SELECT id FROM visits WHERE patient_id = ? AND status = 'open'").get(id);
    if (openVisit) throw new ApiError(409, 'Close the open visit before archiving this patient.');

    const archive = String(req.body?.archive ?? 'true') !== 'false';
    db.prepare('UPDATE patients SET is_active = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(
      archive ? 0 : 1, req.user.id, new Date().toISOString(), id,
    );
    audit(ctx, req, {
      action: archive ? 'patient.archive' : 'patient.restore',
      entityType: 'patient',
      entityId: id,
      patientId: id,
      detail: { mrn: row.mrn },
    });
    res.json({ ok: true, isActive: !archive });
  });

  // ---------------------------------------------------------------------------
  // Allergies
  // ---------------------------------------------------------------------------
  router.post('/:id/allergies', requirePerm('clinical.write', 'patient.write'), (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM patients WHERE id = ?').get(id)) throw new ApiError(404, 'Patient not found.');
    const v = new Validator(req.body);
    const substance = v.str('substance', { required: true, max: 120, label: 'Substance' });
    const reaction = v.str('reaction', { max: 200 });
    const severity = v.enumOf('severity', ['mild', 'moderate', 'severe', 'life_threatening']) || 'moderate';
    v.throwIfInvalid();
    const info = db
      .prepare('INSERT INTO patient_allergies (patient_id, substance, reaction, severity, recorded_by, created_at) VALUES (?,?,?,?,?,?)')
      .run(id, substance, reaction, severity, req.user.id, new Date().toISOString());
    audit(ctx, req, {
      action: 'patient.allergy_add', entityType: 'patient', entityId: id, patientId: id,
      detail: { substance, severity },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.delete('/:id/allergies/:allergyId', requirePerm('clinical.write', 'patient.write'), (req, res) => {
    const id = idParam(req);
    const allergyId = idParam(req, 'allergyId');
    const info = db
      .prepare('UPDATE patient_allergies SET is_active = 0 WHERE id = ? AND patient_id = ?')
      .run(allergyId, id);
    if (!info.changes) throw new ApiError(404, 'Allergy not found.');
    audit(ctx, req, {
      action: 'patient.allergy_remove', entityType: 'patient', entityId: id, patientId: id,
      detail: { allergyId },
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Conditions
  // ---------------------------------------------------------------------------
  router.post('/:id/conditions', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM patients WHERE id = ?').get(id)) throw new ApiError(404, 'Patient not found.');
    const v = new Validator(req.body);
    const condition = v.str('condition', { required: true, max: 160, label: 'Condition' });
    const sinceDate = v.date('sinceDate');
    const status = v.enumOf('status', ['active', 'resolved', 'in_remission']) || 'active';
    const notes = v.str('notes', { max: 1000 });
    v.throwIfInvalid();
    const info = db
      .prepare('INSERT INTO patient_conditions (patient_id, condition, since_date, status, notes, recorded_by, created_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, condition, sinceDate, status, notes, req.user.id, new Date().toISOString());
    audit(ctx, req, {
      action: 'patient.condition_add', entityType: 'patient', entityId: id, patientId: id,
      detail: { condition },
    });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.patch('/:id/conditions/:conditionId', requirePerm('clinical.write'), (req, res) => {
    const id = idParam(req);
    const conditionId = idParam(req, 'conditionId');
    const v = new Validator(req.body);
    const status = v.enumOf('status', ['active', 'resolved', 'in_remission'], { required: true });
    v.throwIfInvalid();
    const info = db
      .prepare('UPDATE patient_conditions SET status = ? WHERE id = ? AND patient_id = ?')
      .run(status, conditionId, id);
    if (!info.changes) throw new ApiError(404, 'Condition not found.');
    audit(ctx, req, {
      action: 'patient.condition_update', entityType: 'patient', entityId: id, patientId: id,
      detail: { conditionId, status },
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Timeline (visits + notes + documents + billing, newest first)
  // ---------------------------------------------------------------------------
  router.get('/:id/timeline', requirePerm('patient.read'), (req, res) => {
    const id = idParam(req);
    if (!db.prepare('SELECT id FROM patients WHERE id = ?').get(id)) throw new ApiError(404, 'Patient not found.');
    const events = [];

    for (const v of db
      .prepare(
        `SELECT v.*, u.full_name AS doctor_name FROM visits v LEFT JOIN users u ON u.id = v.doctor_id
         WHERE v.patient_id = ? ORDER BY v.created_at DESC LIMIT 100`,
      )
      .all(id)) {
      events.push({
        type: 'visit',
        at: v.created_at,
        title: `${v.visit_type === 'ipd' ? 'In-patient' : v.visit_type === 'emergency' ? 'Emergency' : 'OPD'} visit ${v.visit_no}`,
        subtitle: [v.department, v.doctor_name, v.chief_complaint].filter(Boolean).join(' · '),
        visitId: v.id,
        status: v.status,
      });
    }

    if (req.user.permissions.includes('clinical.read')) {
      for (const n of db
        .prepare(
          `SELECT n.*, u.full_name AS author_name FROM clinical_notes n LEFT JOIN users u ON u.id = n.author_id
           WHERE n.patient_id = ? ORDER BY n.created_at DESC LIMIT 100`,
        )
        .all(id)) {
        events.push({
          type: 'note',
          at: n.created_at,
          title: `Clinical note (${n.note_type})`,
          subtitle: [n.author_name, (n.body || '').slice(0, 90)].filter(Boolean).join(' · '),
          noteId: n.id,
          visitId: n.visit_id,
          status: n.cancelled_at ? 'cancelled' : n.signed_at ? 'signed' : 'draft',
        });
      }
      for (const d of db
        .prepare('SELECT * FROM diagnoses WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50')
        .all(id)) {
        events.push({
          type: 'diagnosis',
          at: d.created_at,
          title: d.description,
          subtitle: [d.code, d.kind, d.cancelled_at ? 'cancelled' : null].filter(Boolean).join(' · '),
          visitId: d.visit_id,
          status: d.cancelled_at ? 'cancelled' : undefined,
        });
      }
    }

    const canSee = (perm) => req.user.permissions.includes(perm);
    for (const a of !canSee('attachment.read') ? [] : db
      .prepare('SELECT * FROM attachments WHERE patient_id = ? AND is_deleted = 0 ORDER BY created_at DESC LIMIT 50')
      .all(id)) {
      events.push({
        type: 'document',
        at: a.created_at,
        title: a.title || a.original_name,
        subtitle: `${a.category} · ${Math.max(1, Math.round(a.size_bytes / 1024))} KB`,
        attachmentId: a.id,
      });
    }

    for (const i of !canSee('billing.read') ? [] : db
      .prepare('SELECT * FROM invoices WHERE patient_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(id)) {
      events.push({
        type: 'invoice',
        at: i.created_at,
        title: `Invoice ${i.invoice_no}`,
        subtitle: `₹${(i.total_paise / 100).toFixed(2)} · ${i.status.replace('_', ' ')}`,
        invoiceId: i.id,
        status: i.status,
      });
    }

    events.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    res.json({ events: events.slice(0, 250) });
  });

  return router;
};

function mapVitalsRow(row) {
  return {
    id: row.id,
    recordedAt: row.recorded_at,
    temperatureC: row.temperature_c,
    pulseBpm: row.pulse_bpm,
    respRate: row.resp_rate,
    bpSystolic: row.bp_systolic,
    bpDiastolic: row.bp_diastolic,
    spo2: row.spo2,
    weightKg: row.weight_kg,
    heightCm: row.height_cm,
    painScore: row.pain_score,
    notes: row.notes,
  };
}

module.exports.mapVitalsRow = mapVitalsRow;
