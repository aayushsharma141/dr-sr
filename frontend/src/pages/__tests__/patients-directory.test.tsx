import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientsDirectory } from '../PatientsDirectory'
import { PatientDetail } from '../PatientDetail'
import type { Me, PatientOut } from '../../api/types'

const mockMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Reception Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: ['patients:read', 'patients:create', 'patients:write'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const mockPatients: PatientOut[] = [
  {
    id: 101,
    urn: 'KH-2026-0001',
    full_name: 'Aarav Kumar',
    guardian_name: 'Suresh Kumar',
    gender: 'M',
    dob: '1995-05-15',
    age_years: 30,
    mobile: '9876543210',
    address: 'Station Road, Ara',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: '9876500000',
    allergies: 'Penicillin',
    notes: 'Referred by Dr. Sharma',
    photo_path: 'photos/101.jpg',
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 102,
    urn: 'KH-2026-0002',
    full_name: 'Sunita Devi',
    guardian_name: 'Ramesh Singh',
    gender: 'F',
    dob: null,
    age_years: 45,
    mobile: '9876543211',
    address: 'Main Market, Bihiya',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: null,
    allergies: 'None reported',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-02T11:00:00Z',
    updated_at: '2026-01-02T11:00:00Z',
  },
]

describe('Patients Directory and Profile Screens', () => {
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

  it('renders directory with search bar and patient table rows', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatients)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientsDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0002')).toBeInTheDocument()
    expect(screen.getByText('Sunita Devi')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search by urn/i)).toBeInTheDocument()
  })

  it('opens edit modal and saves demographic modifications with version_id', async () => {
    let capturedBody: unknown = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients/101') && init?.method === 'PATCH') {
        capturedBody = JSON.parse(init.body as string)
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                ...mockPatients[0],
                ...(capturedBody as Record<string, unknown>),
                version_id: 2,
              }),
            ),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatients)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientsDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    // Click Edit on Aarav Kumar
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons[0])

    // Modal should be open
    await waitFor(() => {
      expect(screen.getByText(/edit patient demographics/i)).toBeInTheDocument()
    })

    const mobileInput = screen.getByLabelText(/mobile number \*/i)
    await user.clear(mobileInput)
    await user.type(mobileInput, '9876599999')

    const saveButton = screen.getByRole('button', { name: /save.*changes/i })
    await user.click(saveButton)

    await waitFor(() => {
      expect(screen.getByText(/updated successfully/i)).toBeInTheDocument()
    })

    expect((capturedBody as any)?.version_id).toBe(1)
    expect((capturedBody as any)?.mobile).toBe('9876599999')
  })

  it('handles 409 version_conflict in edit modal and reloads fresh data', async () => {
    let _patientFetchCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients/101') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'version_conflict',
                message: 'Record was modified by another user.',
              }),
            ),
        })
      }
      if (url.includes('/api/patients/101')) {
        _patientFetchCount++
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                ...mockPatients[0],
                full_name: 'Aarav Kumar (Updated by Server)',
                version_id: 2,
              }),
            ),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatients)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientsDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    const editButtons = screen.getAllByRole('button', { name: /^edit$/i })
    await user.click(editButtons[0])

    await waitFor(() => {
      expect(screen.getByText(/edit patient demographics/i)).toBeInTheDocument()
    })

    const saveButton = screen.getByRole('button', { name: /save.*changes/i })
    await user.click(saveButton)

    // ConflictBanner should appear
    await waitFor(() => {
      expect(screen.getByText('Record was modified by another user')).toBeInTheDocument()
    })

    // Click Reload latest
    const reloadButton = screen.getByRole('button', { name: /reload latest/i })
    await user.click(reloadButton)

    await waitFor(() => {
      expect(screen.getByDisplayValue('Aarav Kumar (Updated by Server)')).toBeInTheDocument()
    })
    expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()
  })

  it('renders patient record tabs and filters the role-scoped visit, therapy and billing timeline', async () => {
    const timeline = [
      {
        id: 'APPOINTMENT-10',
        event_type: 'APPOINTMENT',
        event_date: '2026-11-01T10:00:00Z',
        title: 'Token #1: Appointment with Dr. Madan Mohan Dwivedi',
        subtitle: 'Status: BOOKED',
        summary: 'Knee rehabilitation',
        badge: 'BOOKED',
        badge_variant: 'outline',
        metadata: { appointment_id: 10 },
      },
      {
        id: 'TREATMENT_PLAN-20',
        event_type: 'TREATMENT_PLAN',
        event_date: '2026-11-01T11:00:00Z',
        title: 'Package: Knee Rehabilitation',
        subtitle: 'Dr. Madan Mohan Dwivedi · ₹4,000.00',
        summary: 'Diagnosis: Knee pain | Sessions: 1/8',
        badge: 'ACTIVE',
        badge_variant: 'default',
        metadata: { treatment_plan_id: 20 },
      },
      {
        id: 'PAYMENT-30',
        event_type: 'PAYMENT',
        event_date: '2026-11-01T12:00:00Z',
        title: 'Payment Received: ₹500.00',
        subtitle: 'Receipt: KH-RCPT-0030 · Method: CASH',
        summary: 'Collected by @reception',
        badge: 'PAID',
        badge_variant: 'default',
        metadata: { payment_id: 30 },
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMe)),
        })
      }
      if (url.includes('/api/patients/101/timeline')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(timeline)),
        })
      }
      if (url.includes('/api/patients/101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatients[0])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/patients/101']}>
          <Routes>
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText('Suresh Kumar')).toBeInTheDocument()
    expect(screen.getByText('Penicillin')).toBeInTheDocument()
    expect(screen.getByText('30 Years')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit demographics/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: 'Demographic Profile' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Clinical Records' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Visits & Appointments' }))
    await waitFor(() => {
      expect(screen.getByText('Appointment & visit history')).toBeInTheDocument()
      expect(screen.getByText(/Token #1: Appointment/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Physiotherapy' }))
    await waitFor(() => {
      expect(screen.getByText('Package: Knee Rehabilitation')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Payment Received/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Financial Ledger' }))
    await waitFor(() => {
      expect(screen.getByText('Payment Received: ₹500.00')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Package: Knee Rehabilitation/)).not.toBeInTheDocument()
  })
})
