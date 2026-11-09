/** Patient registration / edit dialog (shared by search, dashboard and chart). */
import { api } from '../api.js';
import * as ui from '../ui.js';

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function field({ name, label, type = 'text', value = '', required = false, placeholder = '', span = '', hint = '', options = null, max = '' }) {
  const spanClass = span ? `span-${span}` : '';
  const common = `class="input" id="pf-${name}" name="${name}" ${required ? 'required' : ''} ${max ? `maxlength="${max}"` : ''}`;
  const control = options
    ? `<select class="select" id="pf-${name}" name="${name}" ${required ? 'required' : ''}>
         <option value="">Select…</option>
         ${options.map((o) => {
           const val = typeof o === 'string' ? o : o.value;
           const text = typeof o === 'string' ? o : o.label;
           return `<option value="${ui.esc(val)}" ${String(value) === String(val) ? 'selected' : ''}>${ui.esc(text)}</option>`;
         }).join('')}
       </select>`
    : type === 'textarea'
      ? `<textarea class="textarea" id="pf-${name}" name="${name}" placeholder="${ui.esc(placeholder)}">${ui.esc(value)}</textarea>`
      : `<input ${common} type="${type}" value="${ui.esc(value)}" placeholder="${ui.esc(placeholder)}" ${type === 'date' ? 'max="2100-12-31"' : ''}>`;
  return `<div class="field ${spanClass}">
    <label for="pf-${name}">${ui.esc(label)} ${required ? '<span class="req">*</span>' : ''}</label>
    ${control}
    ${hint ? `<div class="hint">${ui.esc(hint)}</div>` : ''}
    <div class="field-error hidden" data-error-for="${name}"></div>
  </div>`;
}

