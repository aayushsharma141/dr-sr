/**
 * Thin API client.
 *
 * The session token is kept in sessionStorage (cleared when the browser tab
 * closes) and sent as a header, which also makes it immune to CSRF: no other
 * origin can attach a header to a request. The server additionally sets an
 * HttpOnly cookie as a fallback for reloads.
 */
const STORAGE_KEY = 'kh.session';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'error', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** Field name -> message, for inline form errors. */
  fieldErrors() {
    const out = {};
    for (const detail of this.details || []) {
      if (detail && detail.field) out[detail.field] = detail.message;
    }
    return out;
  }
}

const state = {
  token: null,
  csrf: null,
  user: null,
  settings: null,
  serverTime: null,
  version: null,
};

export const session = {
  get user() { return state.user; },
  get settings() { return state.settings; },
  get version() { return state.version; },
  get token() { return state.token; },
  get csrf() { return state.csrf; },
  get isAuthenticated() { return !!state.token && !!state.user; },

  setVersion(version) {
    state.version = version || state.version;
  },

  set({ token, csrf, user, settings }) {
    if (token) state.token = token;
    if (csrf) state.csrf = csrf;
    if (user) state.user = user;
    if (settings) state.settings = settings;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        token: state.token, csrf: state.csrf, user: state.user, settings: state.settings,
      }));
    } catch { /* private mode: keep in memory only */ }
  },

  restore() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      state.token = parsed.token || null;
      state.csrf = parsed.csrf || null;
      state.user = parsed.user || null;
      state.settings = parsed.settings || null;
      return !!state.token;
    } catch {
      return false;
    }
  },

  clear() {
    state.token = null;
    state.csrf = null;
    state.user = null;
    state.settings = null;
    try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  },

  can(permission) {
    return !!state.user && Array.isArray(state.user.permissions) && state.user.permissions.includes(permission);
  },
};

let onUnauthenticated = () => {};
export function setUnauthenticatedHandler(fn) {
  onUnauthenticated = fn;
}

async function request(method, path, { body, headers = {}, raw, signal } = {}) {
  const init = {
    method,
    headers: { accept: 'application/json', ...headers },
    credentials: 'same-origin',
    signal,
  };
  if (state.token) init.headers['x-session-token'] = state.token;
  if (state.csrf) init.headers['x-csrf-token'] = state.csrf;
  if (raw !== undefined && raw !== null) {
    init.body = raw;
  } else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(path, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(
      'Cannot reach the clinic server. Check the network cable / Wi-Fi and try again.',
      { code: 'network_error' },
    );
  }

  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = null; }
  }

  if (!res.ok) {
    if (res.status === 401) {
      session.clear();
      onUnauthenticated();
    }
    const error = payload && payload.error ? payload.error : {};
    throw new ApiError(error.message || `Request failed (${res.status}).`, {
      status: res.status,
      code: error.code || 'error',
      details: error.details || null,
    });
  }
  return payload;
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  patch: (path, body, opts) => request('PATCH', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts),

  // ---- auth -------------------------------------------------------------
  async login(username, password) {
    const res = await request('POST', '/api/auth/login', { body: { username, password } });
    session.set({ token: res.token, csrf: res.csrf, user: res.user, settings: res.settings });
    return res;
  },

  async completeSetup(payload) {
    const res = await request('POST', '/api/bootstrap/complete', { body: payload });
    session.set({ token: res.token, csrf: res.csrf, user: res.user });
    return res;
  },

  async logout() {
    try { await request('POST', '/api/auth/logout'); } catch { /* ignore */ }
    session.clear();
  },

  async me() {
    const res = await request('GET', '/api/auth/me');
    session.set({ user: res.user, settings: res.settings });
    state.serverTime = res.serverTime;
    state.version = res.version;
    return res;
  },

  bootstrapStatus() {
    return request('GET', '/api/bootstrap/status');
  },

  // ---- files ------------------------------------------------------------
  async uploadDocument(patientId, file, { category = 'other', title = '', visitId = null, onProgress } = {}) {
    const headers = {
      'content-type': file.type || 'application/octet-stream',
      'x-file-name': encodeURIComponent(file.name).slice(0, 400),
      'x-file-type': file.type || 'application/octet-stream',
      'x-category': category,
      'x-title': encodeURIComponent(title || '').slice(0, 400),
    };
    if (visitId) headers['x-visit-id'] = String(visitId);
    return request('POST', `/api/patients/${patientId}/attachments`, { raw: file, headers });
  },

  async download(path, filename) {
    const headers = {};
    if (state.token) headers['x-session-token'] = state.token;
    const res = await fetch(path, { headers, credentials: 'same-origin' });
    if (!res.ok) {
      let message = 'Download failed.';
      try {
        const body = await res.json();
        message = body.error?.message || message;
      } catch { /* ignore */ }
      throw new ApiError(message, { status: res.status });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  async downloadPost(path, body, filename) {
    const headers = { 'content-type': 'application/json' };
    if (state.token) headers['x-session-token'] = state.token;
    if (state.csrf) headers['x-csrf-token'] = state.csrf;
    const res = await fetch(path, { method: 'POST', headers, credentials: 'same-origin', body: JSON.stringify(body) });
    if (!res.ok) {
      let message = 'Download failed.';
      try {
        const payload = await res.json();
        message = payload.error?.message || message;
      } catch { /* ignore */ }
      throw new ApiError(message, { status: res.status });
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },
};
