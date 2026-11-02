import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
})
