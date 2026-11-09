/** My account: profile, password change and active sessions. */
import { api, session } from '../api.js';
import * as ui from '../ui.js';

export default async function accountView(root, { navigate }) {
  const [userRes, sessionsRes] = await Promise.all([api.get('/api/auth/me'), api.get('/api/auth/sessions')]);
  const user = userRes.user;
  const sessions = sessionsRes.sessions;
  const settings = session.settings || {};

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>My account</h1>
        <div class="sub">${ui.esc(user.fullName)} · ${ui.esc(user.roleLabel)}</div>
      </div>
    </div>

    <div class="grid grid--2">
      <section class="card">
        <div class="card-head"><h2>Profile</h2></div>
        <div class="card-body">
          <div class="row mb-2" style="gap:12px">
            <span class="avatar avatar--lg">${ui.esc(ui.initials(user.fullName))}</span>
            <div>
              <div class="strong">${ui.esc(user.fullName)}</div>
              <div class="muted xs">${ui.esc(user.username)} · ${ui.esc(user.roleLabel)}</div>
            </div>
          </div>
          <dl class="kv">
            <dt>Designation</dt><dd>${ui.esc(user.designation || '—')}</dd>
            <dt>Specialty</dt><dd>${ui.esc(user.specialty || '—')}</dd>
            <dt>Registration no.</dt><dd>${ui.esc(user.registrationNo || '—')}</dd>
            <dt>Phone</dt><dd>${ui.esc(user.phone || '—')}</dd>
            <dt>Last sign-in</dt><dd>${ui.esc(user.lastLoginAt ? ui.fmtDateTime(user.lastLoginAt) : '—')}</dd>
            <dt>Clinic</dt><dd>${ui.esc(settings.hospitalName || 'Kalyan Hospital')}</dd>
          </dl>
          <div class="divider"></div>
          <div class="section-title mb-1">Your permissions</div>
          <div class="tag-list">
            ${user.permissions.map((p) => `<span class="pill pill--muted">${ui.esc(p)}</span>`).join('')}
          </div>
          <div class="alert alert--info mt-2">${ui.icon('info')}<div class="xs">
            Only an administrator can change your name, role or password (other than your own password below).
          </div></div>
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Change password</h2></div>
        <div class="card-body">
          <form id="pw-form" class="col" novalidate autocomplete="off">
            ${user.mustChangePassword ? `<div class="alert alert--warn">${ui.icon('alert')}<div class="xs">Your account is using a temporary password. Please change it now.</div></div>` : ''}
            <div class="field">
              <label for="pw-current">Current password</label>
              <input class="input" id="pw-current" name="currentPassword" type="password" autocomplete="current-password">
              <div class="field-error hidden" data-error-for="currentPassword"></div>
            </div>
            <div class="field">
              <label for="pw-new">New password</label>
              <input class="input" id="pw-new" name="newPassword" type="password" autocomplete="new-password">
              <div class="hint">At least 12 characters, mixing letters, numbers or symbols. Not your username or name.</div>
              <div class="field-error hidden" data-error-for="newPassword"></div>
            </div>
            <div class="field">
              <label for="pw-confirm">Repeat new password</label>
              <input class="input" id="pw-confirm" name="confirm" type="password" autocomplete="new-password">
              <div class="field-error hidden" data-error-for="confirm"></div>
            </div>
            <div id="pw-error" class="alert alert--danger hidden"></div>
            <button class="btn btn--primary" type="submit" id="pw-save">Update password</button>
          </form>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <div class="grow"><h2>Active sessions</h2><div class="muted xs">Where this account is signed in</div></div>
          <button class="btn btn--sm" data-action="revoke">Sign out other PCs</button>
        </div>
        <div class="table-wrap"><table class="table table--compact">
          <thead><tr><th>Device</th><th>IP</th><th>Last active</th><th>Expires</th><th></th></tr></thead>
          <tbody>
            ${sessions.map((s) => `
              <tr>
                <td class="truncate" style="max-width:280px">${ui.esc((s.userAgent || 'Unknown browser').slice(0, 70))}</td>
                <td class="mono xs">${ui.esc(s.ip || '—')}</td>
                <td class="muted nowrap">${ui.esc(ui.fmtRelative(s.lastSeenAt))}</td>
                <td class="muted nowrap">${ui.esc(ui.fmtTime(s.expiresAt))}</td>
                <td class="right">${s.current ? '<span class="pill pill--ok">This device</span>' : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </section>

      <section class="card">
        <div class="card-head"><h2>Security notes</h2></div>
        <div class="card-body col" style="gap:10px">
          <div class="sm"><strong>Auto sign-out:</strong> after ${ui.esc(String(settings.sessionIdleMinutes || 20))} minutes of inactivity, or ${12} hours after signing in.</div>
          <div class="sm"><strong>Audit trail:</strong> opening a patient chart, downloading a document and taking a payment are all recorded against your account.</div>
          <div class="sm"><strong>Shared computers:</strong> always use “Sign out” at reception rather than just closing the browser window.</div>
          <div class="alert alert--warn">${ui.icon('alert')}<div class="xs">Never share your password. Every action in the audit trail is attributed to the account, not the person.</div></div>
        </div>
      </section>
    </div>
  `;

  const form = root.querySelector('#pw-form');
  const errorBox = root.querySelector('#pw-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.classList.add('hidden');
    const values = ui.formValues(form);
    if (values.newPassword !== values.confirm) {
      ui.applyFieldErrors(form, [{ field: 'confirm', message: 'Passwords do not match.' }]);
      return;
    }
    const button = root.querySelector('#pw-save');
    ui.setBusy(button, true, 'Updating…');
    try {
      const res = await api.post('/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      session.set({ user: res.user });
      ui.toastOk('Password updated. Other sessions were signed out.');
      navigate('/account');
    } catch (err) {
      if (err.details) ui.applyFieldErrors(form, err.details);
      else {
        errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
        errorBox.classList.remove('hidden');
      }
    } finally {
      ui.setBusy(button, false);
    }
  });

  root.querySelector('[data-action="revoke"]')?.addEventListener('click', async () => {
    const ok = await ui.confirmDialog({
      title: 'Sign out other devices?',
      message: 'Every other browser session for your account will end. You will stay signed in here.',
      confirmLabel: 'Sign out other devices',
    });
    if (!ok) return;
    try {
      const res = await api.post('/api/auth/sessions/revoke-others', {});
      ui.toastOk(`${res.revoked} session${res.revoked === 1 ? '' : 's'} signed out.`);
      navigate('/account');
    } catch (err) { ui.toastError(err.message); }
  });
}
