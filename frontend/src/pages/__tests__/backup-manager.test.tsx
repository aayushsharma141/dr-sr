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
  ],
  total_count: 1,
  backup_dir: '/var/backups',
}

vi.mock('../../api/queries', () => ({
  useMe: () => ({
    data: { full_name: 'Test Admin', role: 'ADMIN', permissions: [] },
    isPending: false,
    isError: false,
  }),
  useBackups: () => ({
    data: sampleBackups,
    isPending: false,
    isError: false,
    error: null,
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
  useBackupSettings: () => ({ data: undefined, isPending: true, isError: false, isFetching: false, refetch: vi.fn() }),
  useUpdateBackupSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useBackupRuns: () => ({ data: [], isPending: false, isError: false }),
  useVerifyBackup: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useLogout: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('BackupManagerPage', () => {
  const queryClient = new QueryClient()

  it('renders backup archives list with verified status badge', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BackupManagerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText('Backup & Recovery Manager')).toBeInTheDocument()
    expect(screen.getByText('kalyan_backup_20261102_100000.tar.gz')).toBeInTheDocument()
    expect(screen.getByText('✓ Cryptographically Verified')).toBeInTheDocument()
    expect(screen.getByText('1.00 MB')).toBeInTheDocument()
  })

  it('opens confirmation modal on Restore click', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BackupManagerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    const restoreBtn = screen.getByText('Restore System')
    fireEvent.click(restoreBtn)

    expect(screen.getByText('⚠ Confirm System Restoration')).toBeInTheDocument()
    expect(screen.getByText('A safety backup is always taken first.')).toBeInTheDocument()
  })

  it('keeps Restore disabled until the RESTORE phrase and a reason are entered', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <BackupManagerPage />
        </MemoryRouter>
      </QueryClientProvider>
    )

    fireEvent.click(screen.getByText('Restore System'))
    const submit = screen.getByRole('button', { name: 'Yes, Execute Safe Restore' })
    expect(submit).toBeDisabled()

    fireEvent.change(document.getElementById('restore-phrase') as HTMLElement, {
      target: { value: 'RESTORE' },
    })
    expect(submit).toBeDisabled()

    fireEvent.change(document.getElementById('restore-reason') as HTMLElement, {
      target: { value: 'Restore after disk failure' },
    })
    expect(submit).toBeEnabled()
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
    fireEvent.change(document.getElementById('restore-phrase') as HTMLElement, {
      target: { value: 'RESTORE' },
    })
    fireEvent.change(document.getElementById('restore-reason') as HTMLElement, {
      target: { value: 'Restore after disk failure' },
    })
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
