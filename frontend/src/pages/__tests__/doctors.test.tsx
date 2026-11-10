import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Doctors } from '../Doctors'
import type { DoctorOut, FeeOut, Me } from '../../api/types'

const mockMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: ['doctors:read', 'doctors:manage', 'fees:read', 'fees:manage'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockDoctors: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Ramesh Sharma',
    name_hi: 'डॉ. रमेश शर्मा',
    qualification: 'MBBS, MD (Medicine)',
    registration_number: 'BR-12345',
    cabin_code: 'A',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

const mockFees: FeeOut[] = [
  {
    id: 1,
    name: 'Standard OPD Consultation',
    fee_paise: 30000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('Doctors and Fees Management Page', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders doctors list and fee schedule items', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/fees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockFees)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Doctors />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Dr. Ramesh Sharma')).toBeInTheDocument()
    })

    expect(screen.getByText('डॉ. रमेश शर्मा')).toBeInTheDocument()
    expect(screen.getByText('MBBS, MD (Medicine)')).toBeInTheDocument()
    expect(screen.getByText('BR-12345')).toBeInTheDocument()
    expect(screen.getByText(/500\.00/)).toBeInTheDocument()

    expect(screen.getByText('Standard OPD Consultation')).toBeInTheDocument()
    expect(screen.getByText(/300\.00/)).toBeInTheDocument()
  })

  it('creates a new doctor profile and converts rupees to paise', async () => {
    let createdPayload: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors')) {
        if (init?.method === 'POST') {
          createdPayload = JSON.parse(init.body as string)
          const newDoc: DoctorOut = {
            id: 2,
            ...(createdPayload as any),
            is_active: true,
            version_id: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          }
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(newDoc)),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctors)),
        })
      }
      if (url.includes('/api/fees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockFees)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Doctors />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^add doctor$/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /^add doctor$/i }))

    expect(screen.getByText('Add Doctor Profile')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/English Name/i), 'Dr. Priya Singh')
    await user.type(screen.getByLabelText(/Qualification/i), 'MS (Ortho)')
    await user.type(screen.getByLabelText(/Registration Number/i), 'BR-98765')
    const feeInput = screen.getByLabelText(/Default Consultation Fee/i)
    await user.clear(feeInput)
    await user.type(feeInput, '600')

    await user.click(screen.getByRole('button', { name: /save doctor/i }))

    await waitFor(() => {
      expect(createdPayload).not.toBeNull()
    })
    expect((createdPayload as any).name_en).toBe('Dr. Priya Singh')
    expect((createdPayload as any).qualification).toBe('MS (Ortho)')
    expect((createdPayload as any).default_fee_paise).toBe(60000)
  })

  it('handles 409 conflict when editing doctor profile and reloads', async () => {
    let doctorFetchCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/doctors/1') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'version_conflict',
                message: 'Doctor record was modified by another user.',
              }),
            ),
        })
      }
      if (url.includes('/api/doctors')) {
        doctorFetchCount++
        const version = doctorFetchCount > 1 ? 2 : 1
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify([
                {
                  ...mockDoctors[0],
                  name_en: version === 2 ? 'Dr. Ramesh Sharma (Senior)' : 'Dr. Ramesh Sharma',
                  version_id: version,
                },
              ]),
            ),
        })
      }
      if (url.includes('/api/fees')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockFees)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Doctors />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Dr. Ramesh Sharma')).toBeInTheDocument()
    })

    // Click Edit on the doctor row
    const editButtons = screen.getAllByRole('button', { name: /^Edit Dr. Ramesh Sharma$/ })
    await user.click(editButtons[0])

    expect(screen.getByText('Edit Doctor Profile')).toBeInTheDocument()

    // Submit edit to trigger conflict
    await user.click(screen.getByRole('button', { name: /save doctor/i }))

    await waitFor(() => {
      expect(screen.getByText('Record was modified by another user')).toBeInTheDocument()
    })

    // Click Reload latest
    await user.click(screen.getByRole('button', { name: /reload latest/i }))

    await waitFor(() => {
      expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()
      expect(screen.getByDisplayValue('Dr. Ramesh Sharma (Senior)')).toBeInTheDocument()
    })
  })

  // ---------------------------------------------------------------- helpers for the tests below

  function jsonResponse(status: number, body: unknown) {
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 409 ? 'Conflict' : 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
  }

  const inactiveFee: FeeOut = {
    id: 2,
    name: 'Old Physiotherapy Rate',
    fee_paise: 25000,
    is_active: false,
    version_id: 3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }

  interface StubOptions {
    fees?: () => FeeOut[]
    onFeePatch?: (id: number, body: Record<string, unknown>) => { status: number; body: unknown }
  }

  function stubFetch({ fees = () => [...mockFees, inactiveFee], onFeePatch }: StubOptions = {}) {
    const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) return jsonResponse(200, mockMe)
      const feePatch = url.match(/\/api\/fees\/(\d+)$/)
      if (feePatch && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string) as Record<string, unknown>
        const r = onFeePatch?.(Number(feePatch[1]), body) ?? { status: 200, body: { ...mockFees[0], ...body } }
        return jsonResponse(r.status, r.body)
      }
      if (url.includes('/api/doctors')) return jsonResponse(200, mockDoctors)
      if (url.includes('/api/fees')) return jsonResponse(200, fees())
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function renderPage() {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Doctors />
        </MemoryRouter>
      </QueryClientProvider>,
    )
  }

  it('hides inactive fee rates until "Show inactive" is ticked, then reactivates one with its version_id', async () => {
    const patches: Array<{ id: number; body: Record<string, unknown> }> = []
    let reactivated = false
    stubFetch({
      fees: () => [...mockFees, { ...inactiveFee, is_active: reactivated, version_id: reactivated ? 4 : 3 }],
      onFeePatch: (id, body) => {
        patches.push({ id, body })
        reactivated = true
        return { status: 200, body: { ...inactiveFee, is_active: true, version_id: 4 } }
      },
    })
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Standard OPD Consultation')).toBeInTheDocument()
    })
    expect(screen.queryByText('Old Physiotherapy Rate')).not.toBeInTheDocument()

    const toggle = screen.getByLabelText(/Show inactive \(1\)/i)
    await user.click(toggle)
    expect(screen.getByText('Old Physiotherapy Rate')).toBeInTheDocument()
    expect(screen.getByText(/250\.00/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reactivate Old Physiotherapy Rate' }))

    await waitFor(() => {
      expect(screen.getByText(/"Old Physiotherapy Rate" is active again/i)).toBeInTheDocument()
    })
    expect(patches).toEqual([
      { id: 2, body: { name: 'Old Physiotherapy Rate', fee_paise: 25000, is_active: true, version_id: 3 } },
    ])
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Reactivate Old Physiotherapy Rate' })).not.toBeInTheDocument()
    })
  })

  it('handles 409 version_conflict on a fee edit with ConflictBanner and reloads the latest rate', async () => {
    let feeFetchCount = 0
    const patches: Record<string, unknown>[] = []
    stubFetch({
      fees: () => {
        feeFetchCount++
        return feeFetchCount > 1
          ? [{ ...mockFees[0], name: 'Standard OPD Consultation (Revised)', fee_paise: 35000, version_id: 2 }]
          : mockFees
      },
      onFeePatch: (_id, body) => {
        patches.push(body)
        return {
          status: 409,
          body: { code: 'version_conflict', message: 'Record was modified by another user' },
        }
      },
    })
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Standard OPD Consultation')).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Edit Standard OPD Consultation' }))
    expect(screen.getByText('Edit Fee Rate')).toBeInTheDocument()

    const amount = screen.getByLabelText(/Fee Rate \(₹ INR\)/i)
    await user.clear(amount)
    await user.type(amount, '320')
    await user.click(screen.getByRole('button', { name: /save rate/i }))

    await waitFor(() => {
      expect(screen.getByText('Record was modified by another user')).toBeInTheDocument()
    })
    expect(patches[0]).toMatchObject({ fee_paise: 32000, version_id: 1 })

    await user.click(screen.getByRole('button', { name: /reload latest/i }))
    await waitFor(() => {
      expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()
      expect(screen.getByLabelText(/Schedule Name/i)).toHaveValue('Standard OPD Consultation (Revised)')
    })
    expect(screen.getByLabelText(/Fee Rate \(₹ INR\)/i)).toHaveValue(350)
  })

  it('asks before discarding unsaved edits in the doctor modal', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('Dr. Ramesh Sharma')).toBeInTheDocument()
    })

    // A clean modal closes straight away.
    await user.click(screen.getByRole('button', { name: 'Edit Dr. Ramesh Sharma' }))
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.queryByText('Edit Doctor Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()

    // A dirty modal asks first.
    await user.click(screen.getByRole('button', { name: 'Edit Dr. Ramesh Sharma' }))
    await user.type(screen.getByLabelText(/Qualification/i), ', DNB')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /keep editing/i }))
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Qualification/i)).toHaveValue('MBBS, MD (Medicine), DNB')

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /discard changes/i }))
    expect(screen.queryByText('Edit Doctor Profile')).not.toBeInTheDocument()
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument()
  })

  it('asks before discarding unsaved edits in the fee modal', async () => {
    stubFetch()
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add fee rate/i })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: /add fee rate/i }))
    await user.type(screen.getByLabelText(/Schedule Name/i), 'Night OPD')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
    expect(screen.getByText(/changes to this fee rate have not been saved/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /discard changes/i }))
    expect(screen.queryByText('Add Fee Rate', { selector: 'h2' })).not.toBeInTheDocument()
  })
})