export function openPatientForm({ patient = null, onSaved } = {}) {
  const editing = !!patient;
  const p = patient || {};

  const handle = ui.modal({
    title: editing ? `Edit ${p.fullName}` : 'Register a patient',
    subtitle: editing ? `Record ${p.mrn}` : 'A medical record number (MRN) is generated automatically.',
    width: 'wide',
    body: `
      <form id="patient-form" class="col" autocomplete="off" novalidate>
        <fieldset>
          <legend>Identity</legend>
          <div class="form-grid form-grid--3">
            ${field({ name: 'firstName', label: 'First name', required: !editing, value: p.firstName || '', max: 80 })}
            ${field({ name: 'lastName', label: 'Last name', value: p.lastName || '', max: 80 })}
            ${field({ name: 'sex', label: 'Sex', options: [
              { value: 'female', label: 'Female' }, { value: 'male', label: 'Male' },
              { value: 'other', label: 'Other' }, { value: 'unknown', label: 'Prefer not to say' },
            ], value: p.sex || '' })}
            ${field({ name: 'dob', label: 'Date of birth', type: 'date', value: p.dob || '', span: '', hint: p.dobEstimated ? 'Recorded as approximate' : '' })}
            ${field({ name: 'ageYears', label: 'Approx. age (if DOB unknown)', type: 'number', value: p.age != null && !p.dob ? p.age : '', placeholder: 'e.g. 42' })}
            ${field({ name: 'bloodGroup', label: 'Blood group', options: BLOOD_GROUPS, value: p.bloodGroup || '' })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Contact</legend>
          <div class="form-grid form-grid--3">
            ${field({ name: 'phone', label: 'Mobile number', required: !editing, value: p.phone || '', placeholder: '10-digit mobile', max: 20 })}
            ${field({ name: 'altPhone', label: 'Alternate phone', value: p.altPhone || '', max: 20 })}
            ${field({ name: 'email', label: 'Email', type: 'email', value: p.email || '' })}
            ${field({ name: 'addressLine', label: 'Address', value: p.addressLine || '', span: '2', max: 200 })}
            ${field({ name: 'city', label: 'City / town', value: p.city || '' })}
            ${field({ name: 'state', label: 'State', value: p.state || 'Bihar' })}
            ${field({ name: 'pincode', label: 'PIN code', value: p.pincode || '', max: 12 })}
            ${field({ name: 'occupation', label: 'Occupation', value: p.occupation || '' })}
            ${field({ name: 'maritalStatus', label: 'Marital status', options: ['Single', 'Married', 'Divorced', 'Widowed'], value: p.maritalStatus || '' })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Next of kin &amp; identification</legend>
          <div class="form-grid form-grid--3">
            ${field({ name: 'guardianName', label: 'Guardian / attendant', value: p.guardianName || '' })}
            ${field({ name: 'guardianRelation', label: 'Relationship', value: p.guardianRelation || '', placeholder: 'e.g. spouse' })}
            ${field({ name: 'emergencyContactPhone', label: 'Emergency phone', value: p.emergencyContactPhone || '', max: 20 })}
            ${field({ name: 'emergencyContactName', label: 'Emergency contact name', value: p.emergencyContactName || '', span: '1' })}
            ${field({ name: 'idType', label: 'ID type', options: ['Aadhaar', 'PAN', 'Driving licence', 'Passport', 'Voter ID', 'Other'], value: p.idType || '' })}
            ${field({ name: 'idNumber', label: 'ID number', value: p.idNumber || '', max: 60 })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Clinical flags</legend>
          <div class="form-grid">
            ${field({
              name: 'allergiesSummary',
              label: 'Known allergies (free text)',
              type: 'textarea',
              value: p.allergiesSummary || '',
              span: '2',
              placeholder: 'e.g. penicillin (rash), sulfa drugs — or "nil known"',
              hint: 'Structured allergy records with severity are added from the patient chart.',
            })}
            ${field({ name: 'notes', label: 'Reception notes', type: 'textarea', value: p.notes || '', span: '2', placeholder: 'Anything the front desk should know (interpreter needed, wheelchair, etc.)' })}
          </div>
        </fieldset>

        <div id="patient-form-error" class="alert alert--danger hidden"></div>
        ${editing ? '' : `<div class="alert alert--info">${ui.icon('info')}<div class="xs">Ask for the patient's phone number — it is used to find the record at future visits. Duplicate names are common in a busy OPD.</div></div>`}
      </form>`,
    footer: `
      <button class="btn" type="button" data-close>Cancel</button>
      <button class="btn btn--primary" type="button" data-save>${ui.icon('save')}<span>${editing ? 'Save changes' : 'Register patient'}</span></button>
    `,
  });

  const form = handle.dialog.querySelector('#patient-form');
  const errorBox = handle.dialog.querySelector('#patient-form-error');
  const saveButton = handle.dialog.querySelector('[data-save]');

  saveButton.addEventListener('click', async () => {
    errorBox.classList.add('hidden');
    const values = ui.formValues(form);
    if (!values.firstName && !editing) {
      ui.applyFieldErrors(form, [{ field: 'firstName', message: 'First name is required.' }]);
      return;
    }
    if (!values.phone && !editing) {
      ui.applyFieldErrors(form, [{ field: 'phone', message: 'A contact number is required.' }]);
      return;
    }
    if (!values.dob && !values.ageYears && !editing) {
      ui.applyFieldErrors(form, [{ field: 'dob', message: 'Enter the date of birth, or an approximate age.' }]);
      return;
    }
    ui.setBusy(saveButton, true, 'Saving…');
    try {
      const res = editing
        ? await api.patch(`/api/patients/${p.id}`, values)
        : await api.post('/api/patients', values);
      ui.toastOk(editing ? 'Patient record updated.' : `Patient registered as ${res.patient.mrn}.`);
      handle.close();
      if (onSaved) onSaved(res.patient);
    } catch (err) {
      if (err.details) {
        ui.applyFieldErrors(form, err.details);
      } else {
        errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
        errorBox.classList.remove('hidden');
      }
    } finally {
      ui.setBusy(saveButton, false);
    }
  });

  return handle;
}
