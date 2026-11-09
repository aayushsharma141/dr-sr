/**
 * UI kit: icons, formatting helpers and the handful of components the app
 * needs (toasts, modals, confirmation, print sheets). No framework, no build.
 */

// ---------------------------------------------------------------------------
// Icons (inline SVG, stroke based, 24x24 grid)
// ---------------------------------------------------------------------------
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  receipt: '<path d="M4 2h16v20l-2.5-1.5L15 22l-3-1.5L9 22l-2.5-1.5L4 22z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  'id-card': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2.2"/><path d="M5 17c0-1.7 1.3-3 3-3s3 1.3 3 3"/><path d="M14 9h5M14 13h5"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'arrow-left': '<path d="M19 12H5M12 19l-7-7 7-7"/>',
  printer: '<path d="M6 9V2h12v7"/><rect x="2" y="9" width="20" height="8" rx="2"/><path d="M6 17h12v5H6z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 9 5-5 5 5"/><path d="M12 4v12"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>',
  edit: '<path d="M11 4H4v16h16v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M17 3l4 4M14 6l4 4"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  heart: '<path d="M20.8 5.6a5.5 5.5 0 0 0-7.8 0L12 6.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/>',
  pill: '<path d="m10.5 20.5 10-10a5 5 0 0 0-7-7l-10 10a5 5 0 0 0 7 7z"/><path d="m8.5 8.5 7 7"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/>',
  stethoscope: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1a.3.3 0 0 0 .2.3"/><path d="M8 15v1a6 6 0 0 0 12 0v-4"/><circle cx="20" cy="10" r="2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  wallet: '<path d="M20 8H4a2 2 0 0 1 0-4h13a1 1 0 0 1 1 1v3"/><path d="M3 6v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M21 10v6h-5a3 3 0 0 1 0-6h5z"/>',
  userPlus: '<path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M19 8v6M16 11h6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M7 3v6h8M7 21v-7h10v7"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2 4.2 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.1a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7A2 2 0 0 1 22 16.9z"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
  'flask': '<path d="M9 3h6M10 3v6L4.5 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.8-3L14 9V3"/><path d="M7 15h10"/>',
};

export function icon(name, size = 18) {
  const body = ICONS[name] || ICONS.info;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor"
    stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Hydrates every <span data-icon="name"> inside a root element. */
export function hydrateIcons(root = document) {
  for (const node of root.querySelectorAll('[data-icon]')) {
    const name = node.getAttribute('data-icon');
    if (!node.firstChild) node.innerHTML = icon(name);
  }
}

// ---------------------------------------------------------------------------
// Escaping / DOM helpers
// ---------------------------------------------------------------------------
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

export function elFrom(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

export function on(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

/** Serialises a form into a plain object (checkbox-aware, trims strings). */
export function formValues(form) {
  const out = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      out[key] = trimmed === '' ? null : trimmed;
    } else {
      out[key] = value;
    }
  }
  for (const box of form.querySelectorAll('input[type="checkbox"][name]')) {
    out[box.name] = box.checked;
  }
  return out;
}

export function debounce(fn, ms = 220) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------
const money = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function inr(paise) {
  if (paise === null || paise === undefined) return '—';
  return `₹${money.format(Number(paise) / 100)}`;
}

export function inrShort(paise) {
  const rupees = Number(paise || 0) / 100;
  if (rupees >= 10000000) return `₹${(rupees / 10000000).toFixed(2)} Cr`;
  if (rupees >= 100000) return `₹${(rupees / 100000).toFixed(2)} L`;
  if (rupees >= 1000) return `₹${(rupees / 1000).toFixed(1)}k`;
  return `₹${rupees.toFixed(0)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Clinic timezone reported by the server (e.g. "Asia/Kolkata"). Timestamps are
// stored in UTC and always rendered in the clinic's clock so that a workstation
// with a wrong Windows timezone still shows the same appointment time as the
// reception desk.
let clinicTz;

export function setTimezone(tz) {
  clinicTz = tz || undefined;
}

function tzOption() {
  return clinicTz ? { timeZone: clinicTz } : {};
}

/** "1990-05-12" -> "12 May 1990" (parsed as parts: no timezone surprises). */
export function fmtDate(value, { short = false, withTime = false } = {}) {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, day] = value.split('-').map(Number);
    return short
      ? `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${String(y).slice(2)}`
      : `${String(day).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const opts = short
    ? { day: '2-digit', month: 'short', year: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) {
    opts.hour = '2-digit';
    opts.minute = '2-digit';
  }
  return new Intl.DateTimeFormat('en-IN', { ...opts, ...tzOption() }).format(d);
}

export function fmtTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    ...tzOption(),
  }).format(d);
}

