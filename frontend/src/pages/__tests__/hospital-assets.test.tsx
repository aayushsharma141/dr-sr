import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { HospitalAssetManager } from '../../components/admin/HospitalAssetManager'
import type { HospitalAssetOut } from '../../api/types'

const mockAssets: HospitalAssetOut[] = [
  {
    id: 1,
    asset_type: 'LOGO',
    filename: 'crest_v1.png',
    original_filename: 'crest_v1.png',
    mime_type: 'image/png',
    file_size_bytes: 24500,
    is_active: false,
    version: 1,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Super Admin',
    created_at: '2026-11-01T10:00:00Z',
  },
  {
    id: 2,
    asset_type: 'LOGO',
    filename: 'crest_v2.png',
    original_filename: 'crest_v2.png',
    mime_type: 'image/png',
    file_size_bytes: 32000,
    is_active: true,
    version: 2,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Super Admin',
    created_at: '2026-11-05T12:00:00Z',
  },
  {
    id: 3,
    asset_type: 'REGISTRATION_DOC',
    filename: 'trust_cert.pdf',
    original_filename: 'trust_cert.pdf',
    mime_type: 'application/pdf',
    file_size_bytes: 120500,
    is_active: true,
    version: 1,
    uploaded_by_user_id: 1,
    uploaded_by_name: 'Super Admin',
    created_at: '2026-11-06T15:30:00Z',
  },
]

let currentAssets: HospitalAssetOut[] = []
const mutateUpload = vi.fn().mockResolvedValue({})
const mutateDeactivate = vi.fn().mockResolvedValue({})

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Admin User', role: 'ADMIN', username: 'admin' }, isPending: false, isError: false }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useHospitalAssets: () => ({
    data: currentAssets,
    isLoading: false,
    error: null,
  }),
  useUploadAsset: () => ({
    mutateAsync: mutateUpload,
    isPending: false,
  }),
  useDeactivateAsset: () => ({
    mutateAsync: mutateDeactivate,
    isPending: false,
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HospitalAssetManager />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HospitalAssetManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    currentAssets = [...mockAssets]
  })

  it('renders active logo hero card, upload action button, and version table', () => {
    renderPage()

    // Hero card
    expect(screen.getByText('Active Hospital Crest & Logo')).toBeDefined()
    expect(screen.getByTestId('active-logo-badge')).toBeDefined()
    expect(screen.getByText('v2')).toBeDefined()

    // Upload Action Trigger
    const uploadBtn = screen.getByTestId('upload-asset-trigger')
    expect(uploadBtn).toBeDefined()
    expect(uploadBtn.textContent).toBe('Upload Hospital Asset')

    // Historical Version Table
    expect(screen.getByText('Historical Asset Library & Versions')).toBeDefined()
    expect(screen.getByTestId('asset-row-1')).toBeDefined()
    expect(screen.getByTestId('asset-row-2')).toBeDefined()
    expect(screen.getByTestId('asset-row-3')).toBeDefined()
    expect(screen.getByText('ARCHIVED')).toBeDefined()
  })

  it('renders empty state when no assets are uploaded', () => {
    currentAssets = []
    renderPage()

    const emptyState = screen.getByTestId('asset-empty-state')
    expect(emptyState).toBeDefined()
    expect(screen.getByText('No Additional Assets Uploaded')).toBeDefined()
    expect(
      screen.getByText(
        /Only the default hospital crest is currently registered\. Click 'Upload Hospital Asset' to add clinic photos or registration documents\./i,
      ),
    ).toBeDefined()
  })

  it('opens upload modal and submits file correctly', async () => {
    renderPage()

    // Click upload button
    fireEvent.click(screen.getByTestId('upload-asset-trigger'))

    // Modal dialog is displayed
    expect(screen.getByRole('heading', { name: 'Upload Hospital Asset' })).toBeDefined()

    // Asset type selector
    const typeSelect = screen.getByLabelText(/Asset Type/i) as HTMLSelectElement
    expect(typeSelect.value).toBe('LOGO')
    fireEvent.change(typeSelect, { target: { value: 'REGISTRATION_DOC' } })
    expect(typeSelect.value).toBe('REGISTRATION_DOC')

    // Attach file
    const fileInput = screen.getByTestId('asset-file-input')
    const testFile = new File(['%PDF-1.4 mock'], 'test_cert.pdf', { type: 'application/pdf' })
    fireEvent.change(fileInput, { target: { files: [testFile] } })

    expect(screen.getByText('test_cert.pdf')).toBeDefined()

    // Submit upload
    const submitBtn = screen.getByTestId('submit-asset-upload')
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(mutateUpload).toHaveBeenCalledTimes(1)
    })
  })

  it('opens deactivation modal with copywriting contract and handles cancellation', () => {
    renderPage()

    // Trigger deactivation for asset 2 (crest_v2.png)
    const deactTrigger = screen.getByTestId('deactivate-trigger-2')
    fireEvent.click(deactTrigger)

    // Modal dialog with destructive confirmation
    expect(screen.getByRole('heading', { name: 'Deactivate Hospital Asset' })).toBeDefined()
    expect(
      screen.getByText(
        /Are you sure you want to deactivate crest_v2\.png\? The asset will remain stored in historical archive for past print references, but will no longer appear on active letterheads or the login screen\. Click 'Confirm Asset Deactivation' to proceed or 'Keep Asset Active' to return\./i,
      ),
    ).toBeDefined()

    // Dismiss with "Keep Asset Active"
    const cancelBtn = screen.getByTestId('cancel-deactivation-button')
    expect(cancelBtn.textContent).toBe('Keep Asset Active')
    fireEvent.click(cancelBtn)

    expect(mutateDeactivate).not.toHaveBeenCalled()
  })

  it('confirms asset deactivation when user clicks confirm', async () => {
    renderPage()

    // Trigger deactivation for asset 3
    fireEvent.click(screen.getByTestId('deactivate-trigger-3'))

    // Confirm deactivation
    const confirmBtn = screen.getByTestId('confirm-deactivation-button')
    expect(confirmBtn.textContent).toBe('Confirm Asset Deactivation')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(mutateDeactivate).toHaveBeenCalledWith(3)
    })
  })
})
