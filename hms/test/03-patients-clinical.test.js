'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, createPatient, makeTeam, openVisit } = require('../test-support/helpers');

test('patients and clinical records', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);
  const { reception, doctor, doctorUser } = await makeTeam(env, admin);

  await t.test('patients get sequential URNs (KH-YYYY-XXXX)', async () => {
    const p1 = await createPatient(reception, { firstName: 'Anita', lastName: 'Kumari', phone: '9822000001' });
    const p2 = await createPatient(reception, { firstName: 'Vikram', lastName: 'Shah', phone: '9822000002' });
    assert.match(p1.mrn, /^KH-\d{4}-\d{4}$/);
    assert.match(p2.mrn, /^KH-\d{4}-\d{4}$/);
    assert.equal(p1.urn, p1.mrn);
    const seq1 = Number(p1.mrn.slice(-4));
    const seq2 = Number(p2.mrn.slice(-4));
    assert.equal(seq2 - seq1, 1);
    assert.equal(p1.district, 'Bhojpur');
    assert.equal(p1.state, 'Bihar');
    assert.equal(p1.age >= 30 && p1.age <= 40, true);
    assert.equal(p1.version, 1);
  });

  await t.test('registration validates required fields', async () => {
    const noPhone = await reception.post('/api/patients', { firstName: 'No', lastName: 'Phone', dob: '1990-01-01' });
    assert.equal(noPhone.status, 400);
    assert.equal(noPhone.body.error.details[0].field, 'phone');

    const noAge = await reception.post('/api/patients', { firstName: 'No', lastName: 'Dob', phone: '9822000003' });
    assert.equal(noAge.status, 400);
    assert.equal(noAge.body.error.details[0].field, 'dob');

    const badSex = await reception.post('/api/patients', {
      firstName: 'Bad', lastName: 'Sex', dob: '1990-01-01', phone: '9822000004', sex: 'martian',
    });
    assert.equal(badSex.status, 400);
  });

  let patient;
  await t.test('search finds patients by name, phone and MRN', async () => {
    patient = await createPatient(reception, {
      firstName: 'Sneha', lastName: 'Kulkarni', phone: '9812340000',
      addressLine: '12 Station Road', city: 'Ara', state: 'Bihar', pincode: '802301',
    });
    const byName = await admin.get('/api/patients?q=Kulkarni');
    assert.equal(byName.body.total, 1);
    const byPhone = await reception.get('/api/patients?q=9812340000');
    assert.equal(byPhone.body.total, 1);
    const byMrn = await doctor.get(`/api/patients?q=${patient.mrn}`);
    assert.equal(byMrn.body.patients[0].id, patient.id);
    assert.equal(byMrn.body.patients[0].balancePaise, null, 'doctors see no balances (ADR-23)');
    const none = await reception.get('/api/patients?q=zzzznotfound');
    assert.equal(none.body.total, 0);
  });

  await t.test('updating a patient keeps the display name in sync', async () => {
    const res = await reception.patch(`/api/patients/${patient.id}`, { lastName: 'Kulkarni-Patil', version: patient.version });
    assert.equal(res.status, 200);
    assert.equal(res.body.patient.fullName, 'Sneha Kulkarni-Patil');
    assert.equal(res.body.patient.version, patient.version + 1);
    patient = res.body.patient;
  });

  await t.test('allergies and conditions can be recorded', async () => {
    const allergy = await reception.post(`/api/patients/${patient.id}/allergies`, {
      substance: 'Penicillin', reaction: 'Rash and swelling', severity: 'severe',
    });
    assert.equal(allergy.status, 201, 'reception records allergies at registration');
    const byReception = await reception.post(`/api/patients/${patient.id}/conditions`, { condition: 'Type 2 diabetes' });
    assert.equal(byReception.status, 403, 'the problem list is clinical');
    const condition = await doctor.post(`/api/patients/${patient.id}/conditions`, {
      condition: 'Type 2 diabetes', sinceDate: '2019-04-01',
    });
    assert.equal(condition.status, 201);

    const chart = await doctor.get(`/api/patients/${patient.id}`);
    assert.equal(chart.body.allergies.length, 1);
    assert.equal(chart.body.conditions.length, 1);
    assert.equal(chart.body.allergies[0].severity, 'severe');
  });

  let visit;
  await t.test('a visit can be opened but not duplicated', async () => {
    const res = await reception.post('/api/visits', {
      patientId: patient.id, visitType: 'opd', department: 'Physiotherapy', doctorId: doctorUser.id,
      chiefComplaint: 'Low back pain 3 days',
    });
    assert.equal(res.status, 201);
    visit = res.body.visit;
    assert.match(visit.visitNo, /^V-\d{6}$/);

    const dupe = await reception.post('/api/visits', { patientId: patient.id });
    assert.equal(dupe.status, 409);
  });

  await t.test('vitals are validated and stored against the visit', async () => {
    const empty = await doctor.post(`/api/visits/${visit.id}/vitals`, {});
    assert.equal(empty.status, 400);

    const halfBp = await doctor.post(`/api/visits/${visit.id}/vitals`, { bpSystolic: 120 });
    assert.equal(halfBp.status, 400);

    const inverted = await doctor.post(`/api/visits/${visit.id}/vitals`, { bpSystolic: 80, bpDiastolic: 120 });
    assert.equal(inverted.status, 400);

    const ok = await doctor.post(`/api/visits/${visit.id}/vitals`, {
      temperatureC: 38.4, pulseBpm: 96, bpSystolic: 118, bpDiastolic: 76, spo2: 97, weightKg: 64.5,
    });
    assert.equal(ok.status, 201);

    const list = await doctor.get(`/api/visits/${visit.id}`);
    assert.equal(list.body.vitals[0].temperatureC, 38.4);
    assert.equal(list.body.vitals[0].bpSystolic, 118);
  });

  let noteId;
  await t.test('clinical notes can be written and signed, then lock', async () => {
    const res = await doctor.post(`/api/visits/${visit.id}/notes`, {
      noteType: 'consultation',
      body: 'Paraspinal spasm at L4-L5. Straight leg raise negative. Advised IFT and core exercises.',
    });
    assert.equal(res.status, 201);
    noteId = res.body.id;

    const edit = await doctor.patch(`/api/notes/${noteId}`, { body: 'Edited before signing.', version: 1 });
    assert.equal(edit.status, 200);

    const sign = await doctor.post(`/api/notes/${noteId}/sign`, {});
    assert.equal(sign.status, 200);

    const editSigned = await doctor.patch(`/api/notes/${noteId}`, { body: 'Should not be allowed.', version: edit.body.version });
    assert.equal(editSigned.status, 409);

    const deleteSigned = await doctor.del(`/api/notes/${noteId}`);
    assert.equal(deleteSigned.status, 405, 'clinical rows are never deleted');
  });

  await t.test('diagnoses and prescriptions attach to the visit', async () => {
    const dx = await doctor.post(`/api/visits/${visit.id}/diagnoses`, {
      code: 'M54.5', description: 'Low back pain', kind: 'primary',
    });
    assert.equal(dx.status, 201);

    const rx = await doctor.post(`/api/visits/${visit.id}/prescriptions`, {
      drugName: 'Paracetamol', strength: '650 mg', form: 'tablet', dose: '1 tablet',
      route: 'oral', frequency: '1-1-1', durationDays: 5, instructions: 'After food',
    });
    assert.equal(rx.status, 201);

    const detail = await doctor.get(`/api/visits/${visit.id}`);
    assert.equal(detail.body.diagnoses.length, 1);
    assert.equal(detail.body.prescriptions[0].drugName, 'Paracetamol');

    const history = await doctor.get(`/api/patients/${patient.id}/prescriptions`);
    assert.equal(history.body.prescriptions.length, 1);
  });

  await t.test('reception and admin see the visit but no clinical content (D-04)', async () => {
    for (const [who, client] of [['reception', reception], ['admin', admin]]) {
      const detail = await client.get(`/api/visits/${visit.id}`);
      assert.equal(detail.status, 200, who);
      assert.equal(detail.body.notes, undefined, `${who}: notes hidden`);
      assert.equal(detail.body.diagnoses, undefined, `${who}: diagnoses hidden`);
      assert.equal(detail.body.vitals, undefined, `${who}: vitals hidden`);
      assert.equal(detail.body.visit.dischargeSummary, undefined, `${who}: closing summary hidden`);

      const chart = await client.get(`/api/patients/${patient.id}`);
      assert.equal(chart.status, 200);
      assert.equal(chart.body.patient.fullName, 'Sneha Kulkarni-Patil');
      assert.equal(chart.body.latestVitals, null, `${who}: vitals hidden on the chart`);
      assert.deepEqual(chart.body.conditions, [], `${who}: problem list hidden`);

      assert.equal((await client.get(`/api/vitals?patientId=${patient.id}`)).status, 403, who);
      assert.equal((await client.get(`/api/patients/${patient.id}/prescriptions`)).status, 403, who);
    }
  });

  await t.test('closing a visit freezes it', async () => {
    const byReception = await reception.post(`/api/visits/${visit.id}/close`, {});
    assert.equal(byReception.status, 403, 'closing records the outcome, so it is the doctor\'s step');

    const close = await doctor.post(`/api/visits/${visit.id}/close`, {
      outcome: 'Discharged', followUpDate: '2026-12-01',
    });
    assert.equal(close.status, 200);

    const vitals = await doctor.post(`/api/visits/${visit.id}/vitals`, { pulseBpm: 80 });
    assert.equal(vitals.status, 409);

    const lateNote = await doctor.post(`/api/visits/${visit.id}/notes`, { body: 'Written after closing.' });
    assert.equal(lateNote.status, 409, 'notes cannot be added to a closed visit');

    const reopen = await doctor.post(`/api/visits/${visit.id}/close`, {});
    assert.equal(reopen.status, 409);

    const nextVisit = await openVisit(reception, patient.id, doctorUser.id, { visitType: 'follow_up' });
    assert.ok(nextVisit.id, 'a new visit can be opened after closing the previous one');
  });

  await t.test('the patient timeline merges visits, notes and diagnoses for clinicians only', async () => {
    const timeline = await doctor.get(`/api/patients/${patient.id}/timeline`);
    assert.equal(timeline.status, 200);
    const types = new Set(timeline.body.events.map((e) => e.type));
    assert.ok(types.has('visit'));
    assert.ok(types.has('note'));
    assert.ok(types.has('diagnosis'));
    assert.ok(!types.has('invoice'), 'doctors have no billing access');

    const desk = new Set((await reception.get(`/api/patients/${patient.id}/timeline`)).body.events.map((e) => e.type));
    assert.ok(desk.has('visit'));
    assert.ok(!desk.has('note') && !desk.has('diagnosis'), 'reception timeline has no clinical events');
  });

  await t.test('archiving requires no open visit', async () => {
    const open = await reception.get(`/api/visits?patientId=${patient.id}&status=open`);
    assert.ok(open.body.visits.length >= 1, 'previous test left an open visit');
    const blocked = await reception.post(`/api/patients/${patient.id}/archive`, {});
    assert.equal(blocked.status, 409);
    for (const v of open.body.visits) {
      await doctor.post(`/api/visits/${v.id}/close`, {});
    }

    const archived = await reception.post(`/api/patients/${patient.id}/archive`, {});
    assert.equal(archived.status, 200);
    const list = await reception.get('/api/patients?q=Kulkarni');
    assert.equal(list.body.total, 0, 'archived patients are hidden from search by default');
    const withInactive = await reception.get('/api/patients?q=Kulkarni&includeInactive=true');
    assert.equal(withInactive.body.total, 1);
  });
});
