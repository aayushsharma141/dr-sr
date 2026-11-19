import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '../../../test/dialog-shim'
import { DuplicateMergePage } from '../DuplicateMergePage'
import * as adminDataOps from '../../../api/admin-data-ops'

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
    expect(screen.getByText('Station Road, Ara')).toBeInTheDocument()
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

    const confirmUndoBtn = await screen.findByRole('button', { name: /confirm unmerge/i })
    await user.click(confirmUndoBtn)

    await waitFor(() => {
      expect(adminDataOps.unmergePatient).toHaveBeenCalledWith(2, expect.any(String))
    })
  })

  it('wraps the page in AppShell with admin identity (M15)', async () => {
    vi.mocked(adminDataOps.getDuplicateCandidates).mockResolvedValue([])

    render(<DuplicateMergePage />)

    await screen.findByText('Duplicate Patient Resolution')
    const shell = screen.getByTestId('app-shell')
    expect(shell).toHaveAttribute('data-role', 'ADMIN')
    expect(shell).toHaveAttribute('data-name', 'Admin User')
  })

  it('uses shared Modal dialog with Escape close, focus restore, and busy guard (M16-Phase23)', async () => {
    vi.mocked(adminDataOps.getDuplicateCandidates).mockResolvedValue([mockPair])
    let resolveMerge!: (value: adminDataOps.PatientMergeResult) => void
    vi.mocked(adminDataOps.mergePatients).mockImplementation(
      () => new Promise((resolve) => { resolveMerge = resolve }),
    )

    const user = userEvent.setup()
    render(<DuplicateMergePage />)

    const trigger = await screen.findByRole('button', { name: /compare & merge/i })
    await user.click(trigger)

    // Native <dialog> semantics and Escape dismissal + focus restore
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())

    // Reopen and verify busy state blocks Escape and disables Cancel
    await user.click(trigger)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /confirm alias merge/i }))

    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    resolveMerge({
      master: mockPair.master,
      secondary: { ...mockPair.duplicate, is_active: false },
      message: 'Merged',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
