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
      if (url.includes('/api/patients/101/summary')) return Promise.resolve(jsonRes(200, { patient_id: 101, urn: serverPatient.urn, total_visits: 0, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: null, prescriptions_count: null, active_conditions_count: null, latest_encounter: null, total_billed_paise: 0, total_paid_paise: 0, total_refunded_paise: 0, outstanding_paise: 0 }))
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
    expect(screen.getAllByText('9876599999').length).toBeGreaterThan(0)

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
      if (url.includes('/api/patients/101/summary')) return Promise.resolve(jsonRes(200, { patient_id: 101, urn: 'KH-2026-0001', total_visits: 0, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: null, prescriptions_count: null, active_conditions_count: null, latest_encounter: null, total_billed_paise: 0, total_paid_paise: 0, total_refunded_paise: 0, outstanding_paise: 0 }))
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

    const receptionMe: Me = {
      ...mockMe,
      permissions: ['patient:read', 'patient:update', 'payment:read', 'timeline:read'],
    }
    const mockSummary = {
      patient_id: 101,
      urn: 'KH-2026-0001',
      total_visits: 1,
      active_treatment_plans: 1,
      latest_visit: null,
      allergy_alert: {
        has_allergies: true,
        count: 1,
        highest_severity: 'MODERATE',
        alert_labels: ['Penicillin'],
      },
      active_allergies: null,
      prescriptions_count: null,
      active_conditions_count: null,
      latest_encounter: null,
      total_billed_paise: 50000,
      total_paid_paise: 50000,
      total_refunded_paise: 0,
      outstanding_paise: 0,
    }
    const mockVisits = {
      items: [
        {
          visit_id: 10,
          visit_code: 'VIS-2026-0010',
          visit_date: '2026-11-01',
          status: 'OPEN',
          token_numbers: [1],
          doctors: ['Madan Mohan Dwivedi'],
          departments: ['Physiotherapy'],
          consultation_count: 1,
          completed_consultations: 0,
          encounter_links: null,
          bill_total_paise: 50000,
          paid_paise: 50000,
          due_paise: 0,
          payment_status: 'PAID',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
    }
    const mockPayments = [
      {
        id: 30,
        receipt_number: 'KH-RCPT-0030',
        patient_id: 101,
        patient_urn: 'KH-2026-0001',
        patient_name: 'Aarav Kumar',
        treatment_plan_id: null,
        treatment_plan_name: null,
        appointment_id: null,
        amount_paise: 50000,
        payment_method: 'CASH',
        notes: null,
        is_reversed: false,
        reversal_reason: null,
        reversed_by_username: null,
        reversed_at: null,
        created_by_username: 'reception',
        created_at: '2026-11-01T12:00:00Z',
      },
    ]
    const mockLedger = {
      patient_id: 101,
      patient_urn: 'KH-2026-0001',
      total_billed_paise: 50000,
      total_paid_paise: 50000,
      total_refunded_paise: 0,
      outstanding_paise: 0,
      ledger_balance_paise: 0,
      entries: [],
      total_entries: 0,
      limit: 50,
      offset: 0,
      payments: mockPayments.map((p) => ({
        ...p,
        refunded_paise: 0,
        remaining_refundable_paise: p.amount_paise,
      })),
      refunds: [],
      visits: [
        {
          visit_id: 10,
          visit_code: 'VIS-2026-0010',
          visit_date: '2026-11-01',
          status: 'OPEN',
          bill_total_paise: 50000,
          paid_paise: 50000,
          refunded_paise: 0,
          due_paise: 0,
        },
      ],
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(receptionMe)),
        })
      }
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSummary)),
        })
      }
      if (url.includes('/api/patients/101/visits')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockVisits)),
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
      if (url.includes('/api/patients/101/ledger')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockLedger)),
        })
      }
      if (url.includes('/api/patients/101/payments')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPayments)),
        })
      }
      if (url.includes('/api/settings/clinic')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({})),
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
      expect(screen.getAllByText('KH-2026-0001').length).toBeGreaterThan(0)
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Aarav Kumar' })).toBeInTheDocument()
    expect(screen.getAllByText('Suresh Kumar').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Penicillin').length).toBeGreaterThan(0)
    expect(screen.getByText('30 Years')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /edit patient/i })).toHaveAttribute(
      'href',
      '/reception/patients/101/edit',
    )
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()

    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Clinical Records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Change History' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Visit History' }))
    await waitFor(() => {
      expect(screen.getAllByText('VIS-2026-0010').length).toBeGreaterThan(0)
    })

    await user.click(screen.getByRole('tab', { name: 'Treatment Plans' }))
    await waitFor(() => {
      expect(screen.getByText('Package: Knee Rehabilitation')).toBeInTheDocument()
    })
    expect(screen.queryByText('KH-RCPT-0030')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Billing & Ledger' }))
    await waitFor(() => {
      expect(screen.getByText('KH-RCPT-0030')).toBeInTheDocument()
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
    const encounters = [
      {
        id: 41,
        patient_id: 101,
        doctor_id: 1,
        doctor_name: 'Madan Mohan Dwivedi',
        encounter_date: '2026-11-01T10:00:00Z',
        diagnosis: 'Lumbar radiculopathy',
        is_finalised: true,
        finalised_at: '2026-11-01T10:30:00Z',
        addenda_count: 0,
      },
    ]
    const prescriptions = [
      {
        id: 42,
        patient_id: 101,
        patient_urn: 'KH-2026-0001',
        patient_name: 'Aarav Kumar',
        doctor_id: 1,
        doctor_name: 'Madan Mohan Dwivedi',
        encounter_id: 41,
        diagnosis: 'Lumbar radiculopathy',
        follow_up_date: '2026-11-15',
        status: 'AUTHORISED',
        revision_number: 1,
        supersedes_prescription_id: null,
        amendment_reason: null,
        items_count: 1,
        created_at: '2026-11-01T11:00:00Z',
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
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ patient_id: 101, urn: 'KH-2026-0001', total_visits: 1, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: [], prescriptions_count: 1, active_conditions_count: 0, latest_encounter: null, total_billed_paise: null, total_paid_paise: null, total_refunded_paise: null, outstanding_paise: null })),
        })
      }
      if (url.includes('/api/patients/101/allergies')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101/conditions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101/encounters')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(encounters)),
        })
      }
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(prescriptions)),
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
      expect(screen.getByRole('tab', { name: 'Clinical Records' })).toBeInTheDocument()
      expect(screen.getByRole('tab', { name: 'Prescriptions' })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Clinical Records' }))
    await waitFor(() => {
      expect(screen.getByText('ENC-#41')).toBeInTheDocument()
      expect(screen.getByText('Lumbar radiculopathy')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('tab', { name: 'Prescriptions' }))
    await waitFor(() => {
      expect(screen.getByText('v1')).toBeInTheDocument()
      expect(screen.getByText('Authorised')).toBeInTheDocument()
      expect(screen.getByText('1 medication')).toBeInTheDocument()
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
      if (url.includes('/api/patients/101/allergies')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ patient_id: 101, urn: 'KH-2026-0001', total_visits: 0, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: [], prescriptions_count: 0, active_conditions_count: 0, latest_encounter: null, total_billed_paise: null, total_paid_paise: null, total_refunded_paise: null, outstanding_paise: null })),
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
      if (url.includes('/api/patients/101/allergies')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ patient_id: 101, urn: 'KH-2026-0001', total_visits: 0, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: [], prescriptions_count: 0, active_conditions_count: 0, latest_encounter: null, total_billed_paise: null, total_paid_paise: null, total_refunded_paise: null, outstanding_paise: null })),
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
      expect(screen.getAllByText('KH-2026-0001').length).toBeGreaterThan(0)
    })
    // Doctor can view file and print card, but cannot edit demographics
    expect(screen.queryByRole('link', { name: /edit patient/i })).not.toBeInTheDocument()
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
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve(jsonOk({ patient_id: 101, urn: 'KH-2026-0001', total_visits: 0, active_treatment_plans: 0, latest_visit: null, allergy_alert: null, active_allergies: null, prescriptions_count: null, active_conditions_count: null, latest_encounter: null, total_billed_paise: 0, total_paid_paise: 0, total_refunded_paise: 0, outstanding_paise: 0 }))
      }
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
      expect(screen.getAllByText('KH-2026-0001').length).toBeGreaterThan(0)
    })
    expect(screen.getByRole('link', { name: /print card/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /edit patient/i })).not.toBeInTheDocument()
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

  it('sends server-side filters (status, gender, district, sort_by, has_due_balance) for RECEPTION and ADMIN and renders due balance badge', async () => {
    const receptionWithPayment: Me = {
      ...mockMe,
      role: 'RECEPTION',
      permissions: ['patient:read', 'patient:create', 'patient:update', 'payment:read'],
    }
    const adminWithPayment: Me = {
      ...mockMe,
      id: 1,
      username: 'admin',
      full_name: 'Hospital Admin',
      role: 'ADMIN',
      permissions: ['patient:read', 'payment:read'],
    }
    const patientWithDue: PatientOut = {
      ...mockPatients[0],
      visit_count: 3,
      last_visit_date: '2026-11-10',
      outstanding_paise: 75000,
    }

    for (const actor of [receptionWithPayment, adminWithPayment]) {
      const listUrls: string[] = []
      const countUrls: string[] = []
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, actor))
        if (url.includes('/api/patients/count')) {
          countUrls.push(url)
          return Promise.resolve(jsonRes(200, { total: 1 }))
        }
        if (url.includes('/api/patients')) {
          listUrls.push(url)
          return Promise.resolve(jsonRes(200, [patientWithDue]))
        }
        return Promise.reject(new Error(`Unhandled: ${url}`))
      })
      vi.stubGlobal('fetch', mockFetch)

      const user = userEvent.setup()
      const localQc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const { unmount } = render(
        <QueryClientProvider client={localQc}>
          <MemoryRouter>
            <PatientsDirectory />
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(await screen.findByText('KH-2026-0001')).toBeInTheDocument()
      expect(await screen.findByText(/Due ₹750/i)).toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Status'), 'archived')
      await user.selectOptions(screen.getByLabelText('Gender'), 'F')
      await user.selectOptions(screen.getByLabelText('Sort by'), 'name')
      await user.click(screen.getByLabelText(/Has Due Balance/i))
      await user.type(screen.getByLabelText('District'), 'Bhojpur')

      await waitFor(() => {
        const lastList = listUrls[listUrls.length - 1] ?? ''
        expect(lastList).toContain('status=archived')
        expect(lastList).toContain('gender=F')
        expect(lastList).toContain('sort_by=name')
        expect(lastList).toContain('has_due_balance=true')
        expect(lastList).toContain('district=Bhojpur')
      })

      const lastCount = countUrls[countUrls.length - 1] ?? ''
      expect(lastCount).toContain('status=archived')
      expect(lastCount).toContain('gender=F')
      expect(lastCount).toContain('has_due_balance=true')
      expect(lastCount).toContain('district=Bhojpur')

      unmount()
    }
  })

  it('resets pagination to offset=0 whenever a directory filter changes on page 2', async () => {
    const receptionWithPayment: Me = {
      ...mockMe,
      permissions: ['patient:read', 'patient:create', 'patient:update', 'payment:read'],
    }
    const allPatients: PatientOut[] = Array.from({ length: 25 }, (_, i) => ({
      ...mockPatients[0],
      id: 2000 + i,
      urn: `KH-2026-${String(i + 1).padStart(4, '0')}`,
      full_name: `Directory Patient ${i + 1}`,
    }))
    const listUrls: string[] = []

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, receptionWithPayment))
      if (url.includes('/api/patients/count')) {
        return Promise.resolve(jsonRes(200, { total: allPatients.length }))
      }
      if (url.includes('/api/patients')) {
        listUrls.push(url)
        const params = new URL(url, 'http://localhost').searchParams
        const limit = Number(params.get('limit'))
        const offset = Number(params.get('offset'))
        return Promise.resolve(jsonRes(200, allPatients.slice(offset, offset + limit)))
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

    expect(await screen.findByText('KH-2026-0001')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    })
    expect(listUrls[listUrls.length - 1]).toContain('offset=20')

    // Changing Gender filter must reset pagination back to offset=0
    await user.selectOptions(screen.getByLabelText('Gender'), 'M')
    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    })
    const afterGenderUrl = listUrls[listUrls.length - 1] ?? ''
    expect(afterGenderUrl).toContain('gender=M')
    expect(afterGenderUrl).toContain('offset=0')

    // Go back to Page 2 and change Status filter -> offset=0 again
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    })
    await user.selectOptions(screen.getByLabelText('Status'), 'all')
    await waitFor(() => {
      expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    })
    const afterStatusUrl = listUrls[listUrls.length - 1] ?? ''
    expect(afterStatusUrl).toContain('status=all')
    expect(afterStatusUrl).toContain('offset=0')
  })

  it('strictly hides Has Due Balance filter and due-balance display for DOCTOR and never sends has_due_balance', async () => {
    const doctorMe: Me = {
      ...mockMe,
      id: 3,
      username: 'dr_dwivedi',
      full_name: 'Dr. Madan Mohan Dwivedi',
      role: 'DOCTOR',
      doctor_id: 1,
      permissions: ['patient:read', 'encounter:read'],
    }
    const requestedUrls: string[] = []
    const doctorPatientRow: PatientOut = {
      ...mockPatients[0],
      visit_count: 2,
      last_visit_date: '2026-11-10',
      // Even if a stale payload had outstanding_paise, DOCTOR UI must never render it.
      outstanding_paise: 50000,
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      requestedUrls.push(url)
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, doctorMe))
      if (url.includes('/api/patients/count')) return Promise.resolve(jsonRes(200, { total: 1 }))
      if (url.includes('/api/patients')) return Promise.resolve(jsonRes(200, [doctorPatientRow]))
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

    expect(await screen.findByText('KH-2026-0001')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getAllByText('Dr. Madan Mohan Dwivedi').length).toBeGreaterThan(0)
    })

    expect(screen.queryByLabelText(/Has Due Balance/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Due ₹/i)).not.toBeInTheDocument()
    expect(requestedUrls.some((u) => u.includes('has_due_balance'))).toBe(false)

    // Doctor row "Clinical Chart" link must navigate to the patient's Clinical Records tab
    const clinicalChartLink = screen.getByRole('link', { name: 'Clinical Chart' })
    expect(clinicalChartLink).toHaveAttribute('href', '/reception/patients/101?tab=clinical')
  })

  it('shows empty-state "New patient" link ONLY for RECEPTION and strictly hides it for DOCTOR and ADMIN', async () => {
    const roles: Array<{ me: Me; shouldShowNewPatient: boolean }> = [
      {
        me: {
          ...mockMe,
          role: 'RECEPTION',
          full_name: 'Front Desk Staff',
          permissions: ['patient:read', 'patient:create'],
        },
        shouldShowNewPatient: true,
      },
      {
        me: {
          ...mockMe,
          id: 3,
          role: 'DOCTOR',
          username: 'dr_dwivedi',
          full_name: 'Dr. Madan Mohan Dwivedi',
          doctor_id: 1,
          permissions: ['patient:read'],
        },
        shouldShowNewPatient: false,
      },
      {
        me: {
          ...mockMe,
          id: 1,
          role: 'ADMIN',
          username: 'admin',
          full_name: 'Hospital Admin',
          permissions: ['patient:read'],
        },
        shouldShowNewPatient: false,
      },
    ]

    for (const { me, shouldShowNewPatient } of roles) {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(200, me))
        if (url.includes('/api/patients/count')) return Promise.resolve(jsonRes(200, { total: 0 }))
        if (url.includes('/api/patients')) return Promise.resolve(jsonRes(200, []))
        return Promise.reject(new Error(`Unhandled: ${url}`))
      })
      vi.stubGlobal('fetch', mockFetch)

      const localQc = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      const { unmount } = render(
        <QueryClientProvider client={localQc}>
          <MemoryRouter>
            <PatientsDirectory />
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(await screen.findByText('No patients registered yet')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getAllByText(me.full_name).length).toBeGreaterThan(0)
      })

      if (shouldShowNewPatient) {
        const newLinks = screen.getAllByRole('link', { name: /new patient/i })
        expect(newLinks.length).toBeGreaterThanOrEqual(2)
        expect(newLinks.every((l) => l.getAttribute('href') === '/reception/patients/new')).toBe(
          true,
        )
      } else {
        expect(screen.queryByRole('link', { name: /new patient/i })).not.toBeInTheDocument()
      }

      unmount()
    }
  })
})
