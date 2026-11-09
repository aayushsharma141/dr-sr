/** Patient directory: search, filter, paginate, register. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';
import { openPatientForm } from './patient-form.js';

export default async function patientsView(root, { navigate, query }) {
  const state = {
    q: query.get('q') || '',
    page: Number(query.get('page') || 1) || 1,
    includeInactive: query.get('includeInactive') === 'true',
  };

  const load = async () => {
    const params = new URLSearchParams({
      limit: '20',
      page: String(state.page),
      ...(state.q ? { q: state.q } : {}),
      ...(state.includeInactive ? { includeInactive: 'true' } : {}),
    });
    return api.get(`/api/patients?${params.toString()}`);
  };

  const data = await load();
  const canWrite = session.can('patient.write');

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Patients</h1>
        <div class="sub">${state.q
          ? `${data.total} result${data.total === 1 ? '' : 's'} for “${ui.esc(state.q)}”`
          : `${data.total} patient record${data.total === 1 ? '' : 's'} in the clinic`}</div>
      </div>
      <div class="page-head-actions">
        ${canWrite ? `<button class="btn btn--primary" data-action="register">${ui.icon('userPlus')}<span>Register patient</span></button>` : ''}
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body row row--wrap" style="gap:10px">
        <div class="grow" style="min-width:240px">
          <input class="input" id="patient-search" type="search" placeholder="Search by name, MRN or phone…"
                 value="${ui.esc(state.q)}" autocomplete="off">
        </div>
        <label class="checkbox">
          <input type="checkbox" id="show-archived" ${state.includeInactive ? 'checked' : ''}>
          <span class="sm">Include archived records</span>
        </label>
        ${state.q ? '<button class="btn btn--sm" data-action="clear">Clear</button>' : ''}
      </div>
    </div>

    <div class="card">
      ${data.patients.length
        ? `<div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Age / Sex</th>
                  <th>Contact</th>
                  <th class="right">Visits</th>
                  ${session.can('billing.read') ? '<th class="right">Outstanding</th>' : ''}
                  <th>Last visit</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${data.patients.map((p) => `
                  <tr class="is-clickable" data-href="#/patients/${p.id}">
                    <td>
                      <div class="row" style="gap:9px">
                        <span class="avatar">${ui.esc(ui.initials(p.fullName))}</span>
                        <span>
                          <span class="cell-main">${ui.esc(p.fullName)}</span>
                          ${p.isActive ? '' : '<span class="pill pill--muted" style="margin-left:6px">Archived</span>'}
                          <div class="cell-sub mono">${ui.esc(p.mrn)}</div>
                        </span>
                      </div>
                    </td>
                    <td class="nowrap">${ui.esc(ui.fmtAge(p.dob, p.age))} · ${ui.esc(ui.sexLabel(p.sex))}</td>
                    <td class="nowrap">${ui.esc(p.phone || '—')}</td>
                    <td class="right">${p.visitCount}</td>
                    ${session.can('billing.read')
                      ? `<td class="right money ${p.balancePaise > 0 ? 'money--due' : ''}">${p.balancePaise > 0 ? ui.inr(p.balancePaise) : '—'}</td>`
                      : ''}
                    <td class="nowrap muted">${p.lastVisitAt ? ui.esc(ui.fmtDate(p.lastVisitAt, { short: true })) : '—'}</td>
                    <td class="right">${ui.icon('chevron-right', 16)}</td>
                  </tr>`).join('')}
              </tbody>
            </table>
          </div>
          <div class="pagination">
            <span>Page ${data.page} of ${data.pages}</span>
            <div class="row" style="gap:6px">
              <button class="btn btn--sm" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
              <button class="btn btn--sm" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
            </div>
          </div>`
        : `<div class="card-body">
            ${ui.emptyState({
              iconName: 'users',
              title: state.q ? 'No matching patients' : 'No patient records yet',
              message: state.q
                ? 'Check the spelling, or try the phone number. Archived records are hidden unless you include them.'
                : 'Register the first patient to start building the clinic record.',
              action: canWrite ? '<button class="btn btn--primary btn--sm" data-action="register">Register a patient</button>' : '',
            })}
          </div>`}
    </div>
  `;

  // ---- interactions -------------------------------------------------------
  const searchInput = root.querySelector('#patient-search');
  const rerun = (patch = {}) => {
    Object.assign(state, patch);
    const params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.page > 1) params.set('page', String(state.page));
    if (state.includeInactive) params.set('includeInactive', 'true');
    navigate(`/patients${params.toString() ? `?${params}` : ''}`);
  };

  searchInput?.addEventListener('input', ui.debounce((e) => {
    state.q = e.target.value.trim();
    state.page = 1;
    rerun();
  }, 350));
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      state.q = e.target.value.trim();
      state.page = 1;
      rerun();
    }
  });

  root.querySelector('#show-archived')?.addEventListener('change', (e) => {
    rerun({ includeInactive: e.target.checked, page: 1 });
  });
  root.querySelector('[data-action="clear"]')?.addEventListener('click', () => rerun({ q: '', page: 1 }));

  for (const button of root.querySelectorAll('[data-page]')) {
    button.addEventListener('click', () => rerun({ page: Number(button.dataset.page) }));
  }
  for (const row of root.querySelectorAll('[data-href]')) {
    row.addEventListener('click', () => { location.hash = row.dataset.href; });
  }
  for (const button of root.querySelectorAll('[data-action="register"]')) {
    button.addEventListener('click', () => openPatientForm({ onSaved: (patient) => navigate(`/patients/${patient.id}`) }));
  }

  if (!state.q) searchInput?.focus();
}
