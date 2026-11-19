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

export const DEFAULT_API_TIMEOUT_MS = 15_000

export interface ApiFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number | null
  idempotencyKey?: string
}

/**
 * Generates an RFC-4122 v4 UUID for Idempotency-Key headers.
 * Uses crypto.randomUUID when available and falls back to crypto.getRandomValues
 * so non-HTTPS LAN workstations (window.isSecureContext === false) work reliably.
 */
export function createIdempotencyKey(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }

  const bytes = new Uint8Array(16)
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes)
  } else {
    // Last-resort fallback for stripped runtimes without Web Crypto.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
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
  declare isTimeout?: boolean
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

/** True when an apiFetch call failed due to its client-side request timeout. */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof ApiError && (err.isTimeout === true || err.code === 'request_timeout')
}

interface RequestSignalHandle {
  signal: AbortSignal | undefined
  timeoutMs: number | null
  didTimeout: () => boolean
  cleanup: () => void
}

function createRequestSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | null | undefined,
): RequestSignalHandle {
  const effectiveTimeoutMs =
    timeoutMs === undefined ? DEFAULT_API_TIMEOUT_MS : timeoutMs

  if (
    effectiveTimeoutMs === null ||
    !Number.isFinite(effectiveTimeoutMs) ||
    effectiveTimeoutMs <= 0 ||
    callerSignal?.aborted
  ) {
    return {
      signal: callerSignal,
      timeoutMs: null,
      didTimeout: () => false,
      cleanup: () => {},
    }
  }

  const timeoutController = new AbortController()
  let timedOut = false
  const timeoutId = setTimeout(() => {
    timedOut = true
    timeoutController.abort(new Error('request_timeout'))
  }, effectiveTimeoutMs)

  if (!callerSignal) {
    return {
      signal: timeoutController.signal,
      timeoutMs: effectiveTimeoutMs,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timeoutId)
      },
    }
  }

  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.any === 'function') {
    const combinedSignal = AbortSignal.any([callerSignal, timeoutController.signal])
    return {
      signal: combinedSignal,
      timeoutMs: effectiveTimeoutMs,
      didTimeout: () => timedOut && !callerSignal.aborted,
      cleanup: () => {
        clearTimeout(timeoutId)
      },
    }
  }

  const combinedController = new AbortController()
  const onCallerAbort = () => {
    clearTimeout(timeoutId)
    combinedController.abort(callerSignal.reason)
  }
  const onTimeoutAbort = () => {
    combinedController.abort(timeoutController.signal.reason)
  }

  callerSignal.addEventListener('abort', onCallerAbort, { once: true })
  timeoutController.signal.addEventListener('abort', onTimeoutAbort, { once: true })

  return {
    signal: combinedController.signal,
    timeoutMs: effectiveTimeoutMs,
    didTimeout: () => timedOut && !callerSignal.aborted,
    cleanup: () => {
      clearTimeout(timeoutId)
      callerSignal.removeEventListener('abort', onCallerAbort)
      timeoutController.signal.removeEventListener('abort', onTimeoutAbort)
    },
  }
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

  const idempotencyKey = init.idempotencyKey?.trim()
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey
  }

  const normalizedPath = path.startsWith('/api')
    ? path
    : path.startsWith('/')
      ? `/api${path}`
      : `/api/${path}`

  const signalHandle = createRequestSignal(init.signal, init.timeoutMs)
  let res: Response
  let text = ''
  try {
    res = await fetch(normalizedPath, {
      method,
      headers,
      signal: signalHandle.signal,
      credentials: 'same-origin',
      body: init.body === undefined ? undefined : isFormData ? (init.body as BodyInit) : JSON.stringify(init.body),
    })

    if (res.status === 204) {
      return undefined as T
    }

    text = await res.text()
  } catch (err) {
    if (signalHandle.didTimeout()) {
      throw new ApiError(
        0,
        'request_timeout',
        'Request timed out. Please check your LAN connection and try again.',
        { isTimeout: true, timeoutMs: signalHandle.timeoutMs },
      )
    }
    throw err
  } finally {
    signalHandle.cleanup()
  }
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
