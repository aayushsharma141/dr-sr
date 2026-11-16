import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BulkArchivePage } from '../BulkArchivePage'
import * as adminDataOps from '../../../api/admin-data-ops'
import * as clientModule from '../../../api/client'

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

    const restoreBtn = screen.getByRole('button', { name: /restore record/i })
    await user.click(restoreBtn)

    await waitFor(() => {
      expect(adminDataOps.unarchivePatient).toHaveBeenCalledWith(10, expect.any(String))
    })
  })
})
