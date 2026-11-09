'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeStaff, createPatient } = require('../test-support/helpers');

test('patients and clinical records', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);

  await t.test('patients get sequential MRNs', async () => {
    const p1 = await createPatient(admin, { firstName: 'Anita', lastName: 'Deshmukh', phone: '9822000001' });
    const p2 = await createPatient(admin, { firstName: 'Vikram', lastName: 'Shah', phone: '9822000002' });
    assert.match(p1.mrn, /^KH-\d{6}$/);
    assert.equal(Number(p2.mrn.slice(3)) - Number(p1.mrn.slice(3)), 1);
    assert.equal(p1.age >= 30 && p1.age <= 40, true);
  });

  await t.test('registration validates required fields', async () => {
    const noPhone = await admin.post('/api/patients', { firstName: 'No', lastName: 'Phone', dob: '1990-01-01' });
    assert.equal(noPhone.status, 400);
    assert.equal(noPhone.body.error.details[0].field, 'phone');

    const noAge = await admin.post('/api/patients', { firstName: 'No', lastName: 'Dob', phone: '9822000003' });
    assert.equal(noAge.status, 400);
    assert.equal(noAge.body.error.details[0].field, 'dob');

    const badSex = await admin.post('/api/patients', {
      firstName: 'Bad', lastName: 'Sex', dob: '1990-01-01', phone: '9822000004', sex: 'martian',
    });
    assert.equal(badSex.status, 400);
  });

  let patient;
  await t.test('search finds patients by name, phone and MRN', async () => {
    patient = await createPatient(admin, {
      firstName: 'Sneha', lastName: 'Kulkarni', phone: '9812340000',
      addressLine: '12 Station Road', city: 'Ara', state: 'Bihar', pincode: '802301',
    });
    const byName = await admin.get('/api/patients?q=Kulkarni');
    assert.equal(byName.body.total, 1);
    const byPhone = await admin.get('/api/patients?q=9812340000');
    assert.equal(byPhone.body.total, 1);
    const byMrn = await admin.get(`/api/patients?q=${patient.mrn}`);
    assert.equal(byMrn.body.patients[0].id, patient.id);
    const none = await admin.get('/api/patients?q=zzzznotfound');
    assert.equal(none.body.total, 0);
  });

  await t.test('updating a patient keeps the display name in sync', async () => {
    const res = await admin.patch(`/api/patients/${patient.id}`, { lastName: 'Kulkarni-Patil' });
    assert.equal(res.status, 200);
    assert.equal(res.body.patient.fullName, 'Sneha Kulkarni-Patil');
  });

  await t.test('allergies and conditions can be recorded', async () => {
    const allergy = await admin.post(`/api/patients/${patient.id}/allergies`, {
      substance: 'Penicillin', reaction: 'Rash and swelling', severity: 'severe',
    });
    assert.equal(allergy.status, 201);
    const condition = await admin.post(`/api/patients/${patient.id}/conditions`, {
      condition: 'Type 2 diabetes', sinceDate: '2019-04-01',
    });
    assert.equal(condition.status, 201);

    const chart = await admin.get(`/api/patients/${patient.id}`);
    assert.equal(chart.body.allergies.length, 1);
    assert.equal(chart.body.conditions.length, 1);
    assert.equal(chart.body.allergies[0].severity, 'severe');
  });

  let visit;
  await t.test('a visit can be opened but not duplicated', async () => {
    const res = await admin.post('/api/visits', {
      patientId: patient.id, visitType: 'opd', department: 'General Medicine', chiefComplaint: 'Fever 3 days',
    });
    assert.equal(res.status, 201);
    visit = res.body.visit;
    assert.match(visit.visitNo, /^V-\d{6}$/);

    const dupe = await admin.post('/api/visits', { patientId: patient.id });
    assert.equal(dupe.status, 409);
  });

  await t.test('vitals are validated and stored against the visit', async () => {
    const empty = await admin.post(`/api/visits/${visit.id}/vitals`, {});
    assert.equal(empty.status, 400);

    const halfBp = await admin.post(`/api/visits/${visit.id}/vitals`, { bpSystolic: 120 });
    assert.equal(halfBp.status, 400);

    const inverted = await admin.post(`/api/visits/${visit.id}/vitals`, { bpSystolic: 80, bpDiastolic: 120 });
    assert.equal(inverted.status, 400);

    const ok = await admin.post(`/api/visits/${visit.id}/vitals`, {
      temperatureC: 38.4, pulseBpm: 96, bpSystolic: 118, bpDiastolic: 76, spo2: 97, weightKg: 64.5,
    });
    assert.equal(ok.status, 201);

    const list = await admin.get(`/api/visits/${visit.id}`);
    assert.equal(list.body.vitals[0].temperatureC, 38.4);
    assert.equal(list.body.vitals[0].bpSystolic, 118);
  });

  let noteId;
  await t.test('clinical notes can be written and signed, then lock', async () => {
    const res = await admin.post(`/api/visits/${visit.id}/notes`, {
      noteType: 'consultation',
      body: 'Patient reports 3 days of fever with chills. No breathlessness. Chest clear on auscultation.',
    });
    assert.equal(res.status, 201);
    noteId = res.body.id;

    const edit = await admin.patch(`/api/notes/${noteId}`, { body: 'Edited before signing.' });
    assert.equal(edit.status, 200);

    const sign = await admin.post(`/api/notes/${noteId}/sign`, {});
    assert.equal(sign.status, 200);

    const editSigned = await admin.patch(`/api/notes/${noteId}`, { body: 'Should not be allowed.' });
    assert.equal(editSigned.status, 409);

    const deleteSigned = await admin.del(`/api/notes/${noteId}`);
    assert.equal(deleteSigned.status, 409);
  });

  await t.test('diagnoses and prescriptions attach to the visit', async () => {
    const dx = await admin.post(`/api/visits/${visit.id}/diagnoses`, {
      code: 'A90', description: 'Dengue fever', kind: 'primary',
    });
    assert.equal(dx.status, 201);

    const rx = await admin.post(`/api/visits/${visit.id}/prescriptions`, {
      drugName: 'Paracetamol', strength: '650 mg', form: 'tablet', dose: '1 tablet',
      route: 'oral', frequency: '1-1-1', durationDays: 5, instructions: 'After food',
    });
    assert.equal(rx.status, 201);

    const detail = await admin.get(`/api/visits/${visit.id}`);
    assert.equal(detail.body.diagnoses.length, 1);
    assert.equal(detail.body.prescriptions[0].drugName, 'Paracetamol');

    const history = await admin.get(`/api/patients/${patient.id}/prescriptions`);
    assert.equal(history.body.prescriptions.length, 1);
  });

  await t.test('reception sees the visit but no clinical content', async () => {
    const { client: reception } = await makeStaff(env, admin, { username: 'desk1', role: 'reception' });
    const detail = await reception.get(`/api/visits/${visit.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.notes, undefined, 'clinical notes are hidden from reception');
    assert.equal(detail.body.diagnoses, undefined);
    assert.ok(detail.body.vitals, 'vitals are part of the nursing flow');

    const chart = await reception.get(`/api/patients/${patient.id}`);
    assert.equal(chart.status, 200);
    assert.equal(chart.body.patient.fullName, 'Sneha Kulkarni-Patil');
  });

  await t.test('closing a visit freezes it', async () => {
    const close = await admin.post(`/api/visits/${visit.id}/close`, {
      outcome: 'Discharged', followUpDate: '2026-12-01',
    });
    assert.equal(close.status, 200);

    const vitals = await admin.post(`/api/visits/${visit.id}/vitals`, { pulseBpm: 80 });
    assert.equal(vitals.status, 409);

    const reopen = await admin.post(`/api/visits/${visit.id}/close`, {});
    assert.equal(reopen.status, 409);

    const nextVisit = await admin.post('/api/visits', { patientId: patient.id, visitType: 'follow_up' });
    assert.equal(nextVisit.status, 201, 'a new visit can be opened after closing the previous one');
  });

  await t.test('the patient timeline merges visits, notes and documents', async () => {
    const timeline = await admin.get(`/api/patients/${patient.id}/timeline`);
    assert.equal(timeline.status, 200);
    const types = new Set(timeline.body.events.map((e) => e.type));
    assert.ok(types.has('visit'));
    assert.ok(types.has('note'));
    assert.ok(types.has('diagnosis'));
  });

  await t.test('archiving requires no open visit', async () => {
    const open = await admin.get(`/api/visits?patientId=${patient.id}&status=open`);
    assert.ok(open.body.visits.length >= 1, 'previous test left an open visit');
    const blocked = await admin.post(`/api/patients/${patient.id}/archive`, {});
    assert.equal(blocked.status, 409);
    for (const v of open.body.visits) {
      await admin.post(`/api/visits/${v.id}/close`, {});
    }

    const archived = await admin.post(`/api/patients/${patient.id}/archive`, {});
    assert.equal(archived.status, 200);
    const list = await admin.get('/api/patients?q=Kulkarni');
    assert.equal(list.body.total, 0, 'archived patients are hidden from search by default');
    const withInactive = await admin.get('/api/patients?q=Kulkarni&includeInactive=true');
    assert.equal(withInactive.body.total, 1);
  });
});
