import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import type { VisitBillOut } from '../../api/bill'
import type { Me, VisitWorkspaceOut } from '../../api/types'
import { VisitWorkspacePage } from '../VisitWorkspacePage'

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function binaryRes(contentType: string, filename: string, bytes = 'binary-data') {
  const blob = new Blob([bytes], { type: contentType })
  return {
    ok: true,
    status: 200,
    headers: new Headers({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    }),
    blob: () => Promise.resolve(blob),
  }
}

const doctorMe: Me = {
  id: 3,
  username: 'dr_dwivedi',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  permissions: [
    'patient:read',
    'visit:read',
    'encounter:read',
    'encounter:write',
    'prescription:read',
    'plan:read',
    'document:read',
    'document:write',
    'bill:clinical',
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
    'visit:read',
    'payment:read',
    'payment:create',
    'receipt:reprint',
    'bill:write',
    'document:read',
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
    'visit:read',
    'payment:read',
    'receipt:reprint',
    'bill:adjust',
    'audit:read',
    'document:read',
  ],
  must_change_password: false,
  csrf_token: 'csrf-adm',
  version_id: 1,
}

const doctorWorkspace: VisitWorkspaceOut = {
  patient: {
    patient_id: 101,
    urn: 'KH-2026-0101',
    full_name: 'Aarav Kumar',
    computed_age_years: 30,
    gender: 'M',
    mobile: '9876543210',
    is_active: true,
    is_archived: false,
    merged_into_id: null,
    merged_into_urn: null,
    allergy_alert: {
      has_allergies: true,
      count: 1,
      highest_severity: 'SEVERE',
      alert_labels: ['Penicillin'],
    },
  },
  visit: {
    visit_id: 501,
    visit_code: 'VIS-26-000501',
    visit_date: '2026-11-10',
    status: 'OPEN',
    referral_source: 'DOCTOR',
    referrer_name: 'Dr. R. K. Verma',
    token_numbers: [4],
  },
  consultations: [
    {
      appointment_id: 801,
      token_number: 4,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      department_name: 'Orthopaedics',
      consultation_status: 'COMPLETED',
      visit_kind: 'NEW',
      priority_level: 'NORMAL',
      encounter_id: 41,
      encounter_code: 'ENC-26-000041',
      is_finalised: true,
      vitals: {
        id: 12,
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
      },
      symptoms: 'Radiating lower back pain for 10 days',
      clinical_notes: 'SLR positive on left at 45 degrees.',
      diagnosis: 'Lumbar radiculopathy',
      template_response_summary: {
        template_code: 'ORTHO_SPINE',
        template_name_en: 'Orthopaedic Spine Assessment',
        template_version_id: 2,
        version_number: 1,
        response_data: { affected_level: 'L4-L5', slr_test: 'Positive Left' },
        updated_at: '2026-11-10T10:40:00Z',
      },
      diagnoses: [
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
          notes: 'Left L4-L5',
          patient_condition_id: 12,
          created_at: '2026-11-10T10:40:00Z',
          updated_at: '2026-11-10T10:40:00Z',
        },
      ],
      investigations: [
        {
          id: 71,
          encounter_id: 41,
          encounter_code: 'ENC-26-000041',
          patient_id: 101,
          doctor_id: 1,
          doctor_name: 'Madan Mohan Dwivedi',
          category: 'IMAGING',
          test_name: 'MRI Lumbar Spine',
          instructions: 'With sagittal T2 view',
          priority: 'URGENT',
          status: 'COMPLETED',
          cancelled_reason: null,
          ordered_at: '2026-11-10T10:45:00Z',
          updated_at: '2026-11-10T12:00:00Z',
          version_id: 2,
          results: [
            {
              id: 901,
              order_id: 71,
              patient_id: 101,
              document_id: 55,
              document_title: 'MRI Film Scan',
              summary_text: 'Mild disc bulge at L4-L5 with left nerve root indentation',
              result_value: 'L4-L5',
              unit: null,
              reference_range: null,
              is_abnormal: true,
              reported_at: '2026-11-10T12:00:00Z',
              recorded_by_user_id: 3,
              recorded_by_username: 'dr_dwivedi',
              created_at: '2026-11-10T12:00:00Z',
            },
          ],
        },
      ],
      prescriptions: [
        {
          id: 42,
          patient_id: 101,
          patient_urn: 'KH-2026-0101',
          patient_name: 'Aarav Kumar',
          patient_mobile: '9876543210',
          patient_address: 'Station Road, Ara',
          doctor_id: 1,
          doctor_name: 'Dr. Madan Mohan Dwivedi',
          encounter_id: 41,
          status: 'AUTHORISED',
          revision_number: 1,
          supersedes_prescription_id: null,
          amendment_reason: null,
          is_printable: true,
          cancellation_reason: null,
          diagnosis: 'Lumbar radiculopathy',
          dietary_advice: 'Warm fluids',
          general_advice: 'Avoid heavy lifting',
          follow_up_date: '2026-11-24',
          version_id: 1,
          created_at: '2026-11-10T11:00:00Z',
          updated_at: '2026-11-10T11:00:00Z',
          items: [
            {
              id: 201,
              prescription_id: 42,
              item_order: 1,
              medicine_name: 'Gabapentin',
              strength: '300mg',
              form: 'Tablet',
              route: 'Oral',
              dosage: '1 tab',
              frequency: 'HS',
              duration_days: 10,
              instructions: 'At bedtime',
            },
          ],
        },
      ],
      treatment_plans: [
        {
          id: 9,
          patient_id: 101,
          patient_urn: 'KH-2026-0101',
          patient_name: 'Aarav Kumar',
          doctor_id: 1,
          doctor_name: 'Madan Mohan Dwivedi',
          encounter_id: 41,
          plan_name: 'Lumbar Spine Rehab Package',
          condition_diagnosis: 'Lumbar radiculopathy',
          referred_by: 'Dr. R. K. Verma',
          total_sessions: 10,
          completed_sessions: 2,
          agreed_price_paise: 500000,
          status: 'ACTIVE',
          cancellation_reason: null,
          version_id: 1,
          created_at: '2026-11-10T11:10:00Z',
          updated_at: '2026-11-10T11:10:00Z',
        },
      ],
      follow_up: null,
      addenda: [
        {
          id: 7,
          encounter_id: 41,
          doctor_id: 1,
          doctor_name: 'Madan Mohan Dwivedi',
          addendum_text: 'Reviewed MRI scan with patient; continue conservative therapy.',
          created_at: '2026-11-11T09:00:00Z',
        },
      ],
      clinical_charges: [
        {
          id: 601,
          category: 'CONSULTATION',
          source: 'SYSTEM',
          status: 'ACTIVE',
          description: 'Orthopaedics Consultation Fee',
          unit: null,
          quantity: 1,
          rate_paise: 50000,
          amount_paise: 50000,
          treatment_plan_id: null,
        },
      ],
    },
  ],
  financial_summary: null,
}

