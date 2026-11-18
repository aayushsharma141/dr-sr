import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../test/dialog-shim'
import { BulkArchivePage } from '../BulkArchivePage'
import * as adminDataOps from '../../../api/admin-data-ops'
import * as clientModule from '../../../api/client'

vi.mock('../../../components/AppShell', () => ({
  AppShell: ({ name, role, children }: { name: string; role: string; children: ReactNode }) => (
    <div data-testid="app-shell" data-name={name} data-role={role}>
      {children}
    </div>
  ),
}))

vi.mock('../../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Admin User', role: 'ADMIN' } }),
}))

vi.mock('../../../api/admin-data-ops', () => ({
  getArchivalCandidates: vi.fn(),
  bulkArchivePatients: vi.fn(),
  unarchivePatient: vi.fn(),
}))

vi.mock('../../../api/client', () => ({
  apiFetch: vi.fn(),
}))

const mockEligible: adminDataOps.ArchivalCandidateItem = {
  patient: {
    id: 10,
    urn: 'URN-ARC-010',
    full_name: 'Dinesh Prasad',
    guardian_name: 'Father',
    gender: 'M',
    dob: null,
    age_years: 55,
    mobile: '9811155555',
    address: 'Old Town, Ara',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: null,
    allergies: 'None',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2022-01-01T00:00:00Z',
    updated_at: '2022-01-01T00:00:00Z',
  },
  last_activity_date: '2022-01-01',
  visit_count: 0,
  total_dues_paise: 0,
  can_archive: true,
}

const mockIneligibleWithDues: adminDataOps.ArchivalCandidateItem = {
  patient: {
    id: 20,
    urn: 'URN-ARC-020',
    full_name: 'Gita Devi',
    guardian_name: 'Husband',
    gender: 'F',
    dob: null,
    age_years: 48,
    mobile: '9811166666',
    address: 'Main Bazar, Ara',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: null,
    allergies: 'None',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2022-01-01T00:00:00Z',
    updated_at: '2022-01-01T00:00:00Z',
  },
  last_activity_date: '2022-01-01',
  visit_count: 1,
  total_dues_paise: 50000,
  can_archive: false,
  blocking_reason: 'Patient has outstanding dues of ₹500.00',
}

