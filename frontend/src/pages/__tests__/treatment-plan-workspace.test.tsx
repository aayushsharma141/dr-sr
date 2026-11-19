import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import { TreatmentPlanWorkspace } from '../TreatmentPlanWorkspace'
import type {
  Me,
  PatientOut,
  TreatmentPlanOut,
  TreatmentSessionOut,
} from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: [
    'plan:read',
    'plan:write',
    'session_log:read',
    'session_log:write',
    'dashboard:doctor',
  ],
  version_id: 1,
}

const mockPatient: PatientOut = {
  id: 102,
  urn: 'KH-2026-0002',
  full_name: 'Sunita Sharma',
  guardian_name: 'Ramesh Sharma',
  gender: 'F',
  dob: '1985-08-20',
  age_years: 41,
  mobile: '9876543222',
  address: 'Bhojpur',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876500001',
  allergies: 'None',
  notes: 'None',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockActivePlan: TreatmentPlanOut = {
  id: 201,
  patient_id: 102,
  patient_urn: 'KH-2026-0002',
  patient_name: 'Sunita Sharma',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_id: null,
  plan_name: 'Lumbar Spondylosis 5-Session Rehab',
  condition_diagnosis: 'L4-L5 Disc Herniation',
  referred_by: 'Self',
  total_sessions: 5,
  completed_sessions: 2,
  agreed_price_paise: 250000,
  status: 'ACTIVE',
  cancellation_reason: null,
  version_id: 1,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

const mockSessions: TreatmentSessionOut[] = [
  {
    id: 1,
    treatment_plan_id: 201,
    patient_id: 102,
    patient_urn: 'KH-2026-0002',
    patient_name: 'Sunita Sharma',
    doctor_id: 1,
    doctor_name: 'Dr. Madan Mohan Dwivedi',
    session_number: 1,
    session_date: '2026-11-01',
    vas_score: 8,
    modalities: ['IFT', 'Hot Pack'],
    clinical_notes: 'Session 1: Severe lumbar spasm noted.',
    is_finalised: true,
    created_by_user_id: 3,
    created_by_username: 'doctor',
    created_at: '2026-11-01T10:30:00Z',
    addenda: [],
  },
  {
    id: 2,
    treatment_plan_id: 201,
    patient_id: 102,
    patient_urn: 'KH-2026-0002',
    patient_name: 'Sunita Sharma',
    doctor_id: 1,
    doctor_name: 'Dr. Madan Mohan Dwivedi',
    session_number: 2,
    session_date: '2026-11-02',
    vas_score: 5,
    modalities: ['IFT', 'Lumbar Traction'],
    clinical_notes: 'Session 2: Spasm reduced, pain moderate.',
    is_finalised: true,
    created_by_user_id: 3,
    created_by_username: 'doctor',
    created_at: '2026-11-02T10:30:00Z',
    addenda: [
      {
        id: 10,
        session_id: 2,
        author_user_id: 3,
        author_name: 'doctor',
        note: 'Traction tolerance good.',
        created_at: '2026-11-02T11:00:00Z',
      },
    ],
  },
]

describe('Treatment Plan Workspace & Session Logger UI', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders active treatment package with progress gauge and session history', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/patients/102/treatment-plans')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockActivePlan])),
        })
      }
      if (url.includes('/api/treatment-plans/201/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSessions)),
        })
      }
      if (url.includes('/api/patients/102')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans?patient_id=102']}>
          <Routes>
            <Route path="/doctor/treatment-plans" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Patient and Plan Info
    await waitFor(() => {
      expect(screen.getByText(/Sunita Sharma/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/Lumbar Spondylosis 5-Session Rehab/i)).toBeInTheDocument()
    expect(screen.getByText(/2 of 5 Sessions Completed/i)).toBeInTheDocument()
    expect(screen.getByText('₹2,500')).toBeInTheDocument()

    // Next session button present
    expect(screen.getByText(/Log Session #3/i)).toBeInTheDocument()

    // Session history rendered
    await waitFor(() => {
      expect(screen.getByText(/Session #1/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/VAS: 8\/10/i)).toBeInTheDocument()
    expect(screen.getByText(/Session #2/i)).toBeInTheDocument()
    expect(screen.getByText(/VAS: 5\/10/i)).toBeInTheDocument()
    expect(screen.getByText(/Traction tolerance good/i)).toBeInTheDocument()
  })

  it('opens session logger modal and logs session #3', async () => {
    let capturedBody: any = null

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/patients/102/treatment-plans')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockActivePlan])),
        })
      }
      if (url.endsWith('/api/treatment-plans/201/sessions') && opts?.method === 'POST') {
        capturedBody = JSON.parse(opts.body)
        const newSession: TreatmentSessionOut = {
          id: 3,
          treatment_plan_id: 201,
          patient_id: 102,
          patient_urn: 'KH-2026-0002',
          patient_name: 'Sunita Sharma',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          session_number: 3,
          session_date: '2026-11-03',
          vas_score: capturedBody.vas_score,
          modalities: capturedBody.modalities,
          clinical_notes: capturedBody.clinical_notes,
          is_finalised: true,
          created_by_user_id: 3,
          created_by_username: 'doctor',
          created_at: '2026-11-03T10:30:00Z',
          addenda: [],
        }
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(newSession)),
        })
      }
      if (url.includes('/api/treatment-plans/201/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSessions)),
        })
      }
      if (url.includes('/api/patients/102')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans?patient_id=102']}>
          <Routes>
            <Route path="/doctor/treatment-plans" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Log Session #3/i)).toBeInTheDocument()
    })

    // Click Log Session #3
    await userEvent.click(screen.getByText(/Log Session #3/i))

    // Verify modal opened
    await waitFor(() => {
      expect(screen.getByText(/Log Session #3 of 5/i)).toBeInTheDocument()
    })

    // Enter notes
    const notesInput = screen.getByPlaceholderText(/Record range of motion/i)
    await userEvent.type(notesInput, 'Session 3 completed. Pain localized to L5.')

    // Submit session
    const submitBtn = screen.getByText(/Finalise & Lock Session #3/i)
    await userEvent.click(submitBtn)

    // Verify payload captured
    await waitFor(() => {
      expect(capturedBody).not.toBeNull()
    })
    expect(capturedBody.clinical_notes).toBe('Session 3 completed. Pain localized to L5.')
    expect(capturedBody.vas_score).toBe(5)
  })

  it('renders Active Treatment Packages Roster on launchpad from GET /api/treatment-plans?status=ACTIVE with Open Plan link', async () => {
    const requestedUrls: string[] = []
    const completedPlan: TreatmentPlanOut = {
      ...mockActivePlan,
      id: 202,
      plan_name: 'Cervical Traction 5-Session Rehab',
      condition_diagnosis: 'Cervical Spondylosis',
      completed_sessions: 5,
      total_sessions: 5,
      status: 'COMPLETED',
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      requestedUrls.push(String(url))
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/treatment-plans?status=ACTIVE')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockActivePlan])),
        })
      }
      if (url.includes('/api/treatment-plans?status=COMPLETED')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([completedPlan])),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([mockPatient])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans']}>
          <Routes>
            <Route path="/doctor/treatment-plans" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Physiotherapy Treatment/ })).toBeInTheDocument()
    })
    expect(screen.getByPlaceholderText(/Type URN/i)).toBeInTheDocument()

    const roster = await screen.findByTestId('active-treatment-plans-roster')
    expect(await within(roster).findByText(/Lumbar Spondylosis 5-Session Rehab/i)).toBeInTheDocument()
    expect(within(roster).getByText('Sunita Sharma')).toBeInTheDocument()
    expect(within(roster).getByText('KH-2026-0002')).toBeInTheDocument()
    expect(within(roster).getByText(/2 \/ 5/i)).toBeInTheDocument()

    const openLink = within(roster).getByRole('link', { name: /Open Plan/i })
    expect(openLink).toHaveAttribute('href', '/doctor/treatment-plans/201')
    expect(requestedUrls.some((u) => u.includes('/api/treatment-plans?status=ACTIVE'))).toBe(true)

    // Static protocol cards are no longer rendered
    expect(screen.queryByText(/Spine Rehabilitation \(Lumbar \/ Cervical\)/i)).not.toBeInTheDocument()

    // Status filter switches to Completed
    await userEvent.click(within(roster).getByRole('button', { name: 'Completed' }))
    expect(await within(roster).findByText(/Cervical Traction 5-Session Rehab/i)).toBeInTheDocument()
  })

  it('links encounter_id when creating a package, resets form, and navigates to the created plan', async () => {
    let capturedCreateBody: any = null
    const patient101: PatientOut = {
      ...mockPatient,
      id: 101,
      urn: 'KH-2026-0001',
      full_name: 'Aarav Kumar',
    }
    const createdPlan: TreatmentPlanOut = {
      ...mockActivePlan,
      id: 305,
      patient_id: 101,
      patient_urn: 'KH-2026-0001',
      patient_name: 'Aarav Kumar',
      encounter_id: 10,
      plan_name: 'Post-Op ACL Rehab',
      condition_diagnosis: 'Right ACL tear recovery',
      total_sessions: 10,
      completed_sessions: 0,
      agreed_price_paise: 500000,
    }

    function LocationProbe() {
      const loc = useLocation()
      return <span data-testid="location-probe">{loc.pathname}{loc.search}</span>
    }

    const mockFetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.endsWith('/api/treatment-plans') && opts?.method === 'POST') {
        capturedCreateBody = JSON.parse(opts.body)
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(createdPlan)),
        })
      }
      if (url.includes('/api/treatment-plans/305/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (url.includes('/api/treatment-plans/305')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(createdPlan)),
        })
      }
      if (url.includes('/api/patients/101/treatment-plans')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(capturedCreateBody ? [createdPlan] : [])),
        })
      }
      if (url.includes('/api/patients/101')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(patient101)),
        })
      }
      if (url.includes('/api/patients')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([patient101])),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans?patient_id=101&encounter_id=10']}>
          <LocationProbe />
          <Routes>
            <Route path="/doctor/treatment-plans" element={<TreatmentPlanWorkspace />} />
            <Route path="/doctor/treatment-plans/:id" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Aarav Kumar/i)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /\+ New Package/i }))

    // Badge shows Linked to Consultation #10
    expect(screen.getByTestId('linked-encounter-badge')).toHaveTextContent('Linked to Consultation #10')

    // Validation blocks <2 char diagnosis before hitting server
    const planNameInput = screen.getByLabelText(/Package Name/i)
    const diagInput = screen.getByLabelText(/Condition \/ Diagnosis/i)
    await userEvent.clear(planNameInput)
    await userEvent.type(planNameInput, 'Post-Op ACL Rehab')
    await userEvent.type(diagInput, 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Create Package' }))
    expect(capturedCreateBody).toBeNull()

    // Valid diagnosis submits encounter_id: 10
    await userEvent.clear(diagInput)
    await userEvent.type(diagInput, 'Right ACL tear recovery')
    await userEvent.click(screen.getByRole('button', { name: 'Create Package' }))

    await waitFor(() => {
      expect(capturedCreateBody).not.toBeNull()
    })
    expect(capturedCreateBody).toMatchObject({
      patient_id: 101,
      encounter_id: 10,
      plan_name: 'Post-Op ACL Rehab',
      condition_diagnosis: 'Right ACL tear recovery',
    })

    // Navigated immediately to the newly created plan route
    await waitFor(() => {
      expect(screen.getByTestId('location-probe')).toHaveTextContent('/doctor/treatment-plans/305')
    })
    expect(await screen.findByText('Post-Op ACL Rehab')).toBeInTheDocument()

    // Re-opening New Package modal confirms inputs were reset
    await userEvent.click(screen.getByRole('button', { name: /\+ New Package/i }))
    expect(screen.getByLabelText(/Package Name/i)).toHaveValue('Physiotherapy Rehabilitation Package')
    expect(screen.getByLabelText(/Condition \/ Diagnosis/i)).toHaveValue('')
  })

  it('shows read-only banner and hides write actions for another doctor plan, and filters activePlan out of Other Packages', async () => {
    const otherDoctorPlan: TreatmentPlanOut = {
      ...mockActivePlan,
      id: 210,
      doctor_id: 99,
      doctor_name: 'Dr. Kavita Verma',
      plan_name: 'Shoulder Frozen Joint Rehab',
    }
    const secondPlan: TreatmentPlanOut = {
      ...mockActivePlan,
      id: 211,
      doctor_id: 1,
      plan_name: 'Older Knee Rehab',
      status: 'COMPLETED',
      completed_sessions: 5,
      total_sessions: 5,
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/treatment-plans/210/sessions')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockSessions)),
        })
      }
      if (url.includes('/api/treatment-plans/210')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(otherDoctorPlan)),
        })
      }
      if (url.includes('/api/patients/102/treatment-plans')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([otherDoctorPlan, secondPlan])),
        })
      }
      if (url.includes('/api/patients/102')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans/210']}>
          <Routes>
            <Route path="/doctor/treatment-plans/:id" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Shoulder Frozen Joint Rehab')).toBeInTheDocument()
    const banner = await screen.findByTestId('treatment-plan-readonly-banner')
    expect(banner).toHaveTextContent(/Dr\. Kavita Verma/i)

    // Write buttons are hidden for cross-doctor plan
    expect(screen.queryByRole('button', { name: /Log Session/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel Package/i })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByText(/Session #1/i)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /\+ Addendum/i })).not.toBeInTheDocument()

    // Other Treatment Packages excludes the currently viewed plan
    expect(screen.getByText('Other Treatment Packages (1)')).toBeInTheDocument()
    expect(screen.getByText('Older Knee Rehab')).toBeInTheDocument()
  })

  it('renders treatment-plan-error alert for 404 or invalid route plan ID instead of silent launchpad', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/treatment-plans/9999')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'plan_not_found', message: 'Treatment plan not found.' })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans/9999']}>
          <Routes>
            <Route path="/doctor/treatment-plans/:id" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const err404 = await screen.findByTestId('treatment-plan-error')
    expect(err404).toHaveAttribute('role', 'alert')
    expect(err404).toHaveTextContent(/Treatment plan not found/i)
    expect(screen.queryByTestId('active-treatment-plans-roster')).not.toBeInTheDocument()
    unmount()

    // Non-numeric route plan ID also renders treatment-plan-error
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/treatment-plans/invalid-id']}>
          <Routes>
            <Route path="/doctor/treatment-plans/:id" element={<TreatmentPlanWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    const errInvalid = await screen.findByTestId('treatment-plan-error')
    expect(errInvalid).toHaveAttribute('role', 'alert')
    expect(errInvalid).toHaveTextContent(/Invalid treatment plan ID/i)
    expect(screen.queryByTestId('active-treatment-plans-roster')).not.toBeInTheDocument()
  })
})
