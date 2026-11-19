import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, Link, MemoryRouter, Route, RouterProvider, Routes } from 'react-router'
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

  function renderWorkspace(routeOrId: number | string = 10) {
    const path = typeof routeOrId === 'number' ? `/doctor/encounters/${routeOrId}` : routeOrId
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/doctor/encounters/new" element={<ClinicalEncounterWorkspace />} />
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
    encounterPrescription?: PrescriptionOut | null
  } = {}) {
    const enc = opts.encounter || mockEncounterPhysio
    const tmpl = opts.deptTemplate || mockPhysioTemplate
    const hasPrior = opts.hasPrior ?? true
    const encounterPrescription = opts.encounterPrescription ?? null

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
      if (urlStr.includes('/api/quick-phrases')) {
        const parsed = new URL(urlStr, 'http://localhost')
        const deptParam = parsed.searchParams.get('department_id')
        const sectionParam = parsed.searchParams.get('section') || 'COMPLAINTS'
        const mkDefault = (id: number, department_code: string | null, phrase_text: string) => ({
          id,
          scope: 'HOSPITAL_DEFAULT',
          doctor_id: null,
          department_id: null,
          department_code,
          section: sectionParam,
          phrase_text,
          sort_order: id,
          is_active: true,
          created_at: '2026-11-06T00:00:00Z',
          updated_at: '2026-11-06T00:00:00Z',
        })
        let defaults: ReturnType<typeof mkDefault>[] = []
        if (sectionParam === 'COMPLAINTS') {
          if (deptParam === '1') {
            defaults = [
              mkDefault(1, 'PHYSIOTHERAPY', 'Low back pain radiating to leg'),
              mkDefault(2, 'PHYSIOTHERAPY', 'Cervical stiffness & neck pain'),
            ]
          } else if (deptParam === '2') {
            defaults = [
              mkDefault(10, 'OPHTHALMOLOGY', 'Blurry vision for distance & near'),
              mkDefault(11, 'OPHTHALMOLOGY', 'Redness, burning sensation & itching'),
            ]
          } else {
            defaults = [mkDefault(20, null, 'Fever with generalized body ache')]
          }
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ defaults, personal: [] })),
        })
      }
      if (urlStr.includes('/api/encounters') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(enc)),
        })
      }
      if (urlStr.includes('/bill-items')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                consultation_line: {
                  id: 1,
                  visit_id: 10,
                  appointment_id: 5,
                  category: 'CONSULTATION',
                  source: 'SYSTEM',
                  description: 'Consultation Fee - Dr. Dwivedi',
                  unit: null,
                  quantity: '1.00',
                  rate_paise: 50000,
                  amount_paise: 50000,
                  original_amount_paise: 50000,
                  status: 'ACTIVE',
                  counts_toward_total: true,
                  created_by_user_id: 2,
                  created_by_username: 'reception',
                  created_at: '2026-11-16T09:00:00Z',
                  history: [],
                },
                doctor_lines: [],
              })
            ),
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
        if (init?.method === 'PUT') {
          const body = JSON.parse(String(init.body))
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () =>
              Promise.resolve(
                JSON.stringify({
                  id: 1,
                  encounter_id: enc.id,
                  template_version_id: body.template_version_id,
                  response_data: body.response_data,
                  created_at: '2026-11-06T10:00:00Z',
                  updated_at: '2026-11-06T10:00:00Z',
                })
              ),
          })
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'template_response_not_found', message: 'None' })),
        })
      }
      if (urlStr.includes(`/api/encounters/${enc.id}/prescription`)) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(encounterPrescription)),
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

      // Primary Action Buttons in header (H11: single Authorise Prescription button lives in #section-prescriptions)
      const header = screen.getByTestId('sticky-clinical-header')
      expect(within(header).queryByRole('button', { name: /Authorise Prescription/i })).not.toBeInTheDocument()
      expect(within(header).getByRole('button', { name: /Print Consultation Summary/i })).toBeInTheDocument()
      expect(within(header).getByRole('button', { name: /Finalise Consultation/i })).toBeInTheDocument()
      const rxSection = screen.getByTestId('section-prescriptions')
      expect(within(rxSection).getByRole('button', { name: /Authorise Prescription/i })).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /Authorise Prescription/i })).toHaveLength(1)
    })

    it('renders left jump navigation rail with continuous section anchors including Investigations for saved encounters', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })
      const jumpRail = screen.getByTestId('jump-navigation-rail')
      expect(jumpRail).toBeInTheDocument()

      // All 7 section tabs exist for a saved draft encounter, in page order, each pointing at a section on the page
      const tabs = within(jumpRail).getAllByRole('button')
      expect(tabs.map((tab) => tab.textContent)).toEqual([
        '1Complaints',
        '2Vitals',
        '3Assessment',
        '4Diagnosis',
        '5Investigations',
        '6Prescription',
        '7Follow-up',
      ])
      const sectionIds = [
        'section-complaints',
        'section-vitals',
        'section-specialty',
        'section-diagnosis',
        'section-investigations',
        'section-prescriptions',
        'section-followup',
      ]
      const sections = sectionIds.map((id) => screen.getByTestId(id))
      // Sections appear in the same order as the tabs.
      for (let i = 1; i < sections.length; i += 1) {
        expect(
          sections[i - 1].compareDocumentPosition(sections[i]) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }
    })

    it('renders persistent side panel with previous encounter card and selective copy buttons', async () => {
      const mockFetch = setupDefaultFetchMocks({ hasPrior: true })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      // Prior encounter card
      const priorCard = await screen.findByTestId('prior-encounter-card')
      expect(priorCard).toBeInTheDocument()
      expect(within(priorCard).getByRole('heading', { name: 'Previous Consultation' })).toBeInTheDocument()

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

    it('renders doctor charges panel in the aside for existing encounter /doctor/encounters/:id', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const chargesPanel = await screen.findByTestId('doctor-charges-panel')
      expect(chargesPanel).toBeInTheDocument()
      expect(within(chargesPanel).getByText(/₹500\.00, billed at check-in/i)).toBeInTheDocument()
    })

    it('renders doctor charges panel in the aside for new consultation /doctor/encounters/new?appointment_id=5&patient_id=101', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace('/doctor/encounters/new?appointment_id=5&patient_id=101')

      const chargesPanel = await screen.findByTestId('doctor-charges-panel')
      expect(chargesPanel).toBeInTheDocument()
      expect(within(chargesPanel).getByText(/₹500\.00, billed at check-in/i)).toBeInTheDocument()
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

    it('shows the queue token from the booked appointment, not the appointment id', async () => {
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).includes('/api/appointments/5')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ id: 5, token_number: 7, department_id: 1 })),
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByTestId('queue-token')).toHaveTextContent('Token #007')
      expect(screen.queryByText(/Token #005/)).not.toBeInTheDocument()
    })

    it('shows no token and no stand-in values when nothing is known', async () => {
      const mockFetch = setupDefaultFetchMocks({
        encounter: { ...mockEncounterPhysio, appointment_id: null },
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByTestId('sticky-clinical-header')).toBeInTheDocument()
      expect(screen.queryByTestId('queue-token')).not.toBeInTheDocument()
      expect(screen.queryByText(/Token #004/)).not.toBeInTheDocument()
      expect(screen.queryByText(/KH-2026-XXXX/)).not.toBeInTheDocument()
      expect(screen.queryByText('Consultation Patient')).not.toBeInTheDocument()
    })

    it('starts a new consultation unlocked after viewing a finalised one in the same session', async () => {
      const mockFetch = setupDefaultFetchMocks({
        encounter: { ...mockEncounterPhysio, is_finalised: true, finalised_at: '2026-11-06T10:00:00Z' },
      })
      vi.stubGlobal('fetch', mockFetch)
      const user = userEvent.setup()

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/doctor/encounters/10']}>
            <Link to="/doctor/encounters/new">Start new</Link>
            <Routes>
              <Route path="/doctor/encounters/new" element={<ClinicalEncounterWorkspace />} />
              <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      await user.click(screen.getByRole('link', { name: 'Start new' }))

      expect((await screen.findAllByText('No patient selected')).length).toBeGreaterThan(0)
      expect(screen.queryByText(/Finalised & Locked/)).not.toBeInTheDocument()
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

      // Authorise prescription via the single button inside #section-prescriptions
      const authBtn = within(screen.getByTestId('section-prescriptions')).getByRole('button', {
        name: /Authorise Prescription/i,
      })
      await userEvent.click(authBtn)

      // Status updates to AUTHORISED (Locked)
      await waitFor(() => {
        expect(screen.getByText(/✓ AUTHORISED \(Locked\)/i)).toBeInTheDocument()
      })

      // Print Prescription Slip opens the A4 slip in place (there is no separate print page)
      expect(screen.queryByRole('link', { name: /Print Prescription Slip/i })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Print Prescription Slip/i }))
      expect(await screen.findByRole('dialog', { name: 'Prescription slip' })).toBeInTheDocument()
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

      const authBtn = within(screen.getByTestId('section-prescriptions')).getByRole('button', {
        name: /Authorise Prescription/i,
      })
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

  // =========================================================================
  // Saving a consultation: nothing the doctor enters is lost
  // =========================================================================
  describe('saving a consultation', () => {
    const json = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    type Call = { url: string; method: string; body: any }
    function calls(mockFetch: ReturnType<typeof vi.fn>): Call[] {
      return mockFetch.mock.calls.map(([url, init]) => {
        const req = init as RequestInit | undefined
        return {
          url: String(url),
          method: (req?.method ?? 'GET').toUpperCase(),
          body: req?.body ? JSON.parse(String(req.body)) : undefined,
        }
      })
    }

    function renderAt(path: string) {
      return render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/doctor/encounters/new" element={<ClinicalEncounterWorkspace />} />
              <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
              <Route path="/doctor" element={<div>Doctor Dashboard</div>} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )
    }

    it('opens the appointment encounter when a consultation starts from the queue, and saves vitals to it', async () => {
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters' && init?.method === 'POST') {
          // DWS-01: the server returns the appointment's encounter (here an existing draft)
          return json(200, mockEncounterPhysio)
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderAt('/doctor/encounters/new?patient_id=101&appointment_id=5')

      // The draft already on the server is shown, not a blank unsaved form
      expect(await screen.findByText(/Consultation draft/i)).toBeInTheDocument()
      expect(document.getElementById('diagnosis-input')).toHaveValue('Lumbar Radiculopathy')
      const opens = calls(mockFetch).filter((c) => c.url === '/api/encounters' && c.method === 'POST')
      expect(opens).toHaveLength(1)
      expect(opens[0].body).toMatchObject({ patient_id: 101, appointment_id: 5 })

      const weight = screen.getByLabelText(/Weight \(kg\)/i)
      fireEvent.change(weight, { target: { value: '72' } })
      fireEvent.blur(weight)

      await waitFor(() => {
        const put = calls(mockFetch).find((c) => c.method === 'PUT' && c.url.includes('/vitals'))
        expect(put?.url).toBe('/api/encounters/10/vitals')
        expect(put?.body).toMatchObject({ weight_kg: 72 })
      })
      expect(calls(mockFetch).some((c) => c.url.includes('/encounters/0'))).toBe(false)
    })

    it('says why a consultation cannot be opened instead of showing a form that cannot save', async () => {
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters' && init?.method === 'POST') {
          return json(422, {
            code: 'not_checked_in',
            message: 'The patient has not been checked in for this appointment. Ask reception to check them in first.',
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderAt('/doctor/encounters/new?patient_id=101&appointment_id=5')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(/has not been checked in/i)
      expect(within(alert).getByRole('link', { name: /Back to consultation queue/i })).toBeInTheDocument()
      expect(screen.queryByLabelText(/Chief Complaints & Symptoms/i)).not.toBeInTheDocument()
    })

    it('creates a consultation without an appointment on its first save and sends later saves to it', async () => {
      const created = { ...mockEncounterPhysio, id: 77, appointment_id: null, symptoms: '', clinical_notes: '', diagnosis: '' }
      const base = setupDefaultFetchMocks({ encounter: created })
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          return json(201, { ...created, symptoms: body.symptoms, clinical_notes: body.clinical_notes, diagnosis: body.diagnosis })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderAt('/doctor/encounters/new?patient_id=101')

      const symptomsInput = await screen.findByLabelText(/Chief Complaints & Symptoms/i)
      fireEvent.change(symptomsInput, { target: { value: 'Knee pain for 3 days' } })
      const weight = screen.getByLabelText(/Weight \(kg\)/i)
      fireEvent.change(weight, { target: { value: '64' } })
      fireEvent.blur(weight)

      await waitFor(() => {
        const put = calls(mockFetch).find((c) => c.method === 'PUT' && c.url.includes('/vitals'))
        expect(put?.url).toBe('/api/encounters/77/vitals')
        expect(put?.body).toMatchObject({ weight_kg: 64 })
      })
      const creates = calls(mockFetch).filter((c) => c.url === '/api/encounters' && c.method === 'POST')
      expect(creates).toHaveLength(1)
      expect(creates[0].body).toMatchObject({ patient_id: 101, symptoms: 'Knee pain for 3 days' })
      expect(creates[0].body.appointment_id ?? null).toBeNull()

      // The form keeps what was typed; the record loaded from the server does not replace it
      expect(screen.getByLabelText(/Chief Complaints & Symptoms/i)).toHaveValue('Knee pain for 3 days')
      expect(screen.getByLabelText(/Weight \(kg\)/i)).toHaveValue(64)

      // The next edit updates the same record
      fireEvent.change(screen.getByLabelText(/Chief Complaints & Symptoms/i), {
        target: { value: 'Knee pain for 3 days, worse on stairs' },
      })
      fireEvent.blur(screen.getByLabelText(/Chief Complaints & Symptoms/i))
      await waitFor(() => {
        const patch = calls(mockFetch).find((c) => c.method === 'PATCH')
        expect(patch?.url).toBe('/api/encounters/77')
        expect(patch?.body).toMatchObject({ symptoms: 'Knee pain for 3 days, worse on stairs', version_id: 1 })
      })
      expect(calls(mockFetch).filter((c) => c.url === '/api/encounters' && c.method === 'POST')).toHaveLength(1)
      expect(calls(mockFetch).some((c) => c.url.includes('/encounters/0'))).toBe(false)
    })

    it('keeps what the doctor types while a save is in flight, and saves it next with the new version', async () => {
      const base = setupDefaultFetchMocks()
      const patchBodies: any[] = []
      let releaseFirst: () => void = () => {}
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters/10' && init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body))
          patchBodies.push(body)
          const reply = () => json(200, { ...mockEncounterPhysio, ...body, version_id: body.version_id + 1 })
          if (patchBodies.length === 1) {
            return new Promise((resolve) => {
              releaseFirst = () => resolve(reply())
            })
          }
          return reply()
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const input = await screen.findByLabelText(/Chief Complaints & Symptoms/i)
      fireEvent.change(input, { target: { value: 'Neck pain' } })
      fireEvent.blur(input)
      await waitFor(() => expect(patchBodies).toHaveLength(1))

      // The doctor keeps typing while the first save is still on its way
      fireEvent.change(input, { target: { value: 'Neck pain, worse at night' } })
      fireEvent.blur(input)
      releaseFirst()

      await waitFor(() => expect(patchBodies).toHaveLength(2))
      expect(screen.getByLabelText(/Chief Complaints & Symptoms/i)).toHaveValue('Neck pain, worse at night')
      expect(patchBodies[0]).toMatchObject({ symptoms: 'Neck pain', version_id: 1 })
      // The queued save carries the version the first save returned: no false conflict
      expect(patchBodies[1]).toMatchObject({ symptoms: 'Neck pain, worse at night', version_id: 2 })
      await waitFor(() => {
        expect(screen.getByTestId('auto-save-pill')).toHaveTextContent(/Saved to server at/i)
      })
      expect(screen.queryByText(/modified in another session/i)).not.toBeInTheDocument()
    })

    it('saves pending vitals before finalising and sends the follow-up once', async () => {
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/follow-up' && init?.method === 'POST') {
          const body = JSON.parse(String(init.body))
          return json(201, {
            id: 3,
            encounter_id: 10,
            patient_id: 101,
            recommended_date: body.recommended_date,
            recommended_doctor_id: body.recommended_doctor_id ?? 1,
            clinical_reason: body.clinical_reason ?? null,
            status: 'PENDING',
          })
        }
        if (u === '/api/encounters/10/finalise') {
          return json(200, { ...mockEncounterPhysio, is_finalised: true, finalised_at: '2026-11-15T10:00:00Z', version_id: 3 })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // Typed, but the 3-second auto-save has not run yet
      const weight = await screen.findByLabelText(/Weight \(kg\)/i)
      fireEvent.change(weight, { target: { value: '70' } })
      fireEvent.change(screen.getByLabelText(/Recommended Review Date/i), { target: { value: '2026-12-01' } })
      expect(screen.getByTestId('follow-up-save-note')).toHaveTextContent(/sent to reception when you finalise/i)

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))
      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()

      await waitFor(() => {
        expect(
          calls(mockFetch).some((c) => c.method === 'POST' && c.url === '/api/encounters/10/follow-up'),
        ).toBe(true)
      })

      const log = calls(mockFetch)
      const vitalsAt = log.findIndex((c) => c.method === 'PUT' && c.url === '/api/encounters/10/vitals')
      const finaliseAt = log.findIndex((c) => c.url === '/api/encounters/10/finalise')
      const followUpAt = log.findIndex((c) => c.method === 'POST' && c.url === '/api/encounters/10/follow-up')
      expect(vitalsAt).toBeGreaterThan(-1)
      expect(log[vitalsAt].body).toMatchObject({ weight_kg: 70 })
      expect(finaliseAt).toBeGreaterThan(vitalsAt)
      // Finalise carries the version the flush returned
      expect(log[finaliseAt].body).toMatchObject({ version_id: 2 })
      // Hardened T4.2 ordering: follow-up is sent ONLY AFTER finalise succeeds
      expect(followUpAt).toBeGreaterThan(finaliseAt)
      expect(log[followUpAt].body).toMatchObject({ recommended_date: '2026-12-01' })
      expect(log.filter((c) => c.url.endsWith('/follow-up') && c.method === 'POST')).toHaveLength(1)
    })

    it('does not send the follow-up on auto-save, so a second save cannot hit "follow-up already exists"', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const input = await screen.findByLabelText(/Chief Complaints & Symptoms/i)
      fireEvent.change(screen.getByLabelText(/Recommended Review Date/i), { target: { value: '2026-12-01' } })
      fireEvent.change(input, { target: { value: 'Shoulder pain' } })
      fireEvent.blur(input)
      await waitFor(() => {
        expect(screen.getByTestId('auto-save-pill')).toHaveTextContent(/Saved to server at/i)
      })
      fireEvent.change(input, { target: { value: 'Shoulder pain, right' } })
      fireEvent.blur(input)
      await waitFor(() => expect(calls(mockFetch).filter((c) => c.method === 'PATCH')).toHaveLength(2))
      expect(calls(mockFetch).some((c) => c.method === 'POST' && c.url.endsWith('/follow-up'))).toBe(false)
    })

    it('warns on Finalise that medicines not yet authorised will not be saved', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await userEvent.click(await screen.findByRole('button', { name: /Add Medication Item/i }))
      await userEvent.type(screen.getByPlaceholderText(/e\.g\. Paracetamol/i), 'Paracetamol')

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      expect(await screen.findByTestId('unauthorised-medicines-warning')).toHaveTextContent(
        /1 medicine is in\s+Prescription but not authorised/i,
      )
    })
  })

  // =========================================================================
  // PHASE 1: Clinical Safety & Data Integrity (C1, H11, C2)
  // =========================================================================
  describe('Phase 1 clinical safety & prescription persistence (C1, H11, C2)', () => {
    const json = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    it('hydrates saved active prescription on mount/reopen with items, advice, Authorised badge, and Print button (C1)', async () => {
      const savedRx: PrescriptionOut = {
        id: 77,
        patient_id: 101,
        patient_urn: 'KH-2026-0001',
        patient_name: 'Aarav Kumar',
        doctor_id: 1,
        doctor_name: 'Dr. Madan Mohan Dwivedi',
        encounter_id: 10,
        status: 'AUTHORISED',
        is_printable: true,
        diagnosis: 'Lumbar Radiculopathy',
        dietary_advice: 'Warm fluids and light meals',
        general_advice: 'Avoid bending forward for 2 weeks',
        follow_up_date: null,
        version_id: 1,
        created_at: '2026-11-06T10:15:00Z',
        updated_at: '2026-11-06T10:15:00Z',
        items: [
          {
            id: 1,
            prescription_id: 77,
            item_order: 1,
            medicine_name: 'Tab Naproxen',
            dosage: '500 mg',
            frequency: 'BD',
            duration_days: 5,
            strength: '500mg',
            form: 'Tablet',
            route: 'Oral',
            instructions: 'After food',
          },
          {
            id: 2,
            prescription_id: 77,
            item_order: 2,
            medicine_name: 'Cap Omeprazole',
            dosage: '20 mg',
            frequency: 'OD',
            duration_days: 5,
            strength: '20mg',
            form: 'Capsule',
            route: 'Oral',
            instructions: 'Before breakfast',
          },
        ],
      }

      const mockFetch = setupDefaultFetchMocks({ encounterPrescription: savedRx })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const rxSection = await screen.findByTestId('section-prescriptions')
      expect(await within(rxSection).findByText(/✓ AUTHORISED \(Locked\)/i)).toBeInTheDocument()
      expect(within(rxSection).getByRole('button', { name: /Print Prescription Slip/i })).toBeInTheDocument()

      const med1 = within(rxSection).getByLabelText('Medicine name row 1') as HTMLInputElement
      const med2 = within(rxSection).getByLabelText('Medicine name row 2') as HTMLInputElement
      expect(med1.value).toBe('Tab Naproxen')
      expect(med1).toBeDisabled()
      expect(med2.value).toBe('Cap Omeprazole')
      expect(med2).toBeDisabled()

      expect(within(rxSection).getByDisplayValue('Warm fluids and light meals')).toBeInTheDocument()
      expect(within(rxSection).getByDisplayValue('Avoid bending forward for 2 weeks')).toBeInTheDocument()
    })

    it('enforces single Authorise Prescription button, blocks empty/short diagnosis inline, and guards rapid double-click (H11)', async () => {
      const user = userEvent.setup()
      const base = setupDefaultFetchMocks({
        encounter: { ...mockEncounterPhysio, diagnosis: '' },
      })
      let rxPostCount = 0
      let resolveRxPost: () => void = () => {}

      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/api/prescriptions') && init?.method === 'POST') {
          rxPostCount += 1
          const body = init.body ? JSON.parse(String(init.body)) : {}
          return new Promise((resolve) => {
            resolveRxPost = () =>
              resolve(
                json(201, {
                  id: 105,
                  patient_id: 101,
                  patient_urn: 'KH-2026-0001',
                  patient_name: 'Aarav Kumar',
                  doctor_id: 1,
                  doctor_name: 'Dr. Madan Mohan Dwivedi',
                  encounter_id: 10,
                  status: 'AUTHORISED',
                  is_printable: true,
                  diagnosis: body.diagnosis,
                  dietary_advice: null,
                  general_advice: null,
                  follow_up_date: null,
                  version_id: 1,
                  created_at: '2026-11-06T10:20:00Z',
                  updated_at: '2026-11-06T10:20:00Z',
                  items: (body.items || []).map((it: any, idx: number) => ({
                    ...it,
                    id: idx + 1,
                    prescription_id: 105,
                  })),
                })
              )
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })
      // Strictly one Authorise Prescription button on the page and none in sticky header
      const header = screen.getByTestId('sticky-clinical-header')
      expect(within(header).queryByRole('button', { name: /Authorise Prescription/i })).not.toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: /Authorise Prescription/i })).toHaveLength(1)

      // Add a medication item while diagnosis is empty -> inline validation error blocks submission
      await user.click(screen.getByRole('button', { name: /Add Medication Item/i }))
      await user.type(screen.getByPlaceholderText(/e\.g\. Paracetamol/i), 'Tab Ibuprofen')

      const rxSection = screen.getByTestId('section-prescriptions')
      const authBtn = within(rxSection).getByRole('button', { name: /Authorise Prescription/i })
      await user.click(authBtn)

      expect(within(rxSection).getByRole('alert')).toHaveTextContent(/Diagnosis is required \(minimum 2 characters\)/i)
      expect(rxPostCount).toBe(0)

      // Short 1-char diagnosis also blocked
      const diagnosisInput = document.getElementById('diagnosis-input') as HTMLInputElement
      fireEvent.change(diagnosisInput, { target: { value: 'A' } })
      await user.click(authBtn)
      expect(within(rxSection).getByRole('alert')).toHaveTextContent(/Diagnosis is required \(minimum 2 characters\)/i)
      expect(rxPostCount).toBe(0)

      // Valid diagnosis + rapid double-click triggers POST /api/prescriptions strictly once
      fireEvent.change(diagnosisInput, { target: { value: 'Lumbar Radiculopathy' } })
      fireEvent.click(authBtn)
      fireEvent.click(authBtn)

      await waitFor(() => expect(rxPostCount).toBe(1))
      resolveRxPost()

      expect(await within(rxSection).findByText(/✓ AUTHORISED \(Locked\)/i)).toBeInTheDocument()
      expect(rxPostCount).toBe(1)
    })

    it('marks UnsavedChangesGuard dirty for unauthorised medicines without falsely clearing via encounter autosave (C1)', async () => {
      const user = userEvent.setup()
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      const router = createMemoryRouter(
        [
          { path: '/doctor/encounters/:id', element: <ClinicalEncounterWorkspace /> },
          { path: '/doctor', element: <div>Doctor Dashboard</div> },
        ],
        { initialEntries: ['/doctor/encounters/10'] },
      )

      render(
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>,
      )

      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      // Type an unauthorised medicine
      await user.click(screen.getByRole('button', { name: /Add Medication Item/i }))
      await user.type(screen.getByPlaceholderText(/e\.g\. Paracetamol/i), 'Tab Diclofenac')

      // Prescription edit alone must NOT trigger encounter PATCH autosave
      expect(
        mockFetch.mock.calls.some(([u, init]) => String(u) === '/api/encounters/10' && (init as RequestInit)?.method === 'PATCH'),
      ).toBe(false)

      // Trigger and complete an encounter text autosave (which clears unsavedEdits)
      const symptomsInput = screen.getByLabelText(/Chief Complaints & Symptoms/i)
      fireEvent.change(symptomsInput, { target: { value: 'Updated back pain note' } })
      fireEvent.blur(symptomsInput)

      await waitFor(() => {
        expect(screen.getByTestId('auto-save-pill')).toHaveTextContent(/Saved to server at/i)
      })

      // Even after encounter autosave succeeds, UnsavedChangesGuard remains dirty because medicine is unauthorised
      const beforeUnloadEvent = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(beforeUnloadEvent)
      expect(beforeUnloadEvent.defaultPrevented).toBe(true)

      // Attempting in-app navigation triggers the router UnsavedChangesGuard modal
      await user.click(screen.getByRole('link', { name: /Back to consultation queue/i }))
      expect(await screen.findByText(/Discard unsaved changes\?/i)).toBeInTheDocument()
    })

    it('emits starting_vas: 0 when typing Physio pain_site without moving VAS slider and finalises cleanly (C2)', async () => {
      const base = setupDefaultFetchMocks({ deptTemplate: mockPhysioTemplate })
      let capturedTemplatePayload: any = null

      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/template-response' && init?.method === 'PUT') {
          capturedTemplatePayload = JSON.parse(String(init.body))
          return json(200, {
            id: 1,
            encounter_id: 10,
            template_version_id: capturedTemplatePayload.template_version_id,
            response_data: capturedTemplatePayload.response_data,
          })
        }
        if (u === '/api/encounters/10/finalise') {
          return json(200, {
            ...mockEncounterPhysio,
            is_finalised: true,
            finalised_at: '2026-11-06T10:30:00Z',
            version_id: 3,
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const painSiteInput = await screen.findByLabelText(/Pain Site \/ Joint/i)
      // Do NOT move VAS slider; only type pain_site
      fireEvent.change(painSiteInput, { target: { value: 'Lumbar spine' } })

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))

      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      expect(capturedTemplatePayload).not.toBeNull()
      expect(capturedTemplatePayload.template_version_id).toBe(1)
      expect(capturedTemplatePayload.response_data).toMatchObject({
        pain_site: 'Lumbar spine',
        starting_vas: 0,
      })
    })

    it('loads Ophthalmology specialty form, saves OD/OS visual acuity, and finalises cleanly', async () => {
      const ophthEnc = { ...mockEncounterPhysio, department_id: 2 }
      const base = setupDefaultFetchMocks({
        deptTemplate: mockOphthalTemplate,
        encounter: ophthEnc,
      })
      let capturedTemplatePayload: any = null

      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/template-response' && init?.method === 'PUT') {
          capturedTemplatePayload = JSON.parse(String(init.body))
          return json(200, {
            id: 2,
            encounter_id: 10,
            template_version_id: capturedTemplatePayload.template_version_id,
            response_data: capturedTemplatePayload.response_data,
          })
        }
        if (u === '/api/encounters/10/finalise') {
          return json(200, {
            ...ophthEnc,
            is_finalised: true,
            finalised_at: '2026-11-06T10:35:00Z',
            version_id: 3,
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByText(/Ophthalmology Specialty Assessment/i)).toBeInTheDocument()
      const vaInputs = screen.getAllByLabelText(/Distance Uncorrected/i)
      fireEvent.change(vaInputs[0], { target: { value: '6/18' } })
      fireEvent.change(vaInputs[1], { target: { value: '6/12' } })

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))

      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      expect(capturedTemplatePayload).not.toBeNull()
      expect(capturedTemplatePayload.template_version_id).toBe(2)
      expect(capturedTemplatePayload.response_data).toMatchObject({
        va_distance_uncorrected_od: '6/18',
        va_distance_uncorrected_os: '6/12',
      })
    })
  })

  // =========================================================================
  // PHASE 2: Consultation Workflow Refinement (T2.1 / T2.2)
  // =========================================================================
  describe('Phase 2 consultation workflow refinement', () => {
    const json = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    it('dynamically adds Investigations (when saved) and Addenda (when finalised) tabs with completion dots', async () => {
      // 1. Unsaved new consultation (encounterId === 0): 6 tabs only (no Investigations, no Addenda)
      const base = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', base)

      const { unmount } = renderWorkspace('/doctor/encounters/new?patient_id=101')
      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })
      const newTabs = within(screen.getByTestId('jump-navigation-rail')).getAllByRole('button')
      expect(newTabs.map((t) => t.textContent)).toEqual([
        '1Complaints',
        '2Vitals',
        '3Assessment',
        '4Diagnosis',
        '5Prescription',
        '6Follow-up',
      ])
      expect(screen.queryByTestId('section-investigations')).not.toBeInTheDocument()
      expect(screen.queryByTestId('section-addenda')).not.toBeInTheDocument()
      unmount()

      // 2. Finalised encounter: 8 tabs including Investigations & Addenda, in page order, with anchors & filled dots
      const finalisedClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      const finalisedEnc: EncounterRead = {
        ...mockEncounterPhysio,
        is_finalised: true,
        finalised_at: '2026-11-06T10:45:00Z',
        addenda: [],
      }
      vi.stubGlobal('fetch', setupDefaultFetchMocks({ encounter: finalisedEnc }))

      render(
        <QueryClientProvider client={finalisedClient}>
          <MemoryRouter initialEntries={['/doctor/encounters/10']}>
            <Routes>
              <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      await screen.findByText(/Finalised & Locked/)
      const jumpRail = screen.getByTestId('jump-navigation-rail')
      const finalisedTabs = within(jumpRail).getAllByRole('button')
      expect(finalisedTabs.map((t) => t.textContent)).toEqual([
        '1Complaints',
        '2Vitals',
        '3Assessment',
        '4Diagnosis',
        '5Investigations',
        '6Prescription',
        '7Follow-up',
        '8Addenda',
      ])

      const invSection = screen.getByTestId('section-investigations')
      const addendaSection = screen.getByTestId('section-addenda')
      expect(invSection).toHaveAttribute('id', 'section-investigations')
      expect(addendaSection).toHaveAttribute('id', 'section-addenda')
      expect(
        invSection.compareDocumentPosition(addendaSection) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()

      // Filled sections get subtle completion dot; untouched optional sections do not
      expect(within(jumpRail).getByTestId('tab-filled-section-complaints')).toBeInTheDocument()
      expect(within(jumpRail).getByTestId('tab-filled-section-diagnosis')).toBeInTheDocument()
      expect(within(jumpRail).queryByTestId('tab-filled-section-vitals')).not.toBeInTheDocument()
      expect(within(jumpRail).queryByTestId('tab-filled-section-specialty')).not.toBeInTheDocument()
    })

    it('organises right sidebar into 3 compact groups (Clinical Context, Encounter Status, Billing) with read-only Rx status and omits VOIDED bill lines', async () => {
      const user = userEvent.setup()
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).includes('/bill-items')) {
          return json(200, {
            consultation_line: {
              id: 1,
              visit_id: 10,
              appointment_id: 5,
              category: 'CONSULTATION',
              source: 'SYSTEM',
              description: 'Consultation Fee - Dr. Dwivedi',
              unit: null,
              quantity: '1.00',
              rate_paise: 50000,
              amount_paise: 50000,
              original_amount_paise: 50000,
              status: 'ACTIVE',
              counts_toward_total: true,
              created_by_user_id: 2,
              created_by_username: 'reception',
              created_at: '2026-11-16T09:00:00Z',
              history: [],
            },
            doctor_lines: [
              {
                id: 2,
                visit_id: 10,
                appointment_id: 5,
                category: 'PROCEDURE',
                source: 'DOCTOR',
                description: 'Active Ultrasound Therapy',
                unit: 'session',
                quantity: '1.00',
                rate_paise: 30000,
                amount_paise: 30000,
                original_amount_paise: 30000,
                status: 'ACTIVE',
                counts_toward_total: true,
                created_by_user_id: 3,
                created_by_username: 'drdwivedi',
                created_at: '2026-11-16T09:15:00Z',
                history: [],
              },
              {
                id: 3,
                visit_id: 10,
                appointment_id: 5,
                category: 'PROCEDURE',
                source: 'DOCTOR',
                description: 'Voided Erroneous Charge',
                unit: 'session',
                quantity: '1.00',
                rate_paise: 20000,
                amount_paise: 20000,
                original_amount_paise: 20000,
                status: 'VOIDED',
                counts_toward_total: false,
                created_by_user_id: 3,
                created_by_username: 'drdwivedi',
                created_at: '2026-11-16T09:16:00Z',
                history: [],
              },
            ],
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)
      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      const sidebar = screen.getByTestId('persistent-side-panel')
      const contextGroup = within(sidebar).getByTestId('sidebar-group-context')
      const statusGroup = within(sidebar).getByTestId('sidebar-group-status')
      const billingGroup = within(sidebar).getByTestId('sidebar-group-billing')

      expect(within(contextGroup).getByRole('heading', { name: 'Clinical Context' })).toBeInTheDocument()
      expect(within(statusGroup).getByRole('heading', { name: 'Encounter Status' })).toBeInTheDocument()
      expect(within(billingGroup).getByRole('heading', { name: 'Billing' })).toBeInTheDocument()

      // Clinical Context: collapsible Patient details + Full patient history link
      expect(within(contextGroup).queryByText('Station Road, Ara')).not.toBeInTheDocument()
      await user.click(within(contextGroup).getByRole('button', { name: /Patient details/i }))
      expect(within(contextGroup).getByText('Station Road, Ara')).toBeInTheDocument()
      expect(within(contextGroup).getByText('9876500000')).toBeInTheDocument()

      const historyLink = within(contextGroup).getByRole('link', { name: /Full patient history/i })
      expect(historyLink).toHaveAttribute('href', '/reception/patients/101?tab=clinical')

      // Encounter Status: Needed to finalise + read-only Rx & Follow-up badges + zero duplicate Rx buttons
      expect(within(statusGroup).getByRole('heading', { name: 'Needed to finalise' })).toBeInTheDocument()
      expect(within(statusGroup).getByTestId('sidebar-rx-status')).toHaveTextContent('No prescription')
      expect(within(statusGroup).getByTestId('sidebar-followup-status')).toHaveTextContent('None')
      expect(within(sidebar).queryByRole('button', { name: /Authorise Prescription/i })).not.toBeInTheDocument()

      // Adding an unauthorised medicine updates sidebar badge to Draft (unauthorised)
      await user.click(screen.getByRole('button', { name: /Add Medication Item/i }))
      expect(within(statusGroup).getByTestId('sidebar-rx-status')).toHaveTextContent('Draft (unauthorised)')

      // Entering follow-up date updates sidebar badge to Pending on finalise
      fireEvent.change(screen.getByLabelText(/Recommended Review Date/i), { target: { value: '2026-12-10' } })
      expect(within(statusGroup).getByTestId('sidebar-followup-status')).toHaveTextContent('Pending on finalise')

      // Billing: active doctor line shown, VOIDED line omitted
      expect(await within(billingGroup).findByText('Active Ultrasound Therapy')).toBeInTheDocument()
      expect(within(billingGroup).queryByText('Voided Erroneous Charge')).not.toBeInTheDocument()
    })

    it('blocks finalisation inline for missing required fields and partially filled Physio template, while allowing empty optional sections', async () => {
      const base = setupDefaultFetchMocks({
        encounter: { ...mockEncounterPhysio, symptoms: '', diagnosis: '' },
        deptTemplate: mockPhysioTemplate,
      })
      let finaliseCalls = 0
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters/10/finalise') {
          finaliseCalls += 1
          return json(200, {
            ...mockEncounterPhysio,
            is_finalised: true,
            finalised_at: '2026-11-06T11:00:00Z',
            version_id: 3,
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)
      await screen.findByText(/Physiotherapy Specialty Assessment/i)

      const header = screen.getByTestId('sticky-clinical-header')
      const finaliseBtn = within(header).getByRole('button', { name: /Finalise Consultation/i })

      // 1. Missing Chief complaint & Diagnosis -> blocks modal, highlights inline
      fireEvent.click(finaliseBtn)
      expect(screen.queryByText('Finalise Consultation?')).not.toBeInTheDocument()
      expect(screen.getByTestId('finalise-validation-alert')).toBeInTheDocument()
      expect(screen.getByText(/Chief complaint is required \(minimum 2 characters\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Diagnosis is required \(minimum 2 characters\)/i)).toBeInTheDocument()
      expect(finaliseCalls).toBe(0)

      // 2. Fill Chief complaint & Diagnosis; leave all optional sections (Vitals, Specialty, Rx, Follow-up) empty
      fireEvent.change(screen.getByLabelText(/Chief Complaints & Symptoms/i), {
        target: { value: 'Lower back pain' },
      })
      fireEvent.change(document.getElementById('diagnosis-input') as HTMLInputElement, {
        target: { value: 'Lumbar strain' },
      })

      // 3. Start filling Physio specialty form (move VAS slider only, leaving required pain_site empty)
      fireEvent.change(screen.getByLabelText(/Pain Intensity Scale \(VAS 0–10\)/i), { target: { value: '6' } })
      fireEvent.click(finaliseBtn)
      expect(screen.queryByText('Finalise Consultation?')).not.toBeInTheDocument()
      expect(screen.getByTestId('specialty-validation-alert')).toHaveTextContent(/Pain Site \/ Joint/i)
      expect(finaliseCalls).toBe(0)

      // 4. Fill required pain_site -> lock modal opens and finalisation succeeds
      fireEvent.change(screen.getByLabelText(/Pain Site \/ Joint/i), { target: { value: 'Lumbar spine' } })
      fireEvent.click(finaliseBtn)
      expect(await screen.findByText('Finalise Consultation?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Yes, Lock & Finalise/i }))
      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      expect(finaliseCalls).toBe(1)
    })

    it('blocks partially filled Ophthalmology template but permits completely empty optional Ophthalmology assessment to finalise', async () => {
      const ophthEnc = { ...mockEncounterPhysio, department_id: 2 }
      const base = setupDefaultFetchMocks({
        encounter: ophthEnc,
        deptTemplate: mockOphthalTemplate,
      })
      let finaliseCalls = 0
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters/10/finalise') {
          finaliseCalls += 1
          return json(200, {
            ...ophthEnc,
            is_finalised: true,
            finalised_at: '2026-11-06T11:05:00Z',
            version_id: 3,
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)
      await screen.findByText(/Ophthalmology Specialty Assessment/i)

      const header = screen.getByTestId('sticky-clinical-header')
      const finaliseBtn = within(header).getByRole('button', { name: /Finalise Consultation/i })

      // 1. Enter OD visual acuity only, leaving OS empty -> blocks lock modal inline
      const vaInputs = screen.getAllByLabelText(/Distance Uncorrected/i)
      fireEvent.change(vaInputs[0], { target: { value: '6/18' } })
      fireEvent.click(finaliseBtn)
      expect(screen.queryByText('Finalise Consultation?')).not.toBeInTheDocument()
      expect(screen.getByTestId('specialty-validation-alert')).toHaveTextContent(/Visual Acuity Distance \(OS\)/i)
      expect(finaliseCalls).toBe(0)

      // 2. Clear OD so specialty form is completely empty -> empty optional specialty NEVER blocks finalisation
      fireEvent.change(vaInputs[0], { target: { value: '' } })
      fireEvent.click(finaliseBtn)
      expect(await screen.findByText('Finalise Consultation?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Yes, Lock & Finalise/i }))
      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      expect(finaliseCalls).toBe(1)
    })

    it('displays ConflictBanner when Finalise returns 409 version_conflict', async () => {
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url) === '/api/encounters/10/finalise' && init?.method === 'POST') {
          return json(409, {
            code: 'version_conflict',
            message: 'Record was updated by another session.',
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)
      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))

      expect(await screen.findByText(/Encounter was modified in another session\./i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Reload Latest Encounter/i })).toBeInTheDocument()
    })

    it('distinguishes 3 specialty fallback states: loading, configured General department, and unknown (departmentId === null)', async () => {
      // State A: Loading while department template request is pending
      let resolveTemplate!: (value: any) => void
      const generalEnc: EncounterRead = { ...mockEncounterPhysio, department_id: 3 }
      const baseGeneral = setupDefaultFetchMocks({ encounter: generalEnc })
      const loadingFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/api/doctors/1/departments')) {
          return json(200, [{ id: 3, code: 'GENERAL', name_en: 'General Medicine', is_active: true }])
        }
        if (u.includes('/api/templates/by-department/3')) {
          return new Promise((resolve) => {
            resolveTemplate = resolve
          })
        }
        return baseGeneral(url, init)
      })
      vi.stubGlobal('fetch', loadingFetch)

      const { unmount } = renderWorkspace(10)
      expect(await screen.findByTestId('specialty-loading')).toHaveTextContent(
        /Loading department assessment template/i,
      )
      expect(screen.queryByTestId('specialty-unknown')).not.toBeInTheDocument()

      // State B: Template 404 for configured General department -> calm neutral info card (not amber warning)
      resolveTemplate(json(404, { code: 'template_not_found', message: 'No template' }))
      const generalInfo = await screen.findByTestId('specialty-general-info')
      expect(generalInfo).toHaveTextContent(/No department-specific structured form is configured for this department/i)
      expect(screen.getByRole('heading', { name: /Clinical Assessment — General Medicine/i })).toBeInTheDocument()
      expect(screen.queryByTestId('specialty-unknown')).not.toBeInTheDocument()
      unmount()

      // State C: departmentId === null -> amber specialty-unknown guidance
      const nullClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      const nullEnc: EncounterRead = { ...mockEncounterPhysio, department_id: null, appointment_id: null }
      const baseNull = setupDefaultFetchMocks({ encounter: nullEnc })
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: string, init?: RequestInit) => {
          if (/\/api\/doctors\/\d+\/departments/.test(String(url))) {
            return json(200, [])
          }
          return baseNull(url, init)
        }),
      )

      render(
        <QueryClientProvider client={nullClient}>
          <MemoryRouter initialEntries={['/doctor/encounters/10']}>
            <Routes>
              <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(await screen.findByTestId('specialty-unknown')).toBeInTheDocument()
      expect(screen.queryByTestId('specialty-general-info')).not.toBeInTheDocument()
      expect(screen.queryByTestId('specialty-loading')).not.toBeInTheDocument()
    })

    it('appends persistent quick phrases to complaints and examination findings without overwriting existing text', async () => {
      const user = userEvent.setup()
      const base = setupDefaultFetchMocks()
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/api/quick-phrases') && u.includes('section=EXAMINATION')) {
          return json(200, {
            defaults: [],
            personal: [
              {
                id: 501,
                scope: 'PERSONAL',
                doctor_id: 1,
                department_id: 1,
                department_code: 'PHYSIOTHERAPY',
                section: 'EXAMINATION',
                phrase_text: 'Paraspinal spasm bilateral',
                sort_order: 0,
                is_active: true,
                created_at: '2026-11-06T00:00:00Z',
                updated_at: '2026-11-06T00:00:00Z',
              },
            ],
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)
      await screen.findByRole('heading', { level: 1, name: /Aarav Kumar/i })

      // Complaints quick phrase appends to existing symptoms without overwriting
      const complaintsPhraseBtn = await screen.findByRole('button', {
        name: /\+ Cervical stiffness & neck pain/i,
      })
      await user.click(complaintsPhraseBtn)
      const symptomsTextarea = screen.getByLabelText(/Chief Complaints & Symptoms/i) as HTMLTextAreaElement
      expect(symptomsTextarea.value).toBe(
        'Low back pain radiating to left leg for 2 weeks, Cervical stiffness & neck pain',
      )

      // Examination findings quick phrase bar is collapsed by default, expands on toggle, and appends cleanly
      expect(screen.queryByTestId('quick-phrase-bar-examination')).not.toBeInTheDocument()
      await user.click(screen.getByTestId('toggle-examination-phrases'))
      const examBar = await screen.findByTestId('quick-phrase-bar-examination')
      const examPhraseBtn = await within(examBar).findByRole('button', {
        name: /\+ Paraspinal spasm bilateral/i,
      })
      await user.click(examPhraseBtn)

      const clinicalNotesTextarea = screen.getByLabelText(/Examination findings/i) as HTMLTextAreaElement
      expect(clinicalNotesTextarea.value).toBe(
        'SLR positive on left at 45 degrees. Tenderness L4-L5. Paraspinal spasm bilateral',
      )
    })
  })

  // =========================================================================
  // PHASE 4: Encounter Follow-up Cleanup & Hardened Finalise->Follow-up (T4.2)
  // =========================================================================
  describe('Phase 4 follow-up cleanup & hardened finalise ordering (T4.2)', () => {
    const json = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    it('removes the duplicate Book Follow-up Appointment shortcut inside #section-followup even when a date is entered (H5)', async () => {
      const mockFetch = setupDefaultFetchMocks()
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const followUpSection = await screen.findByTestId('section-followup')
      const dateInput = within(followUpSection).getByLabelText(/Recommended Review Date/i)
      fireEvent.change(dateInput, { target: { value: '2026-12-15' } })

      expect(
        within(followUpSection).queryByRole('button', { name: /Book Follow-up Appointment/i }),
      ).not.toBeInTheDocument()
      expect(
        within(followUpSection).getByText(/flow to Reception upon finalisation/i),
      ).toBeInTheDocument()
    })

    it('blocks finalisation when clinical justification reason is entered without a follow-up date', async () => {
      const base = setupDefaultFetchMocks()
      let finaliseCalls = 0
      let followUpPostCalls = 0
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/finalise' && init?.method === 'POST') {
          finaliseCalls += 1
          return json(200, {
            ...mockEncounterPhysio,
            is_finalised: true,
            finalised_at: '2026-11-18T12:00:00Z',
            version_id: 2,
          })
        }
        if (u === '/api/encounters/10/follow-up' && init?.method === 'POST') {
          followUpPostCalls += 1
          const body = JSON.parse(String(init.body))
          return json(201, {
            id: 41,
            encounter_id: 10,
            patient_id: 101,
            recommended_date: body.recommended_date,
            recommended_doctor_id: body.recommended_doctor_id ?? 1,
            clinical_reason: body.clinical_reason ?? null,
            status: 'PENDING',
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const followUpSection = await screen.findByTestId('section-followup')
      const reasonInput = within(followUpSection).getByLabelText(/Clinical Justification Notes \(Doctor Only\)/i)
      fireEvent.change(reasonInput, { target: { value: 'Re-evaluate SLR and lumbar ROM after 7 sessions' } })

      const header = screen.getByTestId('sticky-clinical-header')
      const finaliseBtn = within(header).getByRole('button', { name: /Finalise Consultation/i })
      fireEvent.click(finaliseBtn)

      // Finalise confirmation modal must NOT open; inline validation blocks finalisation
      expect(screen.queryByText('Finalise Consultation?')).not.toBeInTheDocument()
      expect(within(followUpSection).getByTestId('followup-date-error')).toHaveTextContent(
        'Follow-up recommendation requires a scheduled date.',
      )
      expect(finaliseCalls).toBe(0)
      expect(followUpPostCalls).toBe(0)

      // Once a review date is entered, validation clears and finalisation succeeds
      const dateInput = within(followUpSection).getByLabelText(/Recommended Review Date/i)
      fireEvent.change(dateInput, { target: { value: '2026-12-18' } })
      expect(within(followUpSection).queryByTestId('followup-date-error')).not.toBeInTheDocument()

      fireEvent.click(finaliseBtn)
      expect(await screen.findByText('Finalise Consultation?')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: /Yes, Lock & Finalise/i }))
      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()

      await waitFor(() => expect(followUpPostCalls).toBe(1))
      expect(finaliseCalls).toBe(1)
    })

    it('runs /finalise BEFORE /follow-up and never calls /follow-up if /finalise fails with 409', async () => {
      const base = setupDefaultFetchMocks()
      const callOrder: string[] = []
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/finalise' && init?.method === 'POST') {
          callOrder.push('finalise')
          return json(409, {
            code: 'version_conflict',
            message: 'Encounter was updated in another session.',
          })
        }
        if (u === '/api/encounters/10/follow-up' && init?.method === 'POST') {
          callOrder.push('follow-up')
          return json(201, { id: 99, encounter_id: 10, status: 'PENDING' })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const dateInput = await screen.findByLabelText(/Recommended Review Date/i)
      fireEvent.change(dateInput, { target: { value: '2026-12-20' } })

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))

      expect(await screen.findByText(/Encounter was modified in another session\./i)).toBeInTheDocument()
      expect(callOrder).toEqual(['finalise'])
      expect(screen.queryByText(/Finalised & Locked/)).not.toBeInTheDocument()
    })

    it('shows Retry Sending Follow-up Recommendation when /finalise succeeds but /follow-up fails, and recovers on retry', async () => {
      const base = setupDefaultFetchMocks()
      const callOrder: string[] = []
      let followUpAttempt = 0

      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u === '/api/encounters/10/finalise' && init?.method === 'POST') {
          callOrder.push('finalise')
          return json(200, {
            ...mockEncounterPhysio,
            is_finalised: true,
            finalised_at: '2026-11-18T12:15:00Z',
            version_id: 2,
          })
        }
        if (u === '/api/encounters/10/follow-up' && init?.method === 'POST') {
          followUpAttempt += 1
          callOrder.push(`follow-up-${followUpAttempt}`)
          if (followUpAttempt === 1) {
            return json(500, { code: 'server_error', message: 'Temporary server outage' })
          }
          const body = JSON.parse(String(init.body))
          return json(201, {
            id: 52,
            encounter_id: 10,
            patient_id: 101,
            recommended_date: body.recommended_date,
            recommended_doctor_id: body.recommended_doctor_id ?? 1,
            clinical_reason: body.clinical_reason ?? null,
            status: 'PENDING',
          })
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      const followUpSection = await screen.findByTestId('section-followup')
      fireEvent.change(within(followUpSection).getByLabelText(/Recommended Review Date/i), {
        target: { value: '2026-12-22' },
      })
      fireEvent.change(within(followUpSection).getByLabelText(/Clinical Justification Notes \(Doctor Only\)/i), {
        target: { value: 'Check mobility recovery' },
      })

      const header = screen.getByTestId('sticky-clinical-header')
      fireEvent.click(within(header).getByRole('button', { name: /Finalise Consultation/i }))
      fireEvent.click(await screen.findByRole('button', { name: /Yes, Lock & Finalise/i }))

      // Encounter is locked, but Retry banner & button appear for the failed follow-up
      expect(await screen.findByText(/Finalised & Locked/)).toBeInTheDocument()
      const retryBanner = await within(followUpSection).findByTestId('followup-retry-banner')
      expect(retryBanner).toHaveTextContent(/Temporary server outage/i)
      const retryBtn = within(retryBanner).getByRole('button', {
        name: /Retry Sending Follow-up Recommendation/i,
      })
      expect(retryBtn).toBeEnabled()
      expect(screen.getByTestId('sidebar-followup-status')).toHaveTextContent('Send failed — retry')

      // Clicking Retry sends the follow-up recommendation, marks it sent, and clears the banner
      fireEvent.click(retryBtn)

      await waitFor(() => {
        expect(screen.getByTestId('sidebar-followup-status')).toHaveTextContent('Sent to reception')
      })
      expect(within(followUpSection).queryByTestId('followup-retry-banner')).not.toBeInTheDocument()
      expect(within(followUpSection).getByTestId('follow-up-save-note')).toHaveTextContent(
        /sent to reception and cannot be changed here/i,
      )
      expect(callOrder).toEqual(['finalise', 'follow-up-1', 'follow-up-2'])
    })
  })

  // =========================================================================
  // PHASE 5: Physiotherapy Treatment Plan Bridge Link (T5.2)
  // =========================================================================
  describe('Phase 5 physiotherapy treatment plan bridge', () => {
    it('renders physio-treatment-plan-link for Physiotherapy encounter and omits it for Ophthalmology', async () => {
      // 1. Physiotherapy encounter (encounterId = 10, patient_id = 101)
      vi.stubGlobal('fetch', setupDefaultFetchMocks({ deptTemplate: mockPhysioTemplate }))
      const { unmount } = renderWorkspace(10)

      const specialtySection = await screen.findByTestId('section-specialty')
      const link = await within(specialtySection).findByTestId('physio-treatment-plan-link')
      expect(link).toHaveTextContent(/Manage Physiotherapy Treatment Plan/i)
      expect(link).toHaveAttribute('href', '/doctor/treatment-plans?patient_id=101&encounter_id=10')
      unmount()

      // 2. Ophthalmology encounter must NOT render the physiotherapy treatment plan link
      const ophthClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
      vi.stubGlobal(
        'fetch',
        setupDefaultFetchMocks({
          deptTemplate: mockOphthalTemplate,
          encounter: { ...mockEncounterPhysio, department_id: 2 },
        }),
      )
      render(
        <QueryClientProvider client={ophthClient}>
          <MemoryRouter initialEntries={['/doctor/encounters/10']}>
            <Routes>
              <Route path="/doctor/encounters/:id" element={<ClinicalEncounterWorkspace />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      )

      expect(await screen.findByText(/Ophthalmology Specialty Assessment/i)).toBeInTheDocument()
      expect(screen.queryByTestId('physio-treatment-plan-link')).not.toBeInTheDocument()
    })
  })

  // =========================================================================
  // WAVE 2 (A6): Cross-Doctor Read-Only Mode, Summary Advice & Extracted Sub-Panels
  // =========================================================================
  describe('A6 cross-doctor read-only mode, summary advice & extracted sub-panels', () => {
    const mockMeDoctorB: Me = {
      ...mockMeDoctor,
      id: 4,
      username: 'drsharma',
      full_name: 'Dr. Priya Sharma',
      doctor_id: 2,
    }

    const json = (status: number, body: unknown) =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })

    it('locks cross-doctor draft encounter in view-only mode with zero PATCH or bill-items calls', async () => {
      const user = userEvent.setup()
      const base = setupDefaultFetchMocks({
        encounter: { ...mockEncounterPhysio, doctor_id: 1, is_finalised: false },
        encounterPrescription: {
          id: 88,
          patient_id: 101,
          patient_urn: 'KH-2026-0001',
          patient_name: 'Aarav Kumar',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          encounter_id: 10,
          status: 'DRAFT',
          is_printable: false,
          diagnosis: 'Lumbar Radiculopathy',
          dietary_advice: 'Warm fluids',
          general_advice: 'Rest for 3 days',
          follow_up_date: null,
          version_id: 1,
          created_at: '2026-11-06T10:15:00Z',
          updated_at: '2026-11-06T10:15:00Z',
          items: [
            {
              id: 1,
              prescription_id: 88,
              item_order: 1,
              medicine_name: 'Tab Naproxen',
              dosage: '500 mg',
              frequency: 'BD',
              duration_days: 5,
              strength: '500mg',
              form: 'Tablet',
              route: 'Oral',
              instructions: 'After food',
            },
          ],
        },
      })

      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/api/auth/me')) {
          return json(200, mockMeDoctorB)
        }
        if (u.includes('/api/encounters/10/diagnoses')) {
          return json(200, [
            {
              id: 301,
              encounter_id: 10,
              patient_id: 101,
              diagnosis_name: 'Lumbar radiculopathy',
              icd10_code: 'M54.16',
              diagnosis_type: 'PRIMARY',
              patient_condition_id: null,
              created_at: '2026-11-06T10:05:00Z',
            },
          ])
        }
        if (u.includes('/api/encounters/10/investigations')) {
          return json(200, [
            {
              id: 401,
              encounter_id: 10,
              patient_id: 101,
              doctor_id: 1,
              category: 'IMAGING',
              test_name: 'MRI Lumbar Spine',
              instructions: 'Bring previous films',
              priority: 'ROUTINE',
              status: 'ORDERED',
              results: [],
              created_at: '2026-11-06T10:06:00Z',
              updated_at: '2026-11-06T10:06:00Z',
            },
          ])
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      // Read-only banner identifies owning doctor
      const banner = await screen.findByTestId('encounter-readonly-banner')
      expect(banner).toHaveAttribute('role', 'status')
      expect(banner).toHaveTextContent(/View-only consultation/i)
      expect(banner).toHaveTextContent(/Dr\. Madan Mohan Dwivedi/i)

      // Core text fields rendered read-only (no editable textarea/input for complaints, exam notes, diagnosis)
      expect(document.getElementById('symptoms-input')).toBeNull()
      expect(document.getElementById('clinical-notes-input')).toBeNull()
      expect(document.getElementById('diagnosis-input')).toBeNull()
      expect(screen.queryByTestId('toggle-examination-phrases')).not.toBeInTheDocument()

      // Vitals, Specialty, Prescription, Follow-up inputs are disabled
      expect(screen.getByLabelText(/Height \(cm\)/i)).toBeDisabled()
      expect(screen.getByLabelText(/Weight \(kg\)/i)).toBeDisabled()
      expect(screen.getByLabelText(/Pain Site \/ Joint/i)).toBeDisabled()
      expect(screen.getByLabelText(/Dietary Advice/i)).toBeDisabled()
      expect(screen.getByLabelText(/General Clinical Advice/i)).toBeDisabled()
      expect(screen.getByLabelText(/Recommended Review Date/i)).toBeDisabled()
      expect(screen.queryByRole('button', { name: /Add Medication Item/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Authorise Prescription/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('physio-treatment-plan-link')).not.toBeInTheDocument()

      // Header Finalise CTA, Needed to finalise checklist, Billing group, DoctorChargesPanel, and Copy buttons are hidden
      expect(screen.queryByRole('button', { name: /Finalise Consultation/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: /Needed to finalise/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('sidebar-group-billing')).not.toBeInTheDocument()
      expect(screen.queryByTestId('doctor-charges-panel')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Copy Section Findings/i })).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/Append Addendum Note/i)).not.toBeInTheDocument()

      // Extracted Structured Diagnoses panel: expandable to view existing items, no Remove or Add Diagnosis controls
      const diagPanel = screen.getByTestId('structured-diagnoses-panel')
      await user.click(within(diagPanel).getByRole('button', { name: /Structured Diagnoses/i }))
      expect(within(diagPanel).getByText('Lumbar radiculopathy')).toBeInTheDocument()
      expect(within(diagPanel).queryByRole('button', { name: /Remove diagnosis/i })).not.toBeInTheDocument()
      expect(within(diagPanel).queryByRole('button', { name: /Add Diagnosis/i })).not.toBeInTheDocument()

      // Extracted Investigation Orders panel: expandable to view existing orders, no Order Investigation form
      const invPanel = screen.getByTestId('encounter-investigations-panel')
      await user.click(within(invPanel).getByRole('button', { name: /Investigation Orders/i }))
      expect(within(invPanel).getByText('MRI Lumbar Spine')).toBeInTheDocument()
      expect(within(invPanel).queryByRole('button', { name: /Order Investigation/i })).not.toBeInTheDocument()

      // Blur events on disabled inputs and navigation guard must not fire PATCH or mark dirty
      fireEvent.blur(screen.getByLabelText(/Height \(cm\)/i))
      fireEvent.blur(screen.getByLabelText(/Pain Site \/ Joint/i))

      const beforeUnloadEvent = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(beforeUnloadEvent)
      expect(beforeUnloadEvent.defaultPrevented).toBe(false)

      const patchCalls = mockFetch.mock.calls.filter(
        ([u, init]) => String(u).includes('/api/encounters/10') && (init as RequestInit)?.method === 'PATCH',
      )
      const billItemCalls = mockFetch.mock.calls.filter(([u]) => String(u).includes('/bill-items'))
      expect(patchCalls).toHaveLength(0)
      expect(billItemCalls).toHaveLength(0)
    })

    it('shows existing addenda read-only for cross-doctor finalised encounter without the append form', async () => {
      const finalisedWithAddenda: EncounterRead = {
        ...mockEncounterPhysio,
        doctor_id: 1,
        is_finalised: true,
        finalised_at: '2026-11-06T11:00:00Z',
        addenda: [
          {
            id: 501,
            encounter_id: 10,
            doctor_id: 1,
            doctor_name: 'Dr. Madan Mohan Dwivedi',
            addendum_text: 'Patient reported 40% pain relief after session 3.',
            created_at: '2026-11-07T09:15:00Z',
          },
        ],
      }
      const base = setupDefaultFetchMocks({ encounter: finalisedWithAddenda })
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        if (String(url).includes('/api/auth/me')) {
          return json(200, mockMeDoctorB)
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      expect(await screen.findByTestId('encounter-readonly-banner')).toBeInTheDocument()
      const addendaSection = screen.getByTestId('section-addenda')
      expect(within(addendaSection).getByText(/Patient reported 40% pain relief after session 3\./i)).toBeInTheDocument()
      expect(within(addendaSection).queryByLabelText(/Append Addendum Note/i)).not.toBeInTheDocument()
      expect(within(addendaSection).queryByRole('button', { name: /Append Addendum/i })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Finalise Consultation/i })).not.toBeInTheDocument()
      expect(screen.queryByTestId('doctor-charges-panel')).not.toBeInTheDocument()
      expect(mockFetch.mock.calls.filter(([u]) => String(u).includes('/bill-items'))).toHaveLength(0)
    })

    it('passes patient care advice (never internal clinicalNotes), departmentName, and dated addenda to ConsultationSummaryPrint', async () => {
      const user = userEvent.setup()
      const finalisedWithNotesAndAddenda: EncounterRead = {
        ...mockEncounterPhysio,
        department_id: 2,
        clinical_notes: 'INTERNAL EXAM ONLY: Grade 2 nuclear sclerosis; suspect early cataract.',
        is_finalised: true,
        finalised_at: '2026-11-06T11:30:00Z',
        addenda: [
          {
            id: 601,
            encounter_id: 10,
            doctor_id: 1,
            doctor_name: 'Dr. Madan Mohan Dwivedi',
            addendum_text: 'Reviewed OCT scan; continue lubricating drops.',
            created_at: '2026-11-08T06:00:00Z',
          },
        ],
      }
      const savedRx: PrescriptionOut = {
        id: 91,
        patient_id: 101,
        patient_urn: 'KH-2026-0001',
        patient_name: 'Aarav Kumar',
        doctor_id: 1,
        doctor_name: 'Dr. Madan Mohan Dwivedi',
        encounter_id: 10,
        status: 'AUTHORISED',
        is_printable: true,
        diagnosis: 'Lumbar Radiculopathy',
        dietary_advice: 'Eat green leafy vegetables and stay hydrated.',
        general_advice: 'Wear UV-protective sunglasses outdoors.',
        follow_up_date: null,
        version_id: 1,
        created_at: '2026-11-06T10:15:00Z',
        updated_at: '2026-11-06T10:15:00Z',
        items: [],
      }

      const mockFetch = setupDefaultFetchMocks({
        deptTemplate: mockOphthalTemplate,
        encounter: finalisedWithNotesAndAddenda,
        encounterPrescription: savedRx,
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByText(/Finalised & Locked/)
      // Wait for prescription hydration so generalAdvice / dietaryAdvice populate before opening summary print
      expect(await screen.findByDisplayValue('Wear UV-protective sunglasses outdoors.')).toBeInTheDocument()

      const header = screen.getByTestId('sticky-clinical-header')
      await user.click(within(header).getByRole('button', { name: /Print Consultation Summary/i }))

      const summarySheet = await screen.findByTestId('consultation-summary-sheet')
      expect(within(summarySheet).getByTestId('letterhead-banner')).toHaveTextContent(/Ophthalmology/i)
      expect(summarySheet).toHaveTextContent(/Wear UV-protective sunglasses outdoors\./i)
      expect(summarySheet).toHaveTextContent(/Eat green leafy vegetables and stay hydrated\./i)
      expect(summarySheet).not.toHaveTextContent(/INTERNAL EXAM ONLY/i)

      const addendaBlock = within(summarySheet).getByTestId('summary-addenda-section')
      expect(addendaBlock).toHaveTextContent(/Reviewed OCT scan; continue lubricating drops\./i)
      expect(addendaBlock).toHaveTextContent(/Dr\. Madan Mohan Dwivedi/i)
    })

    it('renders EncounterInvestigationOrdersPanel in read-only mode when encounter is finalised by authoring doctor (F2-FE-A)', async () => {
      const user = userEvent.setup()
      const finalisedByAuthor: EncounterRead = {
        ...mockEncounterPhysio,
        doctor_id: 1,
        is_finalised: true,
        finalised_at: '2026-11-06T11:00:00Z',
      }
      const existingOrders = [
        {
          id: 501,
          encounter_id: 10,
          patient_id: 101,
          test_name: 'MRI Lumbar Spine',
          category: 'IMAGING',
          priority: 'ROUTINE',
          instructions: 'Check L4-L5 disc herniation',
          status: 'ORDERED',
          created_at: '2026-11-06T10:30:00Z',
        },
      ]

      const base = setupDefaultFetchMocks({ encounter: finalisedByAuthor })
      const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/api/encounters/10/investigations')) {
          return json(200, existingOrders)
        }
        return base(url, init)
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWorkspace(10)

      await screen.findByText(/Finalised & Locked/)

      // Verify that this is the authoring doctor (no cross-doctor read-only banner)
      expect(screen.queryByTestId('encounter-readonly-banner')).not.toBeInTheDocument()

      // Expand Investigation Orders panel
      const invPanel = screen.getByTestId('encounter-investigations-panel')
      expect(within(invPanel).getByText('View')).toBeInTheDocument()
      await user.click(within(invPanel).getByRole('button', { name: /Investigation Orders/i }))

      // Existing orders are displayed
      expect(within(invPanel).getByText('MRI Lumbar Spine')).toBeInTheDocument()
      expect(within(invPanel).getByText('Instructions: Check L4-L5 disc herniation')).toBeInTheDocument()

      // "Order Investigation" form and button are NOT rendered (read-only mode)
      expect(within(invPanel).queryByRole('button', { name: /Order Investigation/i })).not.toBeInTheDocument()
      expect(within(invPanel).queryByLabelText(/Test \/ Investigation Name/i)).not.toBeInTheDocument()
    })
  })
})
