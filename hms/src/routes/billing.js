'use strict';

/**
 * Billing: service catalogue, invoices, payments, daily collection report.
 * Every amount in the API is an integer number of paise.
 */
const express = require('express');

const { Validator, ApiError, pagination, likePattern } = require('../lib/http');
const { audit, idParam, expectedVersion, updateVersioned } = require('../lib/request');
const { requirePerm } = require('../auth');
const { todayLocal } = require('../lib/domain');

const METHODS = ['cash', 'card', 'upi', 'netbanking', 'cheque', 'insurance', 'waived'];

function invoiceStatusFor(total, paid) {
  if (paid <= 0) return 'open';
  if (paid >= total) return 'paid';
  return 'partially_paid';
}

function mapInvoice(row) {
  return {
    id: row.id,
    invoiceNo: row.invoice_no,
    patientId: row.patient_id,
    visitId: row.visit_id,
    status: row.status,
    subtotalPaise: row.subtotal_paise,
    discountPaise: row.discount_paise,
    taxPaise: row.tax_paise,
    totalPaise: row.total_paise,
    paidPaise: row.paid_paise,
    balancePaise: row.balance_paise,
    notes: row.notes,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

function mapPayment(row) {
  return {
    id: row.id,
    receiptNo: row.receipt_no,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    amountPaise: row.amount_paise,
    method: row.method,
    reference: row.reference,
    note: row.note,
    receivedByName: row.received_by_name,
    receivedAt: row.received_at,
    isVoid: !!row.is_void,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
  };
}

module.exports = function billingRoutes(ctx) {
  const router = express.Router();
  const db = ctx.db;

  // ---------------------------------------------------------------------------
  // Service catalogue
  // ---------------------------------------------------------------------------
  router.get('/services', requirePerm('billing.read', 'billing.catalogue', 'invoice.write'), (req, res) => {
    const includeInactive = String(req.query.includeInactive || '') === 'true';
    const rows = db
      .prepare(`SELECT * FROM services ${includeInactive ? '' : 'WHERE is_active = 1'} ORDER BY category, name`)
      .all();
    res.json({
      services: rows.map((s) => ({
        id: s.id, code: s.code, name: s.name, category: s.category,
        pricePaise: s.price_paise, isActive: !!s.is_active, version: s.version,
      })),
    });
  });

  router.post('/services', requirePerm('billing.catalogue'), (req, res) => {
    const v = new Validator(req.body);
    const name = v.str('name', { required: true, max: 160, label: 'Service name' });
    const code = v.str('code', { max: 30 });
    const category = v.str('category', { max: 60 });
    const pricePaise = v.int('pricePaise', { required: true, min: 0, max: 100000000, label: 'Price' });
    v.throwIfInvalid();
    const info = db
      .prepare('INSERT INTO services (code, name, category, price_paise, is_active, created_at) VALUES (?,?,?,?,1,?)')
      .run(code, name, category, pricePaise, new Date().toISOString());
    audit(ctx, req, { action: 'service.create', entityType: 'service', entityId: info.lastInsertRowid, detail: { name, pricePaise } });
    res.status(201).json({ id: info.lastInsertRowid });
  });

  router.patch('/services/:id', requirePerm('billing.catalogue'), (req, res) => {
    const id = idParam(req);
    const service = db.prepare('SELECT * FROM services WHERE id = ?').get(id);
    if (!service) throw new ApiError(404, 'Service not found.');
    const v = new Validator(req.body);
    const version = expectedVersion(v);
    const name = v.str('name', { max: 160 });
    const category = v.str('category', { max: 60 });
    const pricePaise = v.int('pricePaise', { min: 0, max: 100000000, label: 'Price' });
    const isActive = v.bool('isActive');
    v.throwIfInvalid();
    const patch = {};
    if (name) patch.name = name;
    if (category !== undefined && category !== null) patch.category = category;
    if (pricePaise !== undefined && pricePaise !== null) patch.price_paise = pricePaise;
    if (isActive !== undefined && isActive !== null) patch.is_active = isActive ? 1 : 0;
    if (!Object.keys(patch).length) return res.json({ ok: true, unchanged: true, version: service.version });
    updateVersioned(db, 'services', id, version, patch);
    audit(ctx, req, { action: 'service.update', entityType: 'service', entityId: id, detail: { name, pricePaise, isActive } });
    res.json({ ok: true, version: db.prepare('SELECT version FROM services WHERE id = ?').get(id).version });
  });

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------
  router.get('/invoices', requirePerm('billing.read'), (req, res) => {
    const { limit, page, offset } = pagination(req.query, { defaultLimit: 25, maxLimit: 100 });
    const where = ['1=1'];
    const params = { limit, offset };
    if (req.query.patientId) {
      where.push('i.patient_id = @patientId');
      params.patientId = Number(req.query.patientId);
    }
    if (req.query.status && ['open', 'partially_paid', 'paid', 'void'].includes(String(req.query.status))) {
      where.push('i.status = @status');
      params.status = String(req.query.status);
    }
    if (req.query.unpaid === 'true') where.push("i.status IN ('open','partially_paid')");
    if (req.query.date) {
      where.push("date(i.created_at,'+05:30') = @date");
      params.date = String(req.query.date).slice(0, 10);
    }
    if (req.query.from) {
      where.push("date(i.created_at,'+05:30') >= @from");
      params.from = String(req.query.from).slice(0, 10);
    }
    if (req.query.to) {
      where.push("date(i.created_at,'+05:30') <= @to");
      params.to = String(req.query.to).slice(0, 10);
    }
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q) {
      where.push('(i.invoice_no LIKE @like OR p.full_name LIKE @like OR p.mrn LIKE @like)');
      params.like = likePattern(q);
    }
    const whereSql = where.join(' AND ');

    const total = db
      .prepare(`SELECT COUNT(*) AS n FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${whereSql}`)
      .get(params).n;
    const rows = db
      .prepare(
        `SELECT i.*, p.mrn, p.full_name AS patient_name FROM invoices i
         JOIN patients p ON p.id = i.patient_id
         WHERE ${whereSql} ORDER BY i.created_at DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params);

    res.json({
      invoices: rows.map((r) => ({ ...mapInvoice(r), mrn: r.mrn, patientName: r.patient_name })),
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        billedPaise: db
          .prepare(`SELECT COALESCE(SUM(i.total_paise),0) AS n FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${whereSql} AND i.status <> 'void'`)
          .get(params).n,
        collectedPaise: db
          .prepare(`SELECT COALESCE(SUM(i.paid_paise),0) AS n FROM invoices i JOIN patients p ON p.id = i.patient_id WHERE ${whereSql} AND i.status <> 'void'`)
          .get(params).n,
      },
    });
  });

  router.post('/invoices', requirePerm('invoice.write'), (req, res) => {
    const v = new Validator(req.body);
    const patientId = v.int('patientId', { required: true, min: 1, label: 'Patient' });
    const visitId = v.int('visitId', { min: 1 });
    const discountPaise = v.int('discountPaise', { min: 0, max: 50000000 }) || 0;
    const taxPaise = v.int('taxPaise', { min: 0, max: 50000000 }) || 0;
    const notes = v.str('notes', { max: 1000 });
    v.throwIfInvalid();

    const patient = db.prepare('SELECT id FROM patients WHERE id = ?').get(patientId);
    if (!patient) throw new ApiError(404, 'Patient not found.');

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (rawItems.length === 0) throw new ApiError(400, 'Add at least one service or charge to the invoice.');
    if (rawItems.length > 60) throw new ApiError(400, 'An invoice cannot have more than 60 lines.');

    const items = rawItems.map((raw, index) => {
      const iv = new Validator(raw);
      const serviceId = iv.int('serviceId', { min: 1 });
      const description = iv.str('description', { max: 200 });
      const qty = iv.int('qty', { min: 1, max: 999 }) || 1;
      const unitPricePaise = iv.int('unitPricePaise', { min: 0, max: 100000000 });
      iv.throwIfInvalid();

      let finalDescription = description;
      let finalPrice = unitPricePaise;
      if (serviceId) {
        const service = db.prepare('SELECT * FROM services WHERE id = ?').get(serviceId);
        if (!service) throw new ApiError(400, `Line ${index + 1}: service not found.`);
        finalDescription = description || service.name;
        finalPrice = unitPricePaise === null || unitPricePaise === undefined ? service.price_paise : unitPricePaise;
      }
      if (!finalDescription) throw new ApiError(400, `Line ${index + 1}: a description is required.`);
      if (finalPrice === null || finalPrice === undefined) throw new ApiError(400, `Line ${index + 1}: a price is required.`);
      return { serviceId, description: finalDescription, qty, unitPricePaise: finalPrice, lineTotalPaise: qty * finalPrice };
    });

    const subtotal = items.reduce((sum, item) => sum + item.lineTotalPaise, 0);
    const total = subtotal - discountPaise + taxPaise;
    if (total < 0) throw new ApiError(400, 'The discount cannot be more than the invoice subtotal.');

    if (visitId && !db.prepare('SELECT id FROM visits WHERE id = ? AND patient_id = ?').get(visitId, patientId)) {
      throw new ApiError(400, 'That visit does not belong to this patient.');
    }

    const now = new Date().toISOString();
    const prefix = ctx.store.getSetting('invoice_prefix', 'INV');
    const day = now.slice(0, 10).replace(/-/g, '');
    const seq = ctx.store.nextSequence(`seq:invoice:${day}`);
    const invoiceNo = `${prefix}-${day}-${String(seq).padStart(4, '0')}`;

    const invoiceId = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO invoices (invoice_no, patient_id, visit_id, status, subtotal_paise, discount_paise, tax_paise,
             total_paise, paid_paise, balance_paise, notes, created_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?)`,
        )
        .run(invoiceNo, patientId, visitId, total === 0 ? 'paid' : 'open', subtotal, discountPaise, taxPaise,
          total, total, notes, req.user.id, now, now);
      const newId = Number(info.lastInsertRowid);
      const insertItem = db.prepare(
        `INSERT INTO invoice_items (invoice_id, service_id, description, qty, unit_price_paise, line_total_paise)
         VALUES (?,?,?,?,?,?)`,
      );
      for (const item of items) {
        insertItem.run(newId, item.serviceId, item.description, item.qty, item.unitPricePaise, item.lineTotalPaise);
      }
      return newId;
    })();

    audit(ctx, req, {
      action: 'invoice.create',
      entityType: 'invoice',
      entityId: invoiceId,
      patientId,
      detail: { invoiceNo, totalPaise: total, lines: items.length },
    });
    const row = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
    res.status(201).json({ invoice: mapInvoice(row) });
  });

  router.get('/invoices/:id', requirePerm('billing.read'), (req, res) => {
    const id = idParam(req);
    const row = db
      .prepare(
        `SELECT i.*, p.mrn, p.full_name AS patient_name, p.phone, p.address_line, p.city, p.dob, p.age_years,
                v.visit_no, u.full_name AS created_by_name
         FROM invoices i JOIN patients p ON p.id = i.patient_id
         LEFT JOIN visits v ON v.id = i.visit_id
         LEFT JOIN users u ON u.id = i.created_by
         WHERE i.id = ?`,
      )
      .get(id);
    if (!row) throw new ApiError(404, 'Invoice not found.');

    const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id').all(id);
    const payments = db
      .prepare(
        `SELECT pay.*, u.full_name AS received_by_name FROM payments pay
         LEFT JOIN users u ON u.id = pay.received_by WHERE pay.invoice_id = ? ORDER BY pay.received_at ASC`,
      )
      .all(id);

    audit(ctx, req, { action: 'invoice.view', entityType: 'invoice', entityId: id, patientId: row.patient_id });

    res.json({
      invoice: {
        ...mapInvoice(row),
        mrn: row.mrn,
        patientName: row.patient_name,
        phone: row.phone,
        addressLine: row.address_line,
        city: row.city,
        visitNo: row.visit_no,
        createdByName: row.created_by_name,
      },
      items: items.map((i) => ({
        id: i.id, serviceId: i.service_id, description: i.description, qty: i.qty,
        unitPricePaise: i.unit_price_paise, lineTotalPaise: i.line_total_paise,
      })),
      payments: payments.map(mapPayment),
    });
  });

  router.post('/invoices/:id/payments', requirePerm('payment.collect'), (req, res) => {
    const id = idParam(req);
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) throw new ApiError(404, 'Invoice not found.');
    if (invoice.status === 'void') throw new ApiError(409, 'This invoice has been voided.');

    const v = new Validator(req.body);
    const amountPaise = v.int('amountPaise', { required: true, min: 1, max: 100000000, label: 'Amount' });
    const method = v.enumOf('method', METHODS, { required: true }) || 'cash';
    const reference = v.str('reference', { max: 80 });
    const note = v.str('note', { max: 300 });
    v.throwIfInvalid();

    if (amountPaise > invoice.balance_paise) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{
          field: 'amountPaise',
          message: `Amount is more than the outstanding balance (₹${(invoice.balance_paise / 100).toFixed(2)}).`,
        }],
      });
    }
    if (!['cash', 'waived'].includes(method) && !reference) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: [{ field: 'reference', message: 'Add the transaction reference for non-cash payments.' }],
      });
    }

    const now = new Date().toISOString();
    const day = now.slice(0, 10).replace(/-/g, '');
    const prefix = ctx.store.getSetting('receipt_prefix', 'RCPT');
    const seq = ctx.store.nextSequence(`seq:receipt:${day}`);
    const receiptNo = `${prefix}-${day}-${String(seq).padStart(4, '0')}`;

    const result = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO payments (receipt_no, invoice_id, patient_id, amount_paise, method, reference, note,
             received_by, received_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(receiptNo, id, invoice.patient_id, amountPaise, method, reference, note, req.user.id, now, now);
      const paid = invoice.paid_paise + amountPaise;
      const balance = invoice.total_paise - paid;
      db.prepare('UPDATE invoices SET paid_paise = ?, balance_paise = ?, status = ?, updated_at = ? WHERE id = ?')
        .run(paid, balance, invoiceStatusFor(invoice.total_paise, paid), now, id);
      return Number(info.lastInsertRowid);
    })();

    audit(ctx, req, {
      action: 'payment.receive',
      entityType: 'payment',
      entityId: result,
      patientId: invoice.patient_id,
      detail: { receiptNo, invoiceNo: invoice.invoice_no, amountPaise, method },
    });
    const updated = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    res.status(201).json({
      paymentId: result,
      receiptNo,
      invoice: mapInvoice(updated),
    });
  });

  router.post('/invoices/:id/void', requirePerm('payment.reverse'), (req, res) => {
    const id = idParam(req);
    const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
    if (!invoice) throw new ApiError(404, 'Invoice not found.');
    if (invoice.status === 'void') throw new ApiError(409, 'This invoice is already void.');
    const v = new Validator(req.body);
    const reason = v.str('reason', { required: true, min: 3, max: 300, label: 'Reason' });
    v.throwIfInvalid();

    const activePayments = db
      .prepare('SELECT COUNT(*) AS n FROM payments WHERE invoice_id = ? AND is_void = 0')
      .get(id).n;
    if (activePayments > 0) {
      throw new ApiError(409, 'Void the payments on this invoice first, then void the invoice.');
    }

    const now = new Date().toISOString();
    db.prepare("UPDATE invoices SET status = 'void', voided_by = ?, voided_at = ?, void_reason = ?, updated_at = ? WHERE id = ?")
      .run(req.user.id, now, reason, now, id);
    audit(ctx, req, {
      action: 'invoice.void', entityType: 'invoice', entityId: id, patientId: invoice.patient_id,
      detail: { invoiceNo: invoice.invoice_no, reason, totalPaise: invoice.total_paise },
    });
    res.json({ ok: true });
  });

  router.post('/payments/:id/void', requirePerm('payment.reverse'), (req, res) => {
    const id = idParam(req);
    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
    if (!payment) throw new ApiError(404, 'Payment not found.');
    if (payment.is_void) throw new ApiError(409, 'This payment is already void.');
    const v = new Validator(req.body);
    const reason = v.str('reason', { required: true, min: 3, max: 300, label: 'Reason' });
    v.throwIfInvalid();

    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE payments SET is_void = 1, voided_by = ?, voided_at = ?, void_reason = ? WHERE id = ?')
        .run(req.user.id, now, reason, id);
      const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(payment.invoice_id);
      if (invoice && invoice.status !== 'void') {
        const paid = Math.max(0, invoice.paid_paise - payment.amount_paise);
        db.prepare('UPDATE invoices SET paid_paise = ?, balance_paise = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(paid, invoice.total_paise - paid, invoiceStatusFor(invoice.total_paise, paid), now, invoice.id);
      }
    })();

    audit(ctx, req, {
      action: 'payment.void', entityType: 'payment', entityId: id, patientId: payment.patient_id,
      detail: { receiptNo: payment.receipt_no, amountPaise: payment.amount_paise, reason },
    });
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // Reports
  // ---------------------------------------------------------------------------
  router.get('/billing/report', requirePerm('billing.read'), (req, res) => {
    const date = String(req.query.date || '').slice(0, 10) || todayLocal();
    const byMethod = db
      .prepare(
        `SELECT method, COUNT(*) AS count, COALESCE(SUM(amount_paise),0) AS amount
         FROM payments WHERE is_void = 0 AND date(received_at,'+05:30') = ? GROUP BY method ORDER BY method`,
      )
      .all(date);
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(amount_paise),0) AS amount
         FROM payments WHERE is_void = 0 AND date(received_at,'+05:30') = ?`,
      )
      .get(date);
    const invoiced = db
      .prepare(
        `SELECT COUNT(*) AS count, COALESCE(SUM(total_paise),0) AS amount
         FROM invoices WHERE status <> 'void' AND date(created_at,'+05:30') = ?`,
      )
      .get(date);
    const outstanding = db
      .prepare(
        `SELECT COALESCE(SUM(balance_paise),0) AS amount, COUNT(*) AS count
         FROM invoices WHERE status IN ('open','partially_paid')`,
      )
      .get();
    const receipts = db
      .prepare(
        `SELECT pay.*, u.full_name AS received_by_name, i.invoice_no, p.full_name AS patient_name, p.mrn
         FROM payments pay JOIN invoices i ON i.id = pay.invoice_id JOIN patients p ON p.id = pay.patient_id
         LEFT JOIN users u ON u.id = pay.received_by
         WHERE date(pay.received_at,'+05:30') = ? ORDER BY pay.received_at DESC`,
      )
      .all(date);

    audit(ctx, req, { action: 'report.collections_view', detail: { date } });
    res.json({
      date,
      collectedPaise: totals.amount,
      paymentCount: totals.count,
      invoicedPaise: invoiced.amount,
      invoiceCount: invoiced.count,
      outstandingPaise: outstanding.amount,
      outstandingCount: outstanding.count,
      byMethod: byMethod.map((m) => ({ method: m.method, count: m.count, amountPaise: m.amount })),
      receipts: receipts.map((r) => ({
        ...mapPayment(r), invoiceNo: r.invoice_no, patientName: r.patient_name, mrn: r.mrn,
      })),
    });
  });

  router.get('/billing/outstanding', requirePerm('billing.read'), (req, res) => {
    const rows = db
      .prepare(
        `SELECT i.id, i.invoice_no, i.balance_paise, i.created_at, p.id AS patient_id, p.mrn, p.full_name, p.phone
         FROM invoices i JOIN patients p ON p.id = i.patient_id
         WHERE i.status IN ('open','partially_paid') ORDER BY i.created_at ASC LIMIT 200`,
      )
      .all();
    res.json({
      items: rows.map((r) => ({
        invoiceId: r.id, invoiceNo: r.invoice_no, balancePaise: r.balance_paise, createdAt: r.created_at,
        patientId: r.patient_id, mrn: r.mrn, patientName: r.full_name, phone: r.phone,
      })),
    });
  });

  return router;
};

module.exports.METHODS = METHODS;
