import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import type {
  EncounterDiagnosisOut,
  EncounterRead,
  EncounterSummary,
  InvestigationOrderOut,
  InvestigationResultOut,
  PatientConditionOut,
  PatientOut,
  PrescriptionOut,
  PrescriptionSummary,
  TimelineItemOut,
  TreatmentPlanOut,
  TreatmentSessionOut,
  VitalObservationResponse,
} from '../../api/types'
import { PatientClinicalRecordsTab } from '../patient/PatientClinicalRecordsTab'
import { PatientInvestigationsTab } from '../patient/PatientInvestigationsTab'
import { PatientOverviewTab } from '../patient/PatientOverviewTab'
import { PatientPrescriptionsTab } from '../patient/PatientPrescriptionsTab'
import { PatientTreatmentPlansTab } from '../patient/PatientTreatmentPlansTab'

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PatientClinicalRecordsTab', () => {
  const encounterSummary: EncounterSummary = {
    id: 41,
    patient_id: 101,
    doctor_id: 1,
    doctor_name: 'Madan Mohan Dwivedi',
    encounter_date: '2026-11-10T10:30:00Z',
    diagnosis: 'Lumbar radiculopathy',
    is_finalised: true,
    finalised_at: '2026-11-10T11:00:00Z',
    addenda_count: 1,
  }

  const encounterDetail: EncounterRead = {
    id: 41,
    encounter_code: 'ENC-26-000041',
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
    patient_name: 'Aarav Kumar',
    doctor_id: 1,
    doctor_name: 'Madan Mohan Dwivedi',
    appointment_id: 501,
    visit_id: 88,
    department_id: 1,
    encounter_date: '2026-11-10T10:30:00Z',
    symptoms: 'Radiating lower back pain for 10 days',
    clinical_notes: 'SLR positive on left at 45 degrees.',
    diagnosis: 'Lumbar radiculopathy',
    is_finalised: true,
    finalised_at: '2026-11-10T11:00:00Z',
    version_id: 2,
    created_at: '2026-11-10T10:30:00Z',
    updated_at: '2026-11-10T11:00:00Z',
    addenda: [
      {
        id: 7,
        encounter_id: 41,
        doctor_id: 1,
        doctor_name: 'Madan Mohan Dwivedi',
        addendum_text: 'Reviewed MRI report; advised continued traction.',
        created_at: '2026-11-11T09:15:00Z',
      },
    ],
  }

  const structuredDiagnoses: EncounterDiagnosisOut[] = [
    {
      id: 301,
      encounter_id: 41,
      encounter_code: 'ENC-26-000041',
      patient_id: 101,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      diagnosis_name: 'Lumbar radiculopathy',
      icd10_code: 'M54.16',
      diagnosis_type: 'PRIMARY',
      status: 'ACTIVE',
      onset_date: '2026-11-01',
      notes: 'Left L4-L5 distribution',
      patient_condition_id: 12,
      created_at: '2026-11-10T10:40:00Z',
      updated_at: '2026-11-10T10:40:00Z',
    },
  ]

  const sampleVitals: VitalObservationResponse = {
    id: 9,
    encounter_id: 41,
    patient_id: 101,
    height_cm: 172,
    weight_kg: 72,
    bmi: 24.3,
    systolic_bp: 124,
    diastolic_bp: 82,
    pulse_bpm: 76,
    temperature_f: 98.4,
    respiratory_rate: 16,
    spo2_percent: 99,
    created_at: '2026-11-10T10:35:00Z',
    updated_at: '2026-11-10T10:35:00Z',
  }

  it('renders encounter codes and structured ICD-10 diagnoses on expansion', async () => {
    const user = userEvent.setup()
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/encounters')) {
        return Promise.resolve(jsonResponse([encounterSummary]))
      }
      if (url.includes('/api/encounters/41/diagnoses')) {
        return Promise.resolve(jsonResponse(structuredDiagnoses))
      }
      if (url.includes('/api/encounters/41/vitals')) {
        return Promise.resolve(jsonResponse(sampleVitals))
      }
      if (url.includes('/api/encounters/41')) {
        return Promise.resolve(jsonResponse(encounterDetail))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientClinicalRecordsTab patientId={101} />)

    expect(await screen.findByText('ENC-#41')).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /View Details/i }))

    expect(await screen.findByText('ENC-26-000041')).toBeInTheDocument()
    expect(await screen.findByText('M54.16')).toBeInTheDocument()
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    expect(screen.getByText('124/82 mmHg')).toBeInTheDocument()
    expect(screen.getByText('Reviewed MRI report; advised continued traction.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Visit Workspace/i })).toHaveAttribute(
      'href',
      '/patients/101/visits/88',
    )
  })
})

