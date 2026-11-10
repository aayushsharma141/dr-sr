'use strict';

/**
 * Phase 2 domain rules:
 *  - SW-20: Patient URN format KH-YYYY-XXXX, duplicate check, district.
 *  - SW-21: Departments and doctors with Hindi names; fee privacy on doctor screens.
 *  - SW-22 & SW-23: Appointments, per-doctor monotonic daily tokens, consultations under visit.
 *  - D4: Consultation fee once, revisit fee within validity window, physio package fee at plan start.
 *  - SW-26 & Invariant 11: Physio plans & sessions, session deduction on completion, no delete.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  boot, setupAdmin, makeStaff, createPatient, makeTeam, openVisit,
} = require('../test-support/helpers');

test('phase 2 domain rules', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin, user: adminUser } = await setupAdmin(env);
  const { reception, doctor, doctorUser } = await makeTeam(env, admin);
  const { client: eyeDoctor, user: eyeUser } = await makeStaff(env, admin, {
    username: 'eyedoc', role: 'doctor', fullName: 'Dr Ramesh Sharma',
  });
  const { client: thirdDoctor } = await makeStaff(env, admin, {
    username: 'thirddoc', role: 'doctor', fullName: 'Dr Sunita Rao',
  });

  // Assign doctor department and fees
  env.ctx.db.prepare(
    `UPDATE users
     SET department_id = 1, department_code = 'PHYSIOTHERAPY',
         consultation_fee_paise = 50000, revisit_fee_paise = 30000
     WHERE id = ?`,
  ).run(doctorUser.id);

  env.ctx.db.prepare(
    `UPDATE users
     SET department_id = 2, department_code = 'OPHTHALMOLOGY',
         consultation_fee_paise = 40000, revisit_fee_paise = 20000
     WHERE id = ?`,
  ).run(eyeUser.id);

  // ---------------------------------------------------------------------------
  // 1. Patient URN and registration (SW-20)
  // ---------------------------------------------------------------------------
  await t.test('patient registration allocates KH-YYYY-XXXX URN with Bhojpur district and duplicate warning', async () => {
    const year = new Date().getFullYear();
    const res = await reception.post('/api/patients', {
      firstName: 'Kanti',
      lastName: 'Devi',
      dob: '1985-04-12',
      sex: 'female',
      phone: '9876543210',
    });
    assert.equal(res.status, 201);
    const p = res.body.patient;
    assert.match(p.mrn, new RegExp(`^KH-${year}-\\d{4}$`));
    assert.equal(p.district, 'Bhojpur');
    assert.equal(p.state, 'Bihar');

    // Duplicate check finds existing patient by name and phone
    const dupRes = await reception.get('/api/patients/check-duplicate?name=Kanti%20Devi&phone=9876543210');
    assert.equal(dupRes.status, 200);
    assert.equal(dupRes.body.hasDuplicate, true);
    assert.equal(dupRes.body.matchingPatient.mrn, p.mrn);

    // No duplicate for different number
    const noDup = await reception.get('/api/patients/check-duplicate?name=Kanti%20Devi&phone=9111111111');
    assert.equal(noDup.status, 200);
    assert.equal(noDup.body.hasDuplicate, false);
  });

  // ---------------------------------------------------------------------------
  // 2. Departments, doctors and fee privacy (SW-21, D4)
  // ---------------------------------------------------------------------------
  await t.test('departments list Hindi names and doctor screens NEVER see fees', async () => {
    const deptRes = await reception.get('/api/departments');
    assert.equal(deptRes.status, 200);
    const depts = deptRes.body.departments;
    assert.ok(depts.some((d) => d.code === 'PHYSIOTHERAPY' && d.name_hi === 'फिजियोथेरेपी'));
    assert.ok(depts.some((d) => d.code === 'OPHTHALMOLOGY' && d.name_hi === 'नेत्र रोग'));

    // Reception sees fees
    const recpDocs = await reception.get('/api/doctors');
    assert.equal(recpDocs.status, 200);
    const doc1 = recpDocs.body.doctors.find((d) => d.id === doctorUser.id);
    assert.equal(doc1.consultationFeePaise, 50000);
    assert.equal(doc1.revisitFeePaise, 30000);

    // Doctor querying /api/doctors has fees REDACTED (null)
    const docQuery = await doctor.get('/api/doctors');
    assert.equal(docQuery.status, 200);
    const redacted = docQuery.body.doctors.find((d) => d.id === doctorUser.id);
    assert.equal(redacted.consultationFeePaise, null);
    assert.equal(redacted.revisitFeePaise, null);
  });

  // ---------------------------------------------------------------------------
  // 3. Appointment check-in, tokens, and multi-doctor consultations (SW-22, SW-23)
  // ---------------------------------------------------------------------------
  await t.test('independent daily tokens per doctor and multi-consultation visits', async () => {
    const p1 = await createPatient(reception, { firstName: 'Ram', lastName: 'Prasad', phone: '9811110001' });

    // Book appointment with physio doctor
    const now = new Date().toISOString();
    const appt1 = await reception.post('/api/appointments', {
      patientId: p1.id,
      doctorId: doctorUser.id,
      scheduledAt: now,
      reason: 'Shoulder rehabilitation',
    });
    assert.equal(appt1.status, 201);

    // Check in appt 1 -> token 1 for doctorUser
    const check1 = await reception.post(`/api/appointments/${appt1.body.id}/check-in`, {});
    assert.equal(check1.status, 201);
    assert.equal(check1.body.token, 1);
    assert.equal(check1.body.feePaise, 50000, 'first visit charges full consultation fee');
    assert.equal(check1.body.isRevisit, false);
    const visitId = check1.body.visitId;

    // Book appointment for SAME patient with eye doctor on same day
    const appt2 = await reception.post('/api/appointments', {
      patientId: p1.id,
      doctorId: eyeUser.id,
      scheduledAt: now,
      reason: 'Cataract review',
    });
    assert.equal(appt2.status, 201);

    // Check in appt 2 -> token 1 for eyeUser (independent token sequence, ADR-26)
    // and attaches to the SAME open visit (Invariant 3)
    const check2 = await reception.post(`/api/appointments/${appt2.body.id}/check-in`, {});
    assert.equal(check2.status, 201);
    assert.equal(check2.body.token, 1, 'independent daily token sequence for eye doctor');
    assert.equal(check2.body.visitId, visitId, 'consultation attaches to open visit of the day');
    assert.equal(check2.body.feePaise, 40000, 'eye doctor consultation fee added');

    // Both doctors can edit clinical records on the visit
    const note1 = await doctor.post(`/api/visits/${visitId}/notes`, {
      body: 'Physiotherapy evaluation: right shoulder mobility reduced.',
    });
    assert.equal(note1.status, 201);

    const note2 = await eyeDoctor.post(`/api/visits/${visitId}/notes`, {
      body: 'Ophthalmology evaluation: right eye early cataract.',
    });
    assert.equal(note2.status, 201);

    // Third doctor who is NOT assigned to a consultation gets 403
    const forbiddenNote = await thirdDoctor.post(`/api/visits/${visitId}/notes`, {
      body: 'Intruder note',
    });
    assert.equal(forbiddenNote.status, 403);

    // But third doctor can READ the visit (D2 read all)
    const readVisit = await thirdDoctor.get(`/api/visits/${visitId}`);
    assert.equal(readVisit.status, 200);
    assert.equal(readVisit.body.consultations.length, 2);
  });

  // ---------------------------------------------------------------------------
  // 4. D4 Fee rule: Revisit fee within validity window
  // ---------------------------------------------------------------------------
  await t.test('check-in applies revisit fee if patient visited doctor within 7 days', async () => {
    const p = await createPatient(reception, { firstName: 'Sita', lastName: 'Kumari', phone: '9811110002' });
    const now = new Date().toISOString();

    // First visit check-in
    const appt1 = await reception.post('/api/appointments', {
      patientId: p.id,
      doctorId: doctorUser.id,
      scheduledAt: now,
    });
    const c1 = await reception.post(`/api/appointments/${appt1.body.id}/check-in`, {});
    assert.equal(c1.body.feePaise, 50000);
    assert.equal(c1.body.isRevisit, false);

    // Close first visit
    await doctor.post(`/api/visits/${c1.body.visitId}/close`, { outcome: 'Improved' });

    // Second visit check-in within validity days
    const appt2 = await reception.post('/api/appointments', {
      patientId: p.id,
      doctorId: doctorUser.id,
      scheduledAt: now,
    });
    const c2 = await reception.post(`/api/appointments/${appt2.body.id}/check-in`, {});
    assert.equal(c2.body.feePaise, 30000, 'revisit fee charged within validity window');
    assert.equal(c2.body.isRevisit, true);
  });

  // ---------------------------------------------------------------------------
  // 5. Physiotherapy plans and sessions (SW-26, Invariant 11, D4)
  // ---------------------------------------------------------------------------
  await t.test('physio treatment plans, package auto-invoicing, session progress and no delete', async () => {
    const p = await createPatient(reception, { firstName: 'Mahesh', lastName: 'Kumar', phone: '9811110003' });

    // Doctor creates treatment plan (10 sessions, package price Rs 3000 = 300000 paise)
    const planRes = await doctor.post('/api/treatment-plans', {
      patientId: p.id,
      planName: 'Cervical Spondylosis Package',
      conditionDiagnosis: 'Chronic cervical pain',
      totalSessions: 5,
      agreedPricePaise: 300000,
    });
    assert.equal(planRes.status, 201);
    const plan = planRes.body.treatmentPlan;
    assert.equal(plan.totalSessions, 5);
    assert.equal(plan.completedSessions, 0);
    assert.equal(plan.status, 'active');
    // Doctor screen DOES NOT see fee
    assert.equal(plan.agreedPricePaise, null);

    // Reception querying the plan CAN see the package price
    const recpPlan = await reception.get(`/api/treatment-plans/${plan.id}`);
    assert.equal(recpPlan.status, 200);
    assert.equal(recpPlan.body.treatmentPlan.agreedPricePaise, 300000);

    // Invariant 11: completed_sessions increments ONLY when sessions are logged
    const s1 = await doctor.post(`/api/treatment-plans/${plan.id}/sessions`, {
      vasScore: 8,
      modalities: ['IFT', 'Hot Pack'],
      clinicalNotes: 'Day 1 therapy, gentle traction.',
    });
    assert.equal(s1.status, 201);
    assert.equal(s1.body.session.sessionNumber, 1);
    assert.equal(s1.body.session.vasScore, 8);

    // Verify plan progress
    const pAfter1 = (await reception.get(`/api/treatment-plans/${plan.id}`)).body.treatmentPlan;
    assert.equal(pAfter1.completedSessions, 1);
    assert.equal(pAfter1.status, 'active');

    // Add session addendum
    const addendumRes = await doctor.post(`/api/treatment-sessions/${s1.body.session.id}/addenda`, {
      note: 'Patient tolerated therapy well with no dizziness.',
    });
    assert.equal(addendumRes.status, 201);

    // Log remaining sessions (2, 3, 4, 5)
    for (let i = 2; i <= 5; i++) {
      const res = await doctor.post(`/api/treatment-plans/${plan.id}/sessions`, {
        vasScore: Math.max(2, 9 - i),
        modalities: ['Exercises', 'Ultrasound'],
        clinicalNotes: `Session ${i} completed.`,
      });
      assert.equal(res.status, 201);
      assert.equal(res.body.session.sessionNumber, i);
    }

    // Plan is now completed
    const pAfter5 = (await reception.get(`/api/treatment-plans/${plan.id}`)).body.treatmentPlan;
    assert.equal(pAfter5.completedSessions, 5);
    assert.equal(pAfter5.status, 'completed');

    // Trying to log a 6th session is rejected
    const extra = await doctor.post(`/api/treatment-plans/${plan.id}/sessions`, {
      vasScore: 1,
      clinicalNotes: 'Extra session',
    });
    assert.equal(extra.status, 422);

    // Non-doctors cannot log sessions
    const recpLog = await reception.post(`/api/treatment-plans/${plan.id}/sessions`, { vasScore: 5 });
    assert.equal(recpLog.status, 403);

    // Plans and sessions cannot be deleted (SW-12)
    assert.throws(() => env.ctx.db.prepare('DELETE FROM treatment_plans').run(), /cannot be deleted/);
    assert.throws(() => env.ctx.db.prepare('DELETE FROM treatment_sessions').run(), /cannot be deleted/);
  });
});
