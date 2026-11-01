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
    const editButtons = screen.getAllByRole('button', { name: /^Edit$/i })
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
})
