import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../test/dialog-shim'
import { BackupManagerPage } from '../admin/BackupManagerPage'

const sampleBackupSettings = {
  schedule_enabled: true,
  frequency: 'DAILY' as const,
  run_at: '02:00:00',
  weekly_day: null,
  destination_dir: 'E:/KalyanHospitalBackups',
  retention_count: 30,
  version_id: 1,
  updated_at: '2026-11-01T10:00:00Z',
  next_run_at: '2026-11-12T02:00:00Z',
  overdue: false,
  approved_destinations: ['E:/KalyanHospitalBackups'],
}

const mocks = vi.hoisted(() => ({
  createMutate: vi.fn(),
  restoreMutate: vi.fn(),
}))

const sampleBackups = {
  backups: [
    {
      filename: 'kalyan_backup_20261102_100000.tar.gz',
      filepath: '/var/backups/kalyan_backup_20261102_100000.tar.gz',
      size_bytes: 1048576,
      created_at: '2026-11-02T10:00:00Z',
      label: 'nightly',
      is_valid: true,
      manifest: { version: '1.0' },
    },
    {
      filename: 'kalyan_backup_20261101_100000_prerestore.tar.gz',
      filepath: '/var/backups/kalyan_backup_20261101_100000_prerestore.tar.gz',
      size_bytes: 524288,
      created_at: '2026-11-01T10:00:00Z',
      label: 'prerestore',
      is_valid: true,
      manifest: { version: '1.0' },
    },
  ],
  total_count: 2,
  backup_dir: '/var/backups',
}

vi.mock('../../api/branding', () => ({
  useClinicBranding: () => ({
    trustNameEn: 'Sri Vashishtha Kalyan Trust',
    trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
    hospitalName: 'Kalyan Hospital',
    address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
    locationLine: 'Ara, Bhojpur, Bihar',
    crestUrl: '/kalyan-hospital-crest.webp',
  }),
}))

