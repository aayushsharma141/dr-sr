import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DoctorDashboard } from '../DoctorDashboard'
import { ClinicalEncounterWorkspace } from '../ClinicalEncounterWorkspace'
import type {
  DoctorQueueResponse,
  EncounterRead,
  Me,
  PatientOut,
} from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'doctor',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write', 'dashboard:doctor'],
  version_id: 1,
}

const mockPatient: PatientOut = {
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
  allergies: 'Penicillin allergy',
  notes: 'Referred by Dr. Sharma',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockQueue: DoctorQueueResponse = {
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  queue_date: '2026-11-01',
  in_consultation: [],
  waiting: [
    {
      id: 10,
      patient_id: 101,
      patient_urn: 'KH-2026-0001',
      patient_name: 'Aarav Kumar',
      patient_gender: 'M',
      patient_age: 30,
      patient_mobile: '9876543210',
      patient_allergies: 'Penicillin allergy',
      token_number: 1,
      booking_mode: 'WALK_IN',
      visit_type: 'NEW_CONSULTATION',
      status: 'ARRIVED',
      status_updated_at: '2026-11-01T10:00:00Z',
      notes: 'Severe shoulder pain',
      version_id: 2,
    },
  ],
  booked: [],
  completed: [],
  total_active: 1,
}

const mockEncounter: EncounterRead = {
  id: 50,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  appointment_id: 10,
  encounter_date: '2026-11-01T10:15:00Z',
  symptoms: 'Right shoulder pain while lifting arm',
  clinical_notes: 'Positive Neer and Hawkins tests; supraspinatus tenderness',
  diagnosis: 'Right Rotator Cuff Tendinopathy',
  is_finalised: false,
  finalised_at: null,
  version_id: 1,
  created_at: '2026-11-01T10:15:00Z',
  updated_at: '2026-11-01T10:15:00Z',
  addenda: [],
}

describe('Doctor Workspace and Clinical Encounters', () => {
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

  it('renders doctor consultation queue with waiting patients and token numbers', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/doctor/queue')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockQueue)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <DoctorDashboard />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('#1')).toBeInTheDocument()
    })

    expect(screen.getByText('Doctor Consultation Queue')).toBeInTheDocument()
    expect(screen.getByText('Aarav Kumar')).toBeInTheDocument()
    expect(screen.getByText(/KH-2026-0001/)).toBeInTheDocument()
    expect(screen.getByText(/Penicillin allergy/)).toBeInTheDocument()
    expect(screen.getByText(/Start Consultation/)).toBeInTheDocument()
  })

  it('records encounter notes, finalises consultation and adds dated addenda', async () => {
    let capturedFinalise = false
    let capturedAddendum: unknown = null
    let currentEncounterState = { ...mockEncounter }

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (url.includes('/api/patients/101/encounters')) {
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
          text: () => Promise.resolve(JSON.stringify(mockPatient)),
        })
      }
      if (url.includes('/api/encounters/50/finalise') && init?.method === 'POST') {
        capturedFinalise = true
        currentEncounterState = {
          ...currentEncounterState,
          is_finalised: true,
          finalised_at: '2026-11-01T10:30:00Z',
          version_id: 2,
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(currentEncounterState)),
        })
      }
      if (url.includes('/api/encounters/50/addenda') && init?.method === 'POST') {
        capturedAddendum = JSON.parse(init.body as string)
        const added = {
          id: 1,
          encounter_id: 50,
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          addendum_text: (capturedAddendum as { addendum_text: string }).addendum_text,
          created_at: '2026-11-01T10:45:00Z',
        }
        currentEncounterState = {
          ...currentEncounterState,
          addenda: [...currentEncounterState.addenda, added],
        }
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(added)),
        })
      }
      if (url.includes('/api/encounters/50')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(currentEncounterState)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/doctor/encounters/50']}>
          <Routes>
            <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByDisplayValue('Right Rotator Cuff Tendinopathy')).toBeInTheDocument()
    })

    // Click Finalise Consultation button
    await user.click(screen.getByRole('button', { name: /finalise consultation/i }))

    // Finalise Confirmation Dialog appears
    expect(screen.getByText('Finalise Consultation?')).toBeInTheDocument()

    // Confirm finalisation
    await user.click(screen.getByRole('button', { name: /yes, lock & finalise/i }))

    await waitFor(() => {
      expect(capturedFinalise).toBe(true)
      expect(screen.getByText(/Finalised & Locked/)).toBeInTheDocument()
    })

    // Append Addendum
    const addendumInput = screen.getByPlaceholderText(/record follow-up remarks/i)
    await user.type(addendumInput, 'Patient doing ultrasound therapy daily.')
    await user.click(screen.getByRole('button', { name: /\+ append addendum/i }))

    await waitFor(() => {
      expect(capturedAddendum).toEqual({
        addendum_text: 'Patient doing ultrasound therapy daily.',
      })
      expect(screen.getByText('Patient doing ultrasound therapy daily.')).toBeInTheDocument()
    })
  })
})