export function fmtDateTime(value) {
  if (!value) return '—';
  return `${fmtDate(value, { short: true })} · ${fmtTime(value)}`;
}

export function fmtRelative(value) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return fmtDate(value, { short: true });
}

export function fmtAge(dob, ageYears) {
  if (ageYears !== undefined && ageYears !== null) return `${ageYears} y`;
  if (!dob) return '—';
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years -= 1;
  if (years < 1) {
    const months = Math.max(0, Math.floor((now - d) / (1000 * 60 * 60 * 24 * 30.44)));
    return `${months} mo`;
  }
  return `${years} y`;
}

export function initials(name) {
  if (!name) return '–';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '–';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function sexLabel(sex) {
  return { male: 'Male', female: 'Female', other: 'Other', unknown: 'Not recorded' }[sex] || '—';
}

const VISIT_TYPE_LABELS = {
  opd: 'OPD', ipd: 'In-patient', emergency: 'Emergency', follow_up: 'Follow-up', teleconsult: 'Tele-consult',
};

export function visitTypeLabel(value) {
  return VISIT_TYPE_LABELS[value] || titleCase(value);
}

export function titleCase(value) {
  if (!value) return '';
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function bytes(size) {
  if (!size && size !== 0) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Status pills
// ---------------------------------------------------------------------------
const STATUS_MAP = {
  open: ['pill--info', 'Open'],
  closed: ['pill--muted', 'Closed'],
  cancelled: ['pill--muted', 'Cancelled'],
  void: ['pill--muted', 'Void'],
  paid: ['pill--ok', 'Paid'],
  partially_paid: ['pill--warn', 'Part paid'],
  scheduled: ['pill--info', 'Scheduled'],
  arrived: ['pill--brand', 'Arrived'],
  completed: ['pill--ok', 'Completed'],
  no_show: ['pill--danger', 'No show'],
  active: ['pill--ok', 'Active'],
  resolved: ['pill--muted', 'Resolved'],
  in_remission: ['pill--muted', 'In remission'],
  scheduled_backup: ['pill--info', 'Scheduled'],
  ok: ['pill--ok', 'OK'],
  failed: ['pill--danger', 'Failed'],
  missing: ['pill--danger', 'Missing'],
};

export function statusPill(status, labelOverride) {
  if (!status) return '<span class="pill pill--muted">—</span>';
  const [cls, label] = STATUS_MAP[status] || ['', titleCase(status)];
  return `<span class="pill ${cls}">${esc(labelOverride || label)}</span>`;
}

const SEVERITY_MAP = {
  mild: 'pill--warn',
  moderate: 'pill--warn',
  severe: 'pill--danger',
  life_threatening: 'pill--danger',
};

export function severityPill(severity) {
  const cls = SEVERITY_MAP[severity] || 'pill';
  const label = severity === 'life_threatening' ? 'Life threatening' : titleCase(severity);
  return `<span class="pill ${cls}">${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
export function toast(message, type = 'info', timeout = 4200) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const icoName = type === 'error' ? 'alert' : type === 'ok' ? 'check-circle' : 'info';
  const node = el(`<div class="toast toast--${type}">${icon(icoName, 16)}<div>${esc(message)}</div></div>`);
  root.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s ease, transform .2s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateY(6px)';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

export const toastOk = (m) => toast(m, 'ok');
export const toastError = (m) => toast(m, 'error', 6000);

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
let modalStack = 0;

export function modal({
  title = '',
  subtitle = '',
  body = '',
  footer = '',
  width = '',
  onMount,
  onClose,
  closeOnBackdrop = true,
} = {}) {
  const root = document.getElementById('modal-root');
  const widthClass = width === 'wide' ? 'modal--wide' : width === 'narrow' ? 'modal--narrow' : '';
  const backdrop = el(`
    <div class="modal-backdrop" role="presentation">
      <div class="modal ${widthClass}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head">
          <div class="grow">
            <h2>${esc(title)}</h2>
            ${subtitle ? `<div class="sub">${esc(subtitle)}</div>` : ''}
          </div>
          <button class="icon-btn" type="button" data-close aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="modal-body">${body}</div>
        ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
      </div>
    </div>
  `);

  modalStack += 1;
  document.body.style.overflow = 'hidden';
  root.appendChild(backdrop);

  const previousFocus = document.activeElement;
  const dialog = backdrop.querySelector('.modal');
  const focusable = dialog.querySelector(
    'input:not([type=hidden]), select, textarea, button:not([data-close]), [href], [tabindex]:not([tabindex="-1"])',
  );
  if (focusable) setTimeout(() => focusable.focus(), 30);

  function close() {
    if (!backdrop.isConnected) return;
    backdrop.remove();
    modalStack = Math.max(0, modalStack - 1);
    if (modalStack === 0) document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (previousFocus && previousFocus.focus) previousFocus.focus();
    if (onClose) onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
    if (e.key === 'Tab') {
      const nodes = [...dialog.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop && closeOnBackdrop) close();
  });
  backdrop.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));

  if (onMount) onMount({ root: backdrop, dialog, close });
  return { root: backdrop, dialog, close };
}

export function confirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireReason = null,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const reasonField = requireReason
      ? `<div class="field mt-2">
           <label for="confirm-reason">${esc(requireReason)} <span class="req">*</span></label>
           <input class="input" id="confirm-reason" name="reason" maxlength="300" autocomplete="off">
           <div class="field-error hidden" data-reason-error></div>
         </div>`
      : '';
    const handle = modal({
      title,
      width: 'narrow',
      body: `<p class="sm">${esc(message)}</p>${reasonField}`,
      footer: `
        <button class="btn" type="button" data-cancel>${esc(cancelLabel)}</button>
        <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" type="button" data-confirm>${esc(confirmLabel)}</button>
      `,
      onClose: () => { if (!settled) { settled = true; resolve(null); } },
    });

    const reasonInput = handle.dialog.querySelector('#confirm-reason');
    handle.dialog.querySelector('[data-cancel]').addEventListener('click', () => {
      settled = true;
      resolve(null);
      handle.close();
    });
    handle.dialog.querySelector('[data-confirm]').addEventListener('click', () => {
      if (requireReason) {
        const value = reasonInput.value.trim();
        if (value.length < 3) {
          const err = handle.dialog.querySelector('[data-reason-error]');
          err.textContent = 'Please give a short reason (at least 3 characters).';
          err.classList.remove('hidden');
          reasonInput.setAttribute('aria-invalid', 'true');
          reasonInput.focus();
          return;
        }
        settled = true;
        resolve(value);
        handle.close();
        return;
      }
      settled = true;
      resolve(true);
      handle.close();
    });
  });
}

// ---------------------------------------------------------------------------
// Printing - renders a sheet inside a modal and prints just that content.
// ---------------------------------------------------------------------------
export function printSheet({ title, subtitle = '', html, filename = 'document' }) {
  const handle = modal({
    title,
    subtitle,
    width: 'wide',
    body: `<div class="print-sheet">${html}</div>`,
    footer: `
      <button class="btn" type="button" data-close>Close</button>
      <button class="btn btn--primary" type="button" data-print>${icon('printer')}<span>Print</span></button>
    `,
  });
  handle.dialog.querySelector('[data-print]').addEventListener('click', () => window.print());
  document.title = `${title} · ${filename}`;
  return handle;
}

// ---------------------------------------------------------------------------
// Misc components
// ---------------------------------------------------------------------------
export function emptyState({ iconName = 'search', title = 'Nothing here yet', message = '', action = '' } = {}) {
  return `<div class="empty">
    <div class="empty-ico">${icon(iconName, 20)}</div>
    <h3>${esc(title)}</h3>
    ${message ? `<p>${esc(message)}</p>` : ''}
    ${action ? `<div class="mt-2">${action}</div>` : ''}
  </div>`;
}

export function loadingRow(label = 'Loading…') {
  return `<div class="loading-row"><span class="spinner"></span><span>${esc(label)}</span></div>`;
}

export function setBusy(button, busy, busyLabel = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner" style="width:14px;height:14px;border-width:2px"></span><span>${esc(busyLabel)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) button.innerHTML = button.dataset.originalLabel;
  }
}

/** Shows field-level errors returned by the API on inputs named the same way. */
export function applyFieldErrors(scope, details) {
  scope.querySelectorAll('[aria-invalid="true"]').forEach((n) => n.removeAttribute('aria-invalid'));
  scope.querySelectorAll('[data-error-for]').forEach((n) => { n.textContent = ''; n.classList.add('hidden'); });
  let first = null;
  for (const detail of details || []) {
    const field = detail.field;
    const input = scope.querySelector(`[name="${CSS.escape(field)}"]`);
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (!first) first = input;
      const holder = scope.querySelector(`[data-error-for="${CSS.escape(field)}"]`);
      if (holder) {
        holder.textContent = detail.message;
        holder.classList.remove('hidden');
      }
    }
  }
  if (first) first.focus();
}

export function download(name, content, type = 'text/csv;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob(['\ufeff', content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