const sampleVisitBill: VisitBillOut = {
  visit_id: 501,
  patient_id: 101,
  patient_urn: 'KH-2026-0101',
  patient_name: 'Aarav Kumar',
  status: 'OPEN',
  visit_date: '2026-11-10',
  closed_at: null,
  close_reason: null,
  locked: false,
  sections: [
    {
      category: 'CONSULTATION',
      subtotal_paise: 50000,
      lines: [
        {
          id: 601,
          visit_id: 501,
          appointment_id: 801,
          category: 'CONSULTATION',
          source: 'SYSTEM',
          description: 'Orthopaedics Consultation Fee',
          unit: null,
          quantity: 1,
          rate_paise: 50000,
          amount_paise: 50000,
          original_amount_paise: 50000,
          status: 'ACTIVE',
          counts_toward_total: true,
          prescription_item_id: null,
          created_by_user_id: 2,
          created_by_username: 'reception',
          created_at: '2026-11-10T10:00:00Z',
          history: [],
        },
      ],
    },
  ],
  bill_total_paise: 50000,
  paid_paise: 50000,
  due_paise: 0,
  payments: [
    {
      id: 31,
      visit_id: 501,
      appointment_id: 801,
      receipt_number: 'RCP-2026-0031',
      amount_paise: 50000,
      payment_method: 'CASH',
      is_reversed: false,
      created_at: '2026-11-10T10:05:00Z',
      created_by_username: 'reception',
    },
  ],
  voided_lines: [],
  previous_dues: [],
  previous_dues_total_paise: 0,
  packages: [],
}

function adminOrReceptionWorkspace(role: 'RECEPTION' | 'ADMIN'): VisitWorkspaceOut {
  return {
    patient: {
      ...doctorWorkspace.patient,
      allergy_alert:
        role === 'RECEPTION'
          ? {
              has_allergies: true,
              count: 1,
              highest_severity: 'SEVERE',
              alert_labels: ['Penicillin'],
            }
          : null,
    },
    visit: doctorWorkspace.visit,
    consultations: [
      {
        appointment_id: 801,
        token_number: 4,
        doctor_id: 1,
        doctor_name: 'Madan Mohan Dwivedi',
        department_name: 'Orthopaedics',
        consultation_status: 'COMPLETED',
        visit_kind: 'NEW',
        priority_level: 'NORMAL',
        encounter_id: null,
        encounter_code: null,
        is_finalised: null,
        vitals: null,
        symptoms: null,
        clinical_notes: null,
        diagnosis: null,
        template_response_summary: null,
        diagnoses: null,
        investigations: null,
        prescriptions: null,
        treatment_plans: null,
        follow_up: null,
        addenda: null,
        clinical_charges: null,
      },
    ],
    financial_summary: {
      bill_total_paise: 50000,
      paid_paise: 50000,
      refunded_paise: 0,
      due_paise: 0,
      payment_status: 'PAID',
      payments: sampleVisitBill.payments,
      refunds: [],
    },
  }
}

