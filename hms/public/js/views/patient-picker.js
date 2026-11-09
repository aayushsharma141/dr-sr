/** Modal patient search used by billing and appointment flows. */
import { api } from '../api.js';
import * as ui from '../ui.js';
import { openPatientForm } from './patient-form.js';

export function pickPatient({ title = 'Find a patient', allowRegister = true } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const handle = ui.modal({
      title,
      subtitle: 'Search by name, MRN or phone number.',
      body: `
        <div class="field">
          <input class="input" id="picker-search" type="search" placeholder="Start typing a name, MRN or phone…" autocomplete="off">
        </div>
        <div id="picker-results" class="mt-2" style="max-height:46vh;overflow-y:auto">
          <div class="muted sm">Type at least 2 characters.</div>
        </div>
        ${allowRegister ? `<div class="divider"></div>
        <div class="row row--between">
          <span class="muted sm">Can't find them?</span>
          <button class="btn btn--sm" type="button" data-register>${ui.icon('userPlus', 14)}<span>Register new patient</span></button>
        </div>` : ''}
      `,
      footer: '<button class="btn" type="button" data-close>Cancel</button>',
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });

    const input = handle.dialog.querySelector('#picker-search');
    const results = handle.dialog.querySelector('#picker-results');
    input.focus();

    const run = ui.debounce(async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        results.innerHTML = '<div class="muted sm">Type at least 2 characters.</div>';
        return;
      }
      results.innerHTML = ui.loadingRow('Searching…');
      try {
        const res = await api.get(`/api/patients?q=${encodeURIComponent(q)}&limit=12`);
        if (!res.patients.length) {
          results.innerHTML = '<div class="muted sm">No matching patient.</div>';
          return;
        }
        results.innerHTML = res.patients.map((p) => `
          <button type="button" class="file-row" style="width:100%;text-align:left;background:none;border:0;border-bottom:1px solid var(--line-soft);cursor:pointer"
                  data-pick="${p.id}">
            <span class="avatar">${ui.esc(ui.initials(p.fullName))}</span>
            <span class="grow">
              <span class="strong">${ui.esc(p.fullName)}</span>
              <div class="muted xs">${ui.esc(p.mrn)} · ${ui.esc(ui.fmtAge(p.dob, p.age))} · ${ui.esc(ui.sexLabel(p.sex))} · ${ui.esc(p.phone || 'no phone')}</div>
            </span>
            ${p.balancePaise > 0 ? `<span class="pill pill--warn money">${ui.inr(p.balancePaise)} due</span>` : ''}
            <span class="muted">${ui.icon('chevron-right', 15)}</span>
          </button>`).join('');
        for (const button of results.querySelectorAll('[data-pick]')) {
          button.addEventListener('click', () => {
            const patient = res.patients.find((p) => p.id === Number(button.dataset.pick));
            settled = true;
            resolve(patient);
            handle.close();
          });
        }
      } catch (err) {
        results.innerHTML = `<div class="alert alert--danger">${ui.esc(err.message)}</div>`;
      }
    }, 220);

    input.addEventListener('input', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = results.querySelector('[data-pick]');
        if (first) first.click();
      }
    }); 

    handle.dialog.querySelector('[data-register]')?.addEventListener('click', () => {
      settled = true;
      handle.close();
      openPatientForm({
        onSaved: (patient) => resolve(patient),
      });
      // If the registration dialog is cancelled, resolve with null.
      setTimeout(() => { if (!document.getElementById('patient-form')) resolve(null); }, 100);
    });
  });
}
