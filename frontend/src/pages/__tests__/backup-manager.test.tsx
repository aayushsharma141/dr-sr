import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { BackupManagerPage } from '../admin/BackupManagerPage'

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
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useRestoreBackup: () => ({
    mutateAsync: vi.fn().mockResolvedValue({
      status: 'SUCCESS',
      prerestore_snapshot: '/var/backups/prerestore.tar.gz',
    }),
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
