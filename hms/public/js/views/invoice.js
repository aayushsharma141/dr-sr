/** Single invoice: line items, payments, receipt printing and voiding. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
];

export default async function invoiceView(root, { params, navigate }) {
  const id = Number(params[0]);
  const data = await api.get(`/api/invoices/${id}`);
  const inv = data.invoice;
  // ADR-23 / D-06: reception collects payments; only the administrator reverses them.
  const canWrite = session.can('payment.collect');
  const canVoid = session.can('payment.reverse');

  root.innerHTML = `
    <div class="breadcrumb">
      <a href="#/billing">Billing</a><span class="sep">/</span><span>${ui.esc(inv.invoiceNo)}</span>
    </div>

    <div class="page-head">
      <div>
        <h1>Invoice ${ui.esc(inv.invoiceNo)} ${ui.statusPill(inv.status)}</h1>
        <div class="sub">
          <a href="#/patients/${inv.patientId}">${ui.esc(inv.patientName)}</a> · ${ui.esc(inv.mrn)}
          · raised ${ui.esc(ui.fmtDateTime(inv.createdAt))}${inv.createdByName ? ` by ${ui.esc(inv.createdByName)}` : ''}
        </div>
      </div>
      <div class="page-head-actions no-print">
        <button class="btn" data-action="print">${ui.icon('printer')}<span>Print receipt</span></button>
        ${canWrite && inv.status !== 'void' && inv.balancePaise > 0
      ? `<button class="btn btn--primary" data-action="pay">${ui.icon('wallet')}<span>Receive payment</span></button>` : ''}
        ${canVoid && inv.status !== 'void' ? `<button class="btn btn--danger" data-action="void">Void</button>` : ''}
      </div>
    </div>

    ${inv.status === 'void' ? `<div class="alert alert--danger mb-2">${ui.icon('ban')}
      <div><strong>This invoice was voided</strong> on ${ui.esc(ui.fmtDateTime(inv.voidedAt))}${inv.voidReason ? ` — ${ui.esc(inv.voidReason)}` : ''}.</div></div>` : ''}

    <div class="grid grid--sidebar">
      <div class="col">
        <section class="card">
          <div class="card-head">
            <h2>Charges</h2>
            ${canWrite && inv.status !== 'void'
      ? `<button class="btn btn--sm" data-action="add-charge">${ui.icon('plus')}<span>Add charge</span></button>` : ''}
          </div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Unit price</th><th class="right">Amount</th></tr></thead>
            <tbody>
              ${data.items.map((item) => `
                <tr>
                  <td>${ui.esc(item.description)}</td>
                  <td class="right">${item.qty}</td>
                  <td class="right money">${ui.inr(item.unitPricePaise)}</td>
                  <td class="right money">${ui.inr(item.lineTotalPaise)}</td>
                </tr>`).join('')}
            </tbody>
            <tfoot>
              <tr><td colspan="3" class="right muted">Subtotal</td><td class="right money">${ui.inr(inv.subtotalPaise)}</td></tr>
              ${inv.discountPaise ? `<tr><td colspan="3" class="right muted">Discount</td><td class="right money">− ${ui.inr(inv.discountPaise)}</td></tr>` : ''}
              ${inv.taxPaise ? `<tr><td colspan="3" class="right muted">Tax</td><td class="right money">${ui.inr(inv.taxPaise)}</td></tr>` : ''}
              <tr><td colspan="3" class="right strong">Total</td><td class="right money strong">${ui.inr(inv.totalPaise)}</td></tr>
              <tr><td colspan="3" class="right muted">Paid</td><td class="right money">${ui.inr(inv.paidPaise)}</td></tr>
              <tr><td colspan="3" class="right strong">Balance</td><td class="right money ${inv.balancePaise > 0 ? 'money--due' : 'money--ok'}">${ui.inr(inv.balancePaise)}</td></tr>
            </tfoot>
          </table></div>
          ${inv.notes ? `<div class="card-foot sm muted">${ui.esc(inv.notes)}</div>` : ''}
        </section>

        <section class="card">
          <div class="card-head"><div class="grow"><h2>Payments</h2></div></div>
          ${data.payments.length ? `<div class="table-wrap"><table class="table">
            <thead><tr><th>Receipt</th><th>When</th><th>Method</th><th>Reference</th><th class="right">Amount</th><th>By</th><th></th></tr></thead>
            <tbody>
              ${data.payments.map((p) => `
                <tr style="${p.isVoid ? 'opacity:.55' : ''}">
                  <td class="mono">${ui.esc(p.receiptNo)}${p.isVoid ? ' <span class="pill pill--muted">Void</span>' : ''}</td>
                  <td class="nowrap muted">${ui.esc(ui.fmtDateTime(p.receivedAt))}</td>
                  <td>${ui.esc(ui.titleCase(p.method))}</td>
                  <td class="muted">${ui.esc(p.reference || '—')}</td>
                  <td class="right money">${ui.inr(p.amountPaise)}</td>
                  <td class="muted xs">${ui.esc(p.receivedByName || '—')}</td>
                  <td class="right nowrap">
                    <button class="btn btn--sm" data-print-payment="${p.id}" title="Print payment receipt">${ui.icon('printer', 14)}<span>Print</span></button>
                    ${canVoid && !p.isVoid
          ? `<button class="btn btn--sm btn--danger ml-1" data-void-payment="${p.id}">Void</button>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>`
      : `<div class="card-body">${ui.emptyState({ iconName: 'wallet', title: 'No payments recorded', message: inv.balancePaise > 0 ? 'Receive a payment to settle this invoice.' : '' })}</div>`}
        </section>
      </div>

      <div class="col">
        <section class="card">
          <div class="card-head"><h2>Patient</h2></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Name</dt><dd><a href="#/patients/${inv.patientId}">${ui.esc(inv.patientName)}</a></dd>
              <dt>MRN</dt><dd class="mono">${ui.esc(inv.mrn)}</dd>
              <dt>Phone</dt><dd>${ui.esc(inv.phone || '—')}</dd>
              <dt>Visit</dt><dd>${ui.esc(inv.visitNo || '—')}</dd>
            </dl>
            <div class="divider"></div>
            <div class="row row--between">
              <span class="muted sm">Balance</span>
              <span class="money ${inv.balancePaise > 0 ? 'money--due' : 'money--ok'}">${ui.inr(inv.balancePaise)}</span>
            </div>
          </div>
        </section>
        ${canWrite && inv.status !== 'void' && inv.balancePaise > 0 ? `
        <section class="card">
          <div class="card-body">
            <button class="btn btn--primary btn--block" data-action="pay">${ui.icon('wallet')}<span>Receive ${ui.inr(inv.balancePaise)}</span></button>
          </div>
        </section>` : ''}
      </div>
    </div>
  `;

  root.querySelector('[data-action="print"]')?.addEventListener('click', () => printReceipt(data));
  root.querySelector('[data-action="add-charge"]')?.addEventListener('click', () => openAddChargeModal(data, () => navigate(`/billing/${id}`)));
  for (const button of root.querySelectorAll('[data-action="pay"]')) {
    button.addEventListener('click', () => openPaymentModal(data, () => navigate(`/billing/${id}`)));
  }
  for (const button of root.querySelectorAll('[data-print-payment]')) {
    button.addEventListener('click', async () => {
      try {
        const res = await api.post(`/api/payments/${button.dataset.printPayment}/print`);
        printSinglePaymentReceipt(res, data.invoice);
      } catch (err) { ui.toastError(err.message); }
    });
  }
  root.querySelector('[data-action="void"]')?.addEventListener('click', async () => {
    const reason = await ui.confirmDialog({
      title: 'Void this invoice?',
      message: 'Voiding keeps the invoice on record but cancels it for accounting. Any payments must be voided first.',
      confirmLabel: 'Void invoice',
      danger: true,
      requireReason: 'Reason for voiding',
    });
    if (!reason) return;
    try {
      await api.post(`/api/invoices/${id}/void`, { reason });
      ui.toastOk('Invoice voided.');
      navigate(`/billing/${id}`);
    } catch (err) { ui.toastError(err.message); }
  });

  for (const button of root.querySelectorAll('[data-void-payment]')) {
    button.addEventListener('click', async () => {
      const reason = await ui.confirmDialog({
        title: 'Void this payment?',
        message: 'The receipt stays visible but is marked void, and the invoice balance is restored.',
        confirmLabel: 'Void payment',
        danger: true,
        requireReason: 'Reason for voiding',
      });
      if (!reason) return;
      try {
        await api.post(`/api/payments/${button.dataset.voidPayment}/void`, { reason });
        ui.toastOk('Payment voided.');
        navigate(`/billing/${id}`);
      } catch (err) { ui.toastError(err.message); }
    });
  }
}

export function openPaymentModal(data, onDone) {
  const inv = data.invoice;
  const handle = ui.modal({
    title: 'Receive payment',
    subtitle: `${inv.invoiceNo} · balance ${ui.inr(inv.balancePaise)}`,
    width: 'narrow',
    body: `<form id="pay-form" class="col" novalidate>
      <div class="field">
        <label for="pay-amount">Amount (₹) <span class="req">*</span></label>
        <input class="input" id="pay-amount" name="amount" type="number" min="0.01" step="0.01"
               value="${(inv.balancePaise / 100).toFixed(2)}" autofocus>
        <div class="field-error hidden" data-error-for="amountPaise"></div>
      </div>
      <div class="field">
        <label for="pay-method">Method <span class="req">*</span></label>
        <select class="select" id="pay-method" name="method">
          ${METHODS.map((m) => `<option value="${m.value}">${ui.esc(m.label)}</option>`).join('')}
        </select>
      </div>
      <div class="field" id="pay-ref-field">
        <label for="pay-ref">Transaction reference</label>
        <input class="input" id="pay-ref" name="reference" placeholder="UPI / card / cheque reference">
        <div class="hint">Required for card, UPI, cheque and insurance payments.</div>
        <div class="field-error hidden" data-error-for="reference"></div>
      </div>
      <div class="field">
        <label for="pay-note">Note</label>
        <input class="input" id="pay-note" name="note" placeholder="Optional">
      </div>
      <div id="pay-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>${ui.icon('check')}<span>Record payment</span></button>`,
  });

  const form = handle.dialog.querySelector('#pay-form');
  const errorBox = handle.dialog.querySelector('#pay-error');
  const save = handle.dialog.querySelector('[data-save]');

  save.addEventListener('click', async () => {
    const values = ui.formValues(form);
    ui.setBusy(save, true, 'Recording…');
    try {
      const res = await api.post(`/api/invoices/${inv.id}/payments`, {
        amountPaise: Math.round(Number(values.amount || 0) * 100),
        method: values.method,
        reference: values.reference,
        note: values.note,
      });
      ui.toastOk(`Payment recorded — receipt ${res.receiptNo}.`);
      handle.close();
      onDone();
    } catch (err) {
      if (err.details) ui.applyFieldErrors(form, err.details);
      else {
        errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
        errorBox.classList.remove('hidden');
      }
    } finally {
      ui.setBusy(save, false);
    }
  });
}

export function openAddChargeModal(data, onDone) {
  const inv = data.invoice;
  const handle = ui.modal({
    title: 'Add charge to invoice',
    subtitle: `${inv.invoiceNo} · ${inv.patientName}`,
    width: 'narrow',
    body: `<form id="add-charge-form" class="col" novalidate>
      <div class="field">
        <label for="charge-desc">Description / Particulars <span class="req">*</span></label>
        <input class="input" id="charge-desc" name="description" placeholder="e.g. Additional Consultation / Dressing / Injection" autofocus required>
      </div>
      <div class="row">
        <div class="field grow">
          <label for="charge-qty">Quantity</label>
          <input class="input" id="charge-qty" name="qty" type="number" min="1" max="99" value="1">
        </div>
        <div class="field grow">
          <label for="charge-rate">Rate (₹) <span class="req">*</span></label>
          <input class="input" id="charge-rate" name="unitPrice" type="number" min="0.01" step="0.01" placeholder="0.00" required>
        </div>
      </div>
      <div id="charge-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>${ui.icon('check')}<span>Add charge</span></button>`,
  });

  const form = handle.dialog.querySelector('#add-charge-form');
  const errorBox = handle.dialog.querySelector('#charge-error');
  const save = handle.dialog.querySelector('[data-save]');

  save.addEventListener('click', async () => {
    const values = ui.formValues(form);
    const desc = String(values.description || '').trim();
    const qty = parseInt(values.qty, 10) || 1;
    const rate = parseFloat(values.unitPrice);
    if (!desc) {
      errorBox.textContent = 'Please enter a description.';
      errorBox.classList.remove('hidden');
      return;
    }
    if (isNaN(rate) || rate <= 0) {
      errorBox.textContent = 'Please enter a valid price.';
      errorBox.classList.remove('hidden');
      return;
    }

    ui.setBusy(save, true, 'Adding…');
    try {
      await api.post(`/api/invoices/${inv.id}/items`, {
        items: [{ description: desc, qty, unitPricePaise: Math.round(rate * 100) }],
      });
      ui.toastOk('Charge added to invoice.');
      handle.close();
      onDone();
    } catch (err) {
      errorBox.textContent = err.message;
      errorBox.classList.remove('hidden');
    } finally {
      ui.setBusy(save, false);
    }
  });
}

export function printSinglePaymentReceipt(payData, inv) {
  const pay = payData.payment;
  const patient = payData.patient || {};
  const settings = session.settings || {};

  ui.printSheet({
    title: `Receipt · ${pay.receiptNo}`,
    subtitle: patient.fullName || '',
    filename: `receipt-${pay.receiptNo}`,
    html: `
      <div class="receipt">
        ${payData.isDuplicate ? `<div class="duplicate-banner">*** प्रतिलिपि रसीद / DUPLICATE RECEIPT (Print #${payData.printCount}) ***</div>` : ''}
        <div class="receipt-head">
          <div>
            <div class="receipt-hospital-hi">${ui.esc(settings.hospitalNameHi || 'कल्याण हॉस्पिटल')}</div>
            <div class="receipt-hospital">${ui.esc(settings.hospitalName || 'Kalyan Hospital')}</div>
            <div class="xs muted">${ui.esc(settings.trustNameHi || 'श्री वशिष्ठ कल्याण ट्रस्ट')} · ${ui.esc(settings.trustName || 'Sri Vashishtha Kalyan Trust')}</div>
            <div class="xs">${ui.esc(settings.hospitalAddress || 'Hospital Road, Ara, Bhojpur, Bihar - 802301')}</div>
            <div class="xs">${ui.esc(settings.hospitalPhone || '')} ${settings.hospitalRegistration ? `· Reg. ${ui.esc(settings.hospitalRegistration)}` : ''}</div>
          </div>
          <div class="receipt-meta">
            <div><strong>PAYMENT RECEIPT</strong></div>
            <div class="mono strong">${ui.esc(pay.receiptNo)}</div>
            <div>${ui.esc(ui.fmtDateTime(pay.receivedAt))}</div>
          </div>
        </div>

        <div class="row row--between mt-2" style="align-items:flex-start">
          <div>
            <div class="xs muted">Patient / रोगी</div>
            <div><strong>${ui.esc(patient.fullName || inv.patientName)}</strong></div>
            <div class="xs">${ui.esc(patient.mrn || inv.mrn)}${patient.phone ? ` · ${ui.esc(patient.phone)}` : ''}</div>
            <div class="xs muted">${ui.esc(patient.district || 'Bhojpur')}, ${ui.esc(patient.state || 'Bihar')}</div>
          </div>
          <div style="text-align:right">
            <div class="xs muted">Invoice / बिल</div>
            <div class="mono">${ui.esc(inv.invoiceNo)}</div>
            <div class="xs muted">Received by: ${ui.esc(pay.receivedByName || 'Cashier')}</div>
          </div>
        </div>

        <table class="mt-2">
          <thead><tr><th>Particulars</th><th>Payment Mode</th><th>Reference</th><th class="right">Amount Paid</th></tr></thead>
          <tbody>
            <tr>
              <td>Payment against Invoice ${ui.esc(inv.invoiceNo)}</td>
              <td>${ui.esc(ui.titleCase(pay.method))}</td>
              <td class="mono muted">${ui.esc(pay.reference || '—')}</td>
              <td class="right money strong">${ui.inr(pay.amountPaise)}</td>
            </tr>
          </tbody>
        </table>

        <table class="totals" style="width:300px;margin-left:auto">
          <tbody>
            <tr><td>Invoice Total</td><td class="right">${ui.inr(inv.totalPaise)}</td></tr>
            <tr><td>Total Paid So Far</td><td class="right">${ui.inr(inv.paidPaise)}</td></tr>
            <tr class="grand"><td>Remaining Balance Due</td><td class="right">${ui.inr(inv.balancePaise)}</td></tr>
          </tbody>
        </table>

        <div class="receipt-foot mt-4">
          <div>${ui.esc(settings.printFooterEn || settings.disclaimer || '')}<br><span class="muted xs">Computer-generated receipt. System-tracked and audited.</span></div>
          <div style="text-align:right"><div style="height:35px"></div>
            <div style="border-top:1px solid #333;padding-top:3px">Cashier / Authorised Signatory</div></div>
        </div>
      </div>`,
  });
}

export function printReceipt(data) {
  const inv = data.invoice;
  const settings = session.settings || {};
  const activePayments = data.payments.filter((p) => !p.isVoid);

  ui.printSheet({
    title: `Receipt · ${inv.invoiceNo}`,
    subtitle: inv.patientName,
    filename: `receipt-${inv.invoiceNo}`,
    html: `
      <div class="receipt">
        <div class="receipt-head">
          <div>
            <div class="receipt-hospital-hi">${ui.esc(settings.hospitalNameHi || 'कल्याण हॉस्पिटल')}</div>
            <div class="receipt-hospital">${ui.esc(settings.hospitalName || 'Kalyan Hospital')}</div>
            <div class="xs muted">${ui.esc(settings.trustNameHi || 'श्री वशिष्ठ कल्याण ट्रस्ट')} · ${ui.esc(settings.trustName || 'Sri Vashishtha Kalyan Trust')}</div>
            <div class="xs">${ui.esc(settings.hospitalAddress || 'Hospital Road, Ara, Bhojpur, Bihar - 802301')}</div>
            <div class="xs">${ui.esc(settings.hospitalPhone || '')} ${settings.hospitalRegistration ? `· Reg. ${ui.esc(settings.hospitalRegistration)}` : ''}</div>
          </div>
          <div class="receipt-meta">
            <div><strong>${inv.status === 'void' ? 'VOID INVOICE' : 'INVOICE CUM RECEIPT'}</strong></div>
            <div class="mono strong">${ui.esc(inv.invoiceNo)}</div>
            <div>${ui.esc(ui.fmtDateTime(inv.createdAt))}</div>
          </div>
        </div>

        <div class="row row--between mt-2" style="align-items:flex-start">
          <div>
            <div class="xs muted">Patient / रोगी</div>
            <div><strong>${ui.esc(inv.patientName)}</strong></div>
            <div class="xs">${ui.esc(inv.mrn)}${inv.phone ? ` · ${ui.esc(inv.phone)}` : ''}${inv.visitNo ? ` · Visit ${ui.esc(inv.visitNo)}` : ''}</div>
          </div>
          <div style="text-align:right">
            <div class="xs muted">Raised by</div>
            <div>${ui.esc(inv.createdByName || '—')}</div>
          </div>
        </div>

        <table>
          <thead><tr><th>#</th><th>Particulars</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${data.items.map((item, i) => `
              <tr>
                <td>${i + 1}</td>
                <td>${ui.esc(item.description)}</td>
                <td class="right">${item.qty}</td>
                <td class="right">${ui.inr(item.unitPricePaise)}</td>
                <td class="right">${ui.inr(item.lineTotalPaise)}</td>
              </tr>`).join('')}
          </tbody>
        </table>

        <table class="totals" style="width:300px;margin-left:auto">
          <tbody>
            <tr><td>Subtotal</td><td>${ui.inr(inv.subtotalPaise)}</td></tr>
            ${inv.discountPaise ? `<tr><td>Discount</td><td>− ${ui.inr(inv.discountPaise)}</td></tr>` : ''}
            ${inv.taxPaise ? `<tr><td>Tax</td><td>${ui.inr(inv.taxPaise)}</td></tr>` : ''}
            <tr class="grand"><td>Total</td><td>${ui.inr(inv.totalPaise)}</td></tr>
            <tr><td>Paid</td><td>${ui.inr(inv.paidPaise)}</td></tr>
            <tr><td><strong>Balance due</strong></td><td><strong>${ui.inr(inv.balancePaise)}</strong></td></tr>
          </tbody>
        </table>

        <div class="mt-2 xs">
          <strong>Payments / भुगतान विवरण</strong>
          ${activePayments.length
        ? activePayments.map((p) => `<div>${ui.esc(p.receiptNo)} · ${ui.esc(ui.titleCase(p.method))}${p.reference ? ` (${ui.esc(p.reference)})` : ''} · ${ui.inr(p.amountPaise)} · ${ui.esc(ui.fmtDate(p.receivedAt, { withTime: true }))}</div>`).join('')
        : '<div class="muted">No payment received yet.</div>'}
        </div>

        <div class="receipt-foot">
          <div>${ui.esc(settings.printFooterEn || settings.disclaimer || '')}<br><span class="muted xs">Computer-generated receipt. System-tracked and audited.</span></div>
          <div style="text-align:right"><div style="height:30px"></div>
            <div style="border-top:1px solid #333;padding-top:3px">Cashier / Authorised signatory</div></div>
        </div>
      </div>`,
  });
}
