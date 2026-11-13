/**
 * API client for Kalyan Hospital LAN Web Platform.
 *
 * Guarantees:
 * - Credentials always 'same-origin' for host-only session cookies.
 * - CSRF token stored only in module memory, never web storage.
 * - X-CSRF-Token attached to unsafe HTTP methods (POST, PUT, PATCH, DELETE).
 * - Standardized ApiError mapping for backend error envelopes (status, code, message, extra).
 * - Automatic onAuthLost notification on not_authenticated or session_expired.
 * - Zero external CDN, telemetry, or cloud dependencies.
 */

export interface ApiFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
}

let csrfToken: string | null = null

export function setCsrfToken(token: string | null): void {
  csrfToken = token
}

export function getCsrfToken(): string | null {
  return csrfToken
}

export type AuthLostReason = 'not_authenticated' | 'session_expired'
export type AuthLostHandler = (reason: AuthLostReason) => void

let authLostHandler: AuthLostHandler | null = null

export function onAuthLost(handler: AuthLostHandler | null): () => void {
  authLostHandler = handler
  return () => {
    if (authLostHandler === handler) {
      authLostHandler = null
    }
  }
}

export class ApiError extends Error {
  status: number
  code: string
  extra: Record<string, unknown>
  [key: string]: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.extra = extra
    Object.assign(this, extra)
  }
}

/** True only for a genuine optimistic-lock conflict (409 version_conflict). */
export function isVersionConflict(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'version_conflict'
}

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiFetchOptions = {},
): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase()
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...init.headers,
  }

  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
  if (init.body !== undefined && !headers['Content-Type'] && !isFormData) {
    headers['Content-Type'] = 'application/json'
  }

  if (method !== 'GET' && method !== 'HEAD' && csrfToken) {
    headers['X-CSRF-Token'] = csrfToken
  }

  const normalizedPath = path.startsWith('/api')
    ? path
    : path.startsWith('/')
      ? `/api${path}`
      : `/api/${path}`

  const res = await fetch(normalizedPath, {
    method,
    headers,
    signal: init.signal,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : isFormData ? (init.body as BodyInit) : JSON.stringify(init.body),
  })

  if (res.status === 204) {
    return undefined as T
  }

  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }

  if (!res.ok) {
    const errData =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>)
        : {}
    const code = typeof errData.code === 'string' ? errData.code : 'error'
    const message =
      typeof errData.message === 'string'
        ? errData.message
        : res.statusText || 'Request failed'

    if (code === 'not_authenticated' || code === 'session_expired') {
      authLostHandler?.(code)
    }

    throw new ApiError(res.status, code, message, errData)
  }

  return data as T
}
