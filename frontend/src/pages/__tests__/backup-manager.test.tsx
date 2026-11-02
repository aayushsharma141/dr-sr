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
  ],
  total_count: 1,
  backup_dir: '/var/backups',
}

vi.mock('../../api/queries', () => ({
  useBackups: () => ({
    data: sampleBackups,
    isPending: false,
    isError: false,
    error: null,
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
    expect(
      screen.getByText(/Automatic Pre-Restore Safety Snapshot Guarantee/i)
    ).toBeInTheDocument()
  })
})
