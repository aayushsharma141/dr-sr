import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  useRecordPayment,
  useReversePayment,
  useCreateBackup,
  useRestoreBackup,
} from '../queries'

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
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

  it('useRestoreBackup sends a JSON object body', async () => {
    const fetchMock = stubFetch(200, {})
    const payload = { archive_name: 'backup-test.zip' }
    const { result } = renderHook(() => useRestoreBackup(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync(payload as never)
    })

    const { parsed } = sentBody(fetchMock)
    expect(typeof parsed).toBe('object')
    expect(parsed).toEqual(payload)
  })
})
