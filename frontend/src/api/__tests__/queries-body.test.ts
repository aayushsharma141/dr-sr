import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import {
  useRecordPayment,
  useReversePayment,
  useCreateBackup,
  useRestoreBackup,
  useFinaliseEncounter,
  useUpdatePrintTemplate,
  useCheckIn,
  useWalkIn,
  useBookAppointment,
  useCreateOpdArrival,
  useCheckInNewPatient,
  usePatients,
  useAppointments,
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
  it('useFinaliseEncounter sends its body as an object (a string was rejected with 422)', async () => {
    const fetchMock = stubFetch(200, { id: 122, patient_id: 392 })
    const body = { symptoms: 'Low back pain', diagnosis: 'Mechanical LBP', version_id: 2 }
    const { result } = renderHook(() => useFinaliseEncounter(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({ id: 122, body })
    })

    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/encounters/122/finalise')
    const { init, parsed } = sentBody(fetchMock)
    expect(init.method).toBe('POST')
    expect(typeof parsed).toBe('object')
    expect(parsed).toEqual(body)
  })

  it('useUpdatePrintTemplate sends its payload as an object', async () => {
    const fetchMock = stubFetch(200, { doc_type: 'prescription' })
    const payload = { header_en: 'Kalyan Hospital', version: 3 }
    const { result } = renderHook(() => useUpdatePrintTemplate(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({ docType: 'prescription', payload })
    })

    const { init, parsed } = sentBody(fetchMock)
    expect(init.method).toBe('PATCH')
    expect(typeof parsed).toBe('object')
    expect(parsed).toEqual(payload)
  })

  it('useCheckIn sends idempotencyKey only as Idempotency-Key header and preserves patient_id in JSON body', async () => {
    const fetchMock = stubFetch(200, { id: 501 })
    const body = {
      version_id: 1,
      patient_id: 101,
      referral_source: 'SELF' as const,
      priority_level: 'NORMAL' as const,
      visit_kind: 'NEW' as const,
    }
    const { result } = renderHook(() => useCheckIn(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        id: 501,
        body,
        idempotencyKey: 'checkin-idem-key-0001',
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/appointments/501/check-in')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('checkin-idem-key-0001')
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(parsed).toEqual(body)
    expect('idempotencyKey' in parsed).toBe(false)
  })

  it('useWalkIn strips idempotencyKey from JSON body and sends it only in Idempotency-Key header', async () => {
    const fetchMock = stubFetch(201, { id: 502 })
    const payload = {
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      referral_source: 'SELF' as const,
      priority_level: 'NORMAL' as const,
      visit_kind: 'NEW' as const,
    }
    const { result } = renderHook(() => useWalkIn(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        ...payload,
        idempotencyKey: 'walkin-idem-key-0002',
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/appointments/walk-in')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('walkin-idem-key-0002')
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(parsed).toEqual(payload)
    expect('idempotencyKey' in parsed).toBe(false)
  })

  it('useBookAppointment strips idempotencyKey from JSON body and sends it only in Idempotency-Key header', async () => {
    const fetchMock = stubFetch(201, { id: 602 })
    const payload = {
      patient_id: 101,
      doctor_id: 10,
      department_id: 1,
      appointment_date: '2026-11-20',
      expected_time: '16:00:00',
      source: 'PHONE' as const,
      issue_token: false,
    }
    const { result } = renderHook(() => useBookAppointment(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        ...payload,
        idempotencyKey: 'book-idem-key-0003',
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/appointments')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('book-idem-key-0003')
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(parsed).toEqual(payload)
    expect('idempotencyKey' in parsed).toBe(false)
  })

  it('useCreateOpdArrival strips idempotencyKey from JSON body and sends it only in Idempotency-Key header', async () => {
    const fetchMock = stubFetch(201, { id: 900 })
    const payload = {
      full_name: 'Sita Devi',
      age_years: 41,
      mobile: '9876500011',
      doctor_id: 10,
      department_id: 1,
      priority_level: 'NORMAL' as const,
    }
    const { result } = renderHook(() => useCreateOpdArrival(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        ...payload,
        idempotencyKey: 'arrival-idem-key-0004',
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/opd-arrivals')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('arrival-idem-key-0004')
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(parsed).toEqual(payload)
    expect('idempotencyKey' in parsed).toBe(false)
  })

  it('useCheckInNewPatient strips idempotencyKey from JSON body and sends it only in Idempotency-Key header', async () => {
    const fetchMock = stubFetch(201, { id: 503 })
    const payload = {
      patient: {
        full_name: 'Sita Devi',
        guardian_name: 'Ram Devi',
        age_years: 41,
        gender: 'F' as const,
        mobile: '9876500011',
        address: 'Station Road, Ara',
        district: 'Bhojpur',
        state: 'Bihar',
        allergies: 'None',
      },
      doctor_id: 10,
      department_id: 1,
      referral_source: 'SELF' as const,
      priority_level: 'NORMAL' as const,
    }
    const { result } = renderHook(() => useCheckInNewPatient(), { wrapper: wrapper() })

    await act(async () => {
      await result.current.mutateAsync({
        ...payload,
        idempotencyKey: 'newpatient-idem-key-0005',
      })
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/appointments/walk-in/new-patient')
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe('newpatient-idem-key-0005')
    const parsed = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(parsed).toEqual(payload)
    expect('idempotencyKey' in parsed).toBe(false)
  })
})

describe('query AbortSignal forwarding (real apiFetch, fetch stubbed)', () => {
  it('forwards TanStack Query AbortSignal to fetch on usePatients and aborts when cancelled', async () => {
    let capturedSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const customWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    renderHook(() => usePatients('Ramesh', 8, 0), { wrapper: customWrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    await act(async () => {
      await client.cancelQueries({ queryKey: ['patients'] })
    })
    expect(capturedSignal?.aborted).toBe(true)
  })

  it('forwards TanStack Query AbortSignal to fetch on useAppointments and aborts when cancelled', async () => {
    let capturedSignal: AbortSignal | null | undefined
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      capturedSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const customWrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client }, children)

    renderHook(
      () => useAppointments({ appointment_date: '2026-11-18' }, { refetchInterval: false }),
      { wrapper: customWrapper },
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(capturedSignal).toBeInstanceOf(AbortSignal)
    expect(capturedSignal?.aborted).toBe(false)

    await act(async () => {
      await client.cancelQueries({ queryKey: ['appointments'] })
    })
    expect(capturedSignal?.aborted).toBe(true)
  })
})
