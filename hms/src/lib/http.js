'use strict';

/** HTTP helpers: typed errors, input validation, pagination, CSV. */

class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code || defaultCode(status);
    this.details = details;
    this.expose = true;
  }
}

function defaultCode(status) {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthenticated';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 410: return 'gone';
    case 413: return 'payload_too_large';
    case 415: return 'unsupported_media_type';
    case 429: return 'rate_limited';
    default: return 'error';
  }
}

const badRequest = (msg, details) => new ApiError(400, msg, { details });
const unauthorized = (msg = 'Please sign in.') => new ApiError(401, msg);
const forbidden = (msg = 'You do not have permission to do that.') => new ApiError(403, msg);
const notFound = (msg = 'Not found.') => new ApiError(404, msg);
const conflict = (msg) => new ApiError(409, msg);

// ---------------------------------------------------------------------------
// Validation - small, explicit, and strict about types coming from the wire.
// ---------------------------------------------------------------------------
class Validator {
  constructor(body) {
    this.body = body && typeof body === 'object' ? body : {};
    this.errors = [];
  }

  /**
   * Distinguishes "field absent from the request" (undefined - leave as is)
   * from "field sent as empty" (null - clear it). PATCH semantics depend on it.
   */
  has(field) {
    return Object.prototype.hasOwnProperty.call(this.body, field);
  }

  fail(field, message) {
    this.errors.push({ field, message });
    return undefined;
  }

  str(field, { required = false, min = 0, max = 200, trim = true, label } = {}) {
    const name = label || field;
    const present = this.has(field);
    let value = this.body[field];
    if (value === undefined || value === null) value = '';
    if (!present && !required) return undefined;
    if (typeof value !== 'string') {
      if (typeof value === 'number') value = String(value);
      else return this.fail(field, `${name} must be text.`);
    }
    if (trim) value = value.trim();
    if (!value) {
      if (required) return this.fail(field, `${name} is required.`);
      return null;
    }
    if (value.length < min) return this.fail(field, `${name} must be at least ${min} characters.`);
    if (value.length > max) return this.fail(field, `${name} must be at most ${max} characters.`);
    return value;
  }

  int(field, { required = false, min = -Infinity, max = Infinity, label } = {}) {
    const name = label || field;
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${name} is required.`);
      return this.has(field) ? null : undefined;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n)) return this.fail(field, `${name} must be a whole number.`);
    if (n < min) return this.fail(field, `${name} must be at least ${min}.`);
    if (n > max) return this.fail(field, `${name} must be at most ${max}.`);
    return n;
  }

  num(field, { required = false, min = -Infinity, max = Infinity, label } = {}) {
    const name = label || field;
    const raw = this.body[field];
    if (raw === undefined || raw === null || raw === '') {
      if (required) return this.fail(field, `${name} is required.`);
      return this.has(field) ? null : undefined;
    }
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return this.fail(field, `${name} must be a number.`);
    if (n < min) return this.fail(field, `${name} must be at least ${min}.`);
    if (n > max) return this.fail(field, `${name} must be at most ${max}.`);
    return n;
  }

  bool(field, { required = false } = {}) {
    const raw = this.body[field];
    if (raw === undefined || raw === null) {
      if (required) return this.fail(field, `${field} is required.`);
      return this.has(field) ? null : undefined;
    }
    if (typeof raw === 'boolean') return raw;
    if (raw === 1 || raw === 0) return raw === 1;
    if (raw === 'true' || raw === 'false') return raw === 'true';
    return this.fail(field, `${field} must be true or false.`);
  }

  enumOf(field, allowed, { required = false, label } = {}) {
    const name = label || field;
    const value = this.str(field, { required, max: 60 });
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (!allowed.includes(value)) return this.fail(field, `${name} must be one of: ${allowed.join(', ')}.`);
    return value;
  }

  date(field, { required = false, label } = {}) {
    const name = label || field;
    const value = this.str(field, { required, max: 10 });
    if (value === undefined || value === null) return value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
      return this.fail(field, `${name} must be a date (YYYY-MM-DD).`);
    }
    return value;
  }

  isoDateTime(field, { required = false, label } = {}) {
    const name = label || field;
    const value = this.str(field, { required, max: 40 });
    if (value === undefined || value === null) return value;
    const ts = Date.parse(value);
    if (Number.isNaN(ts)) return this.fail(field, `${name} must be a valid date/time.`);
    return new Date(ts).toISOString();
  }

  phone(field, { required = false, label } = {}) {
    const name = label || field;
    const value = this.str(field, { required, max: 20 });
    if (value === undefined || value === null) return value;
    const digits = value.replace(/[^\d+]/g, '');
    if (!/^[+]?\d{7,15}$/.test(digits)) return this.fail(field, `${name} does not look like a phone number.`);
    return digits;
  }

  email(field, optional = true) {
    const value = this.str(field, { required: !optional, max: 120 });
    if (value === undefined || value === null) return value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return this.fail(field, 'Enter a valid email address.');
    return value;
  }

  throwIfInvalid() {
    if (this.errors.length) {
      throw new ApiError(400, 'Please correct the highlighted fields.', {
        code: 'validation_failed',
        details: this.errors,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------
function intParam(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function pagination(query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const limit = intParam(query.limit, defaultLimit, { min: 1, max: maxLimit });
  const page = intParam(query.page, 1, { min: 1, max: 100000 });
  return { limit, page, offset: (page - 1) * limit };
}

function likePattern(q) {
  return `%${String(q || '').trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
}

// ---------------------------------------------------------------------------
// CSV (for exports - always audited)
// ---------------------------------------------------------------------------
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers, rows) {
  const lines = [headers.map((h) => csvCell(h.label)).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h.key])).join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

module.exports = {
  ApiError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  Validator,
  intParam,
  pagination,
  likePattern,
  toCsv,
  csvCell,
};
