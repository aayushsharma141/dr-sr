import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import type {
  InvestigationOrderOut,
  InvestigationResultOut,
  Me,
  PatientDocumentOut,
  PatientOut,
} from '../../api/types'
import { PatientDetail } from '../../pages/PatientDetail'
import { PatientDocumentsTab } from '../patient/PatientDocumentsTab'
import { PatientInvestigationsTab } from '../patient/PatientInvestigationsTab'

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

function binaryRes(contentType: string, filename: string, content = 'file-bytes') {
  const blob = new Blob([content], { type: contentType })
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

const adminDoc: PatientDocumentOut = {
  id: 10,
  patient_id: 101,
  visit_id: null,
  visit_code: null,
  encounter_id: null,
  encounter_code: null,
  title: 'Aadhaar ID Copy',
  category: 'ID_PROOF',
  is_clinical: false,
  original_filename: 'aadhaar.jpg',
  mime_type: 'image/jpeg',
  file_size_bytes: 120_400,
  sha256_hex: 'aaa111',
  notes: 'Verified at front desk',
  uploaded_by_user_id: 2,
  uploaded_by_username: 'reception',
  doctor_id: null,
  is_archived: false,
  archived_at: null,
  archived_by_user_id: null,
  created_at: '2026-11-10T09:00:00Z',
}

const ownClinicalPdf: PatientDocumentOut = {
  id: 11,
  patient_id: 101,
  visit_id: 501,
  visit_code: 'VIS-26-000501',
  encounter_id: 41,
  encounter_code: 'ENC-26-000041',
  title: 'CBC Lab Report',
  category: 'LAB_REPORT',
  is_clinical: true,
  original_filename: 'cbc-report.pdf',
  mime_type: 'application/pdf',
  file_size_bytes: 245_760,
  sha256_hex: 'bbb222',
  notes: 'External lab PDF',
  uploaded_by_user_id: 3,
  uploaded_by_username: 'dr_dwivedi',
  doctor_id: 1,
  is_archived: false,
  archived_at: null,
  archived_by_user_id: null,
  created_at: '2026-11-10T11:00:00Z',
}

const otherDoctorClinicalDoc: PatientDocumentOut = {
  id: 12,
  patient_id: 101,
  visit_id: 501,
  visit_code: 'VIS-26-000501',
  encounter_id: 49,
  encounter_code: 'ENC-26-000049',
  title: 'Cardiology ECG Scan',
  category: 'IMAGING',
  is_clinical: true,
  original_filename: 'ecg-scan.png',
  mime_type: 'image/png',
  file_size_bytes: 310_000,
  sha256_hex: 'ccc333',
  notes: null,
  uploaded_by_user_id: 9,
  uploaded_by_username: 'dr_sharma',
  doctor_id: 2,
  is_archived: false,
  archived_at: null,
  archived_by_user_id: null,
  created_at: '2026-11-10T12:00:00Z',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PatientDocumentsTab', () => {
  it('excludes clinical categories from RECEPTION Upload modal and forces is_clinical=false', async () => {
    const user = userEvent.setup()
    let capturedFormData: FormData | null = null

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/documents') && init?.method === 'POST') {
        capturedFormData = init.body as FormData
        return Promise.resolve(
          jsonRes(
            {
              ...adminDoc,
              id: 20,
              title: String(capturedFormData.get('title')),
              category: String(capturedFormData.get('category')),
              is_clinical: false,
              original_filename: 'referral-letter.pdf',
              mime_type: 'application/pdf',
            },
            201,
          ),
        )
      }
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes([adminDoc]))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientDocumentsTab
        patientId={101}
        role="RECEPTION"
        permissions={['document:read', 'document:write']}
        currentUserId={2}
      />,
    )

    expect(await screen.findByText('Aadhaar ID Copy')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Upload Document/i }))
    const dialog = await screen.findByRole('dialog')
    const categorySelect = within(dialog).getByLabelText(/Category/i) as HTMLSelectElement
    const optionValues = Array.from(categorySelect.options).map((o) => o.value)

    expect(optionValues).toEqual(['REFERRAL', 'ID_PROOF', 'INSURANCE', 'OTHER'])
    expect(optionValues).not.toContain('LAB_REPORT')
    expect(optionValues).not.toContain('IMAGING')
    expect(optionValues).not.toContain('PRESCRIPTION_SCAN')
    expect(optionValues).not.toContain('DISCHARGE_SUMMARY')
    expect(within(dialog).queryByLabelText(/Mark as clinical/i)).not.toBeInTheDocument()

    const fileInput = within(dialog).getByLabelText(/File \(PDF, JPEG, PNG/i)
    const pdfFile = new File(['%PDF-1.4 sample'], 'referral-letter.pdf', {
      type: 'application/pdf',
    })
    await user.upload(fileInput, pdfFile)
    expect(within(dialog).getByText(/Selected: referral-letter\.pdf/i)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Document Title/i)).toHaveValue('referral letter')

    const form = dialog.querySelector('form')
    expect(form).not.toBeNull()
    fireEvent.submit(form!)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/patients/101/documents',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    expect(capturedFormData).not.toBeNull()
    expect(capturedFormData!.get('category')).toBe('REFERRAL')
    expect(capturedFormData!.get('is_clinical')).toBe('false')
  })

  it('shows all 8 categories and clinical docs for DOCTOR and locks is_clinical for clinical categories', async () => {
    const user = userEvent.setup()
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes([ownClinicalPdf, otherDoctorClinicalDoc, adminDoc]))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientDocumentsTab
        patientId={101}
        role="DOCTOR"
        permissions={['document:read', 'document:write']}
        currentUserId={3}
        currentDoctorId={1}
      />,
    )

    expect(await screen.findByText('CBC Lab Report')).toBeInTheDocument()
    expect(screen.getByText('Cardiology ECG Scan')).toBeInTheDocument()
    expect(screen.getByText('Aadhaar ID Copy')).toBeInTheDocument()
    expect(screen.getAllByText('Clinical').length).toBe(2)

    await user.click(screen.getByRole('button', { name: /Upload Document/i }))
    const dialog = await screen.findByRole('dialog')
    const categorySelect = within(dialog).getByLabelText(/Category/i) as HTMLSelectElement
    const optionValues = Array.from(categorySelect.options).map((o) => o.value)

    expect(optionValues).toEqual([
      'LAB_REPORT',
      'IMAGING',
      'PRESCRIPTION_SCAN',
      'DISCHARGE_SUMMARY',
      'REFERRAL',
      'ID_PROOF',
      'INSURANCE',
      'OTHER',
    ])

    const clinicalCheckbox = within(dialog).getByLabelText(/Mark as clinical/i)
    expect(clinicalCheckbox).toBeChecked()
    expect(clinicalCheckbox).toBeDisabled()
  })

  it('previews JPEG/PNG inside <Modal> with <img> (zero <iframe>, revokes URL on close) and opens PDF in new tab', async () => {
    const user = userEvent.setup()
    let blobCounter = 0
    const createObjectUrl = vi.fn().mockImplementation(() => `blob:http://localhost/doc-${++blobCounter}`)
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    })
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window)

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/documents/10/download')) {
        return Promise.resolve(binaryRes('image/jpeg', 'aadhaar.jpg'))
      }
      if (url.includes('/api/documents/11/download')) {
        return Promise.resolve(binaryRes('application/pdf', 'cbc-report.pdf'))
      }
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes([adminDoc, ownClinicalPdf]))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientDocumentsTab
        patientId={101}
        role="DOCTOR"
        permissions={['document:read', 'document:write']}
        currentUserId={3}
        currentDoctorId={1}
      />,
    )

    expect(await screen.findByText('Aadhaar ID Copy')).toBeInTheDocument()

    // 1. JPEG image preview renders <img> inside <Modal>, zero <iframe>
    await user.click(screen.getByRole('button', { name: /Preview/i }))
    const img = await screen.findByRole('img', { name: 'Aadhaar ID Copy' })
    expect(img).toHaveAttribute('src', 'blob:http://localhost/doc-1')
    expect(document.querySelector('iframe')).toBeNull()

    await user.click(screen.getAllByRole('button', { name: /^Close$/i })[0])
    await waitFor(() => {
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:http://localhost/doc-1')
    })

    // 2. PDF opens via window.open with noopener,noreferrer and zero <iframe>
    await user.click(screen.getByRole('button', { name: /Open PDF/i }))
    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        'blob:http://localhost/doc-2',
        '_blank',
        'noopener,noreferrer',
      )
    })
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('archives via native <Modal> (zero window.confirm) and hides Archive on another doctor clinical doc', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm')
    let archivedDocId: number | null = null
    let docs = [ownClinicalPdf, otherDoctorClinicalDoc]

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/documents/11/archive') && init?.method === 'POST') {
        archivedDocId = 11
        docs = docs.filter((d) => d.id !== 11)
        return Promise.resolve(jsonRes({ ...ownClinicalPdf, is_archived: true }))
      }
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes(docs))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(
      <PatientDocumentsTab
        patientId={101}
        role="DOCTOR"
        permissions={['document:read', 'document:write']}
        currentUserId={3}
        currentDoctorId={1}
      />,
    )

    expect(await screen.findByText('CBC Lab Report')).toBeInTheDocument()
    expect(screen.getByText('Cardiology ECG Scan')).toBeInTheDocument()

    // Own clinical doc has Archive button; another doctor's clinical doc strictly hides Archive
    expect(screen.getByRole('button', { name: 'Archive CBC Lab Report' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Archive Cardiology ECG Scan' }),
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Archive CBC Lab Report' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Archive Document' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Archive Document' }))

    await waitFor(() => {
      expect(archivedDocId).toBe(11)
    })
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(await screen.findByText(/Archived "CBC Lab Report"/i)).toBeInTheDocument()
  })
})

