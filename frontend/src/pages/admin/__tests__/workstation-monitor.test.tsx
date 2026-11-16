import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkstationMonitorPage } from '../WorkstationMonitorPage'
import * as adminDataOps from '../../../api/admin-data-ops'

vi.mock('../../../api/admin-data-ops', () => ({
  getWorkstations: vi.fn(),
  sendHeartbeat: vi.fn(),
}))

const mockWorkstations: adminDataOps.WorkstationOut[] = [
  {
    id: 1,
    hostname: 'DESK-RECEPTION-01',
    terminal_name: 'Main Reception Desk',
    ip_address: '192.168.1.101',
    app_version: '1.0.0',
    last_seen_at: '2026-11-16T10:00:00Z',
    last_user_id: 2,
    last_username: 'reception1',
    status: 'ONLINE',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-16T10:00:00Z',
  },
  {
    id: 2,
    hostname: 'CABIN-DR-SHARMA',
    terminal_name: 'Dr. Sharma Cabin',
    ip_address: '192.168.1.102',
    app_version: '1.0.0',
    last_seen_at: '2026-11-16T09:56:00Z',
    last_user_id: 3,
    last_username: 'drsharma',
    status: 'IDLE',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-16T09:56:00Z',
  },
  {
    id: 3,
    hostname: 'BILLING-DESK-02',
    terminal_name: 'Billing Desk 2',
    ip_address: '192.168.1.103',
    app_version: '1.0.0',
    last_seen_at: '2026-11-16T09:30:00Z',
    last_user_id: 4,
    last_username: 'billing1',
    status: 'OFFLINE',
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-16T09:30:00Z',
  },
]

describe('WorkstationMonitorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders KPI summary cards and terminal statuses correctly', async () => {
    vi.mocked(adminDataOps.getWorkstations).mockResolvedValue(mockWorkstations)

    render(<WorkstationMonitorPage />)

    expect(await screen.findByText('LAN Workstations Monitor')).toBeInTheDocument()

    // KPI cards
    expect(screen.getByText('Total Terminals')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Online Now')).toBeInTheDocument()
    expect(screen.getByText('Idle Terminals')).toBeInTheDocument()
    expect(screen.getByText('Offline Terminals')).toBeInTheDocument()

    // Hostnames and Terminal names
    expect(screen.getByText('Main Reception Desk')).toBeInTheDocument()
    expect(screen.getByText('DESK-RECEPTION-01')).toBeInTheDocument()
    expect(screen.getByText('Dr. Sharma Cabin')).toBeInTheDocument()
    expect(screen.getByText('Billing Desk 2')).toBeInTheDocument()

    // IPs and users
    expect(screen.getByText('192.168.1.101')).toBeInTheDocument()
    expect(screen.getByText('@reception1')).toBeInTheDocument()
    expect(screen.getByText('@drsharma')).toBeInTheDocument()

    // Status pills
    expect(screen.getByText('Online')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
  })
})
