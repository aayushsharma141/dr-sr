/** Billing: invoice register, invoice builder and the daily collection report. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';
import { pickPatient } from './patient-picker.js';

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default async function billingView(root, { query, navigate }) {
  const filters = {
    status: query.get('status') || '',
    q: query.get('q') || '',
    date: query.get('date') || '',
    page: Number(query.get('page') || 1) || 1,
  };

  const params = new URLSearchParams({ limit: '25', page: String(filters.page) });
  if (filters.status) params.set('status', filters.status);
  if (filters.q) params.set('q', filters.q);
  if (filters.date) params.set('date', filters.date);

  const data = await api.get(`/api/invoices?${params}`);
  const canWrite = session.can('invoice.write'); // reception raises invoices (ADR-23)

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Billing</h1>
        <div class="sub">${data.total} invoice${data.total === 1 ? '' : 's'} · ${ui.inr(data.summary.billedPaise)} billed
          · ${ui.inr(data.summary.collectedPaise)} collected</div>
      </div>
      <div class="page-head-actions">
        <button class="btn" data-action="dues">${ui.icon('wallet')}<span>Pending dues</span></button>
        <button class="btn" data-action="report">${ui.icon('printer')}<span>Day report</span></button>
        ${canWrite ? `<button class="btn btn--primary" data-action="new">${ui.icon('plus')}<span>New invoice</span></button>` : ''}
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body row row--wrap" style="gap:10px">
        <input class="input" id="bill-q" type="search" placeholder="Search invoice no, patient or MRN…"
               value="${ui.esc(filters.q)}" style="max-width:300px" autocomplete="off">
        <select class="select" id="bill-status" style="max-width:190px">
          <option value="">All statuses</option>
          <option value="open" ${filters.status === 'open' ? 'selected' : ''}>Unpaid</option>
          <option value="partially_paid" ${filters.status === 'partially_paid' ? 'selected' : ''}>Part paid</option>
          <option value="paid" ${filters.status === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="void" ${filters.status === 'void' ? 'selected' : ''}>Void</option>
        </select>
        <input class="input" id="bill-date" type="date" value="${ui.esc(filters.date)}" style="max-width:160px">
        ${filters.status || filters.q || filters.date ? '<button class="btn btn--sm" data-action="clear">Clear filters</button>' : ''}
      </div>
    </div>

    <div class="card">
      ${data.invoices.length ? `
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>Invoice</th><th>Patient</th><th>Raised</th>
            <th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th>
            <th class="right">Status</th>
          </tr></thead>
          <tbody>
            ${data.invoices.map((inv) => `
              <tr class="is-clickable" data-href="#/billing/${inv.id}">
                <td class="mono">${ui.esc(inv.invoiceNo)}</td>
                <td>
                  <span class="cell-main">${ui.esc(inv.patientName)}</span>
                  <div class="cell-sub">${ui.esc(inv.mrn)}</div>
                </td>
                <td class="nowrap muted">${ui.esc(ui.fmtDate(inv.createdAt, { short: true, withTime: true }))}</td>
                <td class="right money">${ui.inr(inv.totalPaise)}</td>
                <td class="right money">${ui.inr(inv.paidPaise)}</td>
                <td class="right money ${inv.balancePaise > 0 ? 'money--due' : ''}">${ui.inr(inv.balancePaise)}</td>
                <td class="right">${ui.statusPill(inv.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="pagination">
          <span>Page ${data.page} of ${data.pages}</span>
          <div class="row" style="gap:6px">
            <button class="btn btn--sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
            <button class="btn btn--sm" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
          </div>
        </div>`
      : `<div class="card-body">${ui.emptyState({
          iconName: 'receipt',
          title: filters.status || filters.q || filters.date ? 'No invoices match those filters' : 'No invoices yet',
          message: 'Raise an invoice from a patient chart or with the New invoice button.',
          action: canWrite ? '<button class="btn btn--sm btn--primary" data-action="new">Create an invoice</button>' : '',
        })}</div>`}
    </div>
  `;

  const rerun = (patch = {}) => {
    Object.assign(filters, patch);
    const p = new URLSearchParams();
    if (filters.q) p.set('q', filters.q);
    if (filters.status) p.set('status', filters.status);
    if (filters.date) p.set('date', filters.date);
    if (filters.page > 1) p.set('page', String(filters.page));
    navigate(`/billing${p.toString() ? `?${p}` : ''}`);
  };

  const search = root.querySelector('#bill-q');
  search?.addEventListener('input', ui.debounce((e) => rerun({ q: e.target.value.trim(), page: 1 }), 320));
  search?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); rerun({ q: e.target.value.trim(), page: 1 }); }
  });
  root.querySelector('#bill-status')?.addEventListener('change', (e) => rerun({ status: e.target.value, page: 1 }));
  root.querySelector('#bill-date')?.addEventListener('change', (e) => rerun({ date: e.target.value, page: 1 }));
  root.querySelector('[data-action="clear"]')?.addEventListener('click', () => rerun({ q: '', status: '', date: '', page: 1 }));
  for (const row of root.querySelectorAll('[data-href]')) {
    row.addEventListener('click', () => { location.hash = row.dataset.href; });
  }
  for (const button of root.querySelectorAll('[data-page]')) {
    button.addEventListener('click', () => rerun({ page: Number(button.dataset.page) }));
  }

  for (const button of root.querySelectorAll('[data-action="dues"]')) {
    button.addEventListener('click', () => openPendingDuesModal());
  }

  for (const button of root.querySelectorAll('[data-action="report"]')) {
    button.addEventListener('click', () => openDayReport(filters.date || todayLocal()));
  }

  for (const button of root.querySelectorAll('[data-action="new"]')) {
    button.addEventListener('click', async () => {
      const presetPatientId = query.get('patient');
      let patient = null;
      if (presetPatientId) {
        const res = await api.get(`/api/patients/${presetPatientId}`);
        patient = res.patient;
      } else {
        patient = await pickPatient({ title: 'Create an invoice — find the patient' });
      }
      if (!patient) return;
      openInvoiceBuilder(patient, {
        onSaved: (invoice) => {
          ui.toastOk(`Invoice ${invoice.invoiceNo} created.`);
          navigate(`/billing/${invoice.id}`);
        },
      });
    });
  }

  // Auto-open the builder when arriving from a patient chart (?patient=ID).
  if (query.get('patient')) {
    const button = root.querySelector('[data-action="new"]');
    if (button) button.click();
  }
}

// ---------------------------------------------------------------------------
// Invoice builder
// ---------------------------------------------------------------------------
export async function openInvoiceBuilder(patient, { onSaved }) {
  const services = (await api.get('/api/services')).services;
  const lines = [];

  const handle = ui.modal({
    title: 'New invoice',
    subtitle: `${patient.fullName} · ${patient.mrn}`,
    width: 'wide',
    body: `
      <div class="col">
        <div class="inline-form">
          <div class="field grow" style="min-width:240px">
            <label for="svc-pick">Add a service</label>
            <select class="select" id="svc-pick">
              ${Object.entries(services.reduce((acc, s) => {
                (acc[s.category || 'Other'] = acc[s.category || 'Other'] || []).push(s);
                return acc;
              }, {})).map(([category, items]) => `
                <optgroup label="${ui.esc(category)}">
                  ${items.map((s) => `<option value="${s.id}">${ui.esc(s.name)} — ${ui.inr(s.pricePaise)}</option>`).join('')}
                </optgroup>`).join('')}
            </select>
          </div>
          <button class="btn" type="button" data-add-service>${ui.icon('plus', 14)}<span>Add</span></button>
        </div>

        <div class="table-wrap">
          <table class="table table--compact" id="lines-table">
            <thead><tr><th>Description</th><th style="width:80px">Qty</th><th style="width:120px">Unit price</th><th class="right" style="width:110px">Amount</th><th style="width:34px"></th></tr></thead>
            <tbody id="lines-body"></tbody>
          </table>
        </div>
        <div id="lines-empty" class="muted sm">No charges added yet. Pick a service above, or add a custom charge below.</div>

        <div class="inline-form">
          <div class="field grow"><label for="custom-desc">Custom charge</label><input class="input" id="custom-desc" placeholder="Description"></div>
          <div class="field" style="width:120px"><label for="custom-price">Amount (₹)</label><input class="input" id="custom-price" type="number" min="0" step="0.01"></div>
          <button class="btn" type="button" data-add-custom>${ui.icon('plus', 14)}<span>Add</span></button>
        </div>

        <div class="divider"></div>
        <div class="row row--between">
          <div class="field" style="width:150px">
            <label for="inv-discount">Discount (₹)</label>
            <input class="input" id="inv-discount" type="number" min="0" step="0.01" value="0">
          </div>
          <div class="field grow" style="max-width:320px">
            <label for="inv-notes">Note on invoice</label>
            <input class="input" id="inv-notes" placeholder="Optional">
          </div>
          <div style="text-align:right;min-width:180px">
            <div class="muted xs">Subtotal</div>
            <div class="strong money" id="inv-subtotal">₹0.00</div>
            <div class="muted xs mt-1">Total payable</div>
            <div class="strong money" id="inv-total" style="font-size:18px">₹0.00</div>
          </div>
        </div>
        <div id="inv-error" class="alert alert--danger hidden"></div>
      </div>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>${ui.icon('save')}<span>Create invoice</span></button>`,
  });

  const body = handle.dialog;
  const linesBody = body.querySelector('#lines-body');
  const emptyNote = body.querySelector('#lines-empty');

  function renderLines() {
    linesBody.innerHTML = lines.map((line, index) => `
      <tr>
        <td>${ui.esc(line.description)}</td>
        <td><input class="input input--sm" type="number" min="1" max="999" value="${line.qty}" data-qty="${index}" style="width:64px"></td>
        <td><input class="input input--sm" type="number" min="0" step="0.01" value="${(line.unitPricePaise / 100).toFixed(2)}" data-price="${index}" style="width:104px"></td>
        <td class="right money">${ui.inr(line.qty * line.unitPricePaise)}</td>
        <td><button class="icon-btn" data-remove="${index}" type="button" style="width:24px;height:24px">${ui.icon('close', 13)}</button></td>
      </tr>`).join('');
    emptyNote.classList.toggle('hidden', lines.length > 0);
    recalc();
    for (const input of linesBody.querySelectorAll('[data-qty]')) {
      input.addEventListener('input', () => {
        const i = Number(input.dataset.qty);
        lines[i].qty = Math.max(1, Math.min(999, Number(input.value) || 1));
        renderLines();
      });
    }
    for (const input of linesBody.querySelectorAll('[data-price]')) {
      input.addEventListener('change', () => {
        const i = Number(input.dataset.price);
        lines[i].unitPricePaise = Math.max(0, Math.round(Number(input.value || 0) * 100));
        renderLines();
      });
    }
    for (const button of linesBody.querySelectorAll('[data-remove]')) {
      button.addEventListener('click', () => {
        lines.splice(Number(button.dataset.remove), 1);
        renderLines();
      });
    }
  }

  function totals() {
    const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPricePaise, 0);
    const discount = Math.max(0, Math.round(Number(body.querySelector('#inv-discount').value || 0) * 100));
    return { subtotal, discount, total: subtotal - discount };
  }

  function recalc() {
    const { subtotal, discount, total } = totals();
    body.querySelector('#inv-subtotal').textContent = ui.inr(subtotal);
    body.querySelector('#inv-total').textContent = ui.inr(Math.max(0, total));
    body.querySelector('#inv-total').classList.toggle('money--due', total < 0);
  }

  body.querySelector('#inv-discount').addEventListener('input', recalc);
  body.querySelector('[data-add-service]').addEventListener('click', () => {
    const id = Number(body.querySelector('#svc-pick').value);
    const service = services.find((s) => s.id === id);
    if (!service) return;
    const existing = lines.find((l) => l.serviceId === service.id);
    if (existing) existing.qty += 1;
    else lines.push({ serviceId: service.id, description: service.name, qty: 1, unitPricePaise: service.pricePaise });
    renderLines();
  });

  body.querySelector('[data-add-custom]').addEventListener('click', () => {
    const desc = body.querySelector('#custom-desc').value.trim();
    const price = Math.round(Number(body.querySelector('#custom-price').value || 0) * 100);
    if (!desc) {
      ui.toastError('Give the custom charge a description.');
      return;
    }
    lines.push({ serviceId: null, description: desc, qty: 1, unitPricePaise: Math.max(0, price) });
    body.querySelector('#custom-desc').value = '';
    body.querySelector('#custom-price').value = '';
    renderLines();
  });

  const save = body.querySelector('[data-save]');
  const errorBox = body.querySelector('#inv-error');
  save.addEventListener('click', async () => {
    errorBox.classList.add('hidden');
    if (!lines.length) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>Add at least one charge to the invoice.</div>`;
      errorBox.classList.remove('hidden');
      return;
    }
    const { discount } = totals();
    ui.setBusy(save, true, 'Creating…');
    try {
      const res = await api.post('/api/invoices', {
        patientId: patient.id,
        discountPaise: discount,
        notes: body.querySelector('#inv-notes').value,
        items: lines.map((l) => ({
          serviceId: l.serviceId,
          description: l.description,
          qty: l.qty,
          unitPricePaise: l.unitPricePaise,
        })),
      });
      handle.close();
      onSaved(res.invoice);
    } catch (err) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
      errorBox.classList.remove('hidden');
    } finally {
      ui.setBusy(save, false);
    }
  });

  renderLines();
  return handle;
}

// ---------------------------------------------------------------------------
// Daily collection report (printed)
// ---------------------------------------------------------------------------
export async function openDayReport(date) {
  const data = await api.get(`/api/billing/report?date=${date}`);
  const settings = session.settings || {};
  const rows = data.receipts.filter((r) => !r.isVoid);

  ui.printSheet({
    title: 'Daily collection report',
    subtitle: ui.fmtDate(date),
    filename: `collections-${date}`,
    html: `
      <div class="receipt">
        <div class="receipt-head">
          <div>
            <div class="receipt-hospital">${ui.esc(settings.hospitalName || 'Kalyan Hospital')}</div>
            <div class="xs">${ui.esc(settings.hospitalAddress || '')}</div>
          </div>
          <div class="receipt-meta">
            <div><strong>Daily collection</strong></div>
            <div>${ui.esc(ui.fmtDate(date))}</div>
            <div>Printed ${ui.esc(ui.fmtDateTime(new Date().toISOString()))}</div>
          </div>
        </div>

        <table>
          <thead><tr><th>Method</th><th class="right">Receipts</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${data.byMethod.map((m) => `<tr><td>${ui.esc(ui.titleCase(m.method))}</td><td class="right">${m.count}</td><td class="right">${ui.inr(m.amountPaise)}</td></tr>`).join('')}
          </tbody>
          <tfoot>
            <tr><td><strong>Total collected</strong></td><td class="right">${data.paymentCount}</td><td class="right"><strong>${ui.inr(data.collectedPaise)}</strong></td></tr>
          </tfoot>
        </table>

        <table>
          <thead><tr><th>Receipt</th><th>Time</th><th>Patient</th><th>Invoice</th><th>Method</th><th class="right">Amount</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>
              <td>${ui.esc(r.receiptNo)}</td>
              <td>${ui.esc(ui.fmtTime(r.receivedAt))}</td>
              <td>${ui.esc(r.patientName)} <span class="muted">(${ui.esc(r.mrn)})</span></td>
              <td>${ui.esc(r.invoiceNo)}</td>
              <td>${ui.esc(ui.titleCase(r.method))}</td>
              <td class="right">${ui.inr(r.amountPaise)}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">No receipts on this date.</td></tr>'}
          </tbody>
        </table>

        <div class="receipt-foot">
          <div>Invoices raised: ${data.invoiceCount} · ${ui.inr(data.invoicedPaise)}<br>
               All-time outstanding: ${ui.inr(data.outstandingPaise)} across ${data.outstandingCount} invoices</div>
          <div style="text-align:right"><div style="height:30px"></div>
            <div style="border-top:1px solid #333;padding-top:3px">Cashier signature</div></div>
        </div>
      </div>`,
  });
}

async function openPendingDuesModal() {
  const data = await api.get('/api/billing/dues');
  ui.modal({
    title: 'Pending patient dues',
    subtitle: `${data.patientCount} patients with outstanding balances · Total ${ui.inr(data.totalDuePaise)}`,
    width: 'wide',
    body: `
      ${data.patients.length ? `
        <div class="table-wrap"><table class="table">
          <thead>
            <tr>
              <th>Patient</th>
              <th>Phone</th>
              <th>District</th>
              <th class="right">Invoices</th>
              <th class="right">Total Due</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${data.patients.map((p) => `
              <tr>
                <td><strong><a href="#/patients/${p.patientId}?tab=billing">${ui.esc(p.fullName)}</a></strong> <span class="muted sm">(${ui.esc(p.mrn)})</span></td>
                <td>${ui.esc(p.phone || '—')}</td>
                <td>${ui.esc(p.district || 'Bhojpur')}</td>
                <td class="right">${p.invoiceCount}</td>
                <td class="right money money--due"><strong>${ui.inr(p.totalDuePaise)}</strong></td>
                <td class="right"><a class="btn btn--sm" href="#/patients/${p.patientId}?tab=billing">View</a></td>
              </tr>`).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" class="right strong">Total outstanding dues</td>
              <td class="right money money--due strong">${ui.inr(data.totalDuePaise)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table></div>` : ui.emptyState({ iconName: 'check', title: 'No pending dues', message: 'All patient invoices are settled.' })}
    `,
    footer: `<button class="btn" type="button" data-close>Close</button>`,
  });
}
