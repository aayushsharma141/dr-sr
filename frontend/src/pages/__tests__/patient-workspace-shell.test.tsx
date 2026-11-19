import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  Me,
  PatientAllergyOut,
  PatientConditionOut,
  PatientOut,
  PatientSummaryOut,
  PatientVisitHistoryResponse,
  PaymentOut,
  TimelineItemOut,
} from '../../api/types'
import { PatientDetail } from '../PatientDetail'

const samplePatient: PatientOut = {
  id: 101,
  urn: 'KH-2026-0101',
  full_name: 'Aarav Kumar',
  guardian_name: 'Suresh Kumar',
  guardian_relationship: 'Father',
  gender: 'M',
  dob: '1996-05-14',
  age_years: 30,
  computed_age_years: 30,
  mobile: '9876543210',
  address: 'Station Road, Ara',
  district: 'Bhojpur',
  state: 'Bihar',
  emergency_contact: '9876500001',
  blood_group: 'O+',
  allergies: 'Penicillin',
  notes: 'Prefers morning slot',
  photo_path: null,
  is_active: true,
  is_archived: false,
  merged_into_id: null,
  version_id: 2,
  created_at: '2026-01-10T09:00:00Z',
  updated_at: '2026-01-15T10:00:00Z',
}

const sampleAllergy: PatientAllergyOut = {
  id: 11,
  patient_id: 101,
  substance: 'Penicillin',
  category: 'DRUG',
  severity: 'SEVERE',
  reaction: 'Urticaria and bronchospasm',
  clinical_notes: 'Avoid all beta-lactam antibiotics',
  status: 'ACTIVE',
  doctor_id: 1,
  recorded_by_user_id: 3,
  recorded_by_username: 'dr_dwivedi',
  created_at: '2026-02-01T10:00:00Z',
  updated_at: '2026-02-01T10:00:00Z',
  version_id: 1,
}

const doctorMe: Me = {
  id: 3,
  username: 'dr_dwivedi',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  permissions: [
    'patient:read',
    'timeline:read',
    'encounter:read',
    'prescription:read',
    'allergy:read',
    'allergy:write',
  ],
  must_change_password: false,
  csrf_token: 'csrf-doc',
  version_id: 1,
}

