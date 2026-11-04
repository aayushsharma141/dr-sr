import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { IntegrityDashboard } from '../admin/IntegrityDashboard'

const sampleReport = {
  generated_at: '2026-11-02T10:00:00Z',
  is_healthy: true,
  total_checks: 5,
  passed_checks: 5,
  failed_checks: 0,
  checks: [
    {
      name: 'Financial Ledger & Package Invariants',
      passed: true,
      details: 'All treatment plan packages have balanced ledgers and no overpayments',
      discrepancies: [],
    },
    {
      name: 'Patient URN Uniqueness',
      passed: true,
      details: 'All patient URNs are unique',
      discrepancies: [],
    },
    {
      name: 'Sequential Receipt Number Uniqueness',
      passed: true,
      details: 'All payment receipt numbers are unique',
      discrepancies: [],
    },
    {
      name: 'Treatment Session Progress Synchronization',
      passed: true,
      details: 'All treatment plans have accurate completed session counts',
      discrepancies: [],
    },
    {
      name: 'Patient Photo Storage Consistency',
      passed: true,
      details: 'All patient photos exist and no untracked orphans found',
      discrepancies: [],
    },
  ],
}

vi.mock('../../api/queries', () => ({
  useIntegrityCheck: () => ({
    data: sampleReport,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
  useLogout: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}))

describe('IntegrityDashboard', () => {
  const queryClient = new QueryClient()

  it('renders overall healthy banner and all 5 invariant check cards', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <IntegrityDashboard />
        </MemoryRouter>
      </QueryClientProvider>
    )

    expect(screen.getByText('System Integrity')).toBeInTheDocument()
    expect(screen.getByText('All System Invariants Intact & Verified')).toBeInTheDocument()
    expect(screen.getByText('Financial Ledger & Package Invariants')).toBeInTheDocument()
    expect(screen.getByText('Patient URN Uniqueness')).toBeInTheDocument()
    expect(screen.getByText('Sequential Receipt Number Uniqueness')).toBeInTheDocument()
    expect(screen.getByText('Treatment Session Progress Synchronization')).toBeInTheDocument()
    expect(screen.getByText('Patient Photo Storage Consistency')).toBeInTheDocument()
    expect(screen.getAllByText('PASSED').length).toBe(5)
  })
})