describe('PatientPrescriptionsTab', () => {
  const rxV1Summary: PrescriptionSummary = {
    id: 41,
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
    patient_name: 'Aarav Kumar',
    doctor_id: 1,
    doctor_name: 'Madan Mohan Dwivedi',
    encounter_id: 41,
    diagnosis: 'Lumbar radiculopathy',
    follow_up_date: '2026-11-20',
    status: 'SUPERSEDED',
    revision_number: 1,
    supersedes_prescription_id: null,
    amendment_reason: null,
    items_count: 1,
    created_at: '2026-11-10T10:45:00Z',
  }

  const rxV2Summary: PrescriptionSummary = {
    id: 42,
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
    patient_name: 'Aarav Kumar',
    doctor_id: 1,
    doctor_name: 'Madan Mohan Dwivedi',
    encounter_id: 41,
    diagnosis: 'Lumbar radiculopathy',
    follow_up_date: '2026-11-24',
    status: 'AUTHORISED',
    revision_number: 2,
    supersedes_prescription_id: 41,
    amendment_reason: 'Reduced dose due to morning drowsiness',
    items_count: 1,
    created_at: '2026-11-10T11:30:00Z',
  }

  const rxV2Full: PrescriptionOut = {
    id: 42,
    patient_id: 101,
    patient_urn: 'KH-2026-0101',
    patient_name: 'Aarav Kumar',
    patient_mobile: '9876543210',
    patient_address: 'Station Road, Ara',
    doctor_id: 1,
    doctor_name: 'Dr. Madan Mohan Dwivedi',
    encounter_id: 41,
    diagnosis: 'Lumbar radiculopathy',
    dietary_advice: 'Warm fluids',
    general_advice: 'Avoid heavy lifting',
    follow_up_date: '2026-11-24',
    status: 'AUTHORISED',
    revision_number: 2,
    supersedes_prescription_id: 41,
    amendment_reason: 'Reduced dose due to morning drowsiness',
    is_printable: true,
    cancellation_reason: null,
    version_id: 1,
    created_at: '2026-11-10T11:30:00Z',
    updated_at: '2026-11-10T11:30:00Z',
    items: [
      {
        id: 201,
        prescription_id: 42,
        item_order: 1,
        medicine_name: 'Gabapentin',
        strength: '100mg',
        form: 'Tablet',
        route: 'Oral',
        dosage: '1 tab',
        frequency: 'HS',
        duration_days: 10,
        instructions: 'At bedtime',
      },
    ],
  }

  const rxV3Amended: PrescriptionOut = {
    ...rxV2Full,
    id: 43,
    revision_number: 3,
    supersedes_prescription_id: 42,
    amendment_reason: 'Switched to morning dose after follow-up call',
  }

  it('renders revision badges (v1/v2, Superseded), opens PrescriptionPrint, and submits Amend Prescription', async () => {
    const user = userEvent.setup()
    let amendPayload: Record<string, unknown> | null = null
    let prescriptionsList = [rxV2Summary, rxV1Summary]

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve(jsonResponse(prescriptionsList))
      }
      if (url.includes('/api/prescriptions/42/amend') && init?.method === 'POST') {
        amendPayload = JSON.parse(String(init.body)) as Record<string, unknown>
        prescriptionsList = [
          {
            ...rxV2Summary,
            id: 43,
            revision_number: 3,
            supersedes_prescription_id: 42,
            amendment_reason: String(amendPayload.amendment_reason),
          },
          { ...rxV2Summary, status: 'SUPERSEDED' },
          rxV1Summary,
        ]
        return Promise.resolve(jsonResponse(rxV3Amended, 201))
      }
      if (url.includes('/api/prescriptions/42')) {
        return Promise.resolve(jsonResponse(rxV2Full))
      }
      if (url.includes('/api/prescriptions/43')) {
        return Promise.resolve(jsonResponse(rxV3Amended))
      }
      if (url.includes('/api/settings/clinic')) {
        return Promise.resolve(jsonResponse({ name_en: 'Kalyan Hospital' }))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientPrescriptionsTab patientId={101} currentDoctorId={1} />)

    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(screen.getByText('v1')).toBeInTheDocument()
    expect(screen.getByText('Superseded')).toBeInTheDocument()
    expect(screen.getByText('Authorised')).toBeInTheDocument()
    expect(screen.getByText('Supersedes Rx #41')).toBeInTheDocument()
    expect(screen.getByText(/Reduced dose due to morning drowsiness/)).toBeInTheDocument()

    // Open PrescriptionPrint
    await user.click(screen.getByRole('button', { name: /Print \/ Preview/i }))
    const sheet = await screen.findByTestId('prescription-sheet')
    expect(within(sheet).getByText('Gabapentin')).toBeInTheDocument()
    expect(within(sheet).getByText('KH-2026-0101')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => {
      expect(screen.queryByTestId('prescription-sheet')).not.toBeInTheDocument()
    })

    // Open Amend Prescription modal & submit
    await user.click(screen.getByRole('button', { name: /Amend Prescription/i }))
    const reasonField = await screen.findByLabelText(/Amendment Reason/i)
    await user.type(reasonField, 'Switched to morning dose after follow-up call')
    await user.click(screen.getByRole('button', { name: /Save Amended Revision/i }))

    await waitFor(() => {
      expect(amendPayload).not.toBeNull()
    })
    expect(amendPayload).toMatchObject({
      amendment_reason: 'Switched to morning dose after follow-up call',
      diagnosis: 'Lumbar radiculopathy',
      authorise_immediately: true,
    })
    expect(await screen.findByText(/Created amended prescription revision v3/i)).toBeInTheDocument()
  })

  it('shows Authorise action strictly on own-doctor DRAFT prescriptions and authorises them', async () => {
    const user = userEvent.setup()
    let authoriseCalled = false

    const ownDraft: PrescriptionSummary = {
      ...rxV2Summary,
      id: 51,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      status: 'DRAFT',
      revision_number: 2,
      supersedes_prescription_id: 41,
      amendment_reason: 'Draft revision pending sign-off',
    }
    const otherDoctorDraft: PrescriptionSummary = {
      ...rxV2Summary,
      id: 52,
      doctor_id: 2,
      doctor_name: 'Ananya Verma',
      status: 'DRAFT',
      revision_number: 1,
      supersedes_prescription_id: null,
      amendment_reason: null,
    }
    let list: PrescriptionSummary[] = [ownDraft, otherDoctorDraft]

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve(jsonResponse(list))
      }
      if (url.includes('/api/prescriptions/51/authorise') && init?.method === 'POST') {
        authoriseCalled = true
        list = [{ ...ownDraft, status: 'AUTHORISED' }, otherDoctorDraft]
        return Promise.resolve(
          jsonResponse({
            ...rxV2Full,
            id: 51,
            status: 'AUTHORISED',
            is_printable: true,
          }),
        )
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientPrescriptionsTab patientId={101} currentDoctorId={1} />)

    expect(await screen.findByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    expect(screen.getByText('Dr. Ananya Verma')).toBeInTheDocument()

    // Strictly one Authorise button (for own-doctor DRAFT only) and zero Print buttons initially
    const authoriseButtons = screen.getAllByRole('button', { name: /^Authorise$/i })
    expect(authoriseButtons).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Print \/ Preview/i })).not.toBeInTheDocument()

    await user.click(authoriseButtons[0])

    await waitFor(() => {
      expect(authoriseCalled).toBe(true)
    })
    expect(
      await screen.findByText(/Prescription v2 authorised and ready to print\./i),
    ).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Print \/ Preview/i })).toBeInTheDocument()
    // Other doctor's DRAFT still has no Authorise button
    expect(screen.queryByRole('button', { name: /^Authorise$/i })).not.toBeInTheDocument()
  })

  it('fails closed when currentDoctorId is null: no Authorise or Amend actions available', async () => {
    const draft: PrescriptionSummary = {
      ...rxV2Summary,
      id: 51,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      status: 'DRAFT',
      revision_number: 2,
      supersedes_prescription_id: null,
      amendment_reason: null,
    }
    const authorised: PrescriptionSummary = {
      ...rxV2Summary,
      id: 52,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      status: 'AUTHORISED',
      revision_number: 1,
      supersedes_prescription_id: null,
      amendment_reason: null,
    }
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/prescriptions')) {
        return Promise.resolve(jsonResponse([draft, authorised]))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientPrescriptionsTab patientId={101} currentDoctorId={null} />)

    expect(await screen.findByText('v2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Authorise$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Amend Prescription/i })).not.toBeInTheDocument()
  })
})

