import { render, screen, fireEvent, waitFor, renderHook } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { ReactNode } from 'react'
import '../../test/dialog-shim'
import * as clientModule from '../../api/client'
import { useCreateBackup, useRestoreBackup } from '../../api/queries'
import { PatientExportDialog } from '../../components/admin/PatientExportDialog'
import { DemographicCorrectionModal } from '../../components/admin/DemographicCorrectionModal'
import { PaymentReversalModal } from '../../components/PaymentReversalModal'
import { ImportWizard } from '../../components/admin/ImportWizard'
import { HospitalAssetManager } from '../../components/admin/HospitalAssetManager'
import { BackupManagerPage } from '../admin/BackupManagerPage'
import { Doctors } from '../Doctors'
import { DepartmentsPage } from '../admin/DepartmentsPage'
import type { PatientOut, PaymentOut } from '../../api/types'

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function renderWithProviders(ui: ReactNode, initialEntries: string[] = ['/admin']) {
  const qc = createQueryClient()
  return {
    qc,
    ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={initialEntries}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  }
}

function makeJsonResponse(data: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Internal Server Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as unknown as Response
}

const patientA: PatientOut = {
  id: 101,
  urn: 'KH-26-P-01-00001',
  legacy_urn: null,
  full_name: 'Patient Alpha',
  guardian_name: 'Guardian Alpha',
  gender: 'M',
  dob: '1990-01-01',
  age_years: 36,
  mobile: '9876543210',
  address: 'Main Road',
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const patientB: PatientOut = {
  ...patientA,
  id: 102,
  urn: 'KH-26-P-01-00002',
  full_name: 'Patient Beta',
}

const paymentA: PaymentOut = {
  id: 15,
  receipt_number: 'RCP-2026-0015',
  patient_id: 101,
  patient_urn: 'KH-26-P-01-00001',
  patient_name: 'Patient Alpha',
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
  created_at: '2026-03-01T10:00:00Z',
}

const paymentB: PaymentOut = {
  ...paymentA,
  id: 16,
  receipt_number: 'RCP-2026-0016',
  patient_id: 102,
  patient_name: 'Patient Beta',
}

describe('Admin ops defects regressions (M9, M10, M12, M16-BackupManager, M17, M18)', () => {
  let originalFetch: typeof global.fetch
  let originalCreateObjectURL: typeof window.URL.createObjectURL
  let originalRevokeObjectURL: typeof window.URL.revokeObjectURL

  beforeEach(() => {
    originalFetch = global.fetch
    originalCreateObjectURL = window.URL.createObjectURL
    originalRevokeObjectURL = window.URL.revokeObjectURL
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/test')
    window.URL.revokeObjectURL = vi.fn()
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.URL.createObjectURL = originalCreateObjectURL
    window.URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  // --- M9: Dynamic departments in PatientExportDialog ---
  it('M9: PatientExportDialog loads department options dynamically from API instead of hardcoded 1/2', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/departments')) {
        return Promise.resolve(
          makeJsonResponse([
            { id: 7, name_en: 'Orthopaedics', name_hi: null, is_active: true, version_id: 1 },
            { id: 12, name_en: 'Dental', name_hi: null, is_active: true, version_id: 1 },
          ]),
        )
      }
      return Promise.resolve(makeJsonResponse([]))
    })

    renderWithProviders(<PatientExportDialog open={true} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Orthopaedics' })).toBeInTheDocument()
    })
    expect(screen.getByRole('option', { name: 'Dental' })).toHaveValue('12')
    expect(screen.getByRole('option', { name: 'Orthopaedics' })).toHaveValue('7')
    expect(screen.queryByRole('option', { name: 'Physiotherapy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Ophthalmology' })).not.toBeInTheDocument()
  })

  // --- M10: Stale audit reason resets across modals ---
  it('M10: DemographicCorrectionModal resets audit reason when switching patients or closing', async () => {
    const proposed = {
      full_name: 'Updated Name',
      guardian_name: patientA.guardian_name,
      gender: patientA.gender,
      dob: patientA.dob,
      age_years: patientA.age_years,
      mobile: patientA.mobile,
      address: patientA.address,
      district: patientA.district,
      state: patientA.state,
      emergency_contact: patientA.emergency_contact,
    }

    const onConfirm = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    const { rerender } = render(
      <DemographicCorrectionModal
        open={true}
        patient={patientA}
        proposed={proposed}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    const reasonInput = screen.getByLabelText(/Reason for Demographic Correction/i)
    fireEvent.change(reasonInput, { target: { value: 'Patient A Aadhaar typo fix' } })
    expect(reasonInput).toHaveValue('Patient A Aadhaar typo fix')

    // Close and reopen for Patient B
    rerender(
      <DemographicCorrectionModal
        open={false}
        patient={patientA}
        proposed={proposed}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )
    rerender(
      <DemographicCorrectionModal
        open={true}
        patient={patientB}
        proposed={proposed}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    )

    expect(screen.getByLabelText(/Reason for Demographic Correction/i)).toHaveValue('')
  })

  it('M10: PaymentReversalModal resets reason and error when switching payments or reopening', () => {
    const qc = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PaymentReversalModal isOpen={true} onClose={vi.fn()} payment={paymentA} />
      </QueryClientProvider>,
    )

    const input = screen.getByLabelText(/Mandatory Reversal Justification/i)
    fireEvent.change(input, { target: { value: 'Duplicate receipt for Alpha' } })
    expect(input).toHaveValue('Duplicate receipt for Alpha')

    rerender(
      <QueryClientProvider client={qc}>
        <PaymentReversalModal isOpen={false} onClose={vi.fn()} payment={null} />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider client={qc}>
        <PaymentReversalModal isOpen={true} onClose={vi.fn()} payment={paymentB} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText(/Mandatory Reversal Justification/i)).toHaveValue('')
  })

  it('M10: PatientExportDialog resets reason after closing and reopening', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse([]))
    const qc = createQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <PatientExportDialog open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    const reasonInput = screen.getByLabelText(/Documented Purpose \/ Justification for Export/i)
    fireEvent.change(reasonInput, { target: { value: 'Statutory audit export Q1' } })
    expect(reasonInput).toHaveValue('Statutory audit export Q1')

    rerender(
      <QueryClientProvider client={qc}>
        <PatientExportDialog open={false} onClose={vi.fn()} />
      </QueryClientProvider>,
    )
    rerender(
      <QueryClientProvider client={qc}>
        <PatientExportDialog open={true} onClose={vi.fn()} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText(/Documented Purpose \/ Justification for Export/i)).toHaveValue('')
  })

  // --- M12: 300_000ms timeout on long-running backup create, restore, and import commit ---
  it('M12: useCreateBackup and useRestoreBackup pass timeoutMs: 300_000 to apiFetch', async () => {
    const apiSpy = vi.spyOn(clientModule, 'apiFetch').mockResolvedValue({} as never)
    const qc = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )

    const { result: createHook } = renderHook(() => useCreateBackup(), { wrapper })
    await createHook.current.mutateAsync({ label: 'pre_upgrade' })

    expect(apiSpy).toHaveBeenCalledWith(
      '/api/operations/backups',
      expect.objectContaining({ method: 'POST', timeoutMs: 300_000 }),
    )

    apiSpy.mockClear()
    const { result: restoreHook } = renderHook(() => useRestoreBackup(), { wrapper })
    await restoreHook.current.mutateAsync({
      archive_filename: 'backup.tar.gz',
      confirmation_phrase: 'RESTORE',
      reason: 'Approved disaster recovery test',
      create_prerestore_snapshot: true,
    })

    expect(apiSpy).toHaveBeenCalledWith(
      '/api/operations/restore',
      expect.objectContaining({ method: 'POST', timeoutMs: 300_000 }),
    )
  })

  it('M12: ImportWizard commit calls apiFetch with timeoutMs: 300_000', async () => {
    const apiSpy = vi
      .spyOn(clientModule, 'apiFetch')
      .mockResolvedValueOnce({
        filename: 'patients.csv',
        file_type: 'csv',
        encoding: 'utf-8',
        delimiter: ',',
        total_rows: 1,
        headers: ['Name'],
        sample_rows: [{ Name: 'Arun' }],
        suggested_mapping: { Name: 'full_name' },
        canonical_fields: ['full_name'],
      })
      .mockResolvedValueOnce({
        batch_id: 'batch-m12',
        filename: 'patients.csv',
        total_rows: 1,
        valid_rows: 1,
        duplicate_rows: 0,
        invalid_rows: 0,
        committed_rows: 0,
        status: 'STAGED',
      })
      .mockResolvedValueOnce({
        batch_id: 'batch-m12',
        total_rows: 1,
        valid_rows: 1,
        duplicate_rows: 0,
        invalid_rows: 0,
        status: 'VALIDATED',
      })
      .mockResolvedValueOnce({
        batch_id: 'batch-m12',
        status: 'COMMITTED',
        committed_rows: 1,
        safety_backup_file: 'safety.tar.gz',
        urn_range_start: 'KH-26-P-01-00001',
        urn_range_end: 'KH-26-P-01-00001',
      })

    render(<ImportWizard />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['Name\nArun'], 'patients.csv', { type: 'text/csv' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Import File' }))

    await waitFor(() => screen.getByRole('button', { name: 'Confirm File Inspection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm File Inspection' }))

    await waitFor(() => screen.getByRole('button', { name: 'Confirm Column Mapping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Column Mapping' }))

    await waitFor(() => screen.getByRole('button', { name: 'Review Import Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Import Preview' }))

    fireEvent.click(screen.getByRole('button', { name: 'Commit Import Batch' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Batch Commit' }))

    await waitFor(() => {
      expect(apiSpy).toHaveBeenCalledWith(
        '/admin/imports/batch-m12/commit',
        expect.objectContaining({ method: 'POST', timeoutMs: 300_000 }),
      )
    })
  })

  // --- M16-BackupManager: Outer modal is busy while ImportWizard is processing ---
  it('M16-BackupManager: outer Import modal blocks Close while ImportWizard request is in flight', async () => {
    let resolveInspect!: (value: unknown) => void
    const pendingInspect = new Promise((res) => {
      resolveInspect = res
    })

    vi.spyOn(clientModule, 'apiFetch').mockImplementation((path: string) => {
      if (path.includes('/admin/imports/inspect')) return pendingInspect as Promise<never>
      if (path.includes('/operations/backups')) {
        return Promise.resolve({ backups: [], total_count: 0, backup_dir: '/backups' }) as Promise<never>
      }
      if (path.includes('/auth/me')) {
        return Promise.resolve({ id: 1, full_name: 'Admin', role: 'ADMIN', csrf_token: 't' }) as Promise<never>
      }
      return Promise.resolve([]) as Promise<never>
    })

    renderWithProviders(<BackupManagerPage />, ['/admin/backups?action=import'])

    const dialog = await screen.findByRole('dialog')
    const closeBtn = screen.getByRole('button', { name: 'Close' })
    expect(closeBtn).not.toBeDisabled()

    const fileInput = dialog.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File(['Name\nArun'], 'patients.csv', { type: 'text/csv' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Import File' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
    })

    // Resolve to clean up
    resolveInspect({
      filename: 'patients.csv',
      file_type: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      total_rows: 1,
      headers: ['Name'],
      sample_rows: [{ Name: 'Arun' }],
      suggested_mapping: { Name: 'full_name' },
      canonical_fields: ['full_name'],
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).not.toBeDisabled()
    })
  })

  // --- M17: Accessible upload dropzones + working drag-and-drop + Clear resets input ---
  it('M17: ImportWizard dropzone is keyboard-accessible, supports drag-and-drop, and Clear resets input value', async () => {
    const user = userEvent.setup()
    render(<ImportWizard />)

    const dropzone = screen.getByRole('button', { name: /drag and drop spreadsheet|upload spreadsheet/i })
    expect(dropzone).toBeInTheDocument()

    // Keyboard activation triggers hidden file input click
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    dropzone.focus()
    await user.keyboard('{Enter}')
    expect(clickSpy).toHaveBeenCalled()

    // Drag and drop selects file
    const droppedFile = new File(['Name\nSita'], 'dropped.csv', { type: 'text/csv' })
    fireEvent.dragOver(dropzone, { dataTransfer: { files: [droppedFile] } })
    fireEvent.drop(dropzone, { dataTransfer: { files: [droppedFile] } })

    expect(screen.getAllByText('dropped.csv').length).toBeGreaterThanOrEqual(1)

    // Clear resets input value so same file can be re-selected
    Object.defineProperty(fileInput, 'value', { value: 'C:\\fakepath\\dropped.csv', writable: true, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(fileInput.value).toBe('')
  })

  it('M17: HospitalAssetManager upload dropzone is keyboard-accessible', async () => {
    global.fetch = vi.fn().mockResolvedValue(makeJsonResponse([]))
    const user = userEvent.setup()
    renderWithProviders(<HospitalAssetManager />)

    fireEvent.click(screen.getByTestId('upload-asset-trigger'))
    const dropzone = screen.getByRole('button', { name: /click to browse|drag and drop/i })
    expect(dropzone).toBeInTheDocument()

    const fileInput = screen.getByTestId('asset-file-input') as HTMLInputElement
    const clickSpy = vi.spyOn(fileInput, 'click')
    dropzone.focus()
    await user.keyboard('{Enter}')
    expect(clickSpy).toHaveBeenCalled()
  })

  // --- M18: Doctors and DepartmentsPage show explicit error UI instead of false empty states ---
  it('M18: Doctors page shows error alerts with Retry instead of empty catalogue messages when API fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          makeJsonResponse({ id: 1, username: 'admin', full_name: 'Admin', role: 'ADMIN', csrf_token: 't' }),
        )
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve(makeJsonResponse({ code: 'server_error', message: 'Doctors DB offline' }, false, 500))
      }
      if (url.includes('/api/fees')) {
        return Promise.resolve(makeJsonResponse({ code: 'server_error', message: 'Fees DB offline' }, false, 500))
      }
      return Promise.resolve(makeJsonResponse([]))
    })

    renderWithProviders(<Doctors />, ['/admin/doctors'])

    const alerts = await screen.findAllByRole('alert')
    const combined = alerts.map((a) => a.textContent ?? '').join(' ')
    expect(combined).toMatch(/Doctors DB offline/i)
    expect(combined).toMatch(/Fees DB offline/i)
    expect(screen.queryByText('No doctors registered yet.')).not.toBeInTheDocument()
    expect(screen.queryByText('No fee schedules configured yet.')).not.toBeInTheDocument()
  })

  it('M18: DepartmentsPage shows error alerts instead of "No departments configured." when API fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve(
          makeJsonResponse({ id: 1, username: 'admin', full_name: 'Admin', role: 'ADMIN', csrf_token: 't' }),
        )
      }
      if (url.includes('/api/departments')) {
        return Promise.resolve(
          makeJsonResponse({ code: 'server_error', message: 'Departments unavailable' }, false, 500),
        )
      }
      if (url.includes('/api/doctors')) {
        return Promise.resolve(
          makeJsonResponse({ code: 'server_error', message: 'Doctors unavailable' }, false, 500),
        )
      }
      return Promise.resolve(makeJsonResponse([]))
    })

    renderWithProviders(<DepartmentsPage />, ['/admin/departments'])

    const alerts = await screen.findAllByRole('alert')
    const combined = alerts.map((a) => a.textContent ?? '').join(' ')
    expect(combined).toMatch(/Departments unavailable/i)
    expect(combined).toMatch(/Doctors unavailable/i)
    expect(screen.queryByText('No departments configured.')).not.toBeInTheDocument()
  })
})