function renderVisitWorkspace(
  me: Me,
  workspace: VisitWorkspaceOut,
  extraFetch?: (url: string) => Promise<unknown> | null,
) {
  const fetchedUrls: string[] = []
  const mockFetch = vi.fn().mockImplementation((url: string) => {
    fetchedUrls.push(url)
    if (extraFetch) {
      const handled = extraFetch(url)
      if (handled) return handled
    }
    if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(me))
    if (url.includes('/api/patients/101/visits/501/workspace')) {
      return Promise.resolve(jsonRes(workspace))
    }
    if (url.includes('/api/visits/501/bill')) {
      return Promise.resolve(jsonRes(sampleVisitBill))
    }
    if (url.includes('/api/settings/clinic')) {
      return Promise.resolve(jsonRes({ name_en: 'Kalyan Hospital' }))
    }
    return Promise.reject(new Error(`Unhandled fetch: ${url}`))
  })
  vi.stubGlobal('fetch', mockFetch)

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/patients/101/visits/501']}>
        <Routes>
          <Route path="/patients/:id/visits/:visitId" element={<VisitWorkspacePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )

  return { fetchedUrls, mockFetch }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('VisitWorkspacePage (/patients/:id/visits/:visitId)', () => {
  it('renders full clinical sections, report preview, PrescriptionPrint, authoring link & own charges for DOCTOR with ZERO payment collection controls', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi.fn().mockReturnValue('blob:http://localhost/mri-film-55')
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    })

    const { fetchedUrls } = renderVisitWorkspace(doctorMe, doctorWorkspace, (url) => {
      if (url.includes('/api/documents/55/download')) {
        return Promise.resolve(binaryRes('image/jpeg', 'mri-film.jpg'))
      }
      return null
    })

    // Patient strip + Visit header
    expect(await screen.findByText('VIS-26-000501')).toBeInTheDocument()
    expect(screen.getByText('KH-2026-0101')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Aarav Kumar' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Active clinical allergies' })).toBeInTheDocument()
    expect(screen.getByText('Penicillin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Patient Record/i })).toHaveAttribute(
      'href',
      '/reception/patients/101?tab=visits',
    )

    // Clinical consultation sections: encounter code, authoring link, vitals, structured ICD-10 diagnoses, template, investigations, Rx, addenda, own clinical charges
    expect(screen.getByText('ENC-26-000041')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Authoring Workspace/i })).toHaveAttribute(
      'href',
      '/doctor/encounters/41',
    )
    expect(screen.getByText('Radiating lower back pain for 10 days')).toBeInTheDocument()
    expect(screen.getByText('SLR positive on left at 45 degrees.')).toBeInTheDocument()
    expect(screen.getByText('M54.16')).toBeInTheDocument()
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    expect(screen.getByText(/Orthopaedic Spine Assessment/i)).toBeInTheDocument()
    expect(screen.getByText('MRI Lumbar Spine')).toBeInTheDocument()
    expect(screen.getByText(/Gabapentin/)).toBeInTheDocument()
    expect(
      screen.getByText('Reviewed MRI scan with patient; continue conservative therapy.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Orthopaedics Consultation Fee')).toBeInTheDocument()

    // Vitals rendered read-only (no editable inputs with save actions)
    expect(screen.getByText(/Vital Signs & Biometrics/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue('124')).toBeDisabled()

    // ZERO payment collection controls or BillPanel for DOCTOR (AGENTS.md #7)
    expect(screen.queryByTestId('checkout-summary-strip')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open Billing & Checkout/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Visit Billing & Payments/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Print Receipt/i })).not.toBeInTheDocument()
    expect(fetchedUrls.some((u) => u.includes('/api/visits/501/bill'))).toBe(false)

    // CSP-safe report preview (<img> in <Modal>, zero <iframe>, revokes URL on close)
    await user.click(screen.getByRole('button', { name: /View Report \(MRI Film Scan\)/i }))
    const previewImg = await screen.findByRole('img', { name: 'MRI Film Scan' })
    expect(previewImg).toHaveAttribute('src', 'blob:http://localhost/mri-film-55')
    expect(document.querySelector('iframe')).toBeNull()
    await user.click(screen.getByRole('button', { name: /^Close$/i }))
    await waitFor(() => {
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:http://localhost/mri-film-55')
    })

    // PrescriptionPrint preview modal
    await user.click(screen.getByRole('button', { name: /Preview \/ Print Rx/i }))
    const rxSheet = await screen.findByTestId('prescription-sheet')
    expect(within(rxSheet).getByText('Gabapentin')).toBeInTheDocument()
    expect(within(rxSheet).getByText('KH-2026-0101')).toBeInTheDocument()
  })

  it('renders consultation statuses, BillPanel, payments with ReceiptDialog, Open Billing & Checkout, and safety-only allergy pill with ZERO clinical leakage for RECEPTION', async () => {
    const user = userEvent.setup()
    renderVisitWorkspace(receptionMe, adminOrReceptionWorkspace('RECEPTION'))

    expect(await screen.findByText('VIS-26-000501')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Consultation Status Timeline/i })).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    expect(screen.getByText('Orthopaedics')).toBeInTheDocument()
    expect(screen.getByText('COMPLETED')).toBeInTheDocument()

    // Safety-alert-only allergy pill visible for RECEPTION
    const allergyRegion = screen.getByRole('region', { name: 'Allergy safety alert' })
    expect(within(allergyRegion).getByText('Penicillin')).toBeInTheDocument()

    // BillPanel + Open Billing & Checkout + Payments & ReceiptDialog
    expect(await screen.findByTestId('checkout-summary-strip')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open Billing & Checkout/i })).toHaveAttribute(
      'href',
      '/reception/billing?visit_id=501',
    )
    expect(screen.getAllByText('RCP-2026-0031').length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Print Receipt RCP-2026-0031' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    // Strictly ZERO clinical leakage (D-04)
    expect(screen.queryByText('Radiating lower back pain for 10 days')).not.toBeInTheDocument()
    expect(screen.queryByText('SLR positive on left at 45 degrees.')).not.toBeInTheDocument()
    expect(screen.queryByText('M54.16')).not.toBeInTheDocument()
    expect(screen.queryByText('Lumbar radiculopathy')).not.toBeInTheDocument()
    expect(screen.queryByText('Gabapentin')).not.toBeInTheDocument()
    expect(screen.queryByText('MRI Lumbar Spine')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Open Authoring Workspace/i }),
    ).not.toBeInTheDocument()
  })

  it('renders billing & consultation statuses with ZERO clinical data AND ZERO allergy alert pill for ADMIN', async () => {
    renderVisitWorkspace(adminMe, adminOrReceptionWorkspace('ADMIN'))

    expect(await screen.findByText('VIS-26-000501')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Consultation Status Timeline/i })).toBeInTheDocument()
    expect(screen.getByText('Dr. Madan Mohan Dwivedi')).toBeInTheDocument()
    expect(await screen.findByTestId('checkout-summary-strip')).toBeInTheDocument()
    expect(screen.getAllByText('RCP-2026-0031').length).toBeGreaterThan(0)

    // ADMIN does not see Reception checkout shortcut, clinical data, OR allergy pill
    expect(screen.queryByRole('link', { name: /Open Billing & Checkout/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /allergy/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/Allergy Safety Alert/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Allergy Alert/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Penicillin')).not.toBeInTheDocument()
    expect(screen.queryByText('Lumbar radiculopathy')).not.toBeInTheDocument()
    expect(screen.queryByText('M54.16')).not.toBeInTheDocument()
    expect(screen.queryByText('Gabapentin')).not.toBeInTheDocument()
  })

  it('restricts Preview / Print Rx button to AUTHORISED prescriptions and hides it for DRAFT, CANCELLED, and SUPERSEDED rows', async () => {
    const baseRx = doctorWorkspace.consultations[0].prescriptions![0]
    const mixedRxWorkspace: VisitWorkspaceOut = {
      ...doctorWorkspace,
      consultations: [
        {
          ...doctorWorkspace.consultations[0],
          prescriptions: [
            baseRx,
            { ...baseRx, id: 43, revision_number: 2, status: 'DRAFT', is_printable: false },
            { ...baseRx, id: 44, revision_number: 3, status: 'CANCELLED', is_printable: false },
            { ...baseRx, id: 45, revision_number: 4, status: 'SUPERSEDED', is_printable: false },
          ],
        },
      ],
    }

    renderVisitWorkspace(doctorMe, mixedRxWorkspace)

    expect(await screen.findByText('VIS-26-000501')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Preview \/ Print Rx/i })).toHaveLength(1)
    expect(screen.getByText('Not printable (Draft)')).toBeInTheDocument()
    expect(screen.getByText('Not printable (Cancelled)')).toBeInTheDocument()
    expect(screen.getByText('Not printable (Superseded)')).toBeInTheDocument()
  })
})
