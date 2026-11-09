/**
 * Patient chart: identity header with safety banners, then tabbed sections for
 * visits, notes, vitals, medications, documents, billing and timeline.
 */
import { api, session } from '../api.js';
import * as ui from '../ui.js';
import { openPatientForm } from './patient-form.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'visits', label: 'Visits', perm: 'visit.read' },
  { id: 'notes', label: 'Clinical notes', perm: 'clinical.read' },
  { id: 'vitals', label: 'Vitals', perm: 'clinical.read' },
  { id: 'medications', label: 'Medications', perm: 'clinical.read' },
  { id: 'documents', label: 'Documents', perm: 'attachment.read' },
  { id: 'billing', label: 'Billing', perm: 'billing.read' },
  { id: 'timeline', label: 'Timeline' },
];

export default async function patientView(root, { params, query, navigate }) {
  const patientId = Number(params[0]);
  const state = {
    tab: query.get('tab') || 'overview',
    openVisitId: query.get('visit') ? Number(query.get('visit')) : null,
    patient: null,
    chart: null,
  };

  const chart = await api.get(`/api/patients/${patientId}`);
  state.chart = chart;
  try {
    state.doctors = (await api.get('/api/staff/doctors')).doctors;
  } catch {
    state.doctors = [];
  }
  state.patient = chart.patient;
  const patient = chart.patient;

  const visibleTabs = TABS.filter((tab) => !tab.perm || session.can(tab.perm));
  if (!visibleTabs.some((t) => t.id === state.tab)) state.tab = 'overview';

  const criticalAllergies = chart.allergies.filter((a) => a.severity === 'severe' || a.severity === 'life_threatening');

  root.innerHTML = `
    <div class="breadcrumb">
      <a href="#/patients">Patients</a><span class="sep">/</span><span>${ui.esc(patient.fullName)}</span>
    </div>

    <div class="card mb-2">
      <div class="card-body">
        <div class="row row--wrap" style="gap:16px;align-items:flex-start">
          <span class="avatar avatar--lg">${ui.esc(ui.initials(patient.fullName))}</span>
          <div class="grow" style="min-width:220px">
            <div class="row row--wrap" style="gap:8px">
              <h1 style="font-size:20px;letter-spacing:-.01em">${ui.esc(patient.fullName)}</h1>
              ${patient.isActive ? '' : '<span class="pill pill--muted">Archived</span>'}
              ${chart.stats.openVisit ? '<span class="pill pill--info">Open visit</span>' : ''}
            </div>
            <div class="muted sm">
              <span class="mono">${ui.esc(patient.mrn)}</span> ·
              ${ui.esc(ui.fmtAge(patient.dob, patient.age))} · ${ui.esc(ui.sexLabel(patient.sex))}
              ${patient.dob ? ` · DOB ${ui.esc(ui.fmtDate(patient.dob))}` : ''}
              ${patient.bloodGroup ? ` · ${ui.esc(patient.bloodGroup)}` : ''}
            </div>
            <div class="muted sm">
              ${patient.phone ? `<span class="inline-ico">${ui.icon('phone', 13)}</span>${ui.esc(patient.phone)}` : '<span class="muted">No phone on file</span>'}
              ${patient.city ? ` · ${ui.esc(patient.city)}` : ''}
            </div>
          </div>
          <div class="row row--wrap" style="gap:8px">
            ${session.can('visit.write')
              ? (chart.stats.openVisit
                  ? `<button class="btn btn--primary" data-action="open-visit">${ui.icon('stethoscope')}<span>Continue visit</span></button>`
                  : `<button class="btn btn--primary" data-action="new-visit">${ui.icon('stethoscope')}<span>New visit</span></button>`)
              : ''}
            ${session.can('appointment.write') ? `<button class="btn" data-action="book">${ui.icon('calendar')}<span>Book</span></button>` : ''}
            ${session.can('invoice.write') ? `<button class="btn" data-action="invoice">${ui.icon('receipt')}<span>Bill</span></button>` : ''}
            ${session.can('patient.write') ? `<button class="btn" data-action="edit">${ui.icon('edit')}<span>Edit</span></button>` : ''}
          </div>
        </div>

        ${criticalAllergies.length
          ? `<div class="alert alert--danger mt-2">${ui.icon('alert')}
              <div><strong>Allergy alert:</strong> ${criticalAllergies.map((a) => ui.esc(a.substance)).join(', ')}
              ${criticalAllergies.some((a) => a.reaction) ? `<span class="xs"> (${ui.esc(criticalAllergies.map((a) => a.reaction).filter(Boolean).join('; '))})</span>` : ''}
              </div></div>`
          : patient.allergiesSummary
            ? `<div class="alert alert--warn mt-2">${ui.icon('alert')}<div><strong>Allergies:</strong> ${ui.esc(patient.allergiesSummary)}</div></div>`
            : ''}
      </div>
    </div>

    <div class="tabs mb-2" role="tablist">
      ${visibleTabs.map((tab) => `
        <button class="tab ${tab.id === state.tab ? 'is-active' : ''}" role="tab" data-tab="${tab.id}">
          ${ui.esc(tab.label)}
        </button>`).join('')}
    </div>

    <div id="tab-body"></div>
  `;

  const body = root.querySelector('#tab-body');

  const setTab = (tabId, { push = true } = {}) => {
    state.tab = tabId;
    for (const button of root.querySelectorAll('[data-tab]')) {
      button.classList.toggle('is-active', button.dataset.tab === tabId);
    }
    if (push) {
      const params2 = new URLSearchParams({ tab: tabId });
      if (state.openVisitId && tabId === 'visits') params2.set('visit', String(state.openVisitId));
      history.replaceState(null, '', `#/patients/${patientId}?${params2}`);
    }
    renderTab();
  };

  const reloadChart = async () => {
    const fresh = await api.get(`/api/patients/${patientId}`);
    state.chart = fresh;
    state.patient = fresh.patient;
    renderTab();
  };

  // ---- tab router ---------------------------------------------------------
  async function renderTab() {
    body.innerHTML = ui.loadingRow();
    try {
      if (state.tab === 'overview') await renderOverview();
      else if (state.tab === 'visits') await renderVisits();
      else if (state.tab === 'notes') await renderNotes();
      else if (state.tab === 'vitals') await renderVitals();
      else if (state.tab === 'medications') await renderMedications();
      else if (state.tab === 'documents') await renderDocuments();
      else if (state.tab === 'billing') await renderBilling();
      else if (state.tab === 'timeline') await renderTimeline();
    } catch (err) {
      body.innerHTML = `<div class="card"><div class="card-body">${ui.emptyState({
        iconName: 'alert', title: 'Could not load this section', message: err.message,
      })}</div></div>`;
    }
  }

  // =========================================================================
  // Overview
  // =========================================================================
  async function renderOverview() {
    const c = state.chart;
    const v = c.latestVitals;
    const canRecordAllergy = session.can('clinical.write') || session.can('patient.write');
    const myOpenVisit = c.stats.openVisit && c.stats.openVisit.doctor_id === session.user?.id ? c.stats.openVisit : null;
    body.innerHTML = `
      <div class="grid grid--sidebar">
        <div class="col">
          <section class="card">
            <div class="card-head">
              <div class="grow"><h2>Summary</h2></div>
              ${c.stats.openVisit ? `<a class="btn btn--sm" href="#/patients/${patientId}?tab=visits&visit=${c.stats.openVisit.id}">Open visit ${ui.esc(c.stats.openVisit.visit_no)}</a>` : ''}
            </div>
            <div class="card-body">
              <dl class="kv">
                <dt>MRN</dt><dd class="mono">${ui.esc(patient.mrn)}</dd>
                <dt>Sex</dt><dd>${ui.esc(ui.sexLabel(patient.sex))}</dd>
                <dt>Date of birth</dt><dd>${patient.dob ? `${ui.esc(ui.fmtDate(patient.dob))} ${patient.dobEstimated ? '<span class="muted xs">(approx.)</span>' : ''}` : '—'}</dd>
                <dt>Blood group</dt><dd>${ui.esc(patient.bloodGroup || '—')}</dd>
                <dt>Phone</dt><dd>${ui.esc(patient.phone || '—')}${patient.altPhone ? ` / ${ui.esc(patient.altPhone)}` : ''}</dd>
                <dt>Address</dt><dd>${ui.esc([patient.addressLine, patient.city, patient.state, patient.pincode].filter(Boolean).join(', ') || '—')}</dd>
                <dt>Occupation</dt><dd>${ui.esc(patient.occupation || '—')}</dd>
                <dt>Emergency contact</dt><dd>${ui.esc([patient.emergencyContactName, patient.emergencyContactPhone].filter(Boolean).join(' · ') || (patient.guardianName ? `${patient.guardianName} (${patient.guardianRelation || 'guardian'})` : '—'))}</dd>
                <dt>Registered</dt><dd>${ui.esc(ui.fmtDate(patient.createdAt, { withTime: true }))}</dd>
                <dt>Visits</dt><dd>${c.stats.visitCount}</dd>
              </dl>
              ${patient.notes ? `<div class="divider"></div><div class="xs muted">Reception notes</div><div class="sm">${ui.esc(patient.notes)}</div>` : ''}
            </div>
          </section>

          ${session.can('clinical.read') || session.can('patient.write') ? `
          <section class="card">
            <div class="card-head">
              <div class="grow"><h2>${session.can('clinical.read') ? 'Allergies &amp; conditions' : 'Allergies'}</h2></div>
              ${canRecordAllergy ? '<button class="btn btn--sm" data-action="add-allergy">Add allergy</button>' : ''}
            </div>
            <div class="card-body">
              ${c.allergies.length || c.conditions.length ? `
                ${c.allergies.length ? `
                  <div class="section-title mb-1">Allergies</div>
                  <div class="stack-sm mb-2">
                    ${c.allergies.map((a) => `
                      <div class="row" style="gap:8px">
                        <span class="strong sm">${ui.esc(a.substance)}</span>
                        ${ui.severityPill(a.severity)}
                        ${a.reaction ? `<span class="muted xs">${ui.esc(a.reaction)}</span>` : ''}
                        ${canRecordAllergy ? `<button class="icon-btn" style="margin-left:auto;width:24px;height:24px" data-remove-allergy="${a.id}" title="Remove">${ui.icon('close', 13)}</button>` : ''}
                      </div>`).join('')}
                  </div>` : ''}
                ${c.conditions.length ? `
                  <div class="section-title mb-1">Ongoing conditions</div>
                  <div class="stack-sm">
                    ${c.conditions.map((cond) => `
                      <div class="row" style="gap:8px">
                        <span class="sm">${ui.esc(cond.condition)}</span>
                        ${ui.statusPill(cond.status)}
                        ${cond.sinceDate ? `<span class="muted xs">since ${ui.esc(ui.fmtDate(cond.sinceDate, { short: true }))}</span>` : ''}
                      </div>`).join('')}
                  </div>` : ''}
              ` : ui.emptyState({ iconName: 'shield', title: 'No allergies or conditions recorded', message: 'Add known allergies so they are flagged on every visit.' })}
            </div>
          </section>` : ''}
        </div>

        <div class="col">
          ${session.can('clinical.read') ? `
          <section class="card">
            <div class="card-head">
              <div class="grow"><h2>Latest vitals</h2></div>
              ${session.can('vitals.write') && myOpenVisit ? '<button class="btn btn--sm" data-action="add-vitals">Record</button>' : ''}
            </div>
            <div class="card-body">
              ${v ? `
                <div class="grid" style="grid-template-columns:repeat(2,1fr);gap:10px">
                  ${vitalTile('Temperature', v.temperatureC ? `${v.temperatureC} °C` : '—', v.temperatureC > 37.9)}
                  ${vitalTile('Pulse', v.pulseBpm ? `${v.pulseBpm} bpm` : '—', v.pulseBpm > 100 || v.pulseBpm < 60)}
                  ${vitalTile('Blood pressure', v.bpSystolic ? `${v.bpSystolic}/${v.bpDiastolic}` : '—', v.bpSystolic > 140 || v.bpSystolic < 90)}
                  ${vitalTile('SpO₂', v.spo2 ? `${v.spo2}%` : '—', v.spo2 < 94)}
                  ${vitalTile('Weight', v.weightKg ? `${v.weightKg} kg` : '—')}
                  ${vitalTile('Respiratory', v.respRate ? `${v.respRate}/min` : '—', v.respRate > 22)}
                </div>
                <div class="muted xs mt-2">Recorded ${ui.esc(ui.fmtDateTime(v.recordedAt))}</div>
              ` : ui.emptyState({ iconName: 'activity', title: 'No vitals recorded', message: 'Vitals appear here once the doctor records them.' })}
            </div>
          </section>` : ''}

          ${session.can('billing.read') ? `
          <section class="card">
            <div class="card-head"><h2>Account</h2><a class="xs" style="margin-left:auto" href="#/patients/${patientId}?tab=billing">View bills</a></div>
            <div class="card-body">
              <div class="row row--between">
                <span class="muted sm">Outstanding balance</span>
                <span class="money ${c.stats.balancePaise > 0 ? 'money--due' : 'money--ok'}">${ui.inr(c.stats.balancePaise)}</span>
              </div>
              ${c.stats.documentCount !== null ? `<div class="row row--between mt-1">
                <span class="muted sm">Documents on file</span>
                <span class="sm">${c.stats.documentCount}</span>
              </div>` : ''}
            </div>
          </section>` : ''}
        </div>
      </div>
    `;

    for (const button of body.querySelectorAll('[data-action="add-vitals"]')) {
      button.addEventListener('click', () => openVitalsForm(myOpenVisit.id, reloadChart));
    }
    for (const button of body.querySelectorAll('[data-action="add-allergy"]')) {
      button.addEventListener('click', () => openAllergyForm(patientId, () => { refreshThen(reloadChart); }));
    }
    for (const button of body.querySelectorAll('[data-remove-allergy]')) {
      button.addEventListener('click', async () => {
        const ok = await ui.confirmDialog({
          title: 'Remove allergy record?',
          message: 'The allergy will no longer be flagged on this chart. The change is written to the audit trail.',
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!ok) return;
        try {
          await api.del(`/api/patients/${patientId}/allergies/${button.dataset.removeAllergy}`);
          ui.toastOk('Allergy removed.');
          await reloadChart();
        } catch (err) { ui.toastError(err.message); }
      });
    }
  }

  function vitalTile(label, value, abnormal = false) {
    return `<div>
      <div class="muted xs">${ui.esc(label)}</div>
      <div class="strong" style="font-size:16px;${abnormal ? 'color:var(--danger)' : ''}">${ui.esc(value)}</div>
    </div>`;
  }

  // =========================================================================
  // Visits
  // =========================================================================
  async function renderVisits() {
    const data = await api.get(`/api/visits?patientId=${patientId}&limit=100`);
    const visits = data.visits;
    const selectedId = state.openVisitId || (visits[0] ? visits[0].id : null);

    body.innerHTML = `
      <div class="grid--visits">
        <div class="col">
          <section class="card">
            <div class="card-head">
              <div class="grow"><h2>Visit history</h2><div class="muted xs">${visits.length} visit${visits.length === 1 ? '' : 's'} on record</div></div>
              ${session.can('visit.write') && !state.chart.stats.openVisit ? `<button class="btn btn--sm btn--primary" data-action="new-visit">New visit</button>` : ''}
            </div>
            ${visits.length ? `
              <div class="visit-list">
                ${visits.map((v) => `
                  <button type="button" class="visit-row ${Number(selectedId) === v.id ? 'is-selected' : ''}" data-visit="${v.id}">
                    <div class="visit-row__top">
                      <span class="mono xs">${ui.esc(v.visitNo)}</span>
                      ${ui.statusPill(v.status)}
                    </div>
                    <div class="visit-row__meta">${ui.esc(ui.fmtDate(v.createdAt, { short: true }))} · ${ui.esc(ui.visitTypeLabel(v.visitType))}${v.doctorName ? ` · ${ui.esc(v.doctorName)}` : ''}</div>
                    ${v.chiefComplaint ? `<div class="visit-row__note">${ui.esc(v.chiefComplaint)}</div>` : ''}
                  </button>`).join('')}
              </div>`
              : `<div class="card-body">${ui.emptyState({
                  iconName: 'stethoscope', title: 'No visits yet',
                  message: 'Open a visit to record vitals, notes, diagnoses and prescriptions.',
                  action: session.can('visit.write') ? '<button class="btn btn--sm btn--primary" data-action="new-visit">Start a visit</button>' : '',
                })}</div>`}
          </section>
        </div>
        <div id="visit-detail"></div>
      </div>
    `;

    for (const row of body.querySelectorAll('[data-visit]')) {
      row.addEventListener('click', () => {
        state.openVisitId = Number(row.dataset.visit);
        history.replaceState(null, '', `#/patients/${patientId}?tab=visits&visit=${state.openVisitId}`);
        for (const other of body.querySelectorAll('[data-visit]')) {
          other.classList.toggle('is-selected', other.dataset.visit === row.dataset.visit);
        }
        renderVisitDetail(Number(row.dataset.visit));
      });
    }
    for (const button of body.querySelectorAll('[data-action="new-visit"]')) {
      button.addEventListener('click', () => openNewVisitForm(patientId, (visit) => {
        state.openVisitId = visit.id;
        state.chart.stats.openVisit = { id: visit.id, visit_no: visit.visitNo };
        ui.toastOk(`Visit ${visit.visitNo} opened.`);
        renderTab();
      }));
    }

    if (selectedId) await renderVisitDetail(selectedId);
    else document.getElementById('visit-detail').innerHTML = '';
  }

  async function renderVisitDetail(visitId) {
    const host = document.getElementById('visit-detail');
    if (!host) return;
    host.innerHTML = `<div class="card"><div class="card-body">${ui.loadingRow()}</div></div>`;
    let detail;
    try {
      detail = await api.get(`/api/visits/${visitId}`);
    } catch (err) {
      host.innerHTML = `<div class="card"><div class="card-body"><div class="alert alert--danger">${ui.icon('alert')}<div>${ui.esc(err.message)}</div></div></div></div>`;
      return;
    }
    const v = detail.visit;
    const isOpen = v.status === 'open';
    const me = session.user?.id;
    // Doctors write only to visits assigned to them, and only while open (SW-11).
    const isMine = v.doctorId === me;
    const canClinical = session.can('clinical.write') && isMine && isOpen;
    const live = (rows) => (rows || []).filter((r) => !r.cancelledAt);
    const cancelledLine = (r) => r.cancelledAt
      ? `<div class="xs cancel-note">Cancelled${r.cancelledByName ? ` by ${ui.esc(r.cancelledByName)}` : ''} · ${ui.esc(ui.fmtDateTime(r.cancelledAt))} — ${ui.esc(r.cancelReason || '')}</div>`
      : '';

    host.innerHTML = `
      <div class="col">
        <section class="card">
          <div class="card-head">
            <div class="grow">
              <h2>${ui.esc(v.visitNo)}</h2>
              <div class="muted xs">${ui.esc(ui.visitTypeLabel(v.visitType))} · ${ui.esc(ui.fmtDateTime(v.createdAt))} · ${ui.esc(v.doctorName || 'No doctor assigned')}</div>
            </div>
            ${ui.statusPill(v.status)}
          </div>
          <div class="card-body">
            <div class="field mb-2">
              <span class="label">Chief complaint</span>
              <div class="sm">${ui.esc(v.chiefComplaint || 'Not recorded')}</div>
            </div>
            ${v.outcome || v.dischargeSummary ? `
              <div class="field mb-2">
                <span class="label">Outcome</span>
                <div class="sm">${ui.esc(v.outcome || '—')}${v.followUpDate ? ` · follow-up ${ui.esc(ui.fmtDate(v.followUpDate))}` : ''}</div>
                ${v.dischargeSummary ? `<div class="sm" style="white-space:pre-wrap">${ui.esc(v.dischargeSummary)}</div>` : ''}
              </div>` : ''}
            ${(detail.vitals || []).length ? `
              <div class="section-title mb-1">Vitals (${(detail.vitals || []).length})</div>
              <div class="table-wrap mb-2"><table class="table table--compact">
                <thead><tr><th>Recorded</th><th>Temp</th><th>Pulse</th><th>BP</th><th>SpO₂</th><th>By</th></tr></thead>
                <tbody>${(detail.vitals || []).map((vt) => `
                  <tr>
                    <td class="nowrap">${ui.esc(ui.fmtDateTime(vt.recordedAt))}</td>
                    <td>${vt.temperatureC ?? '—'}</td>
                    <td>${vt.pulseBpm ?? '—'}</td>
                    <td>${vt.bpSystolic ? `${vt.bpSystolic}/${vt.bpDiastolic}` : '—'}</td>
                    <td>${vt.spo2 ?? '—'}</td>
                    <td class="muted xs">${ui.esc(vt.recordedByName || '—')}</td>
                  </tr>`).join('')}</tbody>
              </table></div>` : ''}
            ${session.can('vitals.write') && canClinical
              ? `<button class="btn btn--sm" data-action="add-vitals">${ui.icon('plus', 14)}<span>Record vitals</span></button>`
              : ''}
            ${session.can('clinical.write') && isOpen && !isMine
              ? `<div class="muted xs mt-1">${v.doctorId ? `Only ${ui.esc(v.doctorName || 'the assigned doctor')} can change this visit's clinical record.` : 'No doctor is assigned to this visit yet.'}</div>`
              : ''}
          </div>
          ${canClinical ? `<div class="card-foot row row--wrap" style="gap:8px">
              <button class="btn btn--sm" data-action="add-note">${ui.icon('clipboard', 14)}<span>Add note</span></button>
              <button class="btn btn--sm" data-action="add-diagnosis">${ui.icon('stethoscope', 14)}<span>Diagnosis</span></button>
              <button class="btn btn--sm" data-action="add-rx">${ui.icon('pill', 14)}<span>Prescribe</span></button>
              <button class="btn btn--sm" style="margin-left:auto" data-action="close-visit">Close visit</button>
          </div>` : ''}
        </section>

        ${session.can('clinical.read') ? `
          <section class="card">
            <div class="card-head"><h2>Diagnoses</h2></div>
            <div class="card-body">
              ${detail.diagnoses?.length ? `<div class="stack-sm">
                ${detail.diagnoses.map((d) => `
                  <div class="${d.cancelledAt ? 'is-cancelled' : ''}">
                    <div class="row" style="gap:8px">
                      ${d.code ? `<span class="pill pill--muted mono">${ui.esc(d.code)}</span>` : ''}
                      <span class="sm strong strike">${ui.esc(d.description)}</span>
                      <span class="muted xs">${ui.esc(ui.titleCase(d.kind))}</span>
                      ${canClinical && !d.cancelledAt ? `<button class="btn btn--sm btn--ghost" style="margin-left:auto" data-cancel-diagnosis="${d.id}">Cancel</button>` : ''}
                    </div>
                    ${cancelledLine(d)}
                  </div>`).join('')}
              </div>` : '<div class="muted sm">No diagnosis recorded for this visit.</div>'}
            </div>
          </section>

          <section class="card">
            <div class="card-head">
              <div class="grow"><h2>Prescriptions</h2></div>
              ${live(detail.prescriptions).length ? '<button class="btn btn--sm" data-action="print-rx">Print</button>' : ''}
            </div>
            <div class="card-body">
              ${detail.prescriptions?.length ? `<div class="stack-sm">
                ${detail.prescriptions.map((rx) => `
                  <div class="${rx.cancelledAt ? 'is-cancelled' : ''}">
                    <div class="row" style="gap:8px;align-items:flex-start">
                      <span class="grow">
                        <span class="sm strong strike">${ui.esc(rx.drugName)} ${ui.esc(rx.strength || '')}</span>
                        <div class="muted xs">
                          ${[rx.dose, rx.frequency, rx.route, rx.durationDays ? `${rx.durationDays} days` : null].filter(Boolean).map(ui.esc).join(' · ') || '—'}
                          ${rx.instructions ? ` · ${ui.esc(rx.instructions)}` : ''}
                        </div>
                      </span>
                      ${canClinical && !rx.cancelledAt ? `<button class="btn btn--sm btn--ghost" data-cancel-rx="${rx.id}">Cancel</button>` : ''}
                    </div>
                    ${cancelledLine(rx)}
                  </div>`).join('')}
              </div>` : '<div class="muted sm">No medicines prescribed yet.</div>'}
            </div>
          </section>

          <section class="card">
            <div class="card-head"><h2>Clinical notes</h2></div>
            <div class="card-body">
              ${detail.notes?.length ? `<div class="col" style="gap:14px">
                ${detail.notes.map((n) => `
                  <article class="${n.cancelledAt ? 'is-cancelled' : ''}" style="border-left:2px solid var(--line); padding-left:12px">
                    <div class="row" style="gap:8px">
                      <span class="pill pill--muted">${ui.esc(ui.titleCase(n.noteType))}</span>
                      ${n.cancelledAt ? '<span class="pill pill--danger">Cancelled</span>' : n.signedAt ? '<span class="pill pill--ok">Signed</span>' : '<span class="pill pill--warn">Draft</span>'}
                      <span class="muted xs">${ui.esc(n.authorName || '—')} · ${ui.esc(ui.fmtDateTime(n.createdAt))}</span>
                      ${session.can('clinical.write') && n.authorId === me && !n.signedAt && !n.cancelledAt ? `
                        <span class="row" style="gap:6px;margin-left:auto">
                          <button class="btn btn--sm btn--ghost" data-cancel-note="${n.id}">Cancel draft</button>
                          <button class="btn btn--sm" data-sign-note="${n.id}">Sign</button>
                        </span>` : ''}
                    </div>
                    ${n.subject ? `<div class="sm strong mt-1 strike">${ui.esc(n.subject)}</div>` : ''}
                    <div class="sm strike" style="white-space:pre-wrap;margin-top:4px">${ui.esc(n.body)}</div>
                    ${cancelledLine(n)}
                  </article>`).join('')}
              </div>` : '<div class="muted sm">No notes written for this visit.</div>'}
            </div>
          </section>` : `<div class="card"><div class="card-body muted sm">Clinical content (vitals, notes, diagnoses, prescriptions) is not visible to your role.</div></div>`}
      </div>
    `;

    // wiring
    host.querySelector('[data-action="add-vitals"]')?.addEventListener('click', () => openVitalsForm(visitId, () => renderVisitDetail(visitId)));
    host.querySelector('[data-action="add-note"]')?.addEventListener('click', () => openNoteForm(visitId, () => renderVisitDetail(visitId)));
    host.querySelector('[data-action="add-diagnosis"]')?.addEventListener('click', () => openDiagnosisForm(visitId, () => renderVisitDetail(visitId)));
    host.querySelector('[data-action="add-rx"]')?.addEventListener('click', () => openPrescriptionForm(visitId, () => renderVisitDetail(visitId)));
    host.querySelector('[data-action="close-visit"]')?.addEventListener('click', () => closeVisit(visitId, v));
    host.querySelector('[data-action="print-rx"]')?.addEventListener('click', () => printPrescription(detail));

    for (const button of host.querySelectorAll('[data-sign-note]')) {
      button.addEventListener('click', async () => {
        const ok = await ui.confirmDialog({
          title: 'Sign this note?',
          message: 'Signed notes become read-only and can never be changed or withdrawn.',
          confirmLabel: 'Sign note',
        });
        if (!ok) return;
        try {
          await api.post(`/api/notes/${button.dataset.signNote}/sign`, {});
          ui.toastOk('Note signed.');
          renderVisitDetail(visitId);
        } catch (err) { ui.toastError(err.message); }
      });
    }

    // Nothing clinical is deleted: an entry is cancelled with a reason and stays
    // visible, struck through, on the record (SW-12).
    const cancelWithReason = async (title, url, done) => {
      const reason = await ui.confirmDialog({
        title,
        message: 'The entry stays on the record, struck through, with your reason. This cannot be undone.',
        confirmLabel: 'Cancel entry',
        cancelLabel: 'Keep it',
        danger: true,
        requireReason: 'Reason',
      });
      if (!reason) return;
      try {
        await api.post(url, { reason });
        ui.toastOk(done);
        renderVisitDetail(visitId);
      } catch (err) { ui.toastError(err.message); }
    };
    for (const button of host.querySelectorAll('[data-cancel-diagnosis]')) {
      button.addEventListener('click', () => cancelWithReason('Cancel this diagnosis?',
        `/api/visits/${visitId}/diagnoses/${button.dataset.cancelDiagnosis}/cancel`, 'Diagnosis cancelled.'));
    }
    for (const button of host.querySelectorAll('[data-cancel-rx]')) {
      button.addEventListener('click', () => cancelWithReason('Cancel this medicine?',
        `/api/visits/${visitId}/prescriptions/${button.dataset.cancelRx}/cancel`, 'Medicine cancelled.'));
    }
    for (const button of host.querySelectorAll('[data-cancel-note]')) {
      button.addEventListener('click', () => cancelWithReason('Cancel this draft note?',
        `/api/notes/${button.dataset.cancelNote}/cancel`, 'Draft note cancelled.'));
    }
  }

  async function closeVisit(visitId, visit) {
    const handle = ui.modal({
      title: `Close visit ${visit.visitNo}`,
      subtitle: 'Record the outcome and any follow-up before closing.',
      width: 'narrow',
      body: `<form id="close-visit" class="col">
        <div class="field">
          <label for="cv-outcome">Outcome</label>
          <select class="select" id="cv-outcome" name="outcome">
            <option value="Discharged">Discharged</option>
            <option value="Referred">Referred to another facility</option>
            <option value="Admitted">Admitted as in-patient</option>
            <option value="Follow-up advised">Follow-up advised</option>
          </select>
        </div>
        <div class="field">
          <label for="cv-followup">Follow-up date</label>
          <input class="input" id="cv-followup" name="followUpDate" type="date">
        </div>
        <div class="field">
          <label for="cv-summary">Discharge / closing summary</label>
          <textarea class="textarea" id="cv-summary" name="dischargeSummary" placeholder="Optional summary visible on the visit record"></textarea>
        </div>
        <div class="alert alert--warn">${ui.icon('info')}<div class="xs">After closing, this visit cannot be edited. A new visit can be opened for the next consultation.</div></div>
      </form>`,
      footer: `<button class="btn" type="button" data-close>Cancel</button>
               <button class="btn btn--primary" type="button" data-save>Close visit</button>`,
    });
    const form = handle.dialog.querySelector('#close-visit');
    const button = handle.dialog.querySelector('[data-save]');
    button.addEventListener('click', async () => {
      ui.setBusy(button, true, 'Closing…');
      try {
        await api.post(`/api/visits/${visitId}/close`, ui.formValues(form));
        ui.toastOk('Visit closed.');
        handle.close();
        state.chart.stats.openVisit = null;
        renderTab();
      } catch (err) {
        ui.toastError(err.message);
      } finally {
        ui.setBusy(button, false);
      }
    });
  }

  // =========================================================================
  // Notes / vitals / medications
  // =========================================================================
  async function renderNotes() {
    const data = await api.get(`/api/visits?patientId=${patientId}&limit=100`);
    const results = await Promise.all(
      data.visits.slice(0, 20).map((v) => api.get(`/api/visits/${v.id}`).catch(() => null)),
    );
    const notes = [];
    for (const detail of results) {
      if (!detail || !detail.notes) continue;
      for (const note of detail.notes) notes.push({ ...note, visitNo: detail.visit.visitNo, visitId: detail.visit.id });
    }
    notes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    body.innerHTML = `
      <section class="card">
        <div class="card-head">
          <div class="grow"><h2>Clinical notes</h2><div class="muted xs">${notes.length} note${notes.length === 1 ? '' : 's'} across recent visits</div></div>
        </div>
        ${notes.length ? `<div class="card-body col" style="gap:16px">
          ${notes.map((n) => `
            <article style="border-left:2px solid var(--line);padding-left:12px">
              <div class="row row--wrap" style="gap:8px">
                <span class="pill pill--muted">${ui.esc(ui.titleCase(n.noteType))}</span>
                ${n.cancelledAt ? '<span class="pill pill--danger">Cancelled</span>' : n.signedAt ? '<span class="pill pill--ok">Signed</span>' : '<span class="pill pill--warn">Draft</span>'}
                <a class="xs" href="#/patients/${patientId}?tab=visits&visit=${n.visitId}">${ui.esc(n.visitNo)}</a>
                <span class="muted xs">${ui.esc(n.authorName || '—')} · ${ui.esc(ui.fmtDateTime(n.createdAt))}</span>
              </div>
              ${n.subject ? `<div class="sm strong mt-1">${ui.esc(n.subject)}</div>` : ''}
              <div class="sm" style="white-space:pre-wrap;margin-top:4px">${ui.esc(n.body)}</div>
            </article>`).join('')}
        </div>` : `<div class="card-body">${ui.emptyState({ iconName: 'clipboard', title: 'No clinical notes', message: 'Notes are written from within a visit.' })}</div>`}
      </section>`;
  }

  async function renderVitals() {
    const data = await api.get(`/api/vitals?patientId=${patientId}`);
    const rows = data.vitals;
    body.innerHTML = `
      <section class="card">
        <div class="card-head">
          <div class="grow"><h2>Vitals history</h2><div class="muted xs">${rows.length} record${rows.length === 1 ? '' : 's'}</div></div>
          ${session.can('vitals.write') && state.chart.stats.openVisit && state.chart.stats.openVisit.doctor_id === session.user?.id ? `<button class="btn btn--sm btn--primary" data-action="add-vitals">Record vitals</button>` : ''}
        </div>
        ${rows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Recorded</th><th>Temp °C</th><th>Pulse</th><th>Resp</th><th>BP</th><th>SpO₂</th><th>Weight</th><th>Pain</th><th>By</th></tr></thead>
          <tbody>${rows.map((v) => `
            <tr>
              <td class="nowrap">${ui.esc(ui.fmtDateTime(v.recordedAt))}</td>
              <td class="${v.temperatureC > 37.9 ? 'money--due' : ''}">${v.temperatureC ?? '—'}</td>
              <td>${v.pulseBpm ?? '—'}</td>
              <td>${v.respRate ?? '—'}</td>
              <td>${v.bpSystolic ? `${v.bpSystolic}/${v.bpDiastolic}` : '—'}</td>
              <td>${v.spo2 ?? '—'}</td>
              <td>${v.weightKg ?? '—'}</td>
              <td>${v.painScore ?? '—'}</td>
              <td class="muted xs">${ui.esc(v.recordedByName || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : `<div class="card-body">${ui.emptyState({ iconName: 'activity', title: 'No vitals recorded yet', message: state.chart.stats.openVisit ? 'Record vitals for the open visit.' : 'Vitals are recorded during a visit.' })}</div>`}
      </section>`;
    body.querySelector('[data-action="add-vitals"]')?.addEventListener('click', () => openVitalsForm(state.chart.stats.openVisit.id, () => renderTab()));
  }

  async function renderMedications() {
    const data = await api.get(`/api/patients/${patientId}/prescriptions`);
    const rows = data.prescriptions;
    body.innerHTML = `
      <section class="card">
        <div class="card-head"><div class="grow"><h2>Medication history</h2><div class="muted xs">${rows.length} prescription${rows.length === 1 ? '' : 's'}</div></div></div>
        ${rows.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Medicine</th><th>Dose / frequency</th><th>Duration</th><th>Prescribed</th><th>Visit</th><th>By</th></tr></thead>
          <tbody>${rows.map((r) => `
            <tr class="${r.cancelledAt ? 'is-cancelled' : ''}" title="${r.cancelledAt ? ui.esc(`Cancelled: ${r.cancelReason || ''}`) : ''}">
              <td class="cell-main"><span class="strike">${ui.esc(r.drugName)} <span class="muted">${ui.esc(r.strength || '')}</span></span>${r.cancelledAt ? ' <span class="pill pill--danger">Cancelled</span>' : ''}</td>
              <td>${[r.dose, r.frequency, r.route].filter(Boolean).map(ui.esc).join(' · ') || '—'}</td>
              <td>${r.durationDays ? `${r.durationDays} days` : '—'}</td>
              <td class="nowrap">${ui.esc(ui.fmtDate(r.createdAt, { short: true }))}</td>
              <td class="mono muted">${ui.esc(r.visitNo || '—')}</td>
              <td class="muted">${ui.esc(r.prescribedByName || '—')}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : `<div class="card-body">${ui.emptyState({ iconName: 'pill', title: 'No prescriptions yet', message: 'Medicines prescribed during a visit appear here.' })}</div>`}
      </section>`;
  }

  // =========================================================================
  // Documents
  // =========================================================================
  async function renderDocuments() {
    const data = await api.get(`/api/patients/${patientId}/attachments`);
    const canWrite = session.can('attachment.write');
    body.innerHTML = `
      <div class="grid grid--sidebar">
        <section class="card">
          <div class="card-head"><div class="grow"><h2>Documents</h2><div class="muted xs">Scans, lab reports and consent forms</div></div></div>
          <div class="card-body">
            ${data.attachments.length ? data.attachments.map((a) => `
              <div class="file-row">
                <span class="file-ico">${ui.icon(a.mimeType === 'application/pdf' ? 'file' : 'eye', 15)}</span>
                <span class="grow">
                  <span class="strong sm">${ui.esc(a.title || a.originalName)}</span>
                  <div class="muted xs">${ui.esc(ui.titleCase(a.category))} · ${ui.esc(ui.bytes(a.sizeBytes))} · ${ui.esc(a.uploadedByName || '—')} · ${ui.esc(ui.fmtDateTime(a.createdAt))}</div>
                </span>
                <button class="btn btn--sm" data-download="${a.id}" data-name="${ui.esc(a.originalName)}">${ui.icon('download', 14)}<span>Open</span></button>
                ${canWrite ? `<button class="icon-btn" data-delete-doc="${a.id}" title="Remove">${ui.icon('trash', 15)}</button>` : ''}
              </div>`).join('') : ui.emptyState({
                iconName: 'file', title: 'No documents', message: 'Upload scans, lab reports or signed consent forms.',
              })}
          </div>
        </section>

        ${canWrite ? `
        <section class="card">
          <div class="card-head"><h2>Upload a document</h2></div>
          <div class="card-body col">
            <div class="field">
              <label for="doc-category">Category</label>
              <select class="select" id="doc-category">
                <option value="lab">Laboratory report</option>
                <option value="imaging">Imaging / scan</option>
                <option value="consent">Consent form</option>
                <option value="referral">Referral letter</option>
                <option value="insurance">Insurance / TPA</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div class="field">
              <label for="doc-title">Title (optional)</label>
              <input class="input" id="doc-title" placeholder="e.g. CBC — 9 Nov">
            </div>
            <div class="dropzone" id="doc-drop">
              ${ui.icon('upload', 20)}
              <div class="mt-1"><strong>Click to choose a file</strong> or drag it here</div>
              <div class="xs">PDF or image, up to 25 MB</div>
              <input type="file" id="doc-file" accept="application/pdf,image/*,.tif,.tiff" hidden>
            </div>
            <div id="doc-progress" class="hidden">
              <div class="row"><span class="spinner"></span><span class="sm">Encrypting and uploading…</span></div>
            </div>
            <div class="alert alert--info">${ui.icon('lock')}<div class="xs">Documents are encrypted before they are written to the server disk. Every download is recorded in the audit trail.</div></div>
          </div>
        </section>` : ''}
      </div>
    `;

    for (const button of body.querySelectorAll('[data-download]')) {
      button.addEventListener('click', async () => {
        try {
          await api.download(`/api/attachments/${button.dataset.download}?view=1`, button.dataset.name);
        } catch (err) { ui.toastError(err.message); }
      });
    }
    for (const button of body.querySelectorAll('[data-delete-doc]')) {
      button.addEventListener('click', async () => {
        const reason = await ui.confirmDialog({
          title: 'Remove this document?',
          message: 'It will no longer be available in the chart. Keep a copy if it may be needed later.',
          confirmLabel: 'Remove document',
          danger: true,
        });
        if (!reason) return;
        try {
          await api.del(`/api/attachments/${button.dataset.deleteDoc}`);
          ui.toastOk('Document removed.');
          renderTab();
        } catch (err) { ui.toastError(err.message); }
      });
    }

    const drop = body.querySelector('#doc-drop');
    const fileInput = body.querySelector('#doc-file');
    if (drop && fileInput) {
      drop.addEventListener('click', () => fileInput.click());
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('is-over');
        if (e.dataTransfer.files.length) upload(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', () => { if (fileInput.files.length) upload(fileInput.files[0]); });
    }

    async function upload(file) {
      const progress = body.querySelector('#doc-progress');
      progress.classList.remove('hidden');
      try {
        await api.uploadDocument(patientId, file, {
          category: body.querySelector('#doc-category').value,
          title: body.querySelector('#doc-title').value,
        });
        ui.toastOk('Document uploaded.');
        renderTab();
      } catch (err) {
        ui.toastError(err.message);
        progress.classList.add('hidden');
      }
    }
  }

  // =========================================================================
  // Billing
  // =========================================================================
  async function renderBilling() {
    const data = await api.get(`/api/invoices?patientId=${patientId}&limit=50`);
    body.innerHTML = `
      <section class="card">
        <div class="card-head">
          <div class="grow"><h2>Invoices</h2><div class="muted xs">${data.total} invoice${data.total === 1 ? '' : 's'} · ${ui.inr(data.summary.billedPaise)} billed</div></div>
          ${session.can('invoice.write') ? `<button class="btn btn--sm btn--primary" data-action="invoice">New invoice</button>` : ''}
        </div>
        ${data.invoices.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Invoice</th><th>Date</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Balance</th><th class="right">Status</th></tr></thead>
          <tbody>${data.invoices.map((inv) => `
            <tr class="is-clickable" data-href="#/billing/${inv.id}">
              <td class="mono">${ui.esc(inv.invoiceNo)}</td>
              <td class="nowrap">${ui.esc(ui.fmtDate(inv.createdAt, { short: true }))}</td>
              <td class="right money">${ui.inr(inv.totalPaise)}</td>
              <td class="right money">${ui.inr(inv.paidPaise)}</td>
              <td class="right money ${inv.balancePaise > 0 ? 'money--due' : ''}">${ui.inr(inv.balancePaise)}</td>
              <td class="right">${ui.statusPill(inv.status)}</td>
            </tr>`).join('')}</tbody>
        </table></div>` : `<div class="card-body">${ui.emptyState({ iconName: 'receipt', title: 'No invoices', message: 'Bills raised for this patient will be listed here.' })}</div>`}
      </section>`;
    for (const row of body.querySelectorAll('[data-href]')) {
      row.addEventListener('click', () => { location.hash = row.dataset.href; });
    }
    body.querySelector('[data-action="invoice"]')?.addEventListener('click', () => {
      location.hash = `#/billing?patient=${patientId}`;
    });
  }

  // =========================================================================
  // Timeline
  // =========================================================================
  async function renderTimeline() {
    const data = await api.get(`/api/patients/${patientId}/timeline`);
    const ICONS = { visit: 'stethoscope', note: 'clipboard', diagnosis: 'activity', document: 'file', invoice: 'receipt' };
    body.innerHTML = `
      <section class="card">
        <div class="card-head"><div class="grow"><h2>Timeline</h2><div class="muted xs">Everything that has happened on this record</div></div></div>
        <div class="card-body">
          ${data.events.length ? `<div class="timeline">
            ${data.events.map((e) => `
              <div class="tl-item">
                <div class="tl-when">${ui.esc(ui.fmtDateTime(e.at))}</div>
                <div class="tl-title">
                  <span class="muted" style="display:inline-block;vertical-align:-2px;margin-right:5px">${ui.icon(ICONS[e.type] || 'file', 14)}</span>
                  ${ui.esc(e.title)}
                  ${e.status ? ui.statusPill(e.status) : ''}
                </div>
                ${e.subtitle ? `<div class="tl-sub">${ui.esc(e.subtitle)}</div>` : ''}
              </div>`).join('')}
          </div>` : ui.emptyState({ iconName: 'clock', title: 'Nothing recorded yet', message: 'Visits, notes, documents and bills will appear here.' })}
        </div>
      </section>`;
  }

  // =========================================================================
  // Header actions
  // =========================================================================
  root.querySelector('[data-action="edit"]')?.addEventListener('click', () => {
    openPatientForm({
      patient: state.patient,
      onSaved: () => {
        render();
      },
    });
  });
  root.querySelector('[data-action="new-visit"]')?.addEventListener('click', () => {
    openNewVisitForm(patientId, (visit) => {
      ui.toastOk(`Visit ${visit.visitNo} opened.`);
      state.openVisitId = visit.id;
      state.tab = 'visits';
      render();
    });
  });
  root.querySelector('[data-action="open-visit"]')?.addEventListener('click', () => {
    state.openVisitId = state.chart.stats.openVisit.id;
    setTab('visits');
  });
  root.querySelector('[data-action="book"]')?.addEventListener('click', () => openAppointmentForm(patientId, patient));
  root.querySelector('[data-action="invoice"]')?.addEventListener('click', () => {
    location.hash = `#/billing?patient=${patientId}`;
  });

  for (const button of root.querySelectorAll('[data-tab]')) {
    button.addEventListener('click', () => setTab(button.dataset.tab));
  }

  async function refreshThen(fn) {
    await fn();
  }

  await renderTab();

  // =========================================================================
  // Modal forms
  // =========================================================================
  function simpleForm({ title, subtitle, fields, submitLabel, onSubmit, width = 'narrow', extraAlert = '' }) {
    const bodyHtml = fields.map((f) => {
      if (f.type === 'select') {
        return `<div class="field ${f.span ? `span-${f.span}` : ''}">
          <label for="m-${f.name}">${ui.esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
          <select class="select" id="m-${f.name}" name="${f.name}" ${f.required ? 'required' : ''}>
            ${f.options.map((o) => {
              const val = typeof o === 'string' ? o : o.value;
              const label = typeof o === 'string' ? o : o.label;
              return `<option value="${ui.esc(val)}">${ui.esc(label)}</option>`;
            }).join('')}
          </select>
          <div class="field-error hidden" data-error-for="${f.name}"></div>
        </div>`;
      }
      const control = f.type === 'textarea'
        ? `<textarea class="textarea" id="m-${f.name}" name="${f.name}" placeholder="${ui.esc(f.placeholder || '')}"></textarea>`
        : `<input class="input" id="m-${f.name}" name="${f.name}" type="${f.type || 'text'}"
             placeholder="${ui.esc(f.placeholder || '')}" ${f.required ? 'required' : ''}
             ${f.value !== undefined ? `value="${ui.esc(f.value)}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
      return `<div class="field ${f.span ? `span-${f.span}` : ''}">
        <label for="m-${f.name}">${ui.esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>
        ${control}
        ${f.hint ? `<div class="hint">${ui.esc(f.hint)}</div>` : ''}
        <div class="field-error hidden" data-error-for="${f.name}"></div>
      </div>`;
    }).join('');

    const handle = ui.modal({
      title,
      subtitle,
      width,
      body: `<form id="modal-form" class="col" novalidate>
        ${extraAlert}
        <div class="${fields.length > 2 ? 'form-grid' : 'col'}" style="gap:14px">${bodyHtml}</div>
        <div id="modal-form-error" class="alert alert--danger hidden"></div>
      </form>`,
      footer: `<button class="btn" type="button" data-close>Cancel</button>
               <button class="btn btn--primary" type="button" data-save>${ui.esc(submitLabel)}</button>`,
    });
    const form = handle.dialog.querySelector('#modal-form');
    const errorBox = handle.dialog.querySelector('#modal-form-error');
    const saveButton = handle.dialog.querySelector('[data-save]');
    saveButton.addEventListener('click', async () => {
      errorBox.classList.add('hidden');
      ui.setBusy(saveButton, true, 'Saving…');
      try {
        await onSubmit(ui.formValues(form), { close: handle.close, form });
        handle.close();
      } catch (err) {
        if (err.details) ui.applyFieldErrors(form, err.details);
        else {
          errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
          errorBox.classList.remove('hidden');
        }
      } finally {
        ui.setBusy(saveButton, false);
      }
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        saveButton.click();
      }
    });
    return handle;
  }

  function openNewVisitForm(pid, onCreated) {
    const doctors = state.doctors || [];
    simpleForm({
      title: 'Start a visit',
      subtitle: `Opening a new visit for ${patient.fullName}`,
      fields: [
        { name: 'visitType', label: 'Visit type', type: 'select', options: [
          { value: 'opd', label: 'OPD consultation' },
          { value: 'follow_up', label: 'Follow-up' },
          { value: 'emergency', label: 'Emergency' },
          { value: 'ipd', label: 'In-patient (IPD)' },
          { value: 'teleconsult', label: 'Teleconsultation' },
        ], required: true },
        { name: 'department', label: 'Department', type: 'select', options: [
          'General Medicine', 'Cardiology', 'Orthopaedics', 'Paediatrics', 'Gynaecology',
          'Dermatology', 'ENT', 'Ophthalmology', 'Dentistry', 'Emergency', 'Other',
        ] },
        { name: 'doctorId', label: 'Consulting doctor', type: 'select', options: doctors.length
          ? doctors.map((d) => ({ value: String(d.id), label: `${d.fullName}${d.specialty ? ` — ${d.specialty}` : ''}` }))
          : [{ value: '', label: 'No doctors on staff yet' }] },
        { name: 'chiefComplaint', label: 'Chief complaint', type: 'textarea', span: '2', placeholder: 'What brings the patient in today?' },
      ],
      submitLabel: 'Open visit',
      onSubmit: async (values) => {
        const res = await api.post('/api/visits', { patientId: pid, ...values });
        onCreated(res.visit);
      },
    });
  }

  function openVitalsForm(visitId, onDone) {
    simpleForm({
      title: 'Record vitals',
      subtitle: 'Enter any measurements you have — at least one is required.',
      width: 'wide',
      fields: [
        { name: 'temperatureC', label: 'Temperature (°C)', type: 'number', step: '0.1' },
        { name: 'pulseBpm', label: 'Pulse (bpm)', type: 'number' },
        { name: 'respRate', label: 'Respiratory rate (/min)', type: 'number' },
        { name: 'bpSystolic', label: 'BP systolic', type: 'number' },
        { name: 'bpDiastolic', label: 'BP diastolic', type: 'number' },
        { name: 'spo2', label: 'SpO₂ (%)', type: 'number' },
        { name: 'weightKg', label: 'Weight (kg)', type: 'number', step: '0.1' },
        { name: 'heightCm', label: 'Height (cm)', type: 'number', step: '0.1' },
        { name: 'painScore', label: 'Pain score (0–10)', type: 'number' },
        { name: 'notes', label: 'Notes', type: 'textarea', span: '2' },
      ],
      submitLabel: 'Save vitals',
      onSubmit: async (values) => {
        await api.post(`/api/visits/${visitId}/vitals`, values);
        ui.toastOk('Vitals recorded.');
        onDone();
      },
    });
  }

  function openNoteForm(visitId, onDone) {
    simpleForm({
      title: 'Add clinical note',
      subtitle: 'Notes are signed separately and become read-only once signed.',
      width: 'wide',
      fields: [
        { name: 'noteType', label: 'Note type', type: 'select', options: [
          { value: 'consultation', label: 'Consultation' },
          { value: 'progress', label: 'Progress' },
          { value: 'nursing', label: 'Nursing' },
          { value: 'procedure', label: 'Procedure' },
          { value: 'discharge', label: 'Discharge' },
          { value: 'other', label: 'Other' },
        ], required: true },
        { name: 'subject', label: 'Subject', placeholder: 'e.g. Initial assessment' },
        { name: 'body', label: 'Note', type: 'textarea', span: '2', required: true, placeholder: 'History, examination findings, assessment and plan…' },
      ],
      submitLabel: 'Save note',
      onSubmit: async (values) => {
        await api.post(`/api/visits/${visitId}/notes`, values);
        ui.toastOk('Note saved as draft.');
        onDone();
      },
    });
  }

  function openDiagnosisForm(visitId, onDone) {
    simpleForm({
      title: 'Add diagnosis',
      fields: [
        { name: 'description', label: 'Diagnosis', required: true, placeholder: 'e.g. Acute viral pharyngitis' },
        { name: 'code', label: 'ICD-10 code', placeholder: 'e.g. J02.9' },
        { name: 'kind', label: 'Type', type: 'select', options: [
          { value: 'primary', label: 'Primary' },
          { value: 'secondary', label: 'Secondary' },
          { value: 'provisional', label: 'Provisional' },
        ] },
      ],
      submitLabel: 'Add diagnosis',
      onSubmit: async (values) => {
        await api.post(`/api/visits/${visitId}/diagnoses`, values);
        ui.toastOk('Diagnosis added.');
        onDone();
      },
    });
  }

  function openPrescriptionForm(visitId, onDone) {
    simpleForm({
      title: 'Prescribe medicine',
      width: 'wide',
      fields: [
        { name: 'drugName', label: 'Medicine', required: true, placeholder: 'e.g. Amoxicillin' },
        { name: 'strength', label: 'Strength', placeholder: 'e.g. 500 mg' },
        { name: 'form', label: 'Form', type: 'select', options: ['tablet', 'capsule', 'syrup', 'injection', 'ointment', 'drops', 'inhaler', 'other'] },
        { name: 'dose', label: 'Dose', placeholder: 'e.g. 1 tablet' },
        { name: 'route', label: 'Route', type: 'select', options: ['oral', 'IV', 'IM', 'topical', 'inhalation', 'rectal', 'other'] },
        { name: 'frequency', label: 'Frequency', placeholder: 'e.g. 1-0-1, BD, TDS' },
        { name: 'durationDays', label: 'Duration (days)', type: 'number' },
        { name: 'instructions', label: 'Instructions', span: '2', placeholder: 'e.g. after food, complete the course' },
      ],
      submitLabel: 'Add to prescription',
      onSubmit: async (values) => {
        await api.post(`/api/visits/${visitId}/prescriptions`, values);
        ui.toastOk('Medicine added.');
        onDone();
      },
    });
  }

  function openAllergyForm(pid, onDone) {
    simpleForm({
      title: 'Record an allergy',
      fields: [
        { name: 'substance', label: 'Substance', required: true, placeholder: 'e.g. Penicillin' },
        { name: 'reaction', label: 'Reaction', placeholder: 'e.g. rash, swelling' },
        { name: 'severity', label: 'Severity', type: 'select', options: [
          { value: 'mild', label: 'Mild' },
          { value: 'moderate', label: 'Moderate' },
          { value: 'severe', label: 'Severe' },
          { value: 'life_threatening', label: 'Life threatening' },
        ] },
      ],
      submitLabel: 'Save allergy',
      extraAlert: `<div class="alert alert--warn">${ui.icon('alert')}<div class="xs">Severe allergies are shown as a red banner at the top of this chart.</div></div>`,
      onSubmit: async (values) => {
        await api.post(`/api/patients/${pid}/allergies`, values);
        ui.toastOk('Allergy recorded.');
        onDone();
      },
    });
  }

  function openAppointmentForm(pid, p) {
    simpleForm({
      title: 'Book an appointment',
      subtitle: `${p.fullName} · ${p.mrn}`,
      fields: [
        { name: 'date', label: 'Date', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
        { name: 'time', label: 'Time', type: 'time', required: true, value: '10:00' },
        { name: 'doctorId', label: 'Doctor', type: 'select', options: (state.doctors || []).length
          ? state.doctors.map((d) => ({ value: String(d.id), label: d.fullName }))
          : [{ value: '', label: 'No doctors on staff yet' }] },
        { name: 'durationMin', label: 'Duration (minutes)', type: 'number', value: 15 },
        { name: 'reason', label: 'Reason', span: '2', placeholder: 'e.g. review of lab reports' },
      ],
      submitLabel: 'Book appointment',
      onSubmit: async (values) => {
        const scheduledAt = new Date(`${values.date}T${values.time}:00`).toISOString();
        await api.post('/api/appointments', {
          patientId: pid,
          doctorId: values.doctorId || null,
          scheduledAt,
          durationMin: values.durationMin || 15,
          reason: values.reason,
        });
        ui.toastOk('Appointment booked.');
      },
    });
  }

  function printPrescription(detail) {
    const settings = session.settings || {};
    const v = detail.visit;
    const rows = (detail.prescriptions || []).filter((rx) => !rx.cancelledAt).map((rx, i) => `
      <div class="rx-line">
        <span>${i + 1}.</span>
        <span><strong>${ui.esc(rx.drugName)} ${ui.esc(rx.strength || '')}</strong>${rx.form ? ` <span class="muted">(${ui.esc(rx.form)})</span>` : ''}</span>
        <span>${ui.esc([rx.dose, rx.frequency, rx.route].filter(Boolean).join(' · '))}</span>
        <span>${rx.durationDays ? `${rx.durationDays} days` : ''} ${rx.instructions ? `<br><span class="muted">${ui.esc(rx.instructions)}</span>` : ''}</span>
      </div>`).join('');

    ui.printSheet({
      title: `Prescription · ${v.visitNo}`,
      subtitle: `${state.patient.fullName} · ${state.patient.mrn}`,
      filename: `prescription-${v.visitNo}`,
      html: `
        <div class="rx-sheet">
          <div class="receipt-head">
            <div>
              <div class="receipt-hospital">${ui.esc(settings.hospitalName || 'Kalyan Hospital')}</div>
              <div class="xs">${ui.esc(settings.hospitalAddress || '')}</div>
              <div class="xs">${ui.esc(settings.hospitalPhone || '')}</div>
            </div>
            <div class="receipt-meta">
              <div><strong>${ui.esc(state.patient.fullName)}</strong></div>
              <div>${ui.esc(state.patient.mrn)} · ${ui.esc(ui.fmtAge(state.patient.dob, state.patient.age))} · ${ui.esc(ui.sexLabel(state.patient.sex))}</div>
              <div>${ui.esc(ui.fmtDate(v.createdAt, { withTime: true }))}</div>
            </div>
          </div>
          <div class="mt-2 xs"><strong>Diagnosis:</strong> ${(detail.diagnoses || []).filter((d) => !d.cancelledAt).map((d) => ui.esc(d.description)).join('; ') || '—'}</div>
          <div class="rx-head mt-2"><span>#</span><span>Medicine</span><span>Dose / frequency</span><span>Duration</span></div>
          ${rows || '<div class="muted sm mt-2">No medicines prescribed.</div>'}
          <div class="receipt-foot">
            <div>${ui.esc(settings.disclaimer || '')}</div>
            <div style="text-align:right">
              <div style="height:34px"></div>
              <div style="border-top:1px solid #333;padding-top:3px">${ui.esc(v.doctorName || 'Prescriber')}</div>
            </div>
          </div>
        </div>`,
    });
  }
}
