/** Dashboard: today at a glance, the live queue and quick actions. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';
import { openPatientForm } from './patient-form.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function statCard({ label, value, meta, iconName, href }) {
  const inner = `
    <div class="stat">
      <span class="stat-ico">${ui.icon(iconName, 16)}</span>
      <span class="stat-label">${ui.esc(label)}</span>
      <span class="stat-value">${value}</span>
      ${meta ? `<span class="stat-meta">${meta}</span>` : ''}
    </div>`;
  return href ? `<a class="card" href="${href}" style="color:inherit;text-decoration:none">${inner}</a>` : `<div class="card">${inner}</div>`;
}

function queueRow(item, index) {
  return `
    <a class="queue-row" href="#/patients/${item.patientId}" style="color:inherit;text-decoration:none">
      <span class="queue-num">${index + 1}</span>
      <span class="grow">
        <span class="strong">${ui.esc(item.patientName)}</span>
        <span class="muted xs"> · ${ui.esc(ui.fmtAge(item.dob, item.age))} · ${ui.esc(ui.sexLabel(item.sex))}</span><br>
        <span class="muted xs">${ui.esc(item.mrn)} · ${ui.esc(item.chiefComplaint || ui.titleCase(item.visitType))}${item.doctorName ? ` · ${ui.esc(item.doctorName)}` : ''}</span>
      </span>
      <span class="stack-sm" style="align-items:flex-end;gap:3px">
        ${item.seen ? '<span class="pill pill--ok">Seen</span>' : '<span class="pill pill--warn">Waiting</span>'}
        <span class="muted xs">${ui.esc(ui.fmtTime(item.createdAt))}</span>
      </span>
    </a>`;
}

export default async function dashboardView(root, { navigate }) {
  const data = await api.get('/api/dashboard');
  const user = session.user;
  const settings = session.settings || {};
  const today = new Date();
  const canSeeMoney = data.stats.collectionsTodayPaise !== null;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>${ui.esc(greeting())}, ${ui.esc(user.fullName.split(' ')[0])}</h1>
        <div class="sub">${ui.esc(today.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))} · ${ui.esc(user.roleLabel)}</div>
      </div>
      <div class="page-head-actions">
        ${session.can('patient.write') ? `<button class="btn btn--primary" data-action="register">${ui.icon('userPlus')}<span>Register patient</span></button>` : ''}
        ${session.can('billing.write') ? `<a class="btn" href="#/billing">${ui.icon('receipt')}<span>New invoice</span></a>` : ''}
      </div>
    </div>

    ${settings.syntheticData
      ? `<div class="banner-synthetic mb-2">${ui.icon('info', 15)}<span>This installation is running on <strong>synthetic test data</strong>. No real patient information is stored.</span></div>`
      : ''}

    <div class="grid grid--stats mb-2">
      ${statCard({
        label: 'Patients waiting',
        value: data.stats.openVisits,
        meta: data.stats.openVisits ? 'Open visits with no discharge yet' : 'Queue is clear',
        iconName: 'activity',
        href: '#/appointments',
      })}
      ${statCard({
        label: 'Appointments today',
        value: data.stats.appointmentsToday,
        meta: `${data.upcoming.length} still expected`,
        iconName: 'calendar',
        href: '#/appointments',
      })}
      ${statCard({
        label: 'Registered today',
        value: data.stats.patientsToday,
        meta: 'New patient records',
        iconName: 'users',
        href: '#/patients',
      })}
      ${canSeeMoney
        ? statCard({
            label: 'Collected today',
            value: ui.inrShort(data.stats.collectionsTodayPaise),
            meta: data.stats.outstandingCount
              ? `${ui.inrShort(data.stats.outstandingPaise)} outstanding on ${data.stats.outstandingCount} invoice${data.stats.outstandingCount === 1 ? '' : 's'}`
              : 'No outstanding invoices',
            iconName: 'wallet',
            href: '#/billing',
          })
        : statCard({
            label: 'Your role',
            value: `<small>${ui.esc(user.roleLabel)}</small>`,
            meta: 'Billing figures are hidden for your role',
            iconName: 'shield',
          })}
    </div>

    <div class="grid grid--sidebar">
      <div class="col">
        <section class="card">
          <div class="card-head">
            <div class="grow">
              <h2>Today's queue</h2>
              <div class="muted xs">Patients checked in and waiting to be seen</div>
            </div>
            <a class="btn btn--sm" href="#/appointments">All visits</a>
          </div>
          ${data.queue.length
            ? `<div>${data.queue.map(queueRow).join('')}</div>`
            : `<div class="card-body">${ui.emptyState({
                iconName: 'check-circle',
                title: 'No patients waiting',
                message: 'When reception checks a patient in, they appear here.',
                action: session.can('patient.write') ? '<button class="btn btn--sm" data-action="register">Register a patient</button>' : '',
              })}</div>`}
        </section>

        <section class="card">
          <div class="card-head">
            <div class="grow">
              <h2>Upcoming appointments</h2>
              <div class="muted xs">Scheduled for today</div>
            </div>
          </div>
          ${data.upcoming.length
            ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Time</th><th>Patient</th><th>With</th><th>Reason</th><th class="right">Status</th></tr></thead>
                <tbody>
                  ${data.upcoming.map((a) => `
                    <tr>
                      <td class="nowrap strong">${ui.esc(ui.fmtTime(a.scheduledAt))}</td>
                      <td>
                        <a href="#/patients/${a.patientId}" class="cell-main">${ui.esc(a.patientName)}</a>
                        <div class="cell-sub">${ui.esc(a.mrn)}</div>
                      </td>
                      <td class="muted">${ui.esc(a.doctorName || 'Unassigned')}</td>
                      <td class="muted">${ui.esc(a.reason || '—')}</td>
                      <td class="right">${ui.statusPill(a.status)}</td>
                    </tr>`).join('')}
                </tbody>
              </table></div>`
            : `<div class="card-body">${ui.emptyState({
                iconName: 'calendar',
                title: 'Nothing scheduled today',
                message: 'Reception can book appointments from the Appointments page.',
              })}</div>`}
        </section>
      </div>

      <div class="col">
        <section class="card">
          <div class="card-head"><h2>Quick actions</h2></div>
          <div class="card-body col" style="gap:8px">
            ${session.can('patient.write') ? `<button class="btn btn--block" data-action="register">${ui.icon('userPlus')}<span>Register a patient</span></button>` : ''}
            <a class="btn btn--block" href="#/patients">${ui.icon('search')}<span>Find a patient record</span></a>
            ${session.can('appointment.write') ? `<a class="btn btn--block" href="#/appointments">${ui.icon('calendar')}<span>Book an appointment</span></a>` : ''}
            ${session.can('billing.write') ? `<a class="btn btn--block" href="#/billing">${ui.icon('receipt')}<span>Create an invoice</span></a>` : ''}
            ${session.can('backup.manage') ? `<a class="btn btn--block" href="#/admin/backups">${ui.icon('database')}<span>Backups &amp; restore</span></a>` : ''}
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <div class="grow"><h2>Recently registered</h2></div>
            <a class="xs" href="#/patients">View all</a>
          </div>
          <div>
            ${data.recentPatients.map((p) => `
              <a class="queue-row" href="#/patients/${p.id}" style="color:inherit;text-decoration:none">
                <span class="avatar">${ui.esc(ui.initials(p.fullName))}</span>
                <span class="grow">
                  <span class="strong">${ui.esc(p.fullName)}</span><br>
                  <span class="muted xs">${ui.esc(p.mrn)} · ${ui.esc(ui.fmtAge(p.dob, p.ageYears))} · ${ui.esc(ui.sexLabel(p.sex))}</span>
                </span>
                <span class="muted xs">${ui.esc(ui.fmtRelative(p.createdAt))}</span>
              </a>`).join('') || ui.emptyState({ iconName: 'users', title: 'No patients yet', message: 'Register the first patient to get started.' })}
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>Clinic server</h2></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Server</dt><dd>Reachable · ${ui.esc(location.host)}</dd>
              <dt>Signed in as</dt><dd>${ui.esc(user.fullName)}</dd>
              <dt>Role</dt><dd>${ui.esc(user.roleLabel)}</dd>
              <dt>Session</dt><dd>Auto sign-out after ${ui.esc(String(settings.sessionIdleMinutes || 20))} min idle</dd>
            </dl>
            <div class="alert alert--info mt-2">${ui.icon('lock')}<div class="xs">Records are visible only to staff on the clinic network. Every access is logged against your account.</div></div>
          </div>
        </section>
      </div>
    </div>
  `;

  for (const button of root.querySelectorAll('[data-action="register"]')) {
    button.addEventListener('click', () => openPatientForm({ onSaved: (patient) => navigate(`/patients/${patient.id}`) }));
  }
}
