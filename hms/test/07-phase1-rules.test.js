'use strict';

/**
 * Phase 1 (ADR-27) rules over HTTP: SW-11 edit-own, SW-12 cancel instead of
 * delete, SW-13 version conflicts, SW-14 hospital identity settings and logo.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  boot, setupAdmin, makeStaff, createPatient, makeTeam, openVisit, userVersion,
} = require('../test-support/helpers');

// 1x1 transparent PNG.
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
  '1f15c4890000000d49444154789c6300010000050001' + '0d0a2db40000000049454e44ae426082',
  'hex',
);

test('phase 1 rules', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin, user: adminUser } = await setupAdmin(env);
  const { reception, doctor, doctorUser } = await makeTeam(env, admin);
  const { client: otherDoctor } = await makeStaff(env, admin, { username: 'doc2', role: 'doctor', fullName: 'Dr Pooja Sinha' });

  const patient = await createPatient(reception, { firstName: 'Rekha', lastName: 'Devi', phone: '9800001111' });
  const visit = await openVisit(reception, patient.id, doctorUser.id, { chiefComplaint: 'Neck pain' });

  // -------------------------------------------------------------------------
  await t.test('only the assigned doctor changes a visit; other doctors can read it', async () => {
    const write = [
      ['notes', { body: 'Not my patient.' }],
      ['diagnoses', { description: 'Cervicalgia' }],
      ['prescriptions', { drugName: 'Paracetamol' }],
      ['vitals', { pulseBpm: 72 }],
    ];
    for (const [what, body] of write) {
      const res = await otherDoctor.post(`/api/visits/${visit.id}/${what}`, body);
      assert.equal(res.status, 403, what);
    }
    assert.equal((await otherDoctor.post(`/api/visits/${visit.id}/close`, {})).status, 403);
    const read = await otherDoctor.get(`/api/visits/${visit.id}`);
    assert.equal(read.status, 200);
    assert.ok(Array.isArray(read.body.notes), 'doctors read every chart (D2 pending sign-off)');
  });

  await t.test('a visit with no doctor assigned cannot be written to', async () => {
    const other = await createPatient(reception, { firstName: 'Mamta', lastName: 'Rai', phone: '9800002222' });
    const unassigned = await reception.post('/api/visits', { patientId: other.id });
    const res = await doctor.post(`/api/visits/${unassigned.body.visit.id}/notes`, { body: 'Who is this?' });
    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /no doctor assigned/);
  });

  await t.test('admin is not a doctor: it cannot be assigned to visits or appointments', async () => {
    const doctors = (await reception.get('/api/staff/doctors')).body.doctors;
    assert.ok(doctors.every((d) => d.role === 'doctor'));
    assert.ok(!doctors.some((d) => d.id === adminUser.id));
    const other = await createPatient(reception, { firstName: 'Soni', lastName: 'Kumari', phone: '9800003333' });
    const asVisit = await reception.post('/api/visits', { patientId: other.id, doctorId: adminUser.id });
    assert.equal(asVisit.status, 400);
    const asAppt = await reception.post('/api/appointments', {
      patientId: other.id, doctorId: adminUser.id, scheduledAt: new Date(Date.now() + 3600e3).toISOString(),
    });
    assert.equal(asAppt.status, 400);
  });

  // -------------------------------------------------------------------------
  await t.test('wrong diagnoses and prescriptions are cancelled with a reason, never deleted', async () => {
    const dx = await doctor.post(`/api/visits/${visit.id}/diagnoses`, { description: 'Wrong side recorded', code: 'M54.2' });
    const rx = await doctor.post(`/api/visits/${visit.id}/prescriptions`, { drugName: 'Wrong medicine' });

    const noReason = await doctor.post(`/api/visits/${visit.id}/diagnoses/${dx.body.id}/cancel`, {});
    assert.equal(noReason.status, 400);
    const byOther = await otherDoctor.post(`/api/visits/${visit.id}/diagnoses/${dx.body.id}/cancel`, { reason: 'Not mine to cancel' });
    assert.equal(byOther.status, 403);

    assert.equal((await doctor.post(`/api/visits/${visit.id}/diagnoses/${dx.body.id}/cancel`, { reason: 'Entered on the wrong side' })).status, 200);
    assert.equal((await doctor.post(`/api/visits/${visit.id}/prescriptions/${rx.body.id}/cancel`, { reason: 'Wrong medicine chosen' })).status, 200);
    assert.equal((await doctor.post(`/api/visits/${visit.id}/diagnoses/${dx.body.id}/cancel`, { reason: 'Again please' })).status, 409);

    const detail = (await doctor.get(`/api/visits/${visit.id}`)).body;
    const d = detail.diagnoses.find((x) => x.id === dx.body.id);
    assert.equal(d.cancelReason, 'Entered on the wrong side');
    assert.equal(d.cancelledByName, 'Dr Anil Verma');
    assert.ok(detail.prescriptions.find((x) => x.id === rx.body.id).cancelledAt);

    assert.equal((await doctor.del(`/api/visits/${visit.id}/diagnoses/${dx.body.id}`)).status, 405);
    const audit = (await admin.get(`/api/admin/audit?patientId=${patient.id}`)).body.events.map((e) => e.action);
    assert.ok(audit.includes('diagnosis.cancel') && audit.includes('prescription.cancel'));
  });

  await t.test('only the author cancels an unsigned note; signed notes stay', async () => {
    const draft = await doctor.post(`/api/visits/${visit.id}/notes`, { body: 'Draft written in the wrong chart.' });
    const signed = await doctor.post(`/api/visits/${visit.id}/notes`, { body: 'Proper consultation note.' });
    await doctor.post(`/api/notes/${signed.body.id}/sign`, {});

    assert.equal((await otherDoctor.post(`/api/notes/${draft.body.id}/cancel`, { reason: 'Not mine' })).status, 403);
    assert.equal((await doctor.post(`/api/notes/${draft.body.id}/cancel`, { reason: 'Wrong patient chart' })).status, 200);
    assert.equal((await doctor.post(`/api/notes/${signed.body.id}/cancel`, { reason: 'Changed my mind' })).status, 409);
    assert.equal((await doctor.post(`/api/notes/${draft.body.id}/sign`, {})).status, 409, 'a cancelled note cannot be signed');

    const notes = (await doctor.get(`/api/visits/${visit.id}`)).body.notes;
    assert.equal(notes.find((n) => n.id === draft.body.id).cancelReason, 'Wrong patient chart');
  });

  // -------------------------------------------------------------------------
  await t.test('stale edits get 409 instead of overwriting someone else (D-08)', async () => {
    const fresh = (await reception.get(`/api/patients/${patient.id}`)).body.patient;
    const missing = await reception.patch(`/api/patients/${patient.id}`, { occupation: 'Teacher' });
    assert.equal(missing.status, 400, 'the version is required');

    const first = await reception.patch(`/api/patients/${patient.id}`, { occupation: 'Teacher', version: fresh.version });
    assert.equal(first.status, 200);
    const second = await reception.patch(`/api/patients/${patient.id}`, { occupation: 'Farmer', version: fresh.version });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'version_conflict');
    assert.equal(second.body.error.details.currentVersion, fresh.version + 1);
    assert.equal((await reception.get(`/api/patients/${patient.id}`)).body.patient.occupation, 'Teacher', 'the first edit survives');

    // Appointments
    await reception.post('/api/appointments', {
      patientId: patient.id, doctorId: doctorUser.id, scheduledAt: new Date(Date.now() + 7200e3).toISOString(),
    });
    const appt = (await reception.get('/api/appointments')).body.appointments.find((a) => a.patientId === patient.id);
    assert.equal((await reception.patch(`/api/appointments/${appt.id}`, { reason: 'Review', version: appt.version })).status, 200);
    assert.equal((await reception.patch(`/api/appointments/${appt.id}`, { reason: 'Other', version: appt.version })).status, 409);

    // Visits (non-clinical fields by reception)
    const v = (await reception.get(`/api/visits/${visit.id}`)).body.visit;
    assert.equal((await reception.patch(`/api/visits/${visit.id}`, { chiefComplaint: 'Neck and shoulder pain', version: v.version })).status, 200);
    assert.equal((await reception.patch(`/api/visits/${visit.id}`, { chiefComplaint: 'Old text', version: v.version })).status, 409);

    // Staff accounts
    const docVersion = await userVersion(admin, doctorUser.id);
    assert.equal((await admin.patch(`/api/admin/users/${doctorUser.id}`, { designation: 'Physiotherapist', version: docVersion })).status, 200);
    assert.equal((await admin.patch(`/api/admin/users/${doctorUser.id}`, { designation: 'Other', version: docVersion })).status, 409);
  });

  await t.test('reception cannot write the clinical parts of a visit', async () => {
    const v = (await reception.get(`/api/visits/${visit.id}`)).body.visit;
    const res = await reception.patch(`/api/visits/${visit.id}`, { dischargeSummary: 'Reception summary', version: v.version });
    assert.equal(res.status, 403);
  });

  // -------------------------------------------------------------------------
  await t.test('hospital identity settings are validated and versioned', async () => {
    const loaded = (await admin.get('/api/admin/settings')).body;
    assert.equal(loaded.settings.receipt_cycle, 'financial_year', 'D-05 default');
    assert.equal(loaded.settings.trust_name, 'Sri Vashishtha Kalyan Trust');
    assert.equal(loaded.settings.hospital_name_hi, 'कल्याण हॉस्पिटल');

    const bad = await admin.patch('/api/admin/settings', {
      version: loaded.version, receipt_cycle: 'weekly', consultation_validity_days: '-3', hospital_name: '',
    });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.error.details.map((d) => d.field).sort(), ['consultation_validity_days', 'hospital_name', 'receipt_cycle']);

    const ok = await admin.patch('/api/admin/settings', {
      version: loaded.version, receipt_cycle: 'calendar_year', print_footer_hi: 'शुभकामनाएँ', clinic2_address: 'Shrirampur Road, Garhani',
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.version, loaded.version + 1);
    const stale = await admin.patch('/api/admin/settings', { version: loaded.version, receipt_cycle: 'financial_year' });
    assert.equal(stale.status, 409);

    const me = (await reception.get('/api/auth/me')).body.settings;
    assert.equal(me.receiptCycle, 'calendar_year');
    assert.equal(me.printFooterHi, 'शुभकामनाएँ');
    assert.equal(me.trustNameHi, 'श्री वशिष्ठ कल्याण ट्रस्ट');
    assert.equal(me.logoUrl, null);

    assert.equal((await reception.patch('/api/admin/settings', { version: ok.body.version, receipt_cycle: 'financial_year' })).status, 403);
  });

  await t.test('the logo is uploaded by the admin and served publicly', async () => {
    const notImage = await admin.request('POST', '/api/admin/settings/logo', {
      raw: Buffer.from('<svg onload=alert(1)>'), headers: { 'content-type': 'image/svg+xml' },
    });
    assert.equal(notImage.status, 415);
    const byDesk = await reception.request('POST', '/api/admin/settings/logo', { raw: PNG, headers: { 'content-type': 'image/png' } });
    assert.equal(byDesk.status, 403);

    const up = await admin.request('POST', '/api/admin/settings/logo', { raw: PNG, headers: { 'content-type': 'image/png' } });
    assert.equal(up.status, 201, JSON.stringify(up.body));
    assert.match(up.body.logo.url, /^\/api\/branding\/logo\?v=\d+$/);

    const pub = await fetch(`${env.base}${up.body.logo.url}`);
    assert.equal(pub.status, 200, 'served without a session, for the sign-in page');
    assert.equal(pub.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await pub.arrayBuffer()), PNG);

    const status = (await env.client().get('/api/bootstrap/status')).body;
    assert.equal(status.logoUrl, up.body.logo.url);

    assert.equal((await admin.del('/api/admin/settings/logo')).status, 200);
    assert.equal((await fetch(`${env.base}/api/branding/logo`)).status, 404);
  });

  await t.test('the idle timeout setting is what the server enforces', async () => {
    const { version } = (await admin.get('/api/admin/settings')).body;
    assert.equal((await admin.patch('/api/admin/settings', { version, session_idle_minutes: '5' })).status, 200);
    const login = await env.client().post('/api/auth/login', { username: 'admin', password: 'Sunrise-Clinic-2026!' });
    const minutes = (new Date(login.body.expiresAt).getTime() - Date.now()) / 60000;
    assert.ok(minutes > 4 && minutes <= 5.1, `session expires in ${minutes.toFixed(2)} min`);
  });
});
