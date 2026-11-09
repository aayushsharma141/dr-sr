/**
 * Application bootstrap: authentication screens, shell, hash router,
 * global patient search and session housekeeping.
 */
import { api, session, setUnauthenticatedHandler, ApiError } from './api.js';
import * as ui from './ui.js';

import dashboardView from './views/dashboard.js';
import patientsView from './views/patients.js';
import patientView from './views/patient.js';
import appointmentsView from './views/appointments.js';
import billingView from './views/billing.js';
import invoiceView from './views/invoice.js';
import accountView from './views/account.js';
import { usersView, auditView, backupsView, settingsView } from './views/admin.js';

const routes = [
  { name: 'dashboard', pattern: /^\/dashboard\/?$/, view: dashboardView },
  { name: 'patients', pattern: /^\/patients\/?$/, view: patientsView, perm: 'patient.read' },
  { name: 'patient', pattern: /^\/patients\/(\d+)\/?$/, view: patientView, perm: 'patient.read' },
  { name: 'appointments', pattern: /^\/appointments\/?$/, view: appointmentsView, perm: 'appointment.read', fallbackPerm: 'visit.read' },
  { name: 'billing', pattern: /^\/billing\/?$/, view: billingView, perm: 'billing.read' },
  { name: 'invoice', pattern: /^\/billing\/(\d+)\/?$/, view: invoiceView, perm: 'billing.read' },
  { name: 'account', pattern: /^\/account\/?$/, view: accountView },
  { name: 'admin-users', pattern: /^\/admin\/users\/?$/, view: usersView, perm: 'user.manage' },
  { name: 'admin-audit', pattern: /^\/admin\/audit\/?$/, view: auditView, perm: 'audit.read' },
  { name: 'admin-backups', pattern: /^\/admin\/backups\/?$/, view: backupsView, perm: 'backup.manage' },
  { name: 'admin-settings', pattern: /^\/admin\/settings\/?$/, view: settingsView, perm: 'settings.manage' },
];

const dom = {
  boot: () => document.getElementById('boot'),
  auth: () => document.getElementById('auth'),
  shell: () => document.getElementById('shell'),
  view: () => document.getElementById('view'),
  nav: () => document.getElementById('nav'),
};

let currentRoute = null;
let renderToken = 0;

export function navigate(path) {
  if (location.hash === `#${path}`) {
    render();
    return;
  }
  location.hash = path;
}

function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash || '/dashboard';
}

