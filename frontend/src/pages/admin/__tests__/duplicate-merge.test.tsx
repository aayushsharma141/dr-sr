import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DuplicateMergePage } from '../DuplicateMergePage'
import * as adminDataOps from '../../../api/admin-data-ops'

vi.mock('../../../api/admin-data-ops', () => ({
  getDuplicateCandidates: vi.fn(),
  mergePatients: vi.fn(),
  unmergePatient: vi.fn(),
}))

const mockPair: adminDataOps.DuplicateCandidatePair = {
  master: {
    id: 1,
    urn: 'URN-M-001',
    full_name: 'Sanjay Sharma',
    guardian_name: 'Ram Sharma',
    gender: 'M',
    dob: '1985-05-15',
    age_years: 41,
    mobile: '9811122233',
    address: 'Ara, Bihar',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: null,
    allergies: 'None reported',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  duplicate: {
    id: 2,
    urn: 'URN-D-002',
    full_name: 'Sanjay  Sharma',
    guardian_name: 'Ram Sharma',
    gender: 'M',
    dob: '1985-05-15',
    age_years: 41,
    mobile: '9811122233',
    address: 'Station Road, Ara',
    district: 'Bhojpur',
    state: 'Bihar',
    emergency_contact: null,
    allergies: 'Penicillin',
    notes: null,
    photo_path: null,
    is_active: true,
    version_id: 1,
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
  },
  similarity_score: 1.0,
  match_reason: 'Exact mobile and normalized name match',
  master_visit_count: 3,
  duplicate_visit_count: 1,
  has_open_visit: false,
}

describe('DuplicateMergePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders suspected pairs and opens side-by-side comparison modal', async () => {
    vi.mocked(adminDataOps.getDuplicateCandidates).mockResolvedValue([mockPair])
    const user = userEvent.setup()

    render(<DuplicateMergePage />)

    expect(await screen.findByText('Duplicate Patient Resolution')).toBeInTheDocument()
    expect(screen.getByText(/URN-M-001/)).toBeInTheDocument()
    expect(screen.getByText(/URN-D-002/)).toBeInTheDocument()

    // Click Compare & Merge
    await user.click(screen.getByRole('button', { name: /compare & merge/i }))

    expect(screen.getByText(/compare & merge patient records/i)).toBeInTheDocument()
    expect(screen.getByText('Penicillin')).toBeInTheDocument()
  })

  it('disables merge button and shows warning if candidate has open visit', async () => {
    const pairWithOpenVisit = { ...mockPair, has_open_visit: true }
    vi.mocked(adminDataOps.getDuplicateCandidates).mockResolvedValue([pairWithOpenVisit])
    const user = userEvent.setup()

    render(<DuplicateMergePage />)

    await user.click(await screen.findByRole('button', { name: /compare & merge/i }))

    expect(screen.getByText(/cannot merge/i)).toBeInTheDocument()
    const mergeBtn = screen.getByRole('button', { name: /confirm alias merge/i })
    expect(mergeBtn).toBeDisabled()
  })

  it('submits merge with overrides and provides immediate undo', async () => {
    vi.mocked(adminDataOps.getDuplicateCandidates).mockResolvedValue([mockPair])
    vi.mocked(adminDataOps.mergePatients).mockResolvedValue({
      master: mockPair.master,
      secondary: { ...mockPair.duplicate, is_active: false },
      message: 'Successfully merged patient',
    })
    vi.mocked(adminDataOps.unmergePatient).mockResolvedValue({
      ...mockPair.duplicate,
      is_active: true,
    })

    const user = userEvent.setup()
    render(<DuplicateMergePage />)

    await user.click(await screen.findByRole('button', { name: /compare & merge/i }))

    // Click merge
    const mergeBtn = screen.getByRole('button', { name: /confirm alias merge/i })
    expect(mergeBtn).not.toBeDisabled()
    await user.click(mergeBtn)

    await waitFor(() => {
      expect(adminDataOps.mergePatients).toHaveBeenCalled()
    })

    // Undo banner appears
    expect(await screen.findByText(/recent merges in this session/i)).toBeInTheDocument()
    const undoBtn = screen.getByRole('button', { name: /undo merge/i })
    await user.click(undoBtn)

    await waitFor(() => {
      expect(adminDataOps.unmergePatient).toHaveBeenCalledWith(2, expect.any(String))
    })
  })
})
