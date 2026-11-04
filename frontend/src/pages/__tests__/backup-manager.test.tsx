import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import '../../test/dialog-shim'
import { BackupManagerPage } from '../admin/BackupManagerPage'

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

vi.mock('../../api/queries', () => ({
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
}))

describe('BackupManagerPage', () => {
  const renderPage = () => render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BackupManagerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

  it('renders archive overview and removes developer-facing text and per-row destructive buttons', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Backup & Recovery' })).toBeInTheDocument()
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

  it('shows an honest schedule state when the API has no schedule data', () => {
    renderPage()
    fireEvent.click(screen.getByRole('tab', { name: 'Schedule & automation' }))

    expect(screen.getByText('Schedule information is not connected')).toBeInTheDocument()
    expect(screen.getByText(/does not provide the active schedule/i)).toBeInTheDocument()
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
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  it('shows a failed backup as a persistent role=alert, never window.alert', async () => {
    mocks.createMutate.mockRejectedValueOnce(new Error('disk full'))
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger Backup Now' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Backup failed: disk full')
    expect(alertSpy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows a failed restore inside the confirmation dialog and keeps it open', async () => {
    mocks.restoreMutate.mockRejectedValueOnce(new Error('checksum mismatch'))
    renderPage()

    fireEvent.click(screen.getByText('Restore System'))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, Execute Safe Restore' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Restoration failed: checksum mismatch')
    expect(screen.getByText('⚠ Confirm System Restoration')).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('restore confirmation: Esc closes it and focus returns to the Restore button that opened it', async () => {
    const user = userEvent.setup()
    renderPage()
    const trigger = screen.getAllByRole('button', { name: /Restore System/ })[0]
    await user.click(trigger)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('⚠ Confirm System Restoration')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
