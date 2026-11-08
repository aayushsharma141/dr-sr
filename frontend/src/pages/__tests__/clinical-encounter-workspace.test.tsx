import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import { ClinicalEncounterWorkspace } from '../ClinicalEncounterWorkspace'
import type {
  Me,
  PatientOut,
  EncounterRead,
  EncounterSummary,
  VitalObservationResponse,
  ClinicalTemplateRead,
  PrescriptionOut,
  DoctorOut,
} from '../../api/types'

const mockMeDoctor: Me = {
  id: 3,
  username: 'drdwivedi',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'test-csrf-token',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write', 'prescriptions:read', 'prescriptions:write'],
  version_id: 1,
}

const mockPatientWithAllergy: PatientOut = {
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
  allergies: 'Penicillin, Sulfa drugs',
  notes: 'Referred by Dr. Sharma',
  photo_path: null,
  is_active: true,
  version_id: 1,
  created_at: '2026-01-01T10:00:00Z',
  updated_at: '2026-01-01T10:00:00Z',
}

const mockEncounterPhysio: EncounterRead = {
  id: 10,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  appointment_id: 5,
  department_id: 1,
  encounter_date: '2026-11-06T10:00:00Z',
  symptoms: 'Low back pain radiating to left leg for 2 weeks',
  clinical_notes: 'SLR positive on left at 45 degrees. Tenderness L4-L5.',
  diagnosis: 'Lumbar Radiculopathy',
  is_finalised: false,
  finalised_at: null,
  version_id: 1,
  created_at: '2026-11-06T10:00:00Z',
  updated_at: '2026-11-06T10:00:00Z',
  addenda: [],
}

const mockPriorEncounterSummary: EncounterSummary = {
  id: 4,
  patient_id: 101,
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  encounter_date: '2026-10-15T09:30:00Z',
  diagnosis: 'Acute Lumbar Muscle Sprain',
  is_finalised: true,
  finalised_at: '2026-10-15T10:00:00Z',
  addenda_count: 0,
}

const mockPriorEncounterFull: EncounterRead = {
  id: 4,
  patient_id: 101,
  patient_urn: 'KH-2026-0001',
  patient_name: 'Aarav Kumar',
  doctor_id: 1,
  doctor_name: 'Dr. Madan Mohan Dwivedi',
  appointment_id: 2,
  department_id: 1,
  encounter_date: '2026-10-15T09:30:00Z',
  symptoms: 'Prior: Acute lower back stiffness after lifting luggage',
  clinical_notes: 'Paraspinal muscle spasm without neuro deficit.',
  diagnosis: 'Prior: Acute Lumbar Muscle Sprain',
  is_finalised: true,
  finalised_at: '2026-10-15T10:00:00Z',
  version_id: 2,
  created_at: '2026-10-15T09:30:00Z',
  updated_at: '2026-10-15T10:00:00Z',
  addenda: [],
}

const mockPriorVitals: VitalObservationResponse = {
  id: 4,
  encounter_id: 4,
  patient_id: 101,
  height_cm: 172,
  weight_kg: 72,
  bmi: 24.3,
  systolic_bp: 122,
  diastolic_bp: 82,
  pulse_bpm: 76,
  temperature_f: 98.4,
  respiratory_rate: 16,
  spo2_percent: 99,
  created_at: '2026-10-15T09:30:00Z',
  updated_at: '2026-10-15T09:30:00Z',
}

const mockPhysioTemplate: ClinicalTemplateRead = {
  id: 1,
  department_id: 1,
  code: 'PHYSIOTHERAPY',
  name_en: 'Physiotherapy',
  name_hi: 'फिजियोथेरेपी',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  active_version: {
    id: 1,
    template_id: 1,
    version_number: 1,
    schema_json: {
      code: 'PHYSIOTHERAPY_V1',
      required: ['pain_site', 'starting_vas'],
    },
    is_active: true,
    approved_by: 'SYSTEM',
    approved_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  },
}

const mockOphthalTemplate: ClinicalTemplateRead = {
  id: 2,
  department_id: 2,
  code: 'OPHTHALMOLOGY',
  name_en: 'Ophthalmology',
  name_hi: 'नेत्र रोग',
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
  active_version: {
    id: 2,
    template_id: 2,
    version_number: 1,
    schema_json: {
      code: 'OPHTHALMOLOGY_V1',
      required: ['va_distance_uncorrected_od', 'va_distance_uncorrected_os'],
    },
    is_active: true,
    approved_by: 'SYSTEM',
    approved_at: '2026-01-01T00:00:00Z',
    created_at: '2026-01-01T00:00:00Z',
  },
}

