import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientsDirectory } from '../PatientsDirectory'
import { PatientDetail } from '../PatientDetail'
import { PatientRegister } from '../PatientRegister'
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
      if (url.includes('/api/patients/count')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: mockPatients.length })),
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

  it('pages through the patient list 20 rows at a time and resets to page 1 on a new search', async () => {
    const allPatients: PatientOut[] = Array.from({ length: 25 }, (_, i) => ({
      ...mockPatients[1],
      id: 1000 + i,
      urn: `KH-2026-${String(i + 1).padStart(4, '0')}`,
      full_name: `Synthetic Patient ${i + 1}`,
    }))
    const requestedUrls: string[] = []

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
        const params = new URL(url, 'http://localhost').searchParams
        const limit = Number(params.get('limit'))
        const offset = Number(params.get('offset'))
        const q = params.get('q') ?? ''
        const matches = allPatients.filter((p) => p.full_name.includes(q))
        if (url.includes('/api/patients/count')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ total: matches.length })),
          })
        }
        requestedUrls.push(url)
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(matches.slice(offset, offset + limit))),
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

    // Page 1: 20 rows, one extra row requested to detect a next page.
    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })
    expect(requestedUrls[0]).toContain('limit=21')
    expect(requestedUrls[0]).toContain('offset=0')
    expect(screen.getByText('KH-2026-0020')).toBeInTheDocument()
    expect(screen.queryByText('KH-2026-0021')).not.toBeInTheDocument()
    expect(await screen.findByText('Showing 1–20 of 25 patients')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()

    // Page 2: the remaining 5 rows, Next disabled.
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(screen.getByText('KH-2026-0021')).toBeInTheDocument()
    })
    expect(requestedUrls.some((u) => u.includes('offset=20'))).toBe(true)
    expect(screen.getByText('KH-2026-0025')).toBeInTheDocument()
    expect(screen.queryByText('KH-2026-0001')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 21–25 of 25 patients')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    // A new search goes back to page 1.
    await user.type(screen.getByPlaceholderText(/search by urn/i), 'Patient 2')
    await waitFor(() => {
      expect(screen.getByText(/^Page 1( of \d+)?$/)).toBeInTheDocument()
    })
    const lastUrl = requestedUrls[requestedUrls.length - 1]
    expect(lastUrl).toContain('q=Patient%202')
    expect(lastUrl).toContain('offset=0')
  })

  const jsonRes = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 409 ? 'Conflict' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })

  // Editing reuses the registration form: Edit links to /reception/patients/:id/edit, which
  // opens pre-filled and saves with PATCH /patients/{id} using the loaded version_id.
  it('Edit opens the registration form pre-filled and saves with the loaded version_id', async () => {
    let capturedBody: Record<string, unknown> | null = null
    let serverPatient: PatientOut = mockPatients[0]
    const calls: string[] = []

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, mockMe))
      if (url.includes('/api/patients/101/payments')) return Promise.resolve(jsonRes(200, []))
      if (url.includes('/api/patients/101') && init?.method === 'PATCH') {
        capturedBody = JSON.parse(init.body as string)
        serverPatient = { ...serverPatient, ...(capturedBody as Partial<PatientOut>), version_id: 2 }
        return Promise.resolve(jsonRes(200, serverPatient))
      }
      if (url.includes('/api/patients/101')) return Promise.resolve(jsonRes(200, serverPatient))
      if (url.includes('/api/patients/count')) {
        return Promise.resolve(jsonRes(200, { total: mockPatients.length }))
      }
      if (url.includes('/api/patients')) return Promise.resolve(jsonRes(200, mockPatients))
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/patients']}>
          <Routes>
            <Route path="/reception/patients" element={<PatientsDirectory />} />
            <Route path="/reception/patients/:id/edit" element={<PatientRegister />} />
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })

    // Edit on Aarav Kumar's row: a link to the edit page, not a separate dialog
    const editLinks = screen.getAllByRole('link', { name: /^edit$/i })
    expect(editLinks[0]).toHaveAttribute('href', '/reception/patients/101/edit')
    await user.click(editLinks[0])

    // It is the registration form in edit mode, already holding the saved details
    expect(await screen.findByRole('heading', { name: 'Edit Patient Details' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Full Name \*/i)).toHaveValue('Aarav Kumar')
    expect(screen.getByLabelText(/Mobile Number \*/i)).toHaveValue('9876543210')
    expect(screen.getByLabelText(/Age \(Years\)/i)).toHaveValue(30)
    expect(screen.getByLabelText(/Address \(Village/i)).toHaveValue('Station Road, Ara')
    expect(screen.getByLabelText(/Allergies \*/i)).toHaveValue('Penicillin')
    expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    // Changing details books no visit and issues no token
    expect(screen.queryByLabelText(/Department/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Doctor \*/i)).not.toBeInTheDocument()

    const mobileInput = screen.getByLabelText(/mobile number \*/i)
    await user.clear(mobileInput)
    await user.type(mobileInput, '9876599999')
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    // Back on the patient's record, which shows the saved change and a notice
    await waitFor(() => {
      expect(screen.getByText('Patient details updated successfully.')).toBeInTheDocument()
    })
    expect(screen.getByText('9876599999')).toBeInTheDocument()

    expect(capturedBody).not.toBeNull()
    const saved = capturedBody as unknown as Record<string, unknown>
    expect(saved.version_id).toBe(1)
    expect(saved.mobile).toBe('9876599999')
    expect(saved.full_name).toBe('Aarav Kumar')
    // Editing never registers a second patient or runs the new-registration duplicate check
    expect(calls.some((c) => c.startsWith('POST'))).toBe(false)
    expect(calls.some((c) => c.includes('check-duplicate'))).toBe(false)
  })

  it('shows the conflict banner on a 409, reloads the latest record into the form, and saves against the new version', async () => {
    let conflictRaised = false
    const patchedVersions: number[] = []
    const newer: PatientOut = {
      ...mockPatients[0],
      full_name: 'Aarav Kumar (Updated by Server)',
      version_id: 2,
    }

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, mockMe))
      if (url.includes('/api/patients/101/payments')) return Promise.resolve(jsonRes(200, []))
      if (url.includes('/api/patients/101') && init?.method === 'PATCH') {
        const body = JSON.parse(init.body as string) as { version_id: number }
        patchedVersions.push(body.version_id)
        if (body.version_id !== 2) {
          conflictRaised = true
          return Promise.resolve(
            jsonRes(409, {
              code: 'version_conflict',
              message: 'Record was modified by another user.',
            }),
          )
        }
        return Promise.resolve(jsonRes(200, { ...newer, ...body, version_id: 3 }))
      }
      if (url.includes('/api/patients/101')) {
        return Promise.resolve(jsonRes(200, conflictRaised ? newer : mockPatients[0]))
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/patients/101/edit']}>
          <Routes>
            <Route path="/reception/patients/:id/edit" element={<PatientRegister />} />
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('button', { name: 'Save Changes' }))

    // ConflictBanner appears and the typed form stays; saving again is blocked until reload
    await waitFor(() => {
      expect(screen.getByText('Record was modified by another user')).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: /reload latest/i }))

    await waitFor(() => {
      expect(screen.getByDisplayValue('Aarav Kumar (Updated by Server)')).toBeInTheDocument()
    })
    expect(screen.queryByText('Record was modified by another user')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save Changes' }))
    await waitFor(() => {
      expect(screen.getByText('Patient details updated successfully.')).toBeInTheDocument()
    })
    expect(patchedVersions).toEqual([1, 2])
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
      if (url.includes('/api/patients/101/payments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
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

    expect(screen.getByRole('heading', { level: 1, name: 'Aarav Kumar' })).toBeInTheDocument()
    expect(screen.getByText('Suresh Kumar')).toBeInTheDocument()
    expect(screen.getByText('Penicillin')).toBeInTheDocument()
    expect(screen.getByText('30 Years')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit patient details/i })).toHaveAttribute(
      'href',
      '/reception/patients/101/edit',
    )
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: 'Profile' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Consultations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Change History' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Appointments' }))
    await waitFor(() => {
      expect(screen.getByText('Appointment & visit history')).toBeInTheDocument()
      expect(screen.getByText(/Token #1: Appointment/)).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Treatment Plans' }))
    await waitFor(() => {
      expect(screen.getByText('Package: Knee Rehabilitation')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Payment Received/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Payments' }))
    await waitFor(() => {
      expect(screen.getByText('Payment Received: ₹500.00')).toBeInTheDocument()
    })
    expect(screen.queryByText(/Package: Knee Rehabilitation/)).not.toBeInTheDocument()
  })

  it('exposes clinical record tabs to the treating doctor and filters encounter data', async () => {
    const doctorMe: Me = {
      ...mockMe,
      role: 'DOCTOR',
      username: 'doctor',
      full_name: 'Treating Doctor',
      doctor_id: 1,
      permissions: ['patient:read', 'timeline:read', 'encounter:read', 'prescription:read'],
    }
    const timeline = [
      {
        id: 'ENCOUNTER-41',
        event_type: 'ENCOUNTER',
        event_date: '2026-11-01T10:00:00Z',
        title: 'Clinical Consultation with Dr. Madan Mohan Dwivedi',
        subtitle: 'Dr. Madan Mohan Dwivedi',
        summary: 'Diagnosis: Lumbar radiculopathy',
        badge: 'FINALIZED',
        badge_variant: 'default',
        metadata: { encounter_id: 41 },
      },
      {
        id: 'PRESCRIPTION-42',
        event_type: 'PRESCRIPTION',
        event_date: '2026-11-01T11:00:00Z',
        title: 'Prescription by Dr. Madan Mohan Dwivedi',
        subtitle: 'Rx #42 · 1 medication(s)',
        summary: 'Test medicine (10 mg)',
        badge: 'ACTIVE',
        badge_variant: 'default',
        metadata: { prescription_id: 42 },
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(doctorMe)),
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
      expect(screen.getByRole('tab', { name: 'Consultations' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Consultations' }))
    await waitFor(() => {
      expect(screen.getByText('Clinical Consultation with Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
      expect(screen.getByText('Prescription by Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    })
  })


  it('shows patient audit history only to an ADMIN with audit:read permission', async () => {
    const adminMe: Me = {
      ...mockMe,
      role: 'ADMIN',
      username: 'admin',
      full_name: 'Hospital Administrator',
      permissions: ['patient:read', 'timeline:read', 'audit:read'],
    }
    const auditResponse = {
      items: [
        {
          id: 901,
          occurred_at: '2026-11-01T09:30:00Z',
          actor_user_id: 1,
          actor_username: 'admin',
          actor_role: 'ADMIN',
          action: 'PATIENT_UPDATED',
          outcome: 'SUCCESS',
          entity_type: 'patient',
          entity_id: '101',
          before_data: null,
          after_data: null,
          reason: null,
          request_id: 'req-901',
          ip: null,
          user_agent: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
      pages: 1,
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(adminMe)),
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
      if (url.includes('/api/audit-logs')) {
        expect(url).toContain('entity_type=patient')
        expect(url).toContain('entity_id=101')
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(auditResponse)),
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
      expect(screen.getByRole('tab', { name: 'Change History' })).toBeInTheDocument()
    })
    expect(screen.queryByRole('tab', { name: 'Consultations' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Change History' }))
    await waitFor(() => {
      expect(screen.getByText('PATIENT_UPDATED')).toBeInTheDocument()
    })
    expect(screen.getByText('admin')).toBeInTheDocument()
  })

  it('hides registration and edit actions from DOCTOR role in directory and patient file', async () => {
    const doctorMe: Me = {
      ...mockMe,
      role: 'DOCTOR',
      username: 'dr.dwivedi',
      full_name: 'Dr. Madan Mohan Dwivedi',
      doctor_id: 1,
      permissions: ['patient:read', 'consultation:read', 'consultation:write'],
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(doctorMe)),
        })
      }
      if (url.includes('/api/patients/count')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ total: 1 })),
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
      if (url.includes('/api/patients/')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockPatients[0]])),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockPatients[0]])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientsDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })
    // Doctor cannot register patients or edit demographic rows
    expect(screen.queryByRole('link', { name: /\+ register new patient/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view card/i })).toBeInTheDocument()

    unmount()

    // Test PatientDetail view with doctor role
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
    // Doctor can view file and print card, but cannot edit demographics
    expect(screen.queryByRole('link', { name: /edit patient details/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()
  })

  // The API grants patient:update to RECEPTION only (an administrator corrects a record through
  // the audited admin correction flow), so ADMIN is not offered an edit that would be refused.
  it('does not offer ADMIN an edit action in the directory or on the patient file', async () => {
    const adminMe: Me = {
      ...mockMe,
      role: 'ADMIN',
      username: 'admin',
      full_name: 'System Admin',
      permissions: ['patient:read'],
    }
    const jsonOk = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonOk(adminMe))
      if (url.includes('/api/patients/count')) return Promise.resolve(jsonOk({ total: 1 }))
      if (url.includes('/api/patients/101/payments')) return Promise.resolve(jsonOk([]))
      if (url.includes('/api/patients/101')) return Promise.resolve(jsonOk(mockPatients[0]))
      if (url.includes('/api/patients')) return Promise.resolve(jsonOk([mockPatients[0]]))
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PatientsDirectory />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('KH-2026-0001')).toBeInTheDocument()
    })
    // `me` loads separately from the list; wait until the role is known before asserting absence.
    await waitFor(() => {
      expect(screen.getAllByText('System Admin').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('link', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    unmount()

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
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /edit patient details/i })).not.toBeInTheDocument()
  })

  it('shows the notice handed over by the edit form on the patient file', async () => {
    const jsonOk = (body: unknown) => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(body)),
    })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonOk(mockMe))
        if (url.includes('/api/patients/101/payments')) return Promise.resolve(jsonOk([]))
        if (url.includes('/api/patients/101')) return Promise.resolve(jsonOk(mockPatients[0]))
        return Promise.reject(new Error('Unhandled'))
      }),
    )

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={[
            { pathname: '/reception/patients/101', state: { notice: 'Patient details updated successfully.' } },
          ]}
        >
          <Routes>
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Patient details updated successfully.')).toBeInTheDocument()
  })
})
