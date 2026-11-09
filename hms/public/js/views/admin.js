/** Administration: staff accounts, audit trail, backups and clinic settings. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';

// ===========================================================================
// Staff accounts
// ===========================================================================
export async function usersView(root, { navigate }) {
  const data = await api.get('/api/admin/users');
  const users = data.users;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Staff accounts</h1>
        <div class="sub">${users.length} account${users.length === 1 ? '' : 's'} ·
          ${users.filter((u) => u.isActive).length} active</div>
      </div>
      <div class="page-head-actions">
        <button class="btn btn--primary" data-action="add">${ui.icon('userPlus')}<span>Add staff account</span></button>
      </div>
    </div>

    <div class="card mb-2">
      <div class="card-body row row--wrap" style="gap:18px">
        ${data.roles.map((r) => `
          <div class="sm"><strong>${ui.esc(r.label)}</strong>
            <div class="muted xs">${ui.esc({
              admin: 'Full access, including accounts, audit and backups',
              doctor: 'Charts, clinical notes, prescriptions; read-only billing',
              nurse: 'Vitals and nursing notes',
              reception: 'Registration, appointments and billing; no clinical notes',
            }[r.role] || '')}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Last sign-in</th><th>Status</th><th class="right">Actions</th></tr></thead>
        <tbody>
          ${users.map((u) => `
            <tr>
              <td>
                <div class="row" style="gap:9px">
                  <span class="avatar">${ui.esc(ui.initials(u.fullName))}</span>
                  <span>
                    <span class="cell-main">${ui.esc(u.fullName)}</span>
                    <div class="cell-sub">${ui.esc(u.designation || u.specialty || '—')}</div>
                  </span>
                </div>
              </td>
              <td class="mono">${ui.esc(u.username)}</td>
              <td><span class="pill pill--brand">${ui.esc(u.roleLabel)}</span></td>
              <td class="muted nowrap">${u.lastLoginAt ? ui.esc(ui.fmtDateTime(u.lastLoginAt)) : 'Never'}</td>
              <td>
                ${u.isActive ? '<span class="pill pill--ok">Active</span>' : '<span class="pill pill--muted">Disabled</span>'}
                ${u.mustChangePassword ? '<span class="pill pill--warn">Temp password</span>' : ''}
              </td>
              <td>
                <div class="actions">
                  <button class="btn btn--sm" data-edit="${u.id}">Edit</button>
                  <button class="btn btn--sm" data-reset="${u.id}">${ui.icon('key', 13)}<span>Password</span></button>
                  ${u.id === session.user.id ? '' : `<button class="btn btn--sm ${u.isActive ? 'btn--danger' : ''}" data-toggle="${u.id}">
                    ${u.isActive ? 'Disable' : 'Enable'}</button>`}
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>
    </div>
  `;

  root.querySelector('[data-action="add"]').addEventListener('click', () => openUserForm({ roles: data.roles, onSaved: () => navigate('/admin/users') }));
  for (const button of root.querySelectorAll('[data-edit]')) {
    const user = users.find((u) => u.id === Number(button.dataset.edit));
    button.addEventListener('click', () => openUserForm({ user, roles: data.roles, onSaved: () => navigate('/admin/users') }));
  }
  for (const button of root.querySelectorAll('[data-reset]')) {
    const user = users.find((u) => u.id === Number(button.dataset.reset));
    button.addEventListener('click', () => openResetPassword(user, () => navigate('/admin/users')));
  }
  for (const button of root.querySelectorAll('[data-toggle]')) {
    const user = users.find((u) => u.id === Number(button.dataset.toggle));
    button.addEventListener('click', async () => {
      const disabling = user.isActive;
      const ok = await ui.confirmDialog({
        title: disabling ? `Disable ${user.fullName}?` : `Enable ${user.fullName}?`,
        message: disabling
          ? 'They will be signed out immediately and cannot sign in again until re-enabled. Their records and audit history are kept.'
          : 'They will be able to sign in again with their existing password.',
        confirmLabel: disabling ? 'Disable account' : 'Enable account',
        danger: disabling,
      });
      if (!ok) return;
      try {
        await api.patch(`/api/admin/users/${user.id}`, { isActive: !user.isActive });
        ui.toastOk(disabling ? 'Account disabled.' : 'Account enabled.');
        navigate('/admin/users');
      } catch (err) { ui.toastError(err.message); }
    });
  }
}

function openUserForm({ user = null, roles, onSaved }) {
  const editing = !!user;
  const u = user || {};
  const handle = ui.modal({
    title: editing ? `Edit ${u.fullName}` : 'Add a staff account',
    subtitle: editing ? `@${u.username}` : 'The person will be asked to set their own password at first sign-in.',
    body: `<form id="user-form" class="col" novalidate>
      <div class="form-grid">
        <div class="field span-2">
          <label for="uf-name">Full name <span class="req">*</span></label>
          <input class="input" id="uf-name" name="fullName" value="${ui.esc(u.fullName || '')}" required>
          <div class="field-error hidden" data-error-for="fullName"></div>
        </div>
        ${editing ? '' : `
        <div class="field">
          <label for="uf-username">Username <span class="req">*</span></label>
          <input class="input" id="uf-username" name="username" autocomplete="off" spellcheck="false" required>
          <div class="hint">Letters, numbers, dot, dash or underscore.</div>
          <div class="field-error hidden" data-error-for="username"></div>
        </div>
        <div class="field">
          <label for="uf-role">Role <span class="req">*</span></label>
          <select class="select" id="uf-role" name="role" required>
            ${roles.map((r) => `<option value="${r.role}" ${u.role === r.role ? 'selected' : ''}>${ui.esc(r.label)}</option>`).join('')}
          </select>
          <div class="field-error hidden" data-error-for="role"></div>
        </div>
        <div class="field span-2">
          <label for="uf-password">Temporary password <span class="req">*</span></label>
          <input class="input" id="uf-password" name="password" type="text" autocomplete="off" required>
          <div class="hint">At least 12 characters. Give it to the staff member in person; they must change it at first sign-in.</div>
          <div class="field-error hidden" data-error-for="password"></div>
        </div>`}
        ${editing ? `
        <div class="field">
          <label for="uf-role">Role</label>
          <select class="select" id="uf-role" name="role">
            ${roles.map((r) => `<option value="${r.role}" ${u.role === r.role ? 'selected' : ''}>${ui.esc(r.label)}</option>`).join('')}
          </select>
          <div class="field-error hidden" data-error-for="role"></div>
        </div>` : ''}
        <div class="field">
          <label for="uf-designation">Designation</label>
          <input class="input" id="uf-designation" name="designation" value="${ui.esc(u.designation || '')}" placeholder="e.g. Consultant physician">
        </div>
        <div class="field">
          <label for="uf-specialty">Specialty</label>
          <input class="input" id="uf-specialty" name="specialty" value="${ui.esc(u.specialty || '')}" placeholder="e.g. Internal medicine">
        </div>
        <div class="field">
          <label for="uf-registration">Registration no.</label>
          <input class="input" id="uf-registration" name="registrationNo" value="${ui.esc(u.registrationNo || '')}">
        </div>
        <div class="field">
          <label for="uf-phone">Phone</label>
          <input class="input" id="uf-phone" name="phone" value="${ui.esc(u.phone || '')}">
          <div class="field-error hidden" data-error-for="phone"></div>
        </div>
      </div>
      <div id="user-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>${editing ? 'Save changes' : 'Create account'}</button>`,
  });

  const form = handle.dialog.querySelector('#user-form');
  const errorBox = handle.dialog.querySelector('#user-error');
  const save = handle.dialog.querySelector('[data-save]');
  save.addEventListener('click', async () => {
    errorBox.classList.add('hidden');
    ui.setBusy(save, true, 'Saving…');
    try {
      if (editing) await api.patch(`/api/admin/users/${u.id}`, ui.formValues(form));
      else await api.post('/api/admin/users', ui.formValues(form));
      ui.toastOk(editing ? 'Account updated.' : 'Staff account created.');
      handle.close();
      onSaved();
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

function openResetPassword(user, onDone) {
  const handle = ui.modal({
    title: `Reset password for ${user.fullName}`,
    subtitle: 'All of their sessions are signed out immediately.',
    width: 'narrow',
    body: `<form id="reset-form" class="col" novalidate>
      <div class="field">
        <label for="rp-password">New temporary password</label>
        <input class="input" id="rp-password" name="newPassword" type="text" autocomplete="off" required>
        <div class="hint">At least 12 characters. They will be asked to choose their own on next sign-in.</div>
        <div class="field-error hidden" data-error-for="newPassword"></div>
      </div>
      <div id="reset-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>Reset password</button>`,
  });
  const form = handle.dialog.querySelector('#reset-form');
  const errorBox = handle.dialog.querySelector('#reset-error');
  const save = handle.dialog.querySelector('[data-save]');
  save.addEventListener('click', async () => {
    ui.setBusy(save, true, 'Resetting…');
    try {
      await api.post(`/api/admin/users/${user.id}/reset-password`, ui.formValues(form));
      ui.toastOk('Password reset. Hand the new password over in person.');
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

// ===========================================================================
// Audit trail
// ===========================================================================
export async function auditView(root, { query, navigate }) {
  const filters = {
    action: query.get('action') || '',
    from: query.get('from') || '',
    to: query.get('to') || '',
    q: query.get('q') || '',
    page: Number(query.get('page') || 1) || 1,
  };
  const params = new URLSearchParams({ limit: '50', page: String(filters.page) });
  for (const [key, value] of Object.entries(filters)) {
    if (value && key !== 'page') params.set(key, value);
  }
  const data = await api.get(`/api/admin/audit?${params}`);
  const verify = await api.get('/api/admin/audit/verify').catch(() => null);

  const ACTION_GROUPS = [
    ['', 'All actions'],
    ['auth.login', 'Sign-ins'],
    ['patient.', 'Patient record changes'],
    ['visit.', 'Visits'],
    ['note.', 'Clinical notes'],
    ['document.', 'Documents'],
    ['invoice.', 'Invoices'],
    ['payment.', 'Payments'],
    ['user.', 'Staff accounts'],
    ['backup.', 'Backups'],
    ['settings.', 'Settings'],
  ];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Audit trail</h1>
        <div class="sub">${data.total} recorded event${data.total === 1 ? '' : 's'} · append-only and hash-chained</div>
      </div>
      <div class="page-head-actions">
        <button class="btn" data-action="export">${ui.icon('download')}<span>Export CSV</span></button>
        <button class="btn" data-action="verify">${ui.icon('shield')}<span>Verify integrity</span></button>
      </div>
    </div>

    ${verify ? (verify.ok
      ? `<div class="alert alert--ok mb-2">${ui.icon('check-circle')}<div>
          Audit chain verified — ${verify.checked.toLocaleString('en-IN')} entries intact, ending at hash
          <span class="mono">${ui.esc((verify.lastHash || '').slice(0, 16))}…</span></div></div>`
      : `<div class="alert alert--danger mb-2">${ui.icon('alert')}<div>
          <strong>Audit chain broken at entry #${verify.brokenAtId}.</strong> The log has been altered outside the application.
          Investigate immediately and restore from a known-good backup.</div></div>`) : ''}

    <div class="card mb-2">
      <div class="card-body row row--wrap" style="gap:10px">
        <select class="select" id="af-action" style="max-width:230px">
          ${ACTION_GROUPS.map(([value, label]) => `<option value="${value}" ${filters.action === value ? 'selected' : ''}>${ui.esc(label)}</option>`).join('')}
        </select>
        <input class="input" id="af-q" type="search" placeholder="Search user or detail…" value="${ui.esc(filters.q)}" style="max-width:240px">
        <input class="input" id="af-from" type="date" value="${ui.esc(filters.from)}" style="max-width:155px">
        <span class="muted xs">to</span>
        <input class="input" id="af-to" type="date" value="${ui.esc(filters.to)}" style="max-width:155px">
        <button class="btn btn--sm" data-action="clear">Clear</button>
      </div>
    </div>

    <div class="card">
      ${data.events.length ? `<div class="table-wrap"><table class="table table--compact">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Detail</th><th>IP</th><th class="mono">Hash</th></tr></thead>
        <tbody>
          ${data.events.map((e) => `
            <tr>
              <td class="nowrap">${ui.esc(ui.fmtDateTime(e.at))}</td>
              <td class="nowrap">${ui.esc(e.actorName || '—')}<div class="cell-sub">${ui.esc(e.actorRole || '')}</div></td>
              <td><span class="pill ${e.action.includes('void') || e.action.includes('failed') ? 'pill--warn' : 'pill--muted'}">${ui.esc(e.action)}</span></td>
              <td class="muted nowrap">${e.entityType ? `${ui.esc(e.entityType)} #${ui.esc(e.entityId || '—')}` : '—'}
                ${e.patientId ? `<div class="cell-sub"><a href="#/patients/${e.patientId}">patient ${e.patientId}</a></div>` : ''}</td>
              <td class="muted xs" style="max-width:340px">${ui.esc(JSON.stringify(e.detail || {}).slice(0, 160))}</td>
              <td class="mono xs">${ui.esc(e.ip || '—')}</td>
              <td class="mono xs">${ui.esc(e.hash)}</td>
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
      : `<div class="card-body">${ui.emptyState({ iconName: 'shield', title: 'No events match', message: 'Try widening the date range or clearing the search.' })}</div>`}
    </div>
  `;

  const rerun = (patch = {}) => {
    Object.assign(filters, patch);
    const p = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value && key !== 'page') p.set(key, value);
    }
    if (filters.page > 1) p.set('page', String(filters.page));
    navigate(`/admin/audit${p.toString() ? `?${p}` : ''}`);
  };

  root.querySelector('#af-action').addEventListener('change', (e) => rerun({ action: e.target.value, page: 1 }));
  root.querySelector('#af-q').addEventListener('input', ui.debounce((e) => rerun({ q: e.target.value.trim(), page: 1 }), 320));
  root.querySelector('#af-from').addEventListener('change', (e) => rerun({ from: e.target.value, page: 1 }));
  root.querySelector('#af-to').addEventListener('change', (e) => rerun({ to: e.target.value, page: 1 }));
  root.querySelector('[data-action="clear"]').addEventListener('click', () => rerun({ action: '', q: '', from: '', to: '', page: 1 }));
  for (const button of root.querySelectorAll('[data-page]')) {
    button.addEventListener('click', () => rerun({ page: Number(button.dataset.page) }));
  }
  root.querySelector('[data-action="verify"]').addEventListener('click', () => rerun({}));
  root.querySelector('[data-action="export"]').addEventListener('click', async () => {
    try {
      await api.download(`/api/admin/audit/export?${params.toString()}`, `audit-${new Date().toISOString().slice(0, 10)}.csv`);
      ui.toastOk('Audit export downloaded.');
    } catch (err) { ui.toastError(err.message); }
  });
}

// ===========================================================================
// Backups & system
// ===========================================================================
export async function backupsView(root, { navigate }) {
  const [data, system] = await Promise.all([api.get('/api/admin/backups'), api.get('/api/admin/system')]);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Backups &amp; system</h1>
        <div class="sub">Nightly automatic backups at ${String(system.backupHour).padStart(2, '0')}:15, keeping the last ${system.retention}</div>
      </div>
      <div class="page-head-actions">
        <button class="btn btn--primary" data-action="backup">${ui.icon('database')}<span>Back up now</span></button>
      </div>
    </div>

    <div class="grid grid--stats mb-2">
      <div class="card"><div class="stat">
        <span class="stat-label">Last backup</span>
        <span class="stat-value" style="font-size:18px">${system.lastBackupAt ? ui.esc(ui.fmtRelative(system.lastBackupAt)) : 'Never'}</span>
        <span class="stat-meta">${system.lastBackupAt ? ui.esc(ui.fmtDateTime(system.lastBackupAt)) : 'Create one now'}</span>
      </div></div>
      <div class="card"><div class="stat">
        <span class="stat-label">Database</span>
        <span class="stat-value" style="font-size:18px">${ui.bytes(system.dbSizeBytes)}</span>
        <span class="stat-meta">${system.integrity === 'ok' ? 'Integrity check passed' : 'Integrity check FAILED'}</span>
      </div></div>
      <div class="card"><div class="stat">
        <span class="stat-label">Audit chain</span>
        <span class="stat-value" style="font-size:18px">${system.auditChain.ok ? 'Intact' : 'Broken'}</span>
        <span class="stat-meta">${system.auditChain.checked.toLocaleString('en-IN')} entries checked</span>
      </div></div>
      <div class="card"><div class="stat">
        <span class="stat-label">Records</span>
        <span class="stat-value" style="font-size:18px">${system.counts.patients.toLocaleString('en-IN')}</span>
        <span class="stat-meta">patients · ${system.counts.visits} visits · ${system.counts.documents} documents</span>
      </div></div>
    </div>

    <div class="grid grid--sidebar">
      <section class="card">
        <div class="card-head"><div class="grow"><h2>Backup history</h2>
          <div class="muted xs">Encrypted on disk; keep an off-site copy on an external drive in a locked cabinet</div></div></div>
        ${data.backups.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>File</th><th>Type</th><th>Size</th><th>Taken</th><th>By</th><th class="right">Actions</th></tr></thead>
          <tbody>
            ${data.backups.map((b) => `
              <tr>
                <td class="mono xs">${ui.esc(b.filename)}</td>
                <td>${ui.esc(ui.titleCase(b.kind))}</td>
                <td class="nowrap">${ui.esc(ui.bytes(b.sizeBytes))}</td>
                <td class="nowrap">${ui.esc(ui.fmtDateTime(b.createdAt))}</td>
                <td class="muted">${ui.esc(b.createdByName || 'automatic')}</td>
                <td class="right">
                  ${b.status === 'ok'
                    ? `<button class="btn btn--sm" data-export="${b.id}">${ui.icon('download', 13)}<span>Export</span></button>`
                    : ui.statusPill(b.status)}
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`
        : `<div class="card-body">${ui.emptyState({ iconName: 'database', title: 'No backups yet', message: 'Create one now — then copy it to an external drive weekly.' })}</div>`}
      </section>

      <div class="col">
        <section class="card">
          <div class="card-head"><h2>Server</h2></div>
          <div class="card-body">
            <dl class="kv">
              <dt>Version</dt><dd>${ui.esc(system.version)} (schema v${system.schemaVersion})</dd>
              <dt>Node</dt><dd>${ui.esc(system.nodeVersion)} · ${ui.esc(system.platform)}</dd>
              <dt>Uptime</dt><dd>${Math.floor(system.uptimeSeconds / 3600)}h ${Math.floor((system.uptimeSeconds % 3600) / 60)}m</dd>
              <dt>Data folder</dt><dd class="mono xs">${ui.esc(system.dataDir)}</dd>
              <dt>Patients</dt><dd>${system.counts.patients}</dd>
              <dt>Audit events</dt><dd>${system.counts.auditEvents.toLocaleString('en-IN')}</dd>
              <dt>Dataset</dt><dd>${system.syntheticData ? '<span class="pill pill--warn">Synthetic test data</span>' : 'Live clinic data'}</dd>
            </dl>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><h2>How backups work</h2></div>
          <div class="card-body col" style="gap:10px">
            <div class="sm"><strong>Automatic:</strong> every night the server writes an encrypted copy of the database and document store into the data folder.</div>
            <div class="sm"><strong>Off-site:</strong> press Export to re-encrypt a copy with your own passphrase, then save it to an external drive or another PC on the network.</div>
            <div class="sm"><strong>Restore:</strong> run <span class="mono">npm run restore</span> on the server after stopping it. Full steps are in <span class="mono">docs/OPERATIONS.md</span>.</div>
            <div class="alert alert--warn">${ui.icon('alert')}<div class="xs">Never store an off-site backup in the same room as the server, and never attach it to an email.</div></div>
          </div>
        </section>
      </div>
    </div>
  `;

  root.querySelector('[data-action="backup"]').addEventListener('click', async (e) => {
    const button = e.currentTarget;
    ui.setBusy(button, true, 'Backing up…');
    try {
      const res = await api.post('/api/admin/backups', {});
      ui.toastOk(`Backup created (${ui.bytes(res.backup.sizeBytes)}).`);
      navigate('/admin/backups');
    } catch (err) {
      ui.toastError(err.message);
      ui.setBusy(button, false);
    }
  });

  for (const button of root.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => openExportDialog(Number(button.dataset.export), data.backups, () => navigate('/admin/backups')));
  }
}

function openExportDialog(id, backups, onDone) {
  const backup = backups.find((b) => b.id === id);
  const handle = ui.modal({
    title: 'Export a backup copy',
    subtitle: backup.filename,
    width: 'narrow',
    body: `<form id="export-form" class="col" novalidate>
      <div class="alert alert--info">${ui.icon('info')}<div class="xs">
        The exported file is re-encrypted with a passphrase <em>you</em> choose. Keep the passphrase in a sealed envelope
        in the clinic safe — without it the backup cannot be restored.</div></div>
      <div class="field">
        <label for="ex-pass">Passphrase (min. 10 characters)</label>
        <input class="input" id="ex-pass" name="passphrase" type="password" autocomplete="new-password">
        <div class="field-error hidden" data-error-for="passphrase"></div>
      </div>
      <div class="field">
        <label for="ex-pass2">Repeat passphrase</label>
        <input class="input" id="ex-pass2" name="passphrase2" type="password" autocomplete="new-password">
        <div class="field-error hidden" data-error-for="passphrase2"></div>
      </div>
      <div id="ex-error" class="alert alert--danger hidden"></div>
    </form>`,
    footer: `<button class="btn" type="button" data-close>Cancel</button>
             <button class="btn btn--primary" type="button" data-save>${ui.icon('download')}<span>Export</span></button>`,
  });
  const form = handle.dialog.querySelector('#export-form');
  const errorBox = handle.dialog.querySelector('#ex-error');
  const save = handle.dialog.querySelector('[data-save]');
  save.addEventListener('click', async () => {
    const values = ui.formValues(form);
    if (!values.passphrase || values.passphrase.length < 10) {
      ui.applyFieldErrors(form, [{ field: 'passphrase', message: 'Use at least 10 characters.' }]);
      return;
    }
    if (values.passphrase !== values.passphrase2) {
      ui.applyFieldErrors(form, [{ field: 'passphrase2', message: 'Passphrases do not match.' }]);
      return;
    }
    ui.setBusy(save, true, 'Exporting…');
    try {
      await api.downloadPost(`/api/admin/backups/${id}/export`, { passphrase: values.passphrase },
        `${backup.filename.replace('.khb', '')}-export.khb`);
      ui.toastOk('Backup exported. Store it safely and away from the server.');
      handle.close();
      onDone();
    } catch (err) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
      errorBox.classList.remove('hidden');
    } finally {
      ui.setBusy(save, false);
    }
  });
}

// ===========================================================================
// Settings
// ===========================================================================
export async function settingsView(root, { navigate }) {
  const data = await api.get('/api/admin/settings');
  const s = data.settings;

  const field = (name, label, value, { hint = '', type = 'text', span = '' } = {}) => `
    <div class="field ${span ? `span-${span}` : ''}">
      <label for="set-${name}">${ui.esc(label)}</label>
      <input class="input" id="set-${name}" name="${name}" type="${type}" value="${ui.esc(value || '')}">
      ${hint ? `<div class="hint">${ui.esc(hint)}</div>` : ''}
    </div>`;

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Clinic settings</h1>
        <div class="sub">These details appear on prescriptions, receipts and reports</div>
      </div>
    </div>

    <form id="settings-form" class="grid grid--2">
      <section class="card">
        <div class="card-head"><h2>Hospital identity</h2></div>
        <div class="card-body form-grid">
          ${field('hospital_name', 'Hospital name', s.hospital_name, { span: '2' })}
          ${field('hospital_tagline', 'Tagline', s.hospital_tagline, { span: '2' })}
          ${field('hospital_address', 'Address', s.hospital_address, { span: '2' })}
          ${field('hospital_phone', 'Phone', s.hospital_phone)}
          ${field('hospital_email', 'Email', s.hospital_email)}
          ${field('hospital_registration', 'Registration number', s.hospital_registration, { span: '2' })}
          ${field('disclaimer', 'Footer note on printed documents', s.disclaimer, { span: '2' })}
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Numbering &amp; sessions</h2></div>
        <div class="card-body form-grid">
          ${field('mrn_prefix', 'MRN prefix', s.mrn_prefix, { hint: 'e.g. KH → KH-000123' })}
          ${field('visit_prefix', 'Visit prefix', s.visit_prefix, { hint: 'e.g. V → V-000123' })}
          ${field('invoice_prefix', 'Invoice prefix', s.invoice_prefix)}
          ${field('receipt_prefix', 'Receipt prefix', s.receipt_prefix)}
          ${field('session_idle_minutes', 'Auto sign-out after (minutes)', s.session_idle_minutes, { type: 'number', hint: 'Default 20. Reception PCs should stay short.' })}
          ${field('backup_retention', 'Backups to keep', s.backup_retention, { type: 'number', hint: 'Older backups are deleted automatically.' })}
          <div class="field span-2">
            <label>Dataset</label>
            <div class="alert ${s.synthetic_data === 'true' ? 'alert--warn' : 'alert--info'}">${ui.icon('info')}<div class="xs">
              ${s.synthetic_data === 'true'
                ? 'This installation is marked as containing synthetic test data only.'
                : 'This installation contains live clinic data. Ensure backups and access control are in place.'}
            </div></div>
            <label class="checkbox">
              <input type="checkbox" name="synthetic_data" value="true" ${s.synthetic_data === 'true' ? 'checked' : ''}>
              <span>This installation still holds synthetic test data only</span>
            </label>
            <div class="hint">Untick this once the demonstration records have been cleared and real patients are being registered. The dashboard banner disappears when it is off.</div>
          </div>
        </div>
        <div class="card-foot row" style="justify-content:flex-end">
          <button class="btn btn--primary" type="submit">${ui.icon('save')}<span>Save settings</span></button>
        </div>
      </section>
    </form>
  `;

  const form = root.querySelector('#settings-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = form.querySelector('[type="submit"]');
    ui.setBusy(button, true, 'Saving…');
    try {
      const values = ui.formValues(form);
      await api.patch('/api/admin/settings', values);
      await api.me();
      ui.toastOk('Settings saved.');
      navigate('/admin/settings');
    } catch (err) {
      ui.toastError(err.message);
    } finally {
      ui.setBusy(button, false);
    }
  });
}