vi.mock('../../api/queries', () => ({
  useMe: () => ({
    data: { full_name: 'System Administrator', role: 'ADMIN' },
    isLoading: false,
  }),
  useBackups: () => ({
    data: sampleBackups,
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCreateBackup: () => ({
    mutateAsync: mocks.createMutate,
    isPending: false,
  }),
  useRestoreBackup: () => ({
    mutateAsync: mocks.restoreMutate,
    isPending: false,
  }),
  useLogout: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useBackupSettings: () => ({
    data: sampleBackupSettings,
    isPending: false,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useBackupRuns: () => ({
    data: [],
    isPending: false,
    isError: false,
    error: null,
  }),
  useUpdateBackupSettings: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('BackupManagerPage', () => {
  const renderPage = (initialEntries: string[] = ['/admin/backups']) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={initialEntries}>
        <BackupManagerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  it('renders archive overview and removes developer-facing text and per-row destructive buttons', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Backup & Restore' })).toBeInTheDocument()
    expect(screen.getByText('kalyan_backup_20261102_100000.tar.gz')).toBeInTheDocument()
    expect(screen.getAllByText('Integrity passed').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('1.00 MB')).toBeInTheDocument()
    expect(screen.queryByText(/BAK-01|BAK-02|fail-closed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore System' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Storage:.*var.*backups/i)).not.toBeInTheDocument()
  })

  it('filters archives by search and type', () => {
    renderPage()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search archives' }), {
      target: { value: 'prerestore' },
    })
    expect(screen.getByText('kalyan_backup_20261101_100000_prerestore.tar.gz')).toBeInTheDocument()
    expect(screen.queryByText('kalyan_backup_20261102_100000.tar.gz')).not.toBeInTheDocument()
  })

  it('renders the backup schedule configuration and controls', () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule & automation' }))

    expect(screen.getByRole('heading', { name: 'Scheduled backups' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /run scheduled backups/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/frequency/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time \(ist\)/i)).toBeInTheDocument()
  })

  it('requires the confirmation phrase and a reason before restore can proceed', () => {
    renderPage()
    fireEvent.click(screen.getAllByText('More actions')[0])
    fireEvent.click(screen.getAllByRole('button', { name: /Restore this archive/ })[0])

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Reason for restoration *')).toBeRequired()
    expect(screen.getByLabelText('Type the confirmation phrase')).toBeRequired()
    expect(screen.getByRole('button', { name: 'Confirm database restoration' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Reason for restoration *'), {
      target: { value: 'Approved recovery after a verified server incident' },
    })
    fireEvent.change(screen.getByLabelText('Type the confirmation phrase'), {
      target: { value: 'RESTORE-DATABASE-OVERWRITE' },
    })
    expect(screen.getByRole('button', { name: 'Confirm database restoration' })).toBeEnabled()
  })

  it('renders data portability buttons and migration overview', () => {
    renderPage()

    expect(screen.getByRole('button', { name: 'Import Spreadsheet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export Dataset' })).toBeInTheDocument()
    expect(screen.getByText('Patient Spreadsheet Ingestion')).toBeInTheDocument()
    expect(screen.getByText('Patient Dataset Export')).toBeInTheDocument()
  })

  it('opens import wizard modal when clicking Import Spreadsheet', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Import Spreadsheet' }))
    expect(screen.getByRole('heading', { name: 'Patient Import Centre' })).toBeInTheDocument()
    expect(screen.getByText(/Step 1: Upload Patient Spreadsheet/i)).toBeInTheDocument()
  })

  it('opens export dialog when clicking Export Dataset', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Export Dataset' }))
    expect(screen.getByRole('heading', { name: 'Export Patient Dataset' })).toBeInTheDocument()
  })

  it('automatically opens import modal when navigated with ?action=import', () => {
    renderPage(['/admin/backups?action=import'])

    expect(screen.getByRole('heading', { name: 'Patient Import Centre' })).toBeInTheDocument()
    expect(screen.getByText(/Step 1: Upload Patient Spreadsheet/i)).toBeInTheDocument()
  })

  it('automatically opens export dialog when navigated with ?action=export', () => {
    renderPage(['/admin/backups?action=export'])

    expect(screen.getByRole('heading', { name: 'Export Patient Dataset' })).toBeInTheDocument()
  })
})

describe('BackupManagerPage failures are persistent inline alerts (UX-03)', () => {
  const queryClient = new QueryClient()
  let alertSpy: ReturnType<typeof vi.spyOn>

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BackupManagerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  beforeEach(() => {
    mocks.createMutate.mockReset()
    mocks.restoreMutate.mockReset()
    mocks.restoreMutate.mockResolvedValue({
      status: 'SUCCESS',
      prerestore_snapshot: '/var/backups/prerestore.tar.gz',
    })
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { })
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('shows a failed backup as a persistent role=alert, never window.alert', async () => {
    mocks.createMutate.mockRejectedValueOnce(new Error('disk full'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Create backup' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start backup' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/Backup could not be created.*disk full/)
    expect(alertSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed restore inside the confirmation dialog and keeps it open', async () => {
    mocks.restoreMutate.mockRejectedValueOnce(new Error('checksum mismatch'))
    renderPage()

    fireEvent.click(screen.getAllByText('More actions')[0])
    fireEvent.click(screen.getAllByRole('button', { name: /Restore this archive/ })[0])

    fireEvent.change(screen.getByLabelText('Reason for restoration *'), {
      target: { value: 'Approved recovery after a verified server incident' },
    })
    fireEvent.change(screen.getByLabelText('Type the confirmation phrase'), {
      target: { value: 'RESTORE-DATABASE-OVERWRITE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm database restoration' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Restore failed: checksum mismatch')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('restore confirmation: Esc closes it and focus returns to the Restore button that opened it', async () => {
    const user = userEvent.setup()
    renderPage()
    fireEvent.click(screen.getAllByText('More actions')[0])
    const trigger = screen.getAllByRole('button', { name: /Restore this archive/ })[0]
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
