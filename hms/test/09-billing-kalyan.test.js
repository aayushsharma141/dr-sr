'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeTeam, createPatient } = require('../test-support/helpers');

const rupees = (p) => Math.round(p * 100);

test('billing for Kalyan and documents access (SW-27 & SW-28)', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);
  const { reception: desk, doctor, doctorUser } = await makeTeam(env, admin);

  let patient;
  let visit;
  let invoice;

  await t.test('setup: patient and initial invoice with FY receipt', async () => {
    patient = await createPatient(desk, { firstName: 'Ramesh', lastName: 'Kumar', phone: '9876543210' });
    const visitRes = await desk.post('/api/visits', {
      patientId: patient.id,
      visitType: 'opd',
      doctorId: doctorUser.id,
      chiefComplaint: 'Knee pain',
    });
    assert.equal(visitRes.status, 201);
    visit = visitRes.body.visit;

    // Create catalogue service
    await admin.post('/api/services', {
      code: 'KNEE-EXAM',
      name: 'Knee Clinical Examination',
      category: 'Orthopaedics',
      pricePaise: rupees(400),
    });

    const invRes = await desk.post('/api/invoices', {
      patientId: patient.id,
      visitId: visit.id,
      items: [{ description: 'OPD Consultation', qty: 1, unitPricePaise: rupees(300) }],
    });
    assert.equal(invRes.status, 201);
    invoice = invRes.body.invoice;

    // Receive payment: method cash
    const payRes = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(100),
      method: 'cash',
    });
    assert.equal(payRes.status, 201);
    // Receipt should follow Indian financial year cycle (e.g. RCP-2026-2027-0001 or RCPT-2026-2027-0001)
    assert.match(payRes.body.receiptNo, /^RCPT?-(?:\d{4}-\d{4})-\d{4}$/);
  });

  await t.test('BIL-01: only cash, card and upi are accepted; others rejected', async () => {
    // Rejected method: netbanking
    const badMethod = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(50),
      method: 'netbanking',
      reference: 'NET-1234',
    });
    assert.equal(badMethod.status, 400);

    // Rejected method: cheque
    const badCheque = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(50),
      method: 'cheque',
      reference: 'CHQ-5678',
    });
    assert.equal(badCheque.status, 400);

    // Accepted method: upi with reference
    const goodUpi = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(50),
      method: 'upi',
      reference: 'UPI-TXN-9988',
    });
    assert.equal(goodUpi.status, 201);

    // Accepted method: card with reference
    const goodCard = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(50),
      method: 'card',
      reference: 'CARD-AUTH-1122',
    });
    assert.equal(goodCard.status, 201);
  });

  await t.test('Invariant 8: charges can accumulate on open invoice (POST /api/invoices/:id/items)', async () => {
    // Current invoice: 300 total - 200 paid = 100 balance
    const addRes = await desk.post(`/api/invoices/${invoice.id}/items`, {
      items: [
        { description: 'X-Ray Knee AP/Lateral', qty: 1, unitPricePaise: rupees(500) },
        { description: 'Elastic Bandage', qty: 2, unitPricePaise: rupees(75) },
      ],
    });
    assert.equal(addRes.status, 201);
    const updated = addRes.body.invoice;
    // New subtotal: 300 + 500 + 150 = 950
    assert.equal(updated.subtotalPaise, rupees(950));
    assert.equal(updated.totalPaise, rupees(950));
    assert.equal(updated.paidPaise, rupees(200));
    assert.equal(updated.balancePaise, rupees(750));
    assert.equal(updated.status, 'partially_paid');
    assert.equal(addRes.body.items.length, 3);
  });

  await t.test('Invariant 8: charges can accumulate on visit (POST /api/visits/:id/charges)', async () => {
    const addVisitCharge = await desk.post(`/api/visits/${visit.id}/charges`, {
      items: [{ description: 'Ice pack application', qty: 1, unitPricePaise: rupees(100) }],
    });
    assert.equal(addVisitCharge.status, 201);
    const inv = addVisitCharge.body.invoice;
    // Appended to open invoice: total was 950, now 1050
    assert.equal(inv.totalPaise, rupees(1050));
    assert.equal(inv.balancePaise, rupees(850));
  });

  await t.test('receipt reprint is marked DUPLICATE and audited', async () => {
    // Settle the invoice
    const payRes = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(850),
      method: 'cash',
    });
    assert.equal(payRes.status, 201);
    const paymentId = payRes.body.paymentId;

    // First print: not duplicate
    const print1 = await desk.post(`/api/payments/${paymentId}/print`);
    assert.equal(print1.status, 200);
    assert.equal(print1.body.isDuplicate, false);
    assert.equal(print1.body.printCount, 1);

    // Second print: DUPLICATE reprint
    const print2 = await desk.post(`/api/payments/${paymentId}/print`);
    assert.equal(print2.status, 200);
    assert.equal(print2.body.isDuplicate, true);
    assert.equal(print2.body.printCount, 2);

    // Check audit trail
    const auditLogs = env.ctx.db
      .prepare("SELECT action, detail_json FROM audit_log WHERE entity_type = 'payment' AND entity_id = ? ORDER BY id ASC")
      .all(String(paymentId));
    const actions = auditLogs.map((a) => a.action);
    assert.ok(actions.includes('receipt.print'), 'initial print recorded in audit log');
    assert.ok(actions.includes('receipt.reprint'), 'reprint recorded in audit log');

    const reprintDetail = JSON.parse(auditLogs.find((a) => a.action === 'receipt.reprint').detail_json);
    assert.equal(reprintDetail.isDuplicate, true);
    assert.equal(reprintDetail.printCount, 2);
  });

  await t.test('pending dues report (GET /api/billing/dues)', async () => {
    // Create another patient with an unpaid bill
    const p2 = await createPatient(desk, { firstName: 'Sunita', lastName: 'Devi', phone: '9811223344' });
    await desk.post('/api/invoices', {
      patientId: p2.id,
      items: [{ description: 'Physiotherapy evaluation', qty: 1, unitPricePaise: rupees(450) }],
    });

    const duesRes = await desk.get('/api/billing/dues');
    assert.equal(duesRes.status, 200);
    assert.ok(duesRes.body.totalDuePaise >= rupees(450));
    assert.ok(duesRes.body.patients.some((p) => p.patientId === p2.id && p.totalDuePaise === rupees(450)));

    // Filter by phone
    const searchRes = await desk.get('/api/billing/dues?q=9811223344');
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.body.patients.length, 1);
    assert.equal(searchRes.body.patients[0].fullName, 'Sunita Devi');
  });

  await t.test('SW-28 / D6: reception may upload but not view clinical documents (lab/imaging)', async () => {
    const PDF = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'),
      Buffer.alloc(512, 0x20),
    ]);

    // Reception uploads lab document -> succeeds
    const uploadLab = await desk.request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: PDF,
      headers: {
        'content-type': 'application/pdf',
        'x-file-name': 'mri-spine.pdf',
        'x-file-type': 'application/pdf',
        'x-category': 'imaging',
        'x-title': 'Spine MRI scan',
      },
    });
    assert.equal(uploadLab.status, 201);
    const labId = uploadLab.body.attachment.id;

    // Reception uploads non-clinical document (consent) -> succeeds
    const uploadConsent = await desk.request('POST', `/api/patients/${patient.id}/attachments`, {
      raw: PDF,
      headers: {
        'content-type': 'application/pdf',
        'x-file-name': 'consent-form.pdf',
        'x-file-type': 'application/pdf',
        'x-category': 'consent',
        'x-title': 'Treatment consent',
      },
    });
    assert.equal(uploadConsent.status, 201);
    const consentId = uploadConsent.body.attachment.id;

    // Reception attempts to download clinical document (imaging) -> 403 Forbidden
    const deskTryLab = await desk.get(`/api/attachments/${labId}`);
    assert.equal(deskTryLab.status, 403, 'reception denied access to imaging/lab documents');

    // Doctor downloads clinical document -> 200 OK
    const docDownloadLab = await doctor.get(`/api/attachments/${labId}`);
    assert.equal(docDownloadLab.status, 200, 'doctor can access clinical document');

    // Reception downloads non-clinical document (consent) -> 200 OK
    const deskDownloadConsent = await desk.get(`/api/attachments/${consentId}`);
    assert.equal(deskDownloadConsent.status, 200, 'reception can access consent document');

    // Attachments list for patient reflects canView flag
    const listRes = await desk.get(`/api/patients/${patient.id}/attachments`);
    assert.equal(listRes.status, 200);
    const labItem = listRes.body.attachments.find((a) => a.id === labId);
    const consentItem = listRes.body.attachments.find((a) => a.id === consentId);
    assert.equal(labItem.canView, false);
    assert.equal(consentItem.canView, true);
  });
});