describe('PatientInvestigationsTab', () => {
  it('transitions status via Mark Sample Collected and records a result via Record Result modal', async () => {
    const user = userEvent.setup()
    let statusPatchBody: Record<string, unknown> | null = null
    let resultPostBody: Record<string, unknown> | null = null

    let currentOrder: InvestigationOrderOut = {
      id: 71,
      encounter_id: 41,
      encounter_code: 'ENC-26-000041',
      patient_id: 101,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      category: 'LAB',
      test_name: 'Serum HbA1c',
      instructions: 'Fasting not required',
      priority: 'URGENT',
      status: 'ORDERED',
      cancelled_reason: null,
      ordered_at: '2026-11-10T10:50:00Z',
      updated_at: '2026-11-10T10:50:00Z',
      version_id: 1,
      results: [],
    }

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/investigations')) {
        return Promise.resolve(jsonResponse([currentOrder]))
      }
      if (url.includes('/api/investigations/71/status') && init?.method === 'PATCH') {
        statusPatchBody = JSON.parse(String(init.body)) as Record<string, unknown>
        currentOrder = {
          ...currentOrder,
          status: 'SAMPLE_COLLECTED',
          version_id: 2,
        }
        return Promise.resolve(jsonResponse(currentOrder))
      }
      if (url.includes('/api/investigations/71/results') && init?.method === 'POST') {
        resultPostBody = JSON.parse(String(init.body)) as Record<string, unknown>
        const createdResult: InvestigationResultOut = {
          id: 901,
          order_id: 71,
          patient_id: 101,
          summary_text: String(resultPostBody.summary_text),
          result_value: (resultPostBody.result_value as string | null) ?? null,
          unit: (resultPostBody.unit as string | null) ?? null,
          reference_range: (resultPostBody.reference_range as string | null) ?? null,
          is_abnormal: Boolean(resultPostBody.is_abnormal),
          reported_at: '2026-11-10T14:00:00Z',
          recorded_by_user_id: 3,
          recorded_by_username: 'dr_dwivedi',
          created_at: '2026-11-10T14:00:00Z',
        }
        currentOrder = {
          ...currentOrder,
          status: 'COMPLETED',
          version_id: 3,
          results: [createdResult],
        }
        return Promise.resolve(jsonResponse(createdResult, 201))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientInvestigationsTab patientId={101} currentDoctorId={1} />)

    expect(await screen.findByText('Serum HbA1c')).toBeInTheDocument()
    expect(screen.getByText('ORDERED')).toBeInTheDocument()

    // 1. Mark Sample Collected
    await user.click(screen.getByRole('button', { name: /Mark Sample Collected/i }))
    await waitFor(() => {
      expect(statusPatchBody).toEqual({
        status: 'SAMPLE_COLLECTED',
        version_id: 1,
      })
    })
    expect(await screen.findByText('SAMPLE COLLECTED')).toBeInTheDocument()

    // 2. Record Result
    await user.click(screen.getByRole('button', { name: /Record Result/i }))
    await user.type(
      await screen.findByLabelText(/Result Summary \/ Findings/i),
      'Elevated HbA1c indicating suboptimal glycaemic control',
    )
    await user.type(screen.getByLabelText(/Measured Value/i), '8.2')
    await user.type(screen.getByLabelText(/^Unit$/i), '%')
    await user.type(screen.getByLabelText(/Reference Range/i), '4.0 - 5.6 %')
    await user.click(screen.getByLabelText(/Flag as abnormal result/i))
    await user.click(screen.getByRole('button', { name: /Save Result/i }))

    await waitFor(() => {
      expect(resultPostBody).toEqual({
        summary_text: 'Elevated HbA1c indicating suboptimal glycaemic control',
        result_value: '8.2',
        unit: '%',
        reference_range: '4.0 - 5.6 %',
        is_abnormal: true,
      })
    })
    expect(await screen.findByText('COMPLETED')).toBeInTheDocument()
    expect(screen.getByText('8.2 %')).toBeInTheDocument()
    expect(screen.getByText('Abnormal')).toBeInTheDocument()
    expect(
      screen.getByText('Elevated HbA1c indicating suboptimal glycaemic control'),
    ).toBeInTheDocument()
  })

  it('fails closed when currentDoctorId is null: mutation buttons are not displayed', async () => {
    const order: InvestigationOrderOut = {
      id: 71,
      encounter_id: 41,
      encounter_code: 'ENC-26-000041',
      patient_id: 101,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      category: 'LAB',
      test_name: 'Serum HbA1c',
      instructions: 'Fasting not required',
      priority: 'URGENT',
      status: 'ORDERED',
      cancelled_reason: null,
      ordered_at: '2026-11-10T10:50:00Z',
      updated_at: '2026-11-10T10:50:00Z',
      version_id: 1,
      results: [],
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/investigations')) {
        return Promise.resolve(jsonResponse([order]))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientInvestigationsTab patientId={101} currentDoctorId={null} />)

    expect(await screen.findByText('Serum HbA1c')).toBeInTheDocument()
    expect(screen.getByText('ORDERED')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark Sample Collected/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record Result/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cancel Order/i })).not.toBeInTheDocument()
  })
})