describe('T4.7 Wiring: PatientDetail Documents tab & PatientInvestigationsTab report linkage', () => {
  it('wires PatientDocumentsTab into PatientDetail when Documents tab is selected', async () => {
    const user = userEvent.setup()
    const doctorMe: Me = {
      id: 3,
      username: 'dr_dwivedi',
      full_name: 'Dr. Madan Mohan Dwivedi',
      role: 'DOCTOR',
      doctor_id: 1,
      permissions: ['patient:read', 'document:read', 'document:write', 'encounter:read'],
      must_change_password: false,
      csrf_token: 'csrf-doc',
      version_id: 1,
    }
    const patient: PatientOut = {
      id: 101,
      urn: 'KH-2026-0101',
      full_name: 'Aarav Kumar',
      guardian_name: 'Suresh Kumar',
      gender: 'M',
      dob: '1996-05-14',
      age_years: 30,
      mobile: '9876543210',
      address: 'Station Road, Ara',
      district: 'Bhojpur',
      state: 'Bihar',
      emergency_contact: null,
      allergies: 'None',
      notes: null,
      photo_path: null,
      is_active: true,
      is_archived: false,
      merged_into_id: null,
      version_id: 1,
      created_at: '2026-01-10T09:00:00Z',
      updated_at: '2026-01-15T10:00:00Z',
    }

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) return Promise.resolve(jsonRes(doctorMe))
      if (url.includes('/api/patients/101/summary')) {
        return Promise.resolve(
          jsonRes({
            patient_id: 101,
            urn: 'KH-2026-0101',
            total_visits: 1,
            active_treatment_plans: 0,
            latest_visit: null,
            allergy_alert: null,
            active_allergies: [],
            prescriptions_count: 0,
            active_conditions_count: 0,
            latest_encounter: null,
            total_billed_paise: null,
            total_paid_paise: null,
            total_refunded_paise: null,
            outstanding_paise: null,
          }),
        )
      }
      if (url.includes('/api/patients/101/allergies')) return Promise.resolve(jsonRes([]))
      if (url.includes('/api/patients/101/conditions')) return Promise.resolve(jsonRes([]))
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes([ownClinicalPdf]))
      }
      if (url.includes('/api/patients/101')) return Promise.resolve(jsonRes(patient))
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/reception/patients/101']}>
          <Routes>
            <Route path="/reception/patients/:id" element={<PatientDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await user.click(await screen.findByRole('tab', { name: 'Documents' }))
    expect(await screen.findByText('CBC Lab Report')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upload Document/i })).toBeInTheDocument()
  })

  it('opens linked investigation report via CSP-safe blob preview and supports linking document_id when recording a result', async () => {
    const user = userEvent.setup()
    const createObjectUrl = vi.fn().mockReturnValue('blob:http://localhost/ecg-12')
    const revokeObjectUrl = vi.fn()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: createObjectUrl,
      revokeObjectURL: revokeObjectUrl,
    })

    let capturedResultBody: Record<string, unknown> | null = null
    let order: InvestigationOrderOut = {
      id: 71,
      encounter_id: 41,
      encounter_code: 'ENC-26-000041',
      patient_id: 101,
      doctor_id: 1,
      doctor_name: 'Madan Mohan Dwivedi',
      category: 'IMAGING',
      test_name: 'Chest X-Ray',
      instructions: 'PA view',
      priority: 'ROUTINE',
      status: 'SAMPLE_COLLECTED',
      cancelled_reason: null,
      ordered_at: '2026-11-10T10:50:00Z',
      updated_at: '2026-11-10T10:50:00Z',
      version_id: 1,
      results: [
        {
          id: 900,
          order_id: 71,
          patient_id: 101,
          document_id: 12,
          document_title: 'Cardiology ECG Scan',
          summary_text: 'Baseline film uploaded',
          result_value: null,
          unit: null,
          reference_range: null,
          is_abnormal: false,
          reported_at: '2026-11-10T11:30:00Z',
          recorded_by_user_id: 3,
          recorded_by_username: 'dr_dwivedi',
          created_at: '2026-11-10T11:30:00Z',
        },
      ],
    }

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/patients/101/investigations')) {
        return Promise.resolve(jsonRes([order]))
      }
      if (url.includes('/api/patients/101/documents')) {
        return Promise.resolve(jsonRes([ownClinicalPdf, otherDoctorClinicalDoc]))
      }
      if (url.includes('/api/documents/12/download')) {
        return Promise.resolve(binaryRes('image/png', 'ecg-scan.png'))
      }
      if (url.includes('/api/investigations/71/results') && init?.method === 'POST') {
        capturedResultBody = JSON.parse(String(init.body)) as Record<string, unknown>
        const created: InvestigationResultOut = {
          id: 901,
          order_id: 71,
          patient_id: 101,
          document_id: (capturedResultBody.document_id as number | null) ?? null,
          document_title: 'CBC Lab Report',
          summary_text: String(capturedResultBody.summary_text),
          result_value: null,
          unit: null,
          reference_range: null,
          is_abnormal: false,
          reported_at: '2026-11-10T14:00:00Z',
          recorded_by_user_id: 3,
          recorded_by_username: 'dr_dwivedi',
          created_at: '2026-11-10T14:00:00Z',
        }
        order = { ...order, status: 'COMPLETED', results: [...order.results, created] }
        return Promise.resolve(jsonRes(created, 201))
      }
      return Promise.reject(new Error(`Unhandled fetch: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    renderWithProviders(<PatientInvestigationsTab patientId={101} currentDoctorId={1} />)

    // 1. Clicking View Report on existing result opens CSP-safe image preview without <iframe>
    await user.click(await screen.findByRole('button', { name: /View Report \(Cardiology ECG Scan\)/i }))
    const previewImg = await screen.findByRole('img', { name: 'Cardiology ECG Scan' })
    expect(previewImg).toHaveAttribute('src', 'blob:http://localhost/ecg-12')
    expect(document.querySelector('iframe')).toBeNull()
    await user.click(screen.getAllByRole('button', { name: /^Close$/i })[0])
    await waitFor(() => {
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:http://localhost/ecg-12')
    })

    // 2. Recording a result with an attached patient document sends document_id
    await user.click(screen.getByRole('button', { name: /Record Result/i }))
    await user.type(await screen.findByLabelText(/Result Summary \/ Findings/i), 'Clear lung fields')
    const docSelect = await screen.findByLabelText(/Linked Report Document/i)
    await waitFor(() => {
      expect(within(docSelect).getByRole('option', { name: /CBC Lab Report/i })).toBeInTheDocument()
    })
    await user.selectOptions(docSelect, '11')
    await user.click(screen.getByRole('button', { name: /Save Result/i }))

    await waitFor(() => {
      expect(capturedResultBody).toMatchObject({
        summary_text: 'Clear lung fields',
        document_id: 11,
      })
    })
  })
})
