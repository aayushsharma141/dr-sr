import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemStatusOut } from '../../api/types'
import { SystemHealthPage } from '../admin/SystemHealthPage'

const mocks = vi.hoisted(() => ({
  status: {
    data: undefined as SystemStatusOut | undefined,
    isPending: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
    isFetching: false,
    dataUpdatedAt: 0,
  },
}))

vi.mock('../../api/queries', () => ({
  useMe: () => ({
    data: { full_name: 'Test Admin', role: 'ADMIN', permissions: [] },
    isPending: false,
    isError: false,
  }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSystemStatus: () => mocks.status,
}))

const STATUS: SystemStatusOut = {
  app_version: '3.0.1',
  environment: 'production',
  db_revision: '0006',
  code_head_revision: '0006',
  revision_matches: true,
  postgres_version: '18.6',
  db_size_bytes: 1048576,
  db_connections: 4,
  server_time_utc: '2026-11-04T06:30:00Z',
  server_time_ist: '2026-11-04T12:00:00+05:30',
  process_started_at: '2026-11-04T04:30:00Z',
  uptime_seconds: 7200,
  storage: [{ label: 'backups', path_label: 'E:\\backups', total_bytes: 1000, free_bytes: 250 }],
  frontend_served: true,
  checks: [
    { key: 'photos', label: 'Patient photos folder', status: 'ok', detail: 'Server can write here.' },
    { key: 'backup_schedule', label: 'Backup schedule', status: 'not_configured', detail: 'Scheduled backups are off.' },
    { key: 'backups', label: 'Backup folder', status: 'error', detail: 'Folder not found.' },
  ],
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <SystemHealthPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SystemHealthPage', () => {
  beforeEach(() => {
    mocks.status.data = STATUS
    mocks.status.isPending = false
    mocks.status.isError = false
    mocks.status.error = null
  })

  afterEach(cleanup)

  it('shows server-reported facts and storage usage', () => {
    renderPage()

    expect(screen.getByText('3.0.1')).toBeInTheDocument()
    expect(screen.getByText('18.6')).toBeInTheDocument()
    expect(screen.getByText('E:\\backups')).toBeInTheDocument()
    expect(screen.getByText('75% used')).toBeInTheDocument()
    expect(screen.getByText(/matches the code head revision/)).toBeInTheDocument()
    expect(screen.getByText('Backup folder')).toBeInTheDocument()
    expect(screen.getByText('Folder not found.')).toBeInTheDocument()
    expect(screen.getByText('Problem')).toBeInTheDocument()
    expect(screen.getByText('Off')).toBeInTheDocument()
  })

  it('warns when the database schema revision differs from the code head', () => {
    mocks.status.data = { ...STATUS, db_revision: '0005', revision_matches: false }
    renderPage()

    expect(screen.getByText(/does not match the code head revision/)).toBeInTheDocument()
    expect(screen.getByText(/Database: 0005/)).toBeInTheDocument()
  })

  it('shows a load failure instead of metrics', () => {
    mocks.status.data = undefined
    mocks.status.isError = true
    mocks.status.error = new Error('forbidden')
    renderPage()

    expect(screen.getByText(/Failed to load system status: forbidden/)).toBeInTheDocument()
    expect(screen.queryByText('Application version')).not.toBeInTheDocument()
  })
})