describe('PatientTreatmentPlansTab', () => {
  const samplePlan: TreatmentPlanOut = {
    id: 9,
    patient_id: 101,
    patient_name: 'Aarav Kumar',
    patient_urn: 'KH-2026-0101',
    doctor_id: 1,
    doctor_name: 'Madan Mohan Dwivedi',
    encounter_id: 41,
    plan_name: 'Lumbar Spine Rehab Package',
    condition_diagnosis: 'Lumbar radiculopathy',
    referred_by: 'Dr. Sharma',
    total_sessions: 10,
    completed_sessions: 2,
    agreed_price_paise: 500000,
    status: 'ACTIVE',
    cancellation_reason: null,
    version_id: 1,
    created_at: '2026-11-01T09:00:00Z',
    updated_at: '2026-11-05T10:00:00Z',
  }

  const sampleSessions: TreatmentSessionOut[] = [
    {
      id: 501,
      treatment_plan_id: 9,
      patient_id: 101,
      patient_urn: 'KH-2026-0101',
      patient_name: 'Aarav Kumar',
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      session_number: 1,
      session_date: '2026-11-02',
      vas_score: 7,
      modalities: ['IFT', 'Lumbar Traction'],
      clinical_notes: 'Tolerated initial traction well.',
      is_finalised: true,
      created_by_user_id: 3,
      created_by_username: 'dr_dwivedi',
      created_at: '2026-11-02T10:00:00Z',
      addenda: [],
    },
    {
      id: 502,
      treatment_plan_id: 9,
      patient_id: 101,
      patient_urn: 'KH-2026-0101',
      patient_name: 'Aarav Kumar',
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      session_number: 2,
      session_date: '2026-11-05',
      vas_score: 4,
      modalities: ['IFT', 'Core Exercises'],
      clinical_notes: 'Pain reduced significantly after session 2.',
      is_finalised: true,
      created_by_user_id: 3,
      created_by_username: 'dr_dwivedi',
      created_at: '2026-11-05T10:00:00Z',
      addenda: [],
    },
  ]

  const sampleTimeline: TimelineItemOut[] = [
    {
      id: 'TREATMENT_PLAN-9',
      event_type: 'TREATMENT_PLAN',
      event_date: '2026-11-01T09:00:00Z',
      title: 'Package: Lumbar Spine Rehab Package',
      subtitle: '10 sessions',
      summary: 'Active physiotherapy package',
      badge: 'ACTIVE',
      badge_variant: 'default',
      metadata: { treatment_plan_id: 9 },
    },
  ]

  it('renders VasTrendChart and clinical session log for DOCTOR with plan:read', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/treatment-plans')) {
        return Promise.resolve(jsonResponse([samplePlan]))
      }
      if (url.includes('/api/treatment-plans/9/sessions')) {
        return Promise.resolve(jsonResponse(sampleSessions))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientTreatmentPlansTab
        patientId={101}
        role="DOCTOR"
        permissions={['plan:read', 'plan:write']}
      />,
    )

    expect(await screen.findByText('Lumbar Spine Rehab Package')).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 10 sessions \(20%\)/)).toBeInTheDocument()
    expect(await screen.findByText(/VAS Pain Trend Across Sessions/i)).toBeInTheDocument()
    expect(screen.getByText('Session #1')).toBeInTheDocument()
    expect(screen.getByText('VAS: 7/10')).toBeInTheDocument()
    expect(screen.getByText('VAS: 4/10')).toBeInTheDocument()
    expect(screen.getByText('Pain reduced significantly after session 2.')).toBeInTheDocument()
  })

  it.each(['RECEPTION', 'ADMIN'] as const)(
    'renders safe non-clinical timeline for %s without calling clinical plan or session endpoints',
    async (role) => {
      const fetchedUrls: string[] = []
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url)
        if (url.includes('/api/patients/101/timeline')) {
          return Promise.resolve(jsonResponse(sampleTimeline))
        }
        return Promise.reject(new Error(`Unhandled fetch: ${url}`))
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWithProviders(
        <PatientTreatmentPlansTab patientId={101} role={role} permissions={['timeline:read']} />,
      )

      expect(await screen.findByText('Package: Lumbar Spine Rehab Package')).toBeInTheDocument()
      expect(screen.queryByText(/VAS Pain Trend Across Sessions/i)).not.toBeInTheDocument()
      expect(
        screen.queryByText('Pain reduced significantly after session 2.'),
      ).not.toBeInTheDocument()
      expect(fetchedUrls.some((u) => u.includes('/treatment-plans'))).toBe(false)
      expect(fetchedUrls.some((u) => u.includes('/sessions'))).toBe(false)
    },
  )
})