const receptionMe: Me = {
  id: 2,
  username: 'reception',
  full_name: 'Front Desk Staff',
  role: 'RECEPTION',
  doctor_id: null,
  permissions: [
    'patient:read',
    'patient:update',
    'appointment:write',
    'payment:read',
    'payment:create',
    'timeline:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-rec',
  version_id: 1,
}

const adminMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Hospital Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: [
    'patient:read',
    'patient:correct',
    'payment:read',
    'audit:read',
    'timeline:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-adm',
  version_id: 1,
}

function summaryFor(role: Me['role']): PatientSummaryOut {
  return {
    patient_id: 101,
    urn: 'KH-2026-0101',
    total_visits: 3,
    active_treatment_plans: 1,
    latest_visit: {
      visit_id: 501,
      visit_code: 'VIS-2026-0501',
      visit_date: '2026-11-10',
      status: 'OPEN',
      token_numbers: [4],
      doctors: ['Dr. Madan Mohan Dwivedi'],
      departments: ['Orthopaedics'],
      consultation_count: 1,
      completed_consultations: 1,
    },
    allergy_alert:
      role === 'ADMIN'
        ? null
        : {
            has_allergies: true,
            count: 1,
            highest_severity: 'SEVERE',
            alert_labels: ['Penicillin'],
          },
    active_allergies: role === 'DOCTOR' ? [sampleAllergy] : null,
    prescriptions_count: role === 'DOCTOR' ? 2 : null,
    active_conditions_count: role === 'DOCTOR' ? 1 : null,
    latest_encounter:
      role === 'DOCTOR'
        ? {
            encounter_id: 41,
            encounter_code: 'ENC-2026-0041',
            encounter_date: '2026-11-10T10:30:00Z',
            doctor_name: 'Dr. Madan Mohan Dwivedi',
            department_name: 'Orthopaedics',
            is_finalised: true,
            diagnosis_summary: 'Lumbar radiculopathy',
          }
        : null,
    total_billed_paise: role === 'DOCTOR' ? null : 150000,
    total_paid_paise: role === 'DOCTOR' ? null : 100000,
    total_refunded_paise: role === 'DOCTOR' ? null : 0,
    outstanding_paise: role === 'DOCTOR' ? null : 50000,
  }
}

const sampleVisits: PatientVisitHistoryResponse = {
  items: [
    {
      visit_id: 501,
      visit_code: 'VIS-2026-0501',
      visit_date: '2026-11-10',
      status: 'OPEN',
      token_numbers: [4],
      doctors: ['Madan Mohan Dwivedi'],
      departments: ['Orthopaedics'],
      consultation_count: 1,
      completed_consultations: 1,
      encounter_links: [
        {
          encounter_id: 41,
          encounter_code: 'ENC-2026-0041',
          is_finalised: true,
          doctor_name: 'Madan Mohan Dwivedi',
        },
      ],
      bill_total_paise: 150000,
      paid_paise: 100000,
      due_paise: 50000,
      payment_status: 'PARTIAL',
    },
  ],
  total: 1,
  limit: 20,
  offset: 0,
}

const samplePayments: PaymentOut[] = [
  {
    id: 31,
    receipt_number: 'RCP-2026-0031',
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
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
    created_at: '2026-11-10T10:00:00Z',
  },
]

const sampleLedger = {
  patient_id: 101,
  patient_urn: 'KH-2026-0101',
  total_billed_paise: 150000,
  total_paid_paise: 50000,
  total_refunded_paise: 0,
  outstanding_paise: 100000,
  ledger_balance_paise: 100000,
  entries: [
    {
      id: 1,
      patient_id: 101,
      visit_id: 501,
      entry_type: 'PAYMENT',
      direction: 'CREDIT',
      amount_paise: 50000,
      signed_amount_paise: -50000,
      running_balance_paise: 100000,
      reference_type: 'PAYMENT',
      reference_id: 31,
      description: 'Payment received (RCP-2026-0031)',
      actor_user_id: 2,
      actor_username: 'reception',
      occurred_at: '2026-11-10T10:00:00Z',
      created_at: '2026-11-10T10:00:00Z',
    },
  ],
  total_entries: 1,
  limit: 50,
  offset: 0,
  payments: samplePayments.map((p) => ({
    ...p,
    refunded_paise: 0,
    remaining_refundable_paise: p.amount_paise,
  })),
  refunds: [],
  visits: [
    {
      visit_id: 501,
      visit_code: 'VIS-2026-0501',
      visit_date: '2026-11-10',
      status: 'OPEN',
      bill_total_paise: 150000,
      paid_paise: 50000,
      refunded_paise: 0,
      due_paise: 100000,
    },
  ],
}

const sampleTimeline: TimelineItemOut[] = [
  {
    id: 'ENCOUNTER-41',
    event_type: 'ENCOUNTER',
    event_date: '2026-11-10T10:30:00Z',
    title: 'Clinical Consultation with Dr. Dwivedi',
    subtitle: 'Orthopaedics',
    summary: 'Lumbar radiculopathy',
    badge: 'FINALISED',
    badge_variant: 'default',
    metadata: { encounter_id: 41 },
  },
  {
    id: 'PRESCRIPTION-42',
    event_type: 'PRESCRIPTION',
    event_date: '2026-11-10T10:45:00Z',
    title: 'Prescription #42',
    subtitle: 'Dr. Dwivedi',
    summary: 'Gabapentin 300mg',
    badge: 'ACTIVE',
    badge_variant: 'default',
    metadata: { prescription_id: 42 },
  },
  {
    id: 'TREATMENT_PLAN-9',
    event_type: 'TREATMENT_PLAN',
    event_date: '2026-11-10T11:00:00Z',
    title: 'Package: Lumbar Spine Rehab',
    subtitle: '10 sessions',
    summary: 'Traction + IFT',
    badge: 'ACTIVE',
    badge_variant: 'default',
    metadata: { treatment_plan_id: 9 },
  },
]

const sampleAudit = {
  items: [
    {
      id: 901,
      occurred_at: '2026-11-10T09:30:00Z',
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

function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location-search">{location.search}</output>
}

function renderWorkspace(
  me: Me,
  initialEntry: string | { pathname: string; search?: string; state?: unknown } = '/reception/patients/101',
  overrides: {
    summary?: PatientSummaryOut | null
    summaryFail500?: boolean
    patient?: PatientOut
    allergies?: PatientAllergyOut[]
    conditions?: PatientConditionOut[]
  } = {},
) {
  const fetchedUrls: string[] = []
  const patientData = overrides.patient ?? samplePatient
  const allergiesData = overrides.allergies ?? [sampleAllergy]
  const conditionsData = overrides.conditions ?? []
  const mockFetch = vi.fn().mockImplementation((url: string) => {
    fetchedUrls.push(url)
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonOk(me))
    if (url.includes('/api/patients/101/summary')) {
      if (overrides.summaryFail500) {
        return Promise.resolve({
          ok: false,
          status: 500,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'internal_error', message: 'Summary unavailable' })),
        })
      }
      return Promise.resolve(jsonOk(overrides.summary !== undefined ? overrides.summary : summaryFor(me.role)))
    }
    if (url.includes('/api/patients/101/allergies')) return Promise.resolve(jsonOk(allergiesData))
    if (url.includes('/api/patients/101/conditions')) return Promise.resolve(jsonOk(conditionsData))
    if (url.includes('/api/patients/101/visits')) return Promise.resolve(jsonOk(sampleVisits))
    if (url.includes('/api/patients/101/ledger')) return Promise.resolve(jsonOk(sampleLedger))
    if (url.includes('/api/patients/101/payments')) return Promise.resolve(jsonOk(samplePayments))
    if (url.includes('/api/patients/101/timeline')) return Promise.resolve(jsonOk(sampleTimeline))
    if (url.includes('/api/audit-logs')) return Promise.resolve(jsonOk(sampleAudit))
    if (url.includes('/api/settings/clinic')) return Promise.resolve(jsonOk({}))
    if (url.includes('/api/patients/101')) return Promise.resolve(jsonOk(patientData))
    return Promise.reject(new Error(`Unhandled fetch: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <LocationProbe />
        <Routes>
          <Route path="/reception/patients/:id" element={<PatientDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { fetchedUrls }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PatientDetail 9-section workspace shell (T1.8)', () => {
  it('keeps the persistent identity header and URN visible across tab switches (desktop + mobile select)', async () => {
    const user = userEvent.setup()
    renderWorkspace(receptionMe)

    const header = await screen.findByRole('banner', { name: 'Patient identity summary' })
    expect(within(header).getByText('KH-2026-0101')).toBeInTheDocument()
    expect(within(header).getByRole('heading', { level: 1, name: 'Aarav Kumar' })).toBeInTheDocument()

    // Switch via desktop tab to Visit History
    await user.click(screen.getByRole('tab', { name: 'Visit History' }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Visit History' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=visits')
    expect(within(screen.getByRole('banner', { name: 'Patient identity summary' })).getByText('KH-2026-0101')).toBeInTheDocument()

    // Switch via mobile <select> to Treatment Plans
    const mobileSelect = screen.getByLabelText('Jump to patient record section')
    await user.selectOptions(mobileSelect, 'therapy')
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Treatment Plans' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=therapy')
    expect(within(screen.getByRole('banner', { name: 'Patient identity summary' })).getByText('KH-2026-0101')).toBeInTheDocument()
  })

  it('adapts allergy display by role: full + editable for DOCTOR, read-only alert for RECEPTION, hidden for ADMIN', async () => {
    // 1. DOCTOR: full clinical details + Add/Edit/Resolve controls
    const { fetchedUrls: doctorUrls } = renderWorkspace(doctorMe)
    expect(await screen.findByRole('heading', { name: 'Structured Clinical Allergies' })).toBeInTheDocument()
    expect(await screen.findByText('Urticaria and bronchospasm')).toBeInTheDocument()
    expect(screen.getByText('Avoid all beta-lactam antibiotics')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add Allergy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeInTheDocument()
    expect(doctorUrls.some((u) => u.includes('/api/patients/101/allergies'))).toBe(true)
  })

  it('shows read-only safety-alert-only allergies for RECEPTION and never calls clinical allergies endpoint', async () => {
    const { fetchedUrls: receptionUrls } = renderWorkspace(receptionMe)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Allergy Safety Alert' })).toBeInTheDocument()
    })
    expect(screen.getByText('Read-only safety summary')).toBeInTheDocument()
    expect(screen.getAllByText('Penicillin').length).toBeGreaterThan(0)
    // Clinical details and write actions must never appear for Reception
    expect(screen.queryByText('Urticaria and bronchospasm')).not.toBeInTheDocument()
    expect(screen.queryByText('Avoid all beta-lactam antibiotics')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add Allergy/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument()
    expect(receptionUrls.some((u) => u.includes('/api/patients/101/allergies'))).toBe(false)
  })

  it('completely hides all allergy UI for ADMIN and never calls clinical allergies endpoint', async () => {
    const { fetchedUrls: adminUrls } = renderWorkspace(adminMe)

    await waitFor(() => {
      expect(screen.getByRole('banner', { name: 'Patient identity summary' })).toBeInTheDocument()
    })
    expect(screen.queryByText(/Allergy Safety Alert/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Structured Clinical Allergies/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Active Clinical Allergies/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Penicillin')).not.toBeInTheDocument()
    expect(adminUrls.some((u) => u.includes('/api/patients/101/allergies'))).toBe(false)
  })

  it('syncs ?tab=visits on initial render and preserves ?tab=visits when clearing/dismissing a redirect notice', async () => {
    const user = userEvent.setup()
    renderWorkspace(receptionMe, {
      pathname: '/reception/patients/101',
      search: '?tab=visits',
      state: { notice: 'Patient details updated successfully.' },
    })

    expect(await screen.findByText('Patient details updated successfully.')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Visit History' })).toHaveAttribute('aria-selected', 'true')
    })
    // Notice effect clears history state while preserving ?tab=visits
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=visits')
    expect((await screen.findAllByText('VIS-2026-0501')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByText('Patient details updated successfully.')).not.toBeInTheDocument()
    expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=visits')
    expect(screen.getByRole('tab', { name: 'Visit History' })).toHaveAttribute('aria-selected', 'true')
  })

  it('renders PaymentHistory ONLY on Billing & Ledger, never on Overview, Visit History, Treatment Plans, Documents, or Change History', async () => {
    const user = userEvent.setup()
    renderWorkspace(adminMe)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    })
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()

    // Visit History
    await user.click(screen.getByRole('tab', { name: 'Visit History' }))
    await waitFor(() => {
      expect(screen.getAllByText('VIS-2026-0501').length).toBeGreaterThan(0)
    })
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()

    // Treatment Plans
    await user.click(screen.getByRole('tab', { name: 'Treatment Plans' }))
    await waitFor(() => {
      expect(screen.getByText('Package: Lumbar Spine Rehab')).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()

    // Documents
    await user.click(screen.getByRole('tab', { name: 'Documents' }))
    expect(await screen.findByRole('heading', { name: 'Documents & Attachments' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()

    // Change History (Audit)
    await user.click(screen.getByRole('tab', { name: 'Change History' }))
    expect(await screen.findByText('PATIENT_UPDATED')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()

    // Billing & Ledger — PaymentHistory renders ONLY here
    await user.click(screen.getByRole('tab', { name: 'Billing & Ledger' }))
    expect(await screen.findByRole('heading', { name: 'Payments & receipts' })).toBeInTheDocument()
    expect(screen.getByText('RCP-2026-0031')).toBeInTheDocument()
  })

  it('enforces role-adapted 9-section tab visibility for DOCTOR, RECEPTION, and ADMIN', async () => {
    // DOCTOR
    const doctorRender = renderWorkspace(doctorMe)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Clinical Records' })).toBeInTheDocument()
    })
    const doctorTabs = screen.getAllByRole('tab').map((el) => el.textContent)
    expect(doctorTabs).toEqual([
      'Overview',
      'Visit History',
      'Clinical Records',
      'Prescriptions',
      'Investigations',
      'Treatment Plans',
      'Documents',
    ])
    expect(screen.queryByRole('tab', { name: 'Billing & Ledger' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Change History' })).not.toBeInTheDocument()
    expect(doctorRender.fetchedUrls.some((u) => u.includes('/payments'))).toBe(false)
  })

  it('shows Billing & Ledger (and hides clinical + audit tabs) for RECEPTION', async () => {
    renderWorkspace(receptionMe)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Billing & Ledger' })).toBeInTheDocument()
    })
    const receptionTabs = screen.getAllByRole('tab').map((el) => el.textContent)
    expect(receptionTabs).toEqual([
      'Overview',
      'Visit History',
      'Treatment Plans',
      'Billing & Ledger',
      'Documents',
    ])
    expect(screen.queryByRole('tab', { name: 'Clinical Records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Prescriptions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Investigations' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Change History' })).not.toBeInTheDocument()
  })

  it('shows Billing & Ledger + Change History (and hides clinical tabs) for ADMIN', async () => {
    renderWorkspace(adminMe)
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Change History' })).toBeInTheDocument()
    })
    const adminTabs = screen.getAllByRole('tab').map((el) => el.textContent)
    expect(adminTabs).toEqual([
      'Overview',
      'Visit History',
      'Treatment Plans',
      'Billing & Ledger',
      'Documents',
      'Change History',
    ])
    expect(screen.queryByRole('tab', { name: 'Clinical Records' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Prescriptions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Investigations' })).not.toBeInTheDocument()
  })

  it('redirects invalid or unauthorized ?tab= values back to overview without crashing', async () => {
    renderWorkspace(doctorMe, '/reception/patients/101?tab=billing')

    await waitFor(() => {
      expect(screen.getByTestId('location-search')).toHaveTextContent('?tab=overview')
    })
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('heading', { name: 'Payments & receipts' })).not.toBeInTheDocument()
  })

  it('shows allergy-status-unavailable and NEVER No known allergies when /summary fails with 500 for DOCTOR (C4)', async () => {
    renderWorkspace(doctorMe, '/reception/patients/101', {
      summaryFail500: true,
      patient: { ...samplePatient, allergies: '' },
      allergies: [],
    })

    const header = await screen.findByRole('banner', { name: 'Patient identity summary' })
    const unavailable = await within(header).findByTestId('allergy-status-unavailable')
    expect(unavailable).toHaveTextContent(/Allergy status unavailable/i)
    expect(within(header).queryByText(/No known allergies/i)).not.toBeInTheDocument()
  })

  it('shows legacy-allergy-pill and NOT No known allergies when /summary has 0 structured allergies but legacy patient.allergies is set (C4)', async () => {
    const emptyStructuredSummary: PatientSummaryOut = {
      ...summaryFor('DOCTOR'),
      allergy_alert: {
        has_allergies: false,
        count: 0,
        highest_severity: null,
        alert_labels: [],
      },
      active_allergies: [],
    }
    renderWorkspace(doctorMe, '/reception/patients/101', {
      summary: emptyStructuredSummary,
      patient: { ...samplePatient, allergies: 'Sulfa drugs' },
      allergies: [],
    })

    const header = await screen.findByRole('banner', { name: 'Patient identity summary' })
    const legacyPill = await within(header).findByTestId('legacy-allergy-pill')
    expect(legacyPill).toHaveTextContent(/Sulfa drugs/i)
    expect(within(header).queryByText(/No known allergies/i)).not.toBeInTheDocument()
    expect(within(header).queryByTestId('allergy-status-unavailable')).not.toBeInTheDocument()
  })

  it('passes currentDoctorId from PatientDetail to PatientOverviewTab so Doctor B sees Doctor A conditions as read-only', async () => {
    const doctorBMe: Me = {
      ...doctorMe,
      id: 4,
      username: 'dr_verma',
      full_name: 'Dr. Ananya Verma',
      doctor_id: 2,
      permissions: [...doctorMe.permissions, 'encounter:write'],
    }
    const doctorACondition: PatientConditionOut = {
      id: 21,
      patient_id: 101,
      doctor_id: 1,
      doctor_name: 'Dr. Madan Mohan Dwivedi',
      condition_name: 'Cervical spondylosis',
      icd10_code: 'M47.812',
      status: 'ACTIVE',
      onset_date: '2026-10-05',
      resolved_date: null,
      notes: 'Physio follow-up',
      created_at: '2026-10-05T09:00:00Z',
      updated_at: '2026-10-05T09:00:00Z',
      version_id: 1,
    }

    renderWorkspace(doctorBMe, '/reception/patients/101', {
      conditions: [doctorACondition],
    })

    expect(await screen.findByText('Cervical spondylosis')).toBeInTheDocument()
    expect(screen.getByText('Read-only')).toBeInTheDocument()
    expect(screen.queryByLabelText('Status for Cervical spondylosis')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit condition Cervical spondylosis' }),
    ).not.toBeInTheDocument()
  })
})
