import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  apiFetch,
  onAuthLost,
  setCsrfToken,
} from '../client'

describe('apiFetch Client Contract', () => {
  beforeEach(() => {
    setCsrfToken(null)
    onAuthLost(null)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefixes /api and uses credentials same-origin without CSRF token on GET', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            id: 1,
            username: 'admin',
            role: 'ADMIN',
          }),
        ),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await apiFetch<{ id: number; username: string }>('/auth/me')

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/auth/me')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-CSRF-Token']).toBeUndefined()
    expect(init.headers.Accept).toBe('application/json')
    expect(result).toEqual({ id: 1, username: 'admin', role: 'ADMIN' })
  })

  it('attaches X-CSRF-Token and Content-Type on POST requests when token is set', async () => {
    setCsrfToken('token_test_123')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify({ success: true })),
    })
    vi.stubGlobal('fetch', mockFetch)

    const payload = { username: 'dr_sharma', role: 'DOCTOR' }
    const result = await apiFetch('/users', {
      method: 'POST',
      body: payload,
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/users')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-CSRF-Token']).toBe('token_test_123')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBe(JSON.stringify(payload))
    expect(result).toEqual({ success: true })
  })

  it('throws ApiError with status 409, code version_conflict, and extras on 409', async () => {
    const conflictBody = {
      code: 'version_conflict',
      message: 'Record was modified by another user',
      entity: 'user',
      id: 42,
    }

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(conflictBody)),
    })
    vi.stubGlobal('fetch', mockFetch)

    let caughtError: ApiError | null = null
    try {
      await apiFetch('/users/42', {
        method: 'PATCH',
        body: { version_id: 1, full_name: 'Dr. New Name' },
      })
    } catch (err) {
      if (err instanceof ApiError) {
        caughtError = err
      }
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError?.status).toBe(409)
    expect(caughtError?.code).toBe('version_conflict')
    expect(caughtError?.message).toBe('Record was modified by another user')
    expect(caughtError?.extra.entity).toBe('user')
    expect(caughtError?.extra.id).toBe(42)
    expect(caughtError?.entity).toBe('user')
    expect(caughtError?.id).toBe(42)
  })

  it('invokes onAuthLost handler with reason when 401 session_expired received', async () => {
    const handler = vi.fn()
    const unsubscribe = onAuthLost(handler)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            code: 'session_expired',
            message: 'Session has expired, please sign in again',
          }),
        ),
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(apiFetch('/admin/overview')).rejects.toThrow(ApiError)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('session_expired')

    unsubscribe()
  })

  it('invokes onAuthLost handler with reason when 401 not_authenticated received', async () => {
    const handler = vi.fn()
    onAuthLost(handler)

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () =>
        Promise.resolve(
          JSON.stringify({
            code: 'not_authenticated',
            message: 'Authentication required',
          }),
        ),
    })
    vi.stubGlobal('fetch', mockFetch)

    await expect(apiFetch('/reception/overview')).rejects.toThrow(ApiError)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith('not_authenticated')
  })

  it('resolves undefined for 204 No Content responses', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      statusText: 'No Content',
      headers: new Headers(),
      text: () => Promise.resolve(''),
    })
    vi.stubGlobal('fetch', mockFetch)

    const res = await apiFetch('/auth/logout', { method: 'POST' })
    expect(res).toBeUndefined()
  })

  it('maps non-JSON error response body to code error and statusText message', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('502 Bad Gateway from upstream'),
    })
    vi.stubGlobal('fetch', mockFetch)

    let caughtError: ApiError | null = null
    try {
      await apiFetch('/health')
    } catch (err) {
      if (err instanceof ApiError) {
        caughtError = err
      }
    }

    expect(caughtError).not.toBeNull()
    expect(caughtError?.status).toBe(502)
    expect(caughtError?.code).toBe('error')
    expect(caughtError?.message).toBe('Bad Gateway')
    expect(caughtError?.extra).toEqual({})
  })
})

