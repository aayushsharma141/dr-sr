import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  useRecordPayment,
  useReversePayment,
  useCreateBackup,
  useRestoreBackup,
  useUpdateFee,
  useRevokeSession,
  useRevokeUserSessions,
  useVerifyBackup,
  useUnlockUser,
  useRolePermissions,
  useActiveSessions,
  useLoginHistory,
  useSecurityPolicy,
  usePasswordPolicy,
  useSystemStatus,
  useAuditActions,
} from '../queries'

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children)
}

function stubFetch(status = 200, body: unknown = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return { init, parsed: JSON.parse(String(init.body)) as unknown }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('mutation request bodies (real apiFetch, fetch stubbed)', () => {
  it('useRecordPayment sends a JSON object body, not a string', async () => {
    const fetchMock = stubFetch(200, { id: 1 })
    const payload = { patient_id: 7, amount_paise: 50000, payment_method: 'CASH' }
    const { result } = renderHook(() => useRecordPayment(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync(payload as never)
    })

    const { init, parsed } = sentBody(fetchMock)
    expect(init.method).toBe('POST')
    expect(typeof parsed).toBe('object')
    expect(parsed).toEqual(payload)
  })

  it('useReversePayment sends { reversal_reason } as an object to the reverse URL', async () => {
    const fetchMock = stubFetch(200, { id: 9 })
    const { result } = renderHook(() => useReversePayment(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        id: 9,
        payload: { reversal_reason: 'Entered against wrong patient' } as never,
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/payments/9/reverse')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      reversal_reason: 'Entered against wrong patient',
    })
  })

  it('useReversePayment surfaces a server rejection with its message', async () => {
    stubFetch(409, { code: 'conflict', message: 'Payment already reversed' })
    const { result } = renderHook(() => useReversePayment(), { wrapper: wrapper() })

    await act(async () => {
      await expect(
        result.current.mutateAsync({ id: 9, payload: { reversal_reason: 'x' } as never }),
      ).rejects.toThrow('Payment already reversed')
    })
  })

  it('useCreateBackup sends a JSON object body', async () => {
    const fetchMock = stubFetch(200, {})
    const payload = { destination: 'primary' }
    const { result } = renderHook(() => useCreateBackup(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync(payload as never)
    })

    const { parsed } = sentBody(fetchMock)
    expect(typeof parsed).toBe('object')
    expect(parsed).toEqual(payload)
  })

  it('useRestoreBackup sends the confirmation phrase and reason as a JSON object body', async () => {
    const fetchMock = stubFetch(200, {})
    const payload = {
      archive_filename: 'kalyan_backup_20261102_100000.tar.gz',
      confirmation_phrase: 'RESTORE',
      reason: 'Server disk replaced after failure',
    }
    const { result } = renderHook(() => useRestoreBackup(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync(payload)
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/operations/restore')
    const { parsed } = sentBody(fetchMock)
    expect(parsed).toEqual(payload)
  })

  it('useUpdateFee sends the fee version_id for optimistic locking', async () => {
    const fetchMock = stubFetch(200, { id: 4 })
    const { result } = renderHook(() => useUpdateFee(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        id: 4,
        body: { name: 'Follow-up visit', fee_paise: 20000, is_active: false, version_id: 3 },
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/fees/4')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Follow-up visit',
      fee_paise: 20000,
      is_active: false,
      version_id: 3,
    })
  })

  it('useRevokeSession posts the optional reason to the session revoke URL', async () => {
    const fetchMock = stubFetch(200, { id: 12, user_id: 5, revoked_at: '2026-11-04T10:00:00Z' })
    const { result } = renderHook(() => useRevokeSession(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({ id: 12, payload: { reason: 'Shared workstation' } })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions/12/revoke')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ reason: 'Shared workstation' })
  })

  it('useRevokeUserSessions posts to the user revoke-sessions URL', async () => {
    const fetchMock = stubFetch(200, { user_id: 5, revoked_count: 2, kept_current_session: false })
    const { result } = renderHook(() => useRevokeUserSessions(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({ id: 5, payload: {} })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/users/5/revoke-sessions')
    expect(JSON.parse(String(init.body))).toEqual({})
  })

  it('useVerifyBackup posts without a body and encodes the filename', async () => {
    const fetchMock = stubFetch(200, { filename: 'a b.tar.gz', valid: true, details: 'ok' })
    const { result } = renderHook(() => useVerifyBackup(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync('a b.tar.gz')
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/operations/backups/a%20b.tar.gz/verify')
    expect(init.method).toBe('POST')
    expect(init.body).toBeUndefined()
  })

  it('useUnlockUser sends the optional reason with version_id', async () => {
    const fetchMock = stubFetch(200, { id: 3 })
    const { result } = renderHook(() => useUnlockUser(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({ id: 3, payload: { version_id: 2, reason: 'Verified by phone' } })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/users/3/unlock')
    expect(JSON.parse(String(init.body))).toEqual({ version_id: 2, reason: 'Verified by phone' })
  })
})

describe('admin read hooks call the documented endpoints', () => {
  const cases: ReadonlyArray<readonly [string, () => { isSuccess: boolean }, string]> = [
    ['useRolePermissions', () => useRolePermissions(), '/api/roles/permissions'],
    ['useActiveSessions (all)', () => useActiveSessions(), '/api/sessions'],
    ['useActiveSessions (user)', () => useActiveSessions(7), '/api/sessions?user_id=7'],
    ['useLoginHistory', () => useLoginHistory(7), '/api/users/7/login-history'],
    ['useSecurityPolicy', () => useSecurityPolicy(), '/api/security/policy'],
    ['usePasswordPolicy', () => usePasswordPolicy(), '/api/security/password-policy'],
    ['useSystemStatus', () => useSystemStatus(), '/api/system/status'],
    ['useAuditActions', () => useAuditActions(), '/api/audit-logs/actions'],
  ]
  it.each(cases)('%s', async (_name, hook, expectedUrl) => {
    const fetchMock = stubFetch(200, [])
    const { result } = renderHook(hook, { wrapper: wrapper() })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(expectedUrl)
  })

  it('useLoginHistory stays idle without a user id', () => {
    const fetchMock = stubFetch(200, [])
    renderHook(() => useLoginHistory(null), { wrapper: wrapper() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