// ---------------------------------------------------------------------------
// Global search
// ---------------------------------------------------------------------------
function setupGlobalSearch() {
  const form = document.getElementById('global-search');
  const input = document.getElementById('global-search-input');
  const results = document.getElementById('global-search-results');

  const close = () => {
    results.hidden = true;
    results.innerHTML = '';
  };

  const search = ui.debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      close();
      return;
    }
    try {
      const res = await api.get(`/api/patients?q=${encodeURIComponent(q)}&limit=8`);
      if (!res.patients.length) {
        results.innerHTML = `<div class="search-empty">No patient matches “${ui.esc(q)}”.</div>`;
        results.hidden = false;
        return;
      }
      results.innerHTML = res.patients
        .map((p) => `
          <a class="search-hit" href="#/patients/${p.id}">
            <span class="avatar">${ui.esc(ui.initials(p.fullName))}</span>
            <span class="grow">
              <span class="strong">${ui.esc(p.fullName)}</span>
              <span class="muted xs"> · ${ui.esc(ui.fmtAge(p.age, null))} · ${ui.esc(ui.sexLabel(p.sex))}</span>
              <br><span class="mrn">${ui.esc(p.mrn)} · ${ui.esc(p.phone || 'no phone')}</span>
            </span>
            <span class="muted">${ui.icon('chevron-right', 15)}</span>
          </a>`)
        .join('');
      results.hidden = false;
    } catch (err) {
      if (err.status === 401) return;
      results.innerHTML = `<div class="search-empty">${ui.esc(err.message)}</div>`;
      results.hidden = false;
    }
  }, 200);

  input.addEventListener('input', search);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) search(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q) {
      close();
      input.blur();
      navigate(`/patients?q=${encodeURIComponent(q)}`);
    }
  });
  document.addEventListener('click', (e) => {
    if (!form.contains(e.target)) close();
  });
  results.addEventListener('click', () => {
    close();
    input.value = '';
  });
  document.addEventListener('keydown', (e) => {
    const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (e.key === '/' && !typing) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
function applyBranding() {
  const settings = session.settings || {};
  const name = settings.hospitalName || 'Kalyan Hospital';
  document.title = name;
  const brand = document.getElementById('brand-name');
  if (brand) brand.textContent = name;
  const tagline = document.getElementById('brand-tagline');
  if (tagline) tagline.textContent = settings.hospitalTagline || 'Clinic workspace';
}

function applyUser() {
  const user = session.user;
  if (!user) return;
  document.getElementById('user-name').textContent = user.fullName;
  document.getElementById('user-role').textContent = user.roleLabel || user.role;
  document.getElementById('user-avatar').textContent = ui.initials(user.fullName);

  for (const node of document.querySelectorAll('[data-perm]')) {
    node.classList.toggle('hidden', !session.can(node.getAttribute('data-perm')));
  }
  const billingPerm = session.can('billing.read');
  const auditPerm = session.can('audit.read');
  const groupLabel = document.querySelector('.nav-group-label');
  if (groupLabel) {
    groupLabel.classList.toggle(
      'hidden',
      !(auditPerm || session.can('user.manage') || session.can('backup.manage') || session.can('settings.manage')),
    );
  }
  const billingNav = document.querySelector('[data-route="billing"]');
  if (billingNav) billingNav.classList.toggle('hidden', !billingPerm);
}

function setActiveNav(name) {
  for (const item of document.querySelectorAll('.nav-item[data-route]')) {
    item.classList.toggle('is-active', item.getAttribute('data-route') === name);
  }
}

function showShell() {
  dom.boot().classList.add('hidden');
  dom.auth().classList.add('hidden');
  dom.shell().classList.remove('hidden');
  applyBranding();
  applyUser();
}

function enforcePasswordChange() {
  const user = session.user;
  if (!user || !user.mustChangePassword) return false;
  const handle = ui.modal({
    title: 'Choose a new password',
    subtitle: 'Your account was created with a temporary password.',
    width: 'narrow',
    closeOnBackdrop: false,
    body: `
      <form id="forced-pw" class="col" autocomplete="off">
        <div class="alert alert--info">${ui.icon('lock')}<div>For the safety of patient data, set your own password before continuing.</div></div>
        <div class="field">
          <label for="fp-current">Current (temporary) password</label>
          <input class="input" id="fp-current" name="currentPassword" type="password" autocomplete="current-password" required>
          <div class="field-error hidden" data-error-for="currentPassword"></div>
        </div>
        <div class="field">
          <label for="fp-new">New password</label>
          <input class="input" id="fp-new" name="newPassword" type="password" autocomplete="new-password" required>
          <div class="hint">At least 12 characters, mixing letters, numbers or symbols.</div>
          <div class="field-error hidden" data-error-for="newPassword"></div>
        </div>
        <div class="field">
          <label for="fp-confirm">Repeat new password</label>
          <input class="input" id="fp-confirm" name="confirm" type="password" autocomplete="new-password" required>
          <div class="field-error hidden" data-error-for="confirm"></div>
        </div>
      </form>`,
    footer: `<button class="btn btn--primary" type="button" data-save>Update password</button>`,
  });

  const form = handle.dialog.querySelector('#forced-pw');
  const button = handle.dialog.querySelector('[data-save]');
  button.addEventListener('click', async () => {
    const values = ui.formValues(form);
    if (values.newPassword !== values.confirm) {
      ui.applyFieldErrors(form, [{ field: 'confirm', message: 'Passwords do not match.' }]);
      return;
    }
    ui.setBusy(button, true, 'Saving…');
    try {
      const res = await api.post('/api/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      session.set({ user: res.user });
      applyUser();
      ui.toastOk('Password updated.');
      handle.close();
    } catch (err) {
      if (err.details) ui.applyFieldErrors(form, err.details);
      else ui.toastError(err.message);
    } finally {
      ui.setBusy(button, false);
    }
  });
  return true;
}

async function render() {
  ui.setTimezone((session.settings || {}).timezone);
  const path = currentPath();
  const token = ++renderToken;
  let match = null;
  let params = [];

  for (const route of routes) {
    const m = path.split('?')[0].match(route.pattern);
    if (m) {
      match = route;
      params = m.slice(1);
      break;
    }
  }

  if (!match) {
    navigate('/dashboard');
    return;
  }

  const requiredPerms = [match.perm, match.fallbackPerm].filter(Boolean);
  if (requiredPerms.length && !requiredPerms.some((p) => session.can(p))) {
    dom.view().innerHTML = `
      <div class="card"><div class="card-body">
        ${ui.emptyState({
          iconName: 'lock',
          title: 'You do not have access to this section',
          message: 'Ask an administrator if you need it enabled for your role.',
          action: '<a class="btn" href="#/dashboard">Back to dashboard</a>',
        })}
      </div></div>`;
    setActiveNav('none');
    return;
  }

  currentRoute = match.name;
  setActiveNav(match.name);
  const view = dom.view();
  view.innerHTML = ui.loadingRow();

  const query = new URLSearchParams(path.split('?')[1] || '');
  try {
    await match.view(view, { params, query, navigate });
  } catch (err) {
    if (token !== renderToken) return;
    if (err.status === 401) return;
    view.innerHTML = `
      <div class="card"><div class="card-body">
        ${ui.emptyState({
          iconName: 'alert',
          title: 'Could not load this page',
          message: err.message || 'Unexpected error.',
          action: '<button class="btn" onclick="location.reload()">Reload</button>',
        })}
      </div></div>`;
  }
}

// ---------------------------------------------------------------------------
// Auth screens
// ---------------------------------------------------------------------------
function renderLogin(hospitalName) {
  dom.boot().classList.add('hidden');
  dom.shell().classList.add('hidden');
  const auth = dom.auth();
  auth.classList.remove('hidden');
  auth.innerHTML = `
    <aside class="auth-aside">
      <div>
        <div class="row" style="gap:12px">
          <div class="brand-mark brand-mark--lg">+</div>
          <div>
            <div style="font-size:16px;font-weight:600;color:#fff">${ui.esc(hospitalName || 'Kalyan Hospital')}</div>
            <div class="xs" style="color:rgba(234,250,247,.7)">Clinic workspace · local network</div>
          </div>
        </div>
        <h1 class="mt-3">Everything the clinic needs,<br>on your own network.</h1>
        <p class="mt-1">Patient records, clinical notes, billing and audit history — served from one
        computer in the clinic. No internet connection required.</p>
        <div class="auth-points">
          <div class="auth-point"><span class="tick">✓</span><div>Shared records for reception and doctors, updated live across the clinic</div></div>
          <div class="auth-point"><span class="tick">✓</span><div>Role-based access — reception never sees clinical notes</div></div>
          <div class="auth-point"><span class="tick">✓</span><div>Every record access is written to a tamper-evident audit trail</div></div>
          <div class="auth-point"><span class="tick">✓</span><div>Nightly encrypted backups that stay inside the building</div></div>
        </div>
      </div>
      <div class="xs" style="color:rgba(234,250,247,.6)">
        Data stays on the clinic LAN. Nothing is sent to the internet.
      </div>
    </aside>
    <div class="auth-main">
      <div class="auth-card">
        <h2>Sign in</h2>
        <p class="muted sm mt-0">Use the account given to you by the hospital administrator.</p>
        <form id="login-form" class="col mt-2" autocomplete="on" novalidate>
          <div class="field">
            <label for="login-username">Username</label>
            <input class="input" id="login-username" name="username" autocomplete="username"
                   autocapitalize="none" spellcheck="false" required autofocus>
            <div class="field-error hidden" data-error-for="username"></div>
          </div>
          <div class="field">
            <label for="login-password">Password</label>
            <input class="input" id="login-password" name="password" type="password"
                   autocomplete="current-password" required>
            <div class="field-error hidden" data-error-for="password"></div>
          </div>
          <div id="login-error" class="alert alert--danger hidden"></div>
          <button class="btn btn--primary btn--lg btn--block" type="submit" id="login-submit">Sign in</button>
        </form>
        <div class="auth-foot">
          <span>Kalyan Hospital · v${ui.esc(session.version || '1.0.0')}</span>
          <span>Forgot your password? Ask an administrator to reset it.</span>
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('login-form');
  const errorBox = document.getElementById('login-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = document.getElementById('login-submit');
    errorBox.classList.add('hidden');
    ui.setBusy(button, true, 'Signing in…');
    try {
      await api.login(form.username.value.trim(), form.password.value);
      await api.me();
      showShell();
      navigate('/dashboard');
      render();
      enforcePasswordChange();
    } catch (err) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
      errorBox.classList.remove('hidden');
      if (err.details) ui.applyFieldErrors(form, err.details);
      form.password.value = '';
      form.password.focus();
    } finally {
      ui.setBusy(button, false);
    }
  });
}

function renderSetup(status) {
  dom.boot().classList.add('hidden');
  dom.shell().classList.add('hidden');
  const auth = dom.auth();
  auth.classList.remove('hidden');
  auth.innerHTML = `
    <aside class="auth-aside">
      <div>
        <div class="row" style="gap:12px">
          <div class="brand-mark brand-mark--lg">+</div>
          <div>
            <div style="font-size:16px;font-weight:600;color:#fff">${ui.esc(status.hospitalName || 'Kalyan Hospital')}</div>
            <div class="xs" style="color:rgba(234,250,247,.7)">First-run setup</div>
          </div>
        </div>
        <h1 class="mt-3">Let's create your<br>administrator account.</h1>
        <p class="mt-1">This is a one-time step. The setup code is printed on the computer that runs
        the clinic server — it is never shown in the browser and is destroyed as soon as this form
        is submitted.</p>
        <div class="auth-points">
          <div class="auth-point"><span class="tick">1</span><div>Look at the server console for the line “ONE-TIME SETUP CODE”</div></div>
          <div class="auth-point"><span class="tick">2</span><div>Enter that code below, with your name and a strong password</div></div>
          <div class="auth-point"><span class="tick">3</span><div>Setup closes permanently once your account exists</div></div>
        </div>
      </div>
      <div class="xs" style="color:rgba(234,250,247,.6)">
        After this, only administrators can create accounts — from the Staff accounts page.
      </div>
    </aside>
    <div class="auth-main">
      <div class="auth-card">
        <h2>Create the first administrator</h2>
        <p class="muted sm mt-0">The setup code is valid for a limited time. Restarting the server prints a new one.</p>
        <form id="setup-form" class="col mt-2" autocomplete="off" novalidate>
          <div class="field">
            <label for="setup-code">One-time setup code <span class="req">*</span></label>
            <input class="input mono" id="setup-code" name="code" placeholder="ABCD-EFGH"
                   style="letter-spacing:.12em;text-transform:uppercase" autocomplete="off" spellcheck="false" required autofocus>
            <div class="field-error hidden" data-error-for="code"></div>
          </div>
          <div class="field">
            <label for="setup-name">Your full name <span class="req">*</span></label>
            <input class="input" id="setup-name" name="fullName" placeholder="Full name of the administrator" required>
            <div class="field-error hidden" data-error-for="fullName"></div>
          </div>
          <div class="field">
            <label for="setup-username">Username <span class="req">*</span></label>
            <input class="input" id="setup-username" name="username" placeholder="admin" autocapitalize="none" spellcheck="false" required>
            <div class="hint">Letters, numbers, dot, dash or underscore.</div>
            <div class="field-error hidden" data-error-for="username"></div>
          </div>
          <div class="field">
            <label for="setup-password">Password <span class="req">*</span></label>
            <input class="input" id="setup-password" name="password" type="password" autocomplete="new-password" required>
            <div class="hint">At least 12 characters; mix letters, numbers or symbols.</div>
            <div class="field-error hidden" data-error-for="password"></div>
          </div>
          <div class="field">
            <label for="setup-hospital">Hospital name</label>
            <input class="input" id="setup-hospital" name="hospitalName" value="${ui.esc(status.hospitalName || 'Kalyan Hospital')}">
          </div>
          <div id="setup-error" class="alert alert--danger hidden"></div>
          <button class="btn btn--primary btn--lg btn--block" type="submit" id="setup-submit">Create administrator</button>
        </form>
        <div class="auth-foot">
          <span>The setup code is printed only on the server console — never send it by email or WhatsApp.</span>
        </div>
      </div>
    </div>
  `;

  const form = document.getElementById('setup-form');
  const errorBox = document.getElementById('setup-error');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = document.getElementById('setup-submit');
    errorBox.classList.add('hidden');
    ui.setBusy(button, true, 'Creating…');
    try {
      const values = ui.formValues(form);
      await api.completeSetup(values);
      await api.me();
      ui.toastOk('Administrator created. Welcome to ' + (session.settings?.hospitalName || 'Kalyan Hospital') + '.');
      showShell();
      navigate('/dashboard');
      render();
    } catch (err) {
      errorBox.innerHTML = `${ui.icon('alert')}<div>${ui.esc(err.message)}</div>`;
      errorBox.classList.remove('hidden');
      if (err.details) ui.applyFieldErrors(form, err.details);
    } finally {
      ui.setBusy(button, false);
    }
  });
}

// ---------------------------------------------------------------------------
// Session / connection helpers
// ---------------------------------------------------------------------------
async function signOut() {
  await api.logout();
  session.clear();
  location.hash = '';
  location.reload();
}

function wireShell() {
  document.getElementById('logout-btn').addEventListener('click', signOut);
  const menu = document.getElementById('menu-toggle');
  const sidebar = document.getElementById('sidebar');
  if (menu && sidebar) {
    menu.addEventListener('click', () => sidebar.classList.toggle('is-open'));
    dom.view().addEventListener('click', () => sidebar.classList.remove('is-open'));
  }
  for (const item of document.querySelectorAll('.nav-item[data-route]')) {
    item.addEventListener('click', () => sidebar.classList.remove('is-open'));
  }

  const chip = document.getElementById('sync-chip');
  const label = document.getElementById('sync-label');
  const netBadge = document.getElementById('net-badge');
  const update = () => {
    const online = navigator.onLine;
    chip?.classList.toggle('is-offline', !online);
    netBadge?.classList.toggle('is-offline', !online);
    if (label) label.textContent = online ? 'Connected' : 'Network down';
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

setUnauthenticatedHandler(() => {
  if (location.hash.startsWith('#/setup')) return;
  dom.shell().classList.add('hidden');
  dom.auth().classList.remove('hidden');
  if (!document.getElementById('login-form')) {
    renderLogin(session.settings?.hospitalName);
    ui.toastError('Your session has ended. Please sign in again.');
  }
});

window.addEventListener('hashchange', () => {
  if (session.isAuthenticated) render();
});

async function boot() {
  ui.hydrateIcons();
  try {
    const status = await api.bootstrapStatus();
    if (status.setupRequired) {
      session.setVersion(status.version);
      renderSetup(status);
      return;
    }
  } catch (err) {
    dom.boot().innerHTML = `<div class="boot-card">
      <div class="alert alert--danger">${ui.icon('alert')}<div>Cannot reach the clinic server.<br><span class="xs">${ui.esc(err.message)}</span></div></div>
      <button class="btn" onclick="location.reload()">Retry</button>
    </div>`;
    return;
  }

  const restored = session.restore();
  if (restored) {
    try {
      const me = await api.me();
      session.setVersion(me.version);
      showShell();
      wireShell();
      setupGlobalSearch();
      render();
      enforcePasswordChange();
      return;
    } catch (err) {
      session.clear();
    }
  }
  renderLogin();
  wireShell();
}

boot();