describe('BulkArchivePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders candidates table and flags patients with outstanding dues as ineligible', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([mockEligible, mockIneligibleWithDues])

    render(<BulkArchivePage />)

    expect(await screen.findByText('Patient Record Archival')).toBeInTheDocument()
    expect(screen.getByText(/URN-ARC-010/)).toBeInTheDocument()
    expect(screen.getByText(/URN-ARC-020/)).toBeInTheDocument()

    // Outstanding dues is formatted
    expect(screen.getByText('₹500.00')).toBeInTheDocument()
    expect(screen.getByText(/outstanding dues of ₹500\.00/i)).toBeInTheDocument()

    // Checkboxes: eligible is enabled, debtor is disabled
    const checkboxes = screen.getAllByRole('checkbox')
    // Index 0 is select-all, 1 is filter zero visits, 2 is p10, 3 is p20
    const p10Check = checkboxes.find((cb) => (cb as HTMLInputElement).disabled === false && cb !== checkboxes[0] && cb !== checkboxes[1])
    const p20Check = checkboxes.find((cb) => (cb as HTMLInputElement).disabled === true)
    expect(p10Check).toBeDefined()
    expect(p20Check).toBeDefined()
  })

  it('selects eligible records and executes bulk archival modal', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([mockEligible])
    vi.mocked(adminDataOps.bulkArchivePatients).mockResolvedValue({
      archived_count: 1,
      skipped_count: 0,
      skipped_details: [],
      message: 'Successfully archived 1 patient record(s).',
    })

    const user = userEvent.setup()
    render(<BulkArchivePage />)

    await screen.findByText(/URN-ARC-010/)

    // Click select all
    const selectAll = screen.getByTitle('Select all eligible')
    await user.click(selectAll)

    const archiveBtn = screen.getByRole('button', { name: /archive selected \(1\)/i })
    expect(archiveBtn).not.toBeDisabled()
    await user.click(archiveBtn)

    // Modal opens
    expect(screen.getByText(/confirm bulk archival/i)).toBeInTheDocument()
    const confirmBtn = screen.getByRole('button', { name: /archive 1 files/i })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(adminDataOps.bulkArchivePatients).toHaveBeenCalledWith({
        patient_ids: [10],
        reason: expect.any(String),
      })
    })
  })

  it('switches to archived tab and supports restoring patient', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([])
    vi.mocked(clientModule.apiFetch).mockResolvedValue([
      {
        ...mockEligible.patient,
        is_archived: true,
        archive_reason: 'Prior test archive',
      },
    ])
    vi.mocked(adminDataOps.unarchivePatient).mockResolvedValue({
      ...mockEligible.patient,
      is_archived: false,
    })

    const user = userEvent.setup()
    render(<BulkArchivePage />)

    // Switch to Archived Patient Files tab
    const tabBtn = screen.getByRole('button', { name: /archived patient files/i })
    await user.click(tabBtn)

    expect(await screen.findByText('Prior test archive')).toBeInTheDocument()
    // M8: must explicitly request status=archived (backend defaults to status=active)
    expect(clientModule.apiFetch).toHaveBeenCalledWith('/patients?status=archived&limit=100')

    const restoreBtn = screen.getByRole('button', { name: /restore record/i })
    await user.click(restoreBtn)

    await waitFor(() => {
      expect(adminDataOps.unarchivePatient).toHaveBeenCalledWith(10, expect.any(String))
    })
  })

  it('wraps the page in AppShell with admin identity (M15)', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([])

    render(<BulkArchivePage />)

    await screen.findByText('Patient Record Archival')
    const shell = screen.getByTestId('app-shell')
    expect(shell).toHaveAttribute('data-role', 'ADMIN')
    expect(shell).toHaveAttribute('data-name', 'Admin User')
  })

  it('shows a limit notice when 100 archived patients are returned (M8)', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([])
    const hundredArchived = Array.from({ length: 100 }, (_, i) => ({
      ...mockEligible.patient,
      id: 1000 + i,
      urn: `URN-ARC-${1000 + i}`,
      is_archived: true,
      archive_reason: 'Retention policy',
    }))
    vi.mocked(clientModule.apiFetch).mockResolvedValue(hundredArchived)

    const user = userEvent.setup()
    render(<BulkArchivePage />)

    await user.click(screen.getByRole('button', { name: /archived patient files/i }))
    expect(await screen.findByText(/showing first 100 archived/i)).toBeInTheDocument()
  })

  it('uses shared Modal dialog with Escape close, focus restore, and busy guard (M16-Phase23)', async () => {
    vi.mocked(adminDataOps.getArchivalCandidates).mockResolvedValue([mockEligible])
    let resolveArchive!: (value: adminDataOps.BulkArchiveResult) => void
    vi.mocked(adminDataOps.bulkArchivePatients).mockImplementation(
      () => new Promise((resolve) => { resolveArchive = resolve }),
    )

    const user = userEvent.setup()
    render(<BulkArchivePage />)

    await screen.findByText(/URN-ARC-010/)
    await user.click(screen.getByTitle('Select all eligible'))

    const trigger = screen.getByRole('button', { name: /archive selected \(1\)/i })
    await user.click(trigger)

    // Native <dialog> semantics and Escape dismissal + focus restore
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    // Reopen and verify busy state blocks Escape and disables Cancel
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /archive 1 files/i }))

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    resolveArchive({
      archived_count: 1,
      skipped_count: 0,
      skipped_details: [],
      message: 'Archived 1 patient',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
