import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { PatientImportPage } from '../admin/PatientImportPage'
import { apiFetch, ApiError } from '../../api/client'

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'System Administrator', role: 'ADMIN' }, isLoading: false }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

// The sidebar's Data Integrity count would otherwise take a queued apiFetch response.
vi.mock('../../api/integrity', () => ({
  useLatestIntegrityRun: () => ({ data: undefined }),
}))

vi.mock('../../api/branding', () => ({
  useClinicBranding: () => ({
    trustNameEn: 'Sri Vashishtha Kalyan Trust',
    trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
    hospitalName: 'Kalyan Hospital',
    address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
    locationLine: 'Ara, Bhojpur, Bihar',
  }),
}))

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  )
}

vi.mock('../../api/client', () => ({
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number
    code: string
    extra: Record<string, unknown>
    constructor(status: number, code: string, message: string, extra = {}) {
      super(message)
      this.status = status
      this.code = code
      this.extra = extra
    }
  },
}))

describe('PatientImportPage and 8-Stage Import Wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders 8-stage stepper and initial upload stage', () => {
    renderWithProviders(<PatientImportPage />)

    expect(screen.getByRole('heading', { name: 'Import Patients' })).toBeInTheDocument()
    expect(screen.getByLabelText('Import Progress')).toBeInTheDocument()

    // 8 stages in stepper
    expect(screen.getByText('Upload')).toBeInTheDocument()
    expect(screen.getByText('Inspect')).toBeInTheDocument()
    expect(screen.getByText('Map')).toBeInTheDocument()
    expect(screen.getByText('Validate')).toBeInTheDocument()
    expect(screen.getByText('Resolve')).toBeInTheDocument()
    expect(screen.getByText('Preview')).toBeInTheDocument()
    expect(screen.getByText('Commit')).toBeInTheDocument()
    expect(screen.getByText('Reconcile')).toBeInTheDocument()

    // Upload step content
    expect(screen.getByText('Step 1: Upload Patient Spreadsheet')).toBeInTheDocument()
    const uploadBtn = screen.getByRole('button', { name: 'Upload Import File' })
    expect(uploadBtn).toBeDisabled()
  })

  it('allows file selection and executes inspection stage', async () => {
    const mockInspectResponse = {
      filename: 'patients.csv',
      file_type: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      total_rows: 3,
      headers: ['Name', 'Guardian', 'Gender', 'Age', 'Mobile', 'Address'],
      sample_rows: [
        { Name: 'Arun Kumar', Guardian: 'Vinod Kumar', Gender: 'M', Age: '32', Mobile: '9876501234', Address: 'Ara' },
      ],
      suggested_mapping: {
        Name: 'full_name',
        Guardian: 'guardian_name',
        Gender: 'gender',
        Age: 'age_years',
        Mobile: 'mobile',
        Address: 'address',
      },
      canonical_fields: ['full_name', 'guardian_name', 'gender', 'age_years', 'mobile', 'address'],
    }

    vi.mocked(apiFetch).mockResolvedValueOnce(mockInspectResponse)

    renderWithProviders(<PatientImportPage />)

    const file = new File(['Name,Guardian\nArun,Vinod'], 'patients.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).not.toBeNull()

    fireEvent.change(fileInput, { target: { files: [file] } })

    const uploadBtn = screen.getByRole('button', { name: 'Upload Import File' })
    expect(uploadBtn).not.toBeDisabled()
    fireEvent.click(uploadBtn)

    await waitFor(() => {
      expect(screen.getByText('Step 2: File Structure Inspection')).toBeInTheDocument()
    })

    expect(screen.getByText('Format: CSV')).toBeInTheDocument()
    expect(screen.getByText('Encoding: utf-8')).toBeInTheDocument()
    expect(screen.getByText('Total Rows: 3')).toBeInTheDocument()
    expect(screen.getByText('Arun Kumar')).toBeInTheDocument()

    // Confirm inspection advances to Map stage
    const confirmInspectBtn = screen.getByRole('button', { name: 'Confirm File Inspection' })
    fireEvent.click(confirmInspectBtn)

    expect(screen.getByText('Step 3: Column Mapping')).toBeInTheDocument()
    expect(screen.getByText('Spreadsheet Column Header')).toBeInTheDocument()
  })

  it('stages rows, validates, and renders metric cards with held back invalid rows', async () => {
    const mockInspectResponse = {
      filename: 'patients.csv',
      file_type: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      total_rows: 3,
      headers: ['Name', 'Guardian', 'Gender', 'Age', 'Mobile', 'Address'],
      sample_rows: [{ Name: 'Arun', Guardian: 'Vinod', Gender: 'M', Age: '32', Mobile: '9876501234', Address: 'Ara' }],
      suggested_mapping: {
        Name: 'full_name',
        Guardian: 'guardian_name',
        Gender: 'gender',
        Age: 'age_years',
        Mobile: 'mobile',
        Address: 'address',
      },
      canonical_fields: ['full_name', 'guardian_name', 'gender', 'age_years', 'mobile', 'address'],
    }

    const mockStageBatch = {
      batch_id: 'batch-test-123',
      filename: 'patients.csv',
      total_rows: 3,
      valid_rows: 0,
      duplicate_rows: 0,
      invalid_rows: 0,
      committed_rows: 0,
      status: 'STAGED',
    }

    const mockValidateSummary = {
      batch_id: 'batch-test-123',
      total_rows: 3,
      valid_rows: 2,
      duplicate_rows: 1,
      invalid_rows: 1,
      status: 'VALIDATED',
    }

    const mockDuplicates = {
      batch_id: 'batch-test-123',
      duplicates: [
        {
          row_id: 10,
          row_index: 2,
          mapped_data: {
            full_name: 'Existing Patient',
            guardian_name: 'Guardian P',
            gender: 'M',
            age_years: 40,
            mobile: '9876500000',
            address: 'Ara Bihar',
          },
          duplicate_patient_id: 50,
          duplicate_patient: {
            id: 50,
            urn: 'KH-2026-0050',
            full_name: 'Existing Patient',
            guardian_name: 'Guardian P',
            gender: 'M',
            age_years: 40,
            mobile: '9876500000',
            address: 'Ara Bihar',
          },
          duplicate_resolution: 'SKIP',
          validation_errors: { duplicate_reason: 'Matches existing patient KH-2026-0050' },
        },
      ],
    }

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(mockInspectResponse) // inspect
      .mockResolvedValueOnce(mockStageBatch) // stage
      .mockResolvedValueOnce(mockValidateSummary) // validate
      .mockResolvedValueOnce(mockDuplicates) // duplicates fetch

    renderWithProviders(<PatientImportPage />)

    // Stage 1 -> Stage 2
    const file = new File(['content'], 'patients.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Import File' }))

    // Stage 2 -> Stage 3
    await waitFor(() => screen.getByRole('button', { name: 'Confirm File Inspection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm File Inspection' }))

    // Stage 3 -> Stage 4
    await waitFor(() => screen.getByRole('button', { name: 'Confirm Column Mapping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Column Mapping' }))

    // Stage 4 Validation display
    await waitFor(() => {
      expect(screen.getByText('Step 4: Batch Validation Results')).toBeInTheDocument()
    })

    expect(screen.getByText('Valid Rows')).toBeInTheDocument()
    expect(screen.getByText('1 Invalid Row Held Back')).toBeInTheDocument()

    // Navigates to duplicate resolution because duplicates > 0
    const resolveBtn = screen.getByRole('button', { name: 'Resolve Duplicate Records' })
    fireEvent.click(resolveBtn)

    expect(screen.getByText('Step 5: Duplicate Resolution')).toBeInTheDocument()
    expect(screen.getByText('Patient Safety Policy')).toBeInTheDocument()
    expect(screen.getByText('1 Duplicate Candidate Flagged')).toBeInTheDocument()

    // Check duplicate comparison card
    expect(screen.getByText('KH-2026-0050')).toBeInTheDocument()
    const skipRadio = screen.getByRole('radio', { name: /Skip Row/ })
    const importNewRadio = screen.getByRole('radio', { name: /Import as New/ })

    expect(skipRadio).toHaveAttribute('aria-checked', 'true')
    expect(importNewRadio).toHaveAttribute('aria-checked', 'false')

    // Click Import as New
    fireEvent.click(importNewRadio)
    expect(importNewRadio).toHaveAttribute('aria-checked', 'true')

    // Click Skip All Flagged Duplicates
    const bulkSkipBtn = screen.getByRole('button', { name: 'Skip All Flagged Duplicates' })
    fireEvent.click(bulkSkipBtn)
    expect(skipRadio).toHaveAttribute('aria-checked', 'true')
  })

  it('navigates through preview, displays destructive confirmation modal, and handles commit', async () => {
    const mockInspectResponse = {
      filename: 'patients.csv',
      file_type: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      total_rows: 2,
      headers: ['Name', 'Guardian', 'Gender', 'Age', 'Mobile', 'Address'],
      sample_rows: [{ Name: 'Arun', Guardian: 'Vinod', Gender: 'M', Age: '32', Mobile: '9876501234', Address: 'Ara' }],
      suggested_mapping: {
        Name: 'full_name',
        Guardian: 'guardian_name',
        Gender: 'gender',
        Age: 'age_years',
        Mobile: 'mobile',
        Address: 'address',
      },
      canonical_fields: ['full_name', 'guardian_name', 'gender', 'age_years', 'mobile', 'address'],
    }

    const mockStageBatch = {
      batch_id: 'batch-test-999',
      filename: 'patients.csv',
      total_rows: 2,
      valid_rows: 2,
      duplicate_rows: 0,
      invalid_rows: 0,
      committed_rows: 0,
      status: 'STAGED',
    }

    const mockValidateSummary = {
      batch_id: 'batch-test-999',
      total_rows: 2,
      valid_rows: 2,
      duplicate_rows: 0,
      invalid_rows: 0,
      status: 'VALIDATED',
    }

    const mockCommitResult = {
      batch_id: 'batch-test-999',
      status: 'COMMITTED',
      committed_rows: 2,
      safety_backup_file: 'kalyan_backup_20261108_preimport.tar.gz',
      urn_range_start: 'KH-2026-0150',
      urn_range_end: 'KH-2026-0151',
    }

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(mockInspectResponse)
      .mockResolvedValueOnce(mockStageBatch)
      .mockResolvedValueOnce(mockValidateSummary)
      .mockResolvedValueOnce(mockCommitResult)

    renderWithProviders(<PatientImportPage />)

    const file = new File(['content'], 'patients.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Upload Import File' }))

    await waitFor(() => screen.getByRole('button', { name: 'Confirm File Inspection' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm File Inspection' }))

    await waitFor(() => screen.getByRole('button', { name: 'Confirm Column Mapping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Column Mapping' }))

    await waitFor(() => screen.getByRole('button', { name: 'Review Import Preview' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Import Preview' }))

    // Stage 6 Preview
    expect(screen.getByText('Step 6: Import Preview & Confirmation')).toBeInTheDocument()
    expect(screen.getByText(/Batch Summary:/)).toBeInTheDocument()
    expect(screen.getByText(/patients\.csv/)).toBeInTheDocument()

    // Trigger commit modal
    const commitBtn = screen.getByRole('button', { name: 'Commit Import Batch' })
    fireEvent.click(commitBtn)

    // Modal opens with exact copywriting
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(
      screen.getByText(/Are you sure you want to commit 2 valid patient records to the hospital database\?/)
    ).toBeInTheDocument()

    // Confirm Commit
    const confirmCommitBtn = screen.getByRole('button', { name: 'Confirm Batch Commit' })
    fireEvent.click(confirmCommitBtn)

    // Stage 8 Reconcile
    await waitFor(() => {
      expect(screen.getByText('Step 8: Batch Reconciliation')).toBeInTheDocument()
    })

    expect(screen.getByText('KH-2026-0150 → KH-2026-0151')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download Error Records' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import Another Register' })).toBeInTheDocument()
  })

  it('renders pre-commit backup error banner if commit fails', async () => {
    const mockInspectResponse = {
      filename: 'patients.csv',
      file_type: 'csv',
      encoding: 'utf-8',
      delimiter: ',',
      total_rows: 1,
      headers: ['Name'],
      sample_rows: [{ Name: 'Arun' }],
      suggested_mapping: { Name: 'full_name' },
      canonical_fields: ['full_name'],
    }

    const mockStageBatch = {
      batch_id: 'batch-fail-111',
      filename: 'patients.csv',
      total_rows: 1,
      valid_rows: 1,
      duplicate_rows: 0,
      invalid_rows: 0,
      committed_rows: 0,
      status: 'STAGED',
    }

    const mockValidateSummary = {
      batch_id: 'batch-fail-111',
      total_rows: 1,
      valid_rows: 1,
      duplicate_rows: 0,
      invalid_rows: 0,
      status: 'VALIDATED',
    }

    vi.mocked(apiFetch)
      .mockResolvedValueOnce(mockInspectResponse)
      .mockResolvedValueOnce(mockStageBatch)
      .mockResolvedValueOnce(mockValidateSummary)
      .mockRejectedValueOnce(
        new ApiError(500, 'precommit_backup_failed', 'Import commit aborted because pre-import safety backup failed: disk error')
      )

    renderWithProviders(<PatientImportPage />)

    const file = new File(['content'], 'patients.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [file] } })
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
      expect(
        screen.getByText('Import commit aborted because pre-import safety backup failed.')
      ).toBeInTheDocument()
    })
  })
})