describe('PatientOverviewTab Longitudinal Conditions (Problem List)', () => {
  const samplePatient: PatientOut = {
    id: 101,
    urn: 'KH-2026-0101',
    full_name: 'Aarav Kumar',
    guardian_name: 'Suresh Kumar',
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
    allergies: 'None',
    notes: '',
    photo_path: null,
    is_active: true,
    is_archived: false,
    merged_into_id: null,
    version_id: 1,
    created_at: '2026-01-10T09:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
  }

  it('allows DOCTOR to view, add, and update condition status with optimistic version_id', async () => {
    const user = userEvent.setup()
    let patchBody: Record<string, unknown> | null = null
    let conditions: PatientConditionOut[] = [
      {
        id: 12,
        patient_id: 101,
        doctor_id: 1,
        doctor_name: 'Dr. Madan Mohan Dwivedi',
        condition_name: 'Lumbar radiculopathy',
        icd10_code: 'M54.16',
        status: 'ACTIVE',
        onset_date: '2026-10-01',
        resolved_date: null,
        notes: 'Chronic',
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:00:00Z',
        version_id: 2,
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/allergies')) {
        return Promise.resolve(jsonResponse([]))
      }
      if (url.includes('/api/patients/101/conditions/12') && init?.method === 'PATCH') {
        patchBody = JSON.parse(String(init.body)) as Record<string, unknown>
        conditions = conditions.map((c) =>
          c.id === 12
            ? {
                ...c,
                status: (patchBody?.status as PatientConditionOut['status']) ?? c.status,
                version_id: c.version_id + 1,
              }
            : c,
        )
        return Promise.resolve(jsonResponse(conditions[0]))
      }
      if (url.includes('/api/patients/101/conditions') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        const created: PatientConditionOut = {
          id: 13,
          patient_id: 101,
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          condition_name: String(body.condition_name),
          icd10_code: (body.icd10_code as string | null) ?? null,
          status: (body.status as PatientConditionOut['status']) ?? 'ACTIVE',
          onset_date: (body.onset_date as string | null) ?? null,
          resolved_date: (body.resolved_date as string | null) ?? null,
          notes: (body.notes as string | null) ?? null,
          created_at: '2026-11-10T10:00:00Z',
          updated_at: '2026-11-10T10:00:00Z',
          version_id: 1,
        }
        conditions = [created, ...conditions]
        return Promise.resolve(jsonResponse(created, 201))
      }
      if (url.includes('/api/patients/101/conditions')) {
        return Promise.resolve(jsonResponse(conditions))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientOverviewTab
        patient={samplePatient}
        role="DOCTOR"
        permissions={['encounter:read', 'encounter:write', 'allergy:read']}
        currentDoctorId={1}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: /Longitudinal Conditions \(Problem List\)/i }),
    ).toBeInTheDocument()
    expect(await screen.findByText('Lumbar radiculopathy')).toBeInTheDocument()
    expect(screen.getByText('M54.16')).toBeInTheDocument()

    // Update status inline with optimistic version_id
    const statusSelect = screen.getByLabelText('Status for Lumbar radiculopathy')
    await user.selectOptions(statusSelect, 'RESOLVED')
    await waitFor(() => {
      expect(patchBody).toEqual({ version_id: 2, status: 'RESOLVED' })
    })

    // Add a new condition
    await user.click(screen.getByRole('button', { name: /Add Condition/i }))
    await user.type(await screen.findByLabelText(/Condition Name/i), 'Type 2 diabetes mellitus')
    await user.type(screen.getByLabelText(/ICD-10 Code/i), 'E11.9')
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /Add Condition/i }))

    expect(await screen.findByText('Type 2 diabetes mellitus')).toBeInTheDocument()
    expect(screen.getByText('E11.9')).toBeInTheDocument()
  })

  it.each(['RECEPTION', 'ADMIN'] as const)(
    'hides Longitudinal Conditions and never queries /conditions for %s',
    async (role) => {
      const fetchedUrls: string[] = []
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        fetchedUrls.push(url)
        return Promise.resolve(jsonResponse([]))
      })
      vi.stubGlobal('fetch', mockFetch)

      renderWithProviders(
        <PatientOverviewTab patient={samplePatient} role={role} permissions={['patient:read']} />,
      )

      expect(
        screen.queryByRole('heading', { name: /Longitudinal Conditions/i }),
      ).not.toBeInTheDocument()
      expect(fetchedUrls.some((u) => u.includes('/conditions'))).toBe(false)
    },
  )

  it('renders other-doctor conditions as read-only while keeping own-doctor conditions editable', async () => {
    const mixedConditions: PatientConditionOut[] = [
      {
        id: 12,
        patient_id: 101,
        doctor_id: 1,
        doctor_name: 'Dr. Madan Mohan Dwivedi',
        condition_name: 'Lumbar radiculopathy',
        icd10_code: 'M54.16',
        status: 'ACTIVE',
        onset_date: '2026-10-01',
        resolved_date: null,
        notes: 'Recorded by Doctor A',
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:00:00Z',
        version_id: 2,
      },
      {
        id: 13,
        patient_id: 101,
        doctor_id: 2,
        doctor_name: 'Dr. Ananya Verma',
        condition_name: 'Primary open-angle glaucoma',
        icd10_code: 'H40.11',
        status: 'ACTIVE',
        onset_date: '2026-11-01',
        resolved_date: null,
        notes: 'Recorded by Doctor B',
        created_at: '2026-11-01T09:00:00Z',
        updated_at: '2026-11-01T09:00:00Z',
        version_id: 1,
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/allergies')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/api/patients/101/conditions')) {
        return Promise.resolve(jsonResponse(mixedConditions))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientOverviewTab
        patient={samplePatient}
        role="DOCTOR"
        permissions={['encounter:read', 'encounter:write', 'allergy:read']}
        currentDoctorId={2}
      />,
    )

    expect(await screen.findByText('Lumbar radiculopathy')).toBeInTheDocument()
    expect(screen.getByText('Primary open-angle glaucoma')).toBeInTheDocument()

    // Doctor A's condition must NOT expose inline status select or Edit button to Doctor B
    expect(screen.queryByLabelText('Status for Lumbar radiculopathy')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit condition Lumbar radiculopathy' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('Read-only')).toBeInTheDocument()

    // Doctor B's own condition MUST remain editable
    expect(screen.getByLabelText('Status for Primary open-angle glaucoma')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Edit condition Primary open-angle glaucoma' }),
    ).toBeInTheDocument()
  })

  it('fails closed when currentDoctorId is null: all conditions remain read-only even with write permissions', async () => {
    const mixedConditions: PatientConditionOut[] = [
      {
        id: 12,
        patient_id: 101,
        doctor_id: 1,
        doctor_name: 'Dr. Madan Mohan Dwivedi',
        condition_name: 'Lumbar radiculopathy',
        icd10_code: 'M54.16',
        status: 'ACTIVE',
        onset_date: '2026-10-01',
        resolved_date: null,
        notes: 'Recorded by Doctor A',
        created_at: '2026-10-01T09:00:00Z',
        updated_at: '2026-10-01T09:00:00Z',
        version_id: 2,
      },
      {
        id: 13,
        patient_id: 101,
        doctor_id: 2,
        doctor_name: 'Dr. Ananya Verma',
        condition_name: 'Primary open-angle glaucoma',
        icd10_code: 'H40.11',
        status: 'ACTIVE',
        onset_date: '2026-11-01',
        resolved_date: null,
        notes: 'Recorded by Doctor B',
        created_at: '2026-11-01T09:00:00Z',
        updated_at: '2026-11-01T09:00:00Z',
        version_id: 1,
      },
    ]

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/allergies')) return Promise.resolve(jsonResponse([]))
      if (url.includes('/api/patients/101/conditions')) {
        return Promise.resolve(jsonResponse(mixedConditions))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientOverviewTab
        patient={samplePatient}
        role="DOCTOR"
        permissions={['encounter:read', 'encounter:write', 'allergy:read']}
        currentDoctorId={null}
      />,
    )

    expect(await screen.findByText('Lumbar radiculopathy')).toBeInTheDocument()
    expect(screen.getByText('Primary open-angle glaucoma')).toBeInTheDocument()

    // When currentDoctorId is null, neither condition is editable
    expect(screen.queryByLabelText('Status for Lumbar radiculopathy')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit condition Lumbar radiculopathy' }),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status for Primary open-angle glaucoma')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Edit condition Primary open-angle glaucoma' }),
    ).not.toBeInTheDocument()
    const readOnlyBadges = screen.getAllByText('Read-only')
    expect(readOnlyBadges).toHaveLength(2)
  })
})
