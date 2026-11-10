/** Appointment diary for a single day, with check-in into a visit. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';
import { pickPatient } from './patient-picker.js';

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function shiftDate(date, days) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export default async function appointmentsView(root, { query, navigate }) {
  const date = query.get('date') || todayLocal();
  const doctorFilter = query.get('doctor') || '';

  const [data, staff] = await Promise.all([
    api.get(`/api/appointments?date=${date}${doctorFilter ? `&doctorId=${doctorFilter}` : ''}`),
    api.get('/api/staff/doctors').catch(() => ({ doctors: [] })),
  ]);

  const appts = data.appointments;
  const isToday = date === todayLocal();
  const canWrite = session.can('appointment.write');
  const canVisit = session.can('visit.write');

  const counts = {
    scheduled: appts.filter((a) => a.status === 'scheduled').length,
    arrived: appts.filter((a) => a.status === 'arrived').length,
    completed: appts.filter((a) => a.status === 'completed').length,
  };

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Appointments</h1>
        <div class="sub">
          ${ui.esc(new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}
          · ${counts.scheduled} scheduled · ${counts.arrived} arrived · ${counts.completed} completed
        </div>
      </div>
      <div class="page-head-actions">
        ${canWrite ? `<button class="btn btn--primary" data-action="new">${ui.icon('plus')}<span>New appointment</span></button>` : ''}
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body row row--wrap" style="gap:10px">
        <div class="btn-group">
          <button class="btn btn--sm" data-nav="-1">${ui.icon('chevron-left', 15)}</button>
          <button class="btn btn--sm ${isToday ? 'is-active' : ''}" data-nav="0">Today</button>
          <button class="btn btn--sm" data-nav="1">${ui.icon('chevron-right', 15)}</button>
        </div>
        <input class="input input--sm" type="date" id="appt-date" value="${ui.esc(date)}" style="width:160px">
        <select class="select select--sm" id="appt-doctor" style="width:200px">
          <option value="">All doctors</option>
          ${staff.doctors.map((d) => `<option value="${d.id}" ${String(d.id) === doctorFilter ? 'selected' : ''}>${ui.esc(d.fullName)}</option>`).join('')}
        </select>
        <span class="grow"></span>
        <span class="pill pill--info">${appts.length} appointment${appts.length === 1 ? '' : 's'}</span>
      </div>
    </div>

    <div class="card">
      ${appts.length ? `<div class="table-wrap"><table class="table">
        <thead>
          <tr><th>Time</th><th>Token</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th><th class="right">Actions</th></tr>
        </thead>
        <tbody>
          ${appts.map((a) => `
            <tr>
              <td class="nowrap strong">${ui.esc(ui.fmtTime(a.scheduledAt))}<div class="cell-sub">${a.durationMin} min</div></td>
              <td class="nowrap">${a.token ? `<span class="pill pill--info">#${a.token}</span>` : '<span class="muted">—</span>'}</td>
              <td>
                <a class="cell-main" href="#/patients/${a.patientId}">${ui.esc(a.patientName)}</a>
                <div class="cell-sub">${ui.esc(a.mrn)} · ${ui.esc(ui.fmtAge(a.dob, a.age))} · ${ui.esc(a.phone || '')}</div>
              </td>
              <td class="muted">${ui.esc(a.doctorName || '—')}</td>
              <td class="muted">${ui.esc(a.reason || '—')}</td>
              <td>${ui.statusPill(a.status)}</td>
              <td>
                <div class="actions">
                  ${a.visitId ? `<a class="btn btn--sm" href="#/patients/${a.patientId}?tab=visits&visit=${a.visitId}">Open visit</a>` : ''}
                  ${!a.visitId && canVisit && ['scheduled', 'no_show'].includes(a.status)
                    ? `<button class="btn btn--sm btn--primary" data-checkin="${a.id}">Check in</button>` : ''}
                  ${canWrite && a.status === 'scheduled' && !a.visitId
                    ? `<button class="btn btn--sm" data-status="no_show" data-id="${a.id}" data-version="${a.version}">No show</button>` : ''}
                  ${canWrite && ['scheduled', 'arrived'].includes(a.status)
                    ? `<button class="icon-btn" data-status="cancelled" data-id="${a.id}" data-version="${a.version}" title="Cancel appointment">${ui.icon('ban', 15)}</button>` : ''}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`
      : `<div class="card-body">${ui.emptyState({
          iconName: 'calendar',
          title: isToday ? 'No appointments today' : 'Nothing booked for this day',
          message: 'Reception can book a slot for any patient record.',
          action: canWrite ? '<button class="btn btn--sm btn--primary" data-action="new">Book an appointment</button>' : '',
        })}</div>`}
    </div>
  `;

  const go = (patch) => {
    const params = new URLSearchParams({ date, ...(doctorFilter ? { doctor: doctorFilter } : {}), ...patch });
    navigate(`/appointments?${params}`);
  };

  for (const button of root.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => {
      const delta = Number(button.dataset.nav);
      go({ date: delta === 0 ? todayLocal() : shiftDate(date, delta) });
    });
  }
  root.querySelector('#appt-date')?.addEventListener('change', (e) => go({ date: e.target.value }));
  root.querySelector('#appt-doctor')?.addEventListener('change', (e) => go({ doctor: e.target.value }));

  for (const button of root.querySelectorAll('[data-checkin]')) {
    button.addEventListener('click', async () => {
      ui.setBusy(button, true, 'Checking in…');
      try {
        const res = await api.post(`/api/appointments/${button.dataset.checkin}/check-in`, {});
        ui.toastOk(`Checked in — Token #${res.token}, Visit ${res.visitNo}${res.feePaise ? ` (${ui.inr(res.feePaise)})` : ''}`);
        const appt = appts.find((a) => a.id === Number(button.dataset.checkin));
        navigate(`/patients/${appt.patientId}?tab=visits&visit=${res.visitId}`);
      } catch (err) {
        ui.toastError(err.message);
        ui.setBusy(button, false);
      }
    });
  }

  for (const button of root.querySelectorAll('[data-status]')) {
    button.addEventListener('click', async () => {
      const status = button.dataset.status;
      try {
        await api.patch(`/api/appointments/${button.dataset.id}`, { status, version: Number(button.dataset.version) });
        ui.toastOk(status === 'cancelled' ? 'Appointment cancelled.' : 'Appointment updated.');
        go({});
      } catch (err) { ui.toastError(err.message); }
    });
  }

  for (const button of root.querySelectorAll('[data-action="new"]')) {
    button.addEventListener('click', async () => {
      const patient = await pickPatient({ title: 'Book an appointment' });
      if (!patient) return;
      openAppointmentModal({ patient, date, staff: staff.doctors, onSaved: () => go({}) });
    });
  }
}

function openAppointmentModal({ patient, date, staff, onSaved }) {
  const handle = ui.modal({
    title: 'Book an appointment',
    subtitle: `${patient.fullName} · ${patient.mrn}`,
    body: `<form id="appt-form" class="col" novalidate>
      <div class="form-grid">
        <div class="field">
          <label for="af-date">Date <span class="req">*</span></label>
          <input class="input" id="af-date" name="date" type="date" value="${ui.esc(date)}">
        </div>
        <div class="field">
          <label for="af-time">Time <span class="req">*</span></label>
          <input class="input" id="af-time" name="time" type="time" value="10:00">
        </div>
        <div class="field">
          <label for="af-doctor">Doctor</label>
          <select class="select" id="af-doctor" name="doctorId">
            <option value="">Unassigned</option>
            ${staff.map((d) => `<option value="${d.id}">${ui.esc(d.fullName)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="af-duration">Duration (minutes)</label>
          <input class="input" id="af-duration" name="durationMin" type="number" value="15" min="5" max="240">
        </div>
        <div class="field span-2">
          <label for="af-reason">Reason</label>
          <input class="input" id="af-reason" name="reason" placeholder="e.g. review of lab reports">
        </div>
      </div>
      <div id="appt-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>Book appointment</button>`,
  });

  const form = handle.dialog.querySelector('#appt-form');
  const save = handle.dialog.querySelector('[data-save]');
  const errorBox = handle.dialog.querySelector('#appt-error');

  save.addEventListener('click', async () => {
    const values = ui.formValues(form);
    if (!values.date || !values.time) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>Choose a date and time.</div>`;
      errorBox.classList.remove('hidden');
      return;
    }
    ui.setBusy(save, true, 'Booking…');
    try {
      await api.post('/api/appointments', {
        patientId: patient.id,
        doctorId: values.doctorId || null,
        scheduledAt: new Date(`${values.date}T${values.time}:00`).toISOString(),
        durationMin: values.durationMin || 15,
        reason: values.reason,
      });
      ui.toastOk('Appointment booked.');
      handle.close();
      onSaved();
    } catch (err) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
      errorBox.classList.remove('hidden');
    } finally {
      ui.setBusy(save, false);
    }
  });
}
