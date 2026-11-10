'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, setupAdmin, makeStaff, createPatient, makeTeam } = require('../test-support/helpers');

const rupees = (p) => Math.round(p * 100);

test('billing and payments', async (t) => {
  const env = await boot();
  t.after(() => env.close());
  const { client: admin } = await setupAdmin(env);
  // ADR-23: reception raises invoices and collects; admin manages fees and reverses.
  const { reception: desk, doctor } = await makeTeam(env, admin);

  let patient;
  let invoice;
  await t.test('a fresh install starts with an empty service catalogue', async () => {
    const services = await admin.get('/api/services');
    assert.equal(services.status, 200);
    assert.equal(services.body.services.length, 0);
  });

  await t.test('an invoice is built from catalogue items', async () => {
    patient = await createPatient(desk, { firstName: 'Meera', lastName: 'Joshi', phone: '9877000111' });
    for (const service of [
      { code: 'CONS-PHYSIO', name: 'Physiotherapy consultation', category: 'Consultation', pricePaise: rupees(300) },
      { code: 'PT-SESSION', name: 'Physiotherapy session', category: 'Physiotherapy', pricePaise: rupees(200) },
    ]) {
      const created = await admin.post('/api/services', service);
      assert.equal(created.status, 201, JSON.stringify(created.body));
    }
    const services = await admin.get('/api/services');
    const consult = services.body.services.find((s) => s.code === 'CONS-PHYSIO');
    const session = services.body.services.find((s) => s.code === 'PT-SESSION');

    const res = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [
        { serviceId: consult.id, qty: 1 },
        { serviceId: session.id, qty: 2 },
        { description: 'Hot pack (manual entry)', qty: 1, unitPricePaise: rupees(250) },
      ],
      discountPaise: rupees(50),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    invoice = res.body.invoice;

    const expectedSubtotal = consult.pricePaise + session.pricePaise * 2 + rupees(250);
    assert.equal(invoice.subtotalPaise, expectedSubtotal);
    assert.equal(invoice.totalPaise, expectedSubtotal - rupees(50));
    assert.equal(invoice.status, 'open');
    assert.equal(invoice.balancePaise, invoice.totalPaise);
    assert.match(invoice.invoiceNo, /^INV-\d{8}-\d{4}$/);
  });

  await t.test('invalid invoices are refused', async () => {
    const noItems = await desk.post('/api/invoices', { patientId: patient.id, items: [] });
    assert.equal(noItems.status, 400);

    const overDiscount = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'X', qty: 1, unitPricePaise: 1000 }],
      discountPaise: 5000,
    });
    assert.equal(overDiscount.status, 400);

    const badService = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ serviceId: 99999, qty: 1 }],
    });
    assert.equal(badService.status, 400);
  });

  await t.test('partial payments move the invoice to partially paid', async () => {
    const res = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(300), method: 'cash',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.invoice.status, 'partially_paid');
    assert.equal(res.body.invoice.balancePaise, invoice.totalPaise - rupees(300));
    assert.match(res.body.receiptNo, /^RCPT?-(?:\d{4}-\d{4}|\d{8})-\d{4}$/);
  });

  await t.test('overpayment and unreferenced card payments are refused', async () => {
    const over = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: invoice.totalPaise, method: 'cash',
    });
    assert.equal(over.status, 400);
    assert.match(over.body.error.details[0].message, /outstanding balance/);

    const noRef = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: rupees(10), method: 'upi',
    });
    assert.equal(noRef.status, 400);
    assert.equal(noRef.body.error.details[0].field, 'reference');

    const zero = await desk.post(`/api/invoices/${invoice.id}/payments`, { amountPaise: 0, method: 'cash' });
    assert.equal(zero.status, 400);
  });

  await t.test('paying the balance closes the invoice', async () => {
    const detail = await admin.get(`/api/invoices/${invoice.id}`);
    const balance = detail.body.invoice.balancePaise;
    const res = await desk.post(`/api/invoices/${invoice.id}/payments`, {
      amountPaise: balance, method: 'upi', reference: 'UPI-778812',
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.status, 'paid');
    assert.equal(res.body.invoice.balancePaise, 0);
  });

  await t.test('voiding is ordered and audited', async () => {
    const res = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'Consultation', qty: 1, unitPricePaise: rupees(500) }],
    });
    const second = res.body.invoice;
    const pay = await desk.post(`/api/invoices/${second.id}/payments`, { amountPaise: rupees(200), method: 'cash' });

    const voidInvoice = await admin.post(`/api/invoices/${second.id}/void`, { reason: 'Raised in error' });
    assert.equal(voidInvoice.status, 409, 'cannot void an invoice that still has payments');

    const noReason = await admin.post(`/api/payments/${pay.body.paymentId}/void`, { reason: '' });
    assert.equal(noReason.status, 400);

    const voidPay = await admin.post(`/api/payments/${pay.body.paymentId}/void`, { reason: 'Wrong patient' });
    assert.equal(voidPay.status, 200);

    const afterVoid = await admin.get(`/api/invoices/${second.id}`);
    assert.equal(afterVoid.body.invoice.paidPaise, 0);
    assert.equal(afterVoid.body.invoice.status, 'open');
    assert.equal(afterVoid.body.payments[0].isVoid, true);

    const ok = await admin.post(`/api/invoices/${second.id}/void`, { reason: 'Raised in error' });
    assert.equal(ok.status, 200);

    const payOnVoid = await desk.post(`/api/invoices/${second.id}/payments`, { amountPaise: 100, method: 'cash' });
    assert.equal(payOnVoid.status, 409);
  });

  await t.test('the collections report reconciles to the payments', async () => {
    const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const report = await admin.get(`/api/billing/report?date=${today}`);
    assert.equal(report.status, 200);
    const activePayments = report.body.receipts.filter((r) => !r.isVoid);
    const sum = activePayments.reduce((acc, r) => acc + r.amountPaise, 0);
    assert.equal(report.body.collectedPaise, sum);
    assert.ok(report.body.byMethod.some((m) => m.method === 'cash'));
    const methodSum = report.body.byMethod.reduce((acc, m) => acc + m.amountPaise, 0);
    assert.equal(methodSum, report.body.collectedPaise);
  });

  await t.test('patient balance and outstanding list agree', async () => {
    const unpaid = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'Pending lab work', qty: 1, unitPricePaise: rupees(500) }],
    });
    assert.equal(unpaid.status, 201);
    const chart = await admin.get(`/api/patients/${patient.id}`);
    const outstanding = await admin.get('/api/billing/outstanding');
    const fromList = outstanding.body.items
      .filter((i) => i.patientId === patient.id)
      .reduce((acc, i) => acc + i.balancePaise, 0);
    assert.equal(chart.body.stats.balancePaise, fromList);
    assert.ok(chart.body.stats.balancePaise > 0);
  });

  await t.test('reception can take money but cannot void it', async () => {
    const { client: reception } = await makeStaff(env, admin, { username: 'cashier1', role: 'reception' });
    const res = await reception.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'Registration', qty: 1, unitPricePaise: rupees(100) }],
    });
    assert.equal(res.status, 201);
    const payment = await reception.post(`/api/invoices/${res.body.invoice.id}/payments`, {
      amountPaise: rupees(100), method: 'cash',
    });
    assert.equal(payment.status, 201);

    const voidAttempt = await reception.post(`/api/payments/${payment.body.paymentId}/void`, { reason: 'test' });
    assert.equal(voidAttempt.status, 403, 'voiding requires billing.void');
  });

  await t.test('only reception collects money; doctors have no billing access (ADR-23)', async () => {
    const res = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'Physiotherapy session', qty: 1, unitPricePaise: rupees(200) }],
    });
    assert.equal(res.status, 201);
    const byAdmin = await admin.post(`/api/invoices/${res.body.invoice.id}/payments`, { amountPaise: rupees(200), method: 'cash' });
    assert.equal(byAdmin.status, 403, 'admin reverses payments but never takes them');
    const adminInvoice = await admin.post('/api/invoices', {
      patientId: patient.id, items: [{ description: 'X', qty: 1, unitPricePaise: 100 }],
    });
    assert.equal(adminInvoice.status, 403);
    const fee = await desk.post('/api/services', { name: 'Desk-made fee', pricePaise: 100 });
    assert.equal(fee.status, 403, 'fees are set by the administrator');

    for (const url of ['/api/invoices', `/api/invoices/${res.body.invoice.id}`, '/api/billing/outstanding', '/api/services']) {
      assert.equal((await doctor.get(url)).status, 403, url);
    }
    const byDoctor = await doctor.post(`/api/invoices/${res.body.invoice.id}/payments`, { amountPaise: rupees(200), method: 'cash' });
    assert.equal(byDoctor.status, 403);
  });

  await t.test('a fee change needs the version the administrator last saw', async () => {
    const list = (await admin.get('/api/services')).body.services;
    const svc = list.find((x) => x.code === 'PT-SESSION');
    const first = await admin.patch(`/api/services/${svc.id}`, { pricePaise: rupees(220), version: svc.version });
    assert.equal(first.status, 200);
    const stale = await admin.patch(`/api/services/${svc.id}`, { pricePaise: rupees(240), version: svc.version });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'version_conflict');
  });

  await t.test('a zero-value invoice is recorded as paid', async () => {
    const res = await desk.post('/api/invoices', {
      patientId: patient.id,
      items: [{ description: 'Free follow-up', qty: 1, unitPricePaise: 0, serviceId: null }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.status, 'paid');
    assert.equal(res.body.invoice.balancePaise, 0);
  });
});