const mockDoctorList: DoctorOut[] = [
  {
    id: 1,
    name_en: 'Dr. Madan Mohan Dwivedi',
    name_hi: 'डॉ. मदन मोहन द्विवेदी',
    qualification: 'BPT, MPT (Ortho)',
    registration_number: 'PT-12345',
    default_fee_paise: 50000,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('Clinical Encounter Workspace Test Suite', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
    localStorage.clear()
    sessionStorage.clear()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
    localStorage.clear()
    sessionStorage.clear()
  })

  function renderWorkspace(encounterId: number = 10) {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/doctor/encounters/${encounterId}`]}>
          <Routes>
            <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
            <Route path="/doctor" element={<div>Doctor Dashboard</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  function setupDefaultFetchMocks(opts: {
    hasPrior?: boolean
    deptTemplate?: ClinicalTemplateRead
    encounter?: EncounterRead
  } = {}) {
    const enc = opts.encounter || mockEncounterPhysio
    const tmpl = opts.deptTemplate || mockPhysioTemplate
    const hasPrior = opts.hasPrior ?? true

    return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const urlStr = String(url)

      if (urlStr.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockMeDoctor)),
        })
      }
      if (urlStr.includes('/api/doctors')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockDoctorList)),
        })
      }
      if (urlStr.includes(`/api/patients/${enc.patient_id}/encounters`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(hasPrior ? [mockPriorEncounterSummary] : [])),
        })
      }
      if (urlStr.includes('/api/encounters/4/vitals')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPriorVitals)),
        })
      }
      if (urlStr.includes('/api/encounters/4')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPriorEncounterFull)),
        })
      }
      if (urlStr.includes('/api/prescriptions') && init?.method === 'POST') {
        if (urlStr.includes('/cancel')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ id: 99, status: 'CANCELLED', is_printable: false })),
          })
        }
        if (urlStr.includes('/authorise')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ id: 99, status: 'AUTHORISED', is_printable: true })),
          })
        }
        const body = init?.body ? JSON.parse(String(init.body)) : {}
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 99,
                patient_id: enc.patient_id,
                patient_urn: 'KH-2026-0001',
                patient_name: 'Aarav Kumar',
                doctor_id: 1,
                doctor_name: 'Dr. Madan Mohan Dwivedi',
                encounter_id: enc.id,
                status: 'AUTHORISED',
                is_printable: true,
                diagnosis: 'Lumbar Radiculopathy',
                items: (body.items || []).map((it: any, idx: number) => ({
                  ...it,
                  id: idx + 1,
                  prescription_id: 99,
                })),
                version_id: 1,
                created_at: '2026-11-06T10:00:00Z',
                updated_at: '2026-11-06T10:00:00Z',
              })
            ),
        })
      }
      if (urlStr.includes(`/api/patients/${enc.patient_id}/prescriptions`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([])),
        })
      }
      if (urlStr.includes(`/api/patients/${enc.patient_id}`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(mockPatientWithAllergy)),
        })
      }
      if (urlStr.includes(`/api/encounters/${enc.id}/vitals`)) {
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body))
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ ...body, id: 10, encounter_id: enc.id, patient_id: enc.patient_id })),
          })
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'vitals_not_found', message: 'None' })),
        })
      }
      if (urlStr.includes(`/api/encounters/${enc.id}/template-response`)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'template_response_not_found', message: 'None' })),
        })
      }
      if (urlStr.includes(`/api/encounters/${enc.id}/follow-up`)) {
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'follow_up_not_found', message: 'None' })),
        })
      }
      if (urlStr.includes('/api/templates/by-department')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(tmpl)),
        })
      }
      if (urlStr.includes(`/api/encounters/${enc.id}`)) {
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body))
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ ...enc, ...body, version_id: (body.version_id || 1) + 1 })),
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(enc)),
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify({})),
      })
    })
  }

  // =========================================================================
  // TASK 1: layout and prior encounter copy
  // =========================================================================
  describe('layout and prior encounter copy', () => {
    it('renders sticky header with patient name, URN, department, allergy badge, and action buttons', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // Patient Name and URN in header
      expect(await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })).toBeInTheDocument()
      expect(screen.getAllByText(/KH-2026-0001/i).length).toBeGreaterThanOrEqual(1)

      // Severe allergy warning badge
      const allergyBadge = await screen.findByTestId('allergy-alert-badge')
      expect(allergyBadge).toBeInTheDocument()
      expect(allergyBadge).toHaveTextContent(/Penicillin, Sulfa drugs/i)

      // Primary Action Buttons in header
      const header = screen.getByTestId('sticky-clinical-header')
      expect(within(header).getByRole('button', { name: /Authorise Prescription/i })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: /Print Consultation Summary/i })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: /Finalise Consultation/i })).toBeInTheDocument()
    })

    it('renders left jump navigation rail with 6 continuous section anchors', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })
      const jumpRail = screen.getByTestId('jump-navigation-rail')
      expect(jumpRail).toBeInTheDocument()

      // Verify all 6 continuous section anchors exist
      expect(screen.getByRole('button', { name: /1\. Chief Complaints & HPI/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /2\. Vital Signs & Biometrics/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /3\. Specialty Assessment/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /4\. Diagnosis & Impressions/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /5\. Prescriptions & Medications/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /6\. Follow-up Recommendation/i })).toBeInTheDocument()
    })

    it('renders persistent side panel with previous encounter card and selective copy buttons', async () => {
      const mockFetch = setupDefaultFetchMocks({ hasPrior: true })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      // Prior encounter card
      const priorCard = await screen.findByTestId('prior-encounter-card')
      expect(priorCard).toBeInTheDocument()
      expect(screen.getByText(/Previous Consultation Card/i)).toBeInTheDocument()

      // Shows prior findings
      expect(screen.getByText(/Prior: Acute lower back stiffness/i)).toBeInTheDocument()

      // Copy Section Findings buttons exist
      const copyButtons = screen.getAllByRole('button', { name: /Copy Section Findings/i })
      expect(copyButtons.length).toBeGreaterThanOrEqual(2)

      // Click copy complaints button
      const complaintsCopyBtn = copyButtons[0]
      await userEvent.click(complaintsCopyBtn)

      // Verified: text imported into active complaints input
      const symptomsTextarea = screen.getByLabelText(/Chief Complaints & Symptoms/i) as HTMLTextAreaElement
      expect(symptomsTextarea.value).toBe('Prior: Acute lower back stiffness after lifting luggage')
    })

    it('displays empty state when patient has no prior consultations', async () => {
      const mockFetch = setupDefaultFetchMocks({ hasPrior: false })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })
      expect(await screen.findByText(/No Prior Encounters Recorded/i)).toBeInTheDocument()
      expect(
        screen.getByText(/This patient has no earlier consultation records in Kalyan Hospital/i)
      ).toBeInTheDocument()
    })
  })

  // =========================================================================
  // TASK 2: auto-save and vitals
  // =========================================================================
  describe('auto-save and vitals', () => {
    it('triggers debounced auto-save ~3s after typing and shows saved timestamp badge', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // Wait for initial render with real timers
      const symptomsInput = await screen.findByLabelText(/Chief Complaints & Symptoms/i)

      vi.useFakeTimers()
      try {
        // User types new text
        fireEvent.change(symptomsInput, { target: { value: 'Persistent pain in lower lumbar area' } })

        // Fast-forward 3000ms debounce
        await vi.advanceTimersByTimeAsync(3500)
      } finally {
        vi.useRealTimers()
      }

      await waitFor(() => {
        expect(screen.getByTestId('auto-save-pill')).toHaveTextContent(/Saved to server at/i)
      })

      // Strict security invariant T-19-10: zero clinical notes written to web storage
      expect(localStorage.length).toBe(0)
      expect(sessionStorage.length).toBe(0)
    })

    it('triggers immediate save on blur when doctor leaves a section', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const symptomsInput = await screen.findByLabelText(/Chief Complaints & Symptoms/i)
      fireEvent.change(symptomsInput, { target: { value: 'Added symptom on blur' } })
      fireEvent.blur(symptomsInput)

      await waitFor(() => {
        expect(screen.getByTestId('auto-save-pill')).toHaveTextContent(/Saved to server at/i)
      })
    })

    it('displays offline error banner when network fails and retains draft in React memory without localStorage', async () => {
      let failSave = false
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/api/encounters/10') && init?.method === 'PATCH' && failSave) {
          return Promise.reject(new Error('Failed to fetch (offline)'))
        }
        return setupDefaultFetchMocks()(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const symptomsInput = await screen.findByLabelText(/Chief Complaints & Symptoms/i)
      failSave = true
      fireEvent.change(symptomsInput, { target: { value: 'Unsaved offline symptom' } })
      fireEvent.blur(symptomsInput)

      await waitFor(() => {
        const alertPill = screen.getByRole('alert')
        expect(alertPill).toHaveTextContent(/Network error — unsaved changes present/i)
      })

      // Data is retained in memory input
      expect((symptomsInput as HTMLTextAreaElement).value).toContain('Unsaved offline symptom')

      // Data NEVER leaked to web storage (T-19-10)
      expect(localStorage.getItem('draft')).toBeNull()
      expect(sessionStorage.getItem('draft')).toBeNull()
    })

    it('calculates real-time client BMI matching server formula and renders category badges', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const heightInput = await screen.findByLabelText(/Height \(cm\)/i)
      const weightInput = screen.getByLabelText(/Weight \(kg\)/i)

      // Enter Height = 175cm, Weight = 70kg -> BMI = 70 / (1.75^2) = 22.857 -> 22.9 (Normal)
      fireEvent.change(heightInput, { target: { value: '175' } })
      fireEvent.change(weightInput, { target: { value: '70' } })

      const bmiBadge = await screen.findByTestId('live-bmi-indicator')
      expect(bmiBadge).toBeInTheDocument()
      expect(bmiBadge).toHaveTextContent(/BMI: 22.9 kg\/m²/i)
      expect(bmiBadge).toHaveTextContent(/NORMAL/i)

      // Change Weight = 95kg -> BMI = 95 / (1.75^2) = 31.02 -> 31.0 (Obese)
      fireEvent.change(weightInput, { target: { value: '95' } })

      await waitFor(() => {
        expect(screen.getByTestId('live-bmi-indicator')).toHaveTextContent(/BMI: 31 kg\/m²|BMI: 31.0 kg\/m²/i)
        expect(screen.getByTestId('live-bmi-indicator')).toHaveTextContent(/OBESE/i)
      })
    })
  })

  // =========================================================================
  // TASK 3: specialty form and prescription lifecycle
  // =========================================================================
  describe('specialty form and prescription lifecycle', () => {
    it('dynamically renders Physiotherapy specialty form with VAS slider and ROM inputs', async () => {
      const mockFetch = setupDefaultFetchMocks({ deptTemplate: mockPhysioTemplate })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByText(/Physiotherapy Specialty Assessment/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Pain Intensity Scale \(VAS 0–10\)/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/Pain Site \/ Joint/i)).toBeInTheDocument()
      expect(screen.getByText(/Manual Muscle Testing \(MMT\) Grade/i)).toBeInTheDocument()
      expect(screen.getByText(/Range of Motion \(ROM\)/i)).toBeInTheDocument()
    })

    it('dynamically renders Ophthalmology specialty form with side-by-side OD/OS visual acuity and IOP', async () => {
      const mockOphthalEncounter = { ...mockEncounterPhysio, department_id: 2 }
      const mockFetch = setupDefaultFetchMocks({
        deptTemplate: mockOphthalTemplate,
        encounter: mockOphthalEncounter,
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByText(/Ophthalmology Specialty Assessment/i)).toBeInTheDocument()
      expect(screen.getAllByText(/Right Eye \(OD\)/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByText(/Left Eye \(OS\)/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getAllByLabelText(/Distance Uncorrected/i).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByLabelText(/IOP OD \(mmHg\)/i)).toBeInTheDocument()
      expect(screen.getByLabelText(/IOP OS \(mmHg\)/i)).toBeInTheDocument()
    })

    it('offers eye quick phrases, not physiotherapy ones, in an ophthalmology consultation', async () => {
      const mockFetch = setupDefaultFetchMocks({
        deptTemplate: mockOphthalTemplate,
        encounter: { ...mockEncounterPhysio, department_id: 2 },
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByText(/Ophthalmology Specialty Assessment/i)).toBeInTheDocument()
      expect(screen.getByText(/Blurry vision for distance & near/i)).toBeInTheDocument()
      expect(screen.queryByText(/Low back pain radiating to leg/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Physiotherapy Specialty Assessment/i)).not.toBeInTheDocument()
    })

    it('never assumes physiotherapy when the consultation has no department', async () => {
      const base = setupDefaultFetchMocks({ encounter: { ...mockEncounterPhysio, department_id: null, appointment_id: null } })
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        // The doctor has no department assigned yet.
        if (/\/api\/doctors\/\d+\/departments/.test(String(url))) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('[]'),
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByTestId('specialty-unknown')).toBeInTheDocument()
      expect(screen.queryByText(/Physiotherapy Specialty Assessment/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Low back pain radiating to leg/i)).not.toBeInTheDocument()
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes('/api/templates/by-department'))).toBe(false)
    })

    it('authorises prescription, locks inputs, and enables print button', async () => {
      let createdRx: PrescriptionOut | null = null
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const urlStr = String(url)
        if (urlStr.includes('/api/prescriptions') && init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          createdRx = {
            id: 99,
            patient_id: 101,
            patient_urn: 'KH-2026-0001',
            patient_name: 'Aarav Kumar',
            doctor_id: 1,
            doctor_name: 'Dr. Madan Mohan Dwivedi',
            encounter_id: 10,
            status: 'AUTHORISED',
            is_printable: true,
            diagnosis: 'Lumbar Radiculopathy',
            dietary_advice: null,
            general_advice: null,
            follow_up_date: null,
            version_id: 1,
            created_at: '2026-11-06T10:00:00Z',
            updated_at: '2026-11-06T10:00:00Z',
            items: (body.items || []).map((it: any, idx: number) => ({ ...it, id: idx + 1, prescription_id: 99 })),
          }
          return Promise.resolve({
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify(createdRx)),
          })
        }
        return setupDefaultFetchMocks()(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // Add medication item
      const addBtn = await screen.findByRole('button', { name: /Add Medication Item/i })
      await userEvent.click(addBtn)

      // Enter medicine name
      const medNameInput = screen.getByPlaceholderText(/e\.g\. Paracetamol/i)
      await userEvent.type(medNameInput, 'Tab Naproxen 500mg')

      // Authorise prescription
      const authBtn = screen.getAllByRole('button', { name: /Authorise Prescription/i })[0]
      await userEvent.click(authBtn)

      // Status updates to AUTHORISED (Locked)
      await waitFor(() => {
        expect(screen.getByText(/✓ AUTHORISED \(Locked\)/i)).toBeInTheDocument()
      })

      // Print Prescription Slip is enabled
      expect(screen.getByRole('link', { name: /Print Prescription Slip/i })).toBeInTheDocument()
    })

    it('requires cancellation reason min 3 chars to cancel and reissue prescription', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // First add item and authorise
      const addBtn = await screen.findByRole('button', { name: /Add Medication Item/i })
      await userEvent.click(addBtn)
      const medNameInput = screen.getByPlaceholderText(/e\.g\. Paracetamol/i)
      await userEvent.type(medNameInput, 'Tab Tramadol')

      const authBtn = screen.getAllByRole('button', { name: /Authorise Prescription/i })[0]
      await userEvent.click(authBtn)

      // Wait for authorised status and "Cancel Prescription & Re-issue" button
      const cancelTrigger = await screen.findByRole('button', { name: /Cancel Prescription & Re-issue/i })
      await userEvent.click(cancelTrigger)

      // Cancellation modal opens
      expect(await screen.findByText(/Are you sure you want to cancel Prescription/i)).toBeInTheDocument()

      // Submit without reason -> validation error
      const confirmCancelBtn = screen.getByRole('button', { name: /Confirm Prescription Cancellation/i })
      await userEvent.click(confirmCancelBtn)
      expect(screen.getByRole('alert')).toHaveTextContent(/at least 3 characters/i)

      // Enter valid explanation
      const reasonInput = screen.getByPlaceholderText(/e\.g\. Medication dosage change required/i)
      await userEvent.type(reasonInput, 'Patient developed gastric intolerance')
      await userEvent.click(confirmCancelBtn)

      // Notification displayed & fresh editor ready
      await waitFor(() => {
        expect(screen.getByText(/Prescription cancelled\. You can now author a re-issued prescription/i)).toBeInTheDocument()
      })
    })

    it('renders follow-up section with recommended review date and doctor-only clinical rationale', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const reviewDateInput = await screen.findByLabelText(/Recommended Review Date/i)
      expect(reviewDateInput).toBeInTheDocument()

      const clinicalReasonInput = screen.getByLabelText(/Clinical Justification Notes \(Doctor Only\)/i)
      expect(clinicalReasonInput).toBeInTheDocument()

      expect(screen.getByText(/omitted from reception booking queues/i)).toBeInTheDocument()
    })
  })
})
