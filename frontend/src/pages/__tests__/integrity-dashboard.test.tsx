import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import type { IntegrityReportOut } from '../../api/types'
import { IntegrityDashboard } from '../admin/IntegrityDashboard'

const passedCheck = (code: string, name: string) => ({
  code,
  name,
  passed: true,
  severity: 'ERROR' as const,
  details: 'ok',
  discrepancies: [],
})

// Today's real local result: an active logo with no file, plus test leftovers.
const fileProblems: IntegrityReportOut = {
  id: 7,
  generated_at: '2026-11-08T14:21:00Z',
  run_by_username: 'admin',
  duration_ms: 12,
  is_healthy: false,
  total_checks: 7,
  passed_checks: 5,
  failed_checks: 1,
  warning_checks: 0,
  cleanup_checks: 1,
  checks: [
    passedCheck('package_payments', 'Financial Ledger & Package Invariants'),
    passedCheck('patient_id_unique', 'Patient URN Uniqueness'),
    { ...passedCheck('patient_id_gaps', 'Patient URN Sequence Gaps'), severity: 'WARNING' },
    passedCheck('receipt_unique', 'Sequential Receipt Number Uniqueness'),
    passedCheck('session_counts', 'Treatment Session Progress Synchronization'),
    {
      code: 'photo_files',
      name: 'Patient Photo Storage Consistency',
      passed: false,
      severity: 'CLEANUP',
      details: 'Found 2 photo storage discrepancies',
      discrepancies: [
        { issue: 'orphan_photo_file', severity: 'CLEANUP', filename: 'a.jpg', bytes: 12 },
        { issue: 'orphan_photo_file', severity: 'CLEANUP', filename: 'b.jpg', bytes: 12 },
      ],
    },
    {
      code: 'asset_files',
      name: 'Hospital Asset Storage Consistency',
      passed: false,
      severity: 'ERROR',
      details: 'Found 2 asset storage discrepancies',
      discrepancies: [
        {
          issue: 'missing_asset_file',
          severity: 'ERROR',
          asset_id: 1,
          asset_type: 'LOGO',
          is_active: true,
          original_filename: 'crest.jpeg',
          filename: 'x.jpg',
        },
        { issue: 'orphan_asset_file', severity: 'CLEANUP', filename: 'asset_1.png', bytes: 33 },
      ],
    },
  ],
}

const state = {
  latest: fileProblems as IntegrityReportOut | null,
  mutate: vi.fn(),
}

vi.mock('../../api/queries', () => ({
  useMe: () => ({ data: { full_name: 'Admin', role: 'ADMIN' } }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../api/integrity', () => ({
  useLatestIntegrityRun: () => ({
    data: state.latest,
    isPending: false,
    isSuccess: true,
    isError: false,
  }),
  useIntegrityHistory: () => ({
    data: {
      runs: [
        {
          id: 7,
          generated_at: '2026-11-08T14:21:00Z',
          run_by_username: 'admin',
          is_healthy: false,
          total_checks: 7,
          passed_checks: 5,
          failed_checks: 1,
          warning_checks: 0,
          cleanup_checks: 1,
        },
      ],
    },
  }),
  useRunIntegrityCheck: () => ({ mutate: state.mutate, isPending: false, isError: false }),
}))

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <IntegrityDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('IntegrityDashboard', () => {
  beforeEach(() => {
    state.latest = fileProblems
    state.mutate.mockReset()
  })

  it('uses the same name as the sidebar and shows who ran the stored check', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Data Integrity' })).toBeInTheDocument()
    expect(screen.getByText(/Last checked .* by admin · read-only/)).toBeInTheDocument()
  })

  it('ranks a missing logo above leftover files and links to the fix', () => {
    renderPage()
    expect(screen.getByRole('heading', { level: 2, name: '1 problem, 1 clean-up item' })).toBeInTheDocument()
    expect(screen.getByText(/patient, payment and treatment records are consistent/)).toBeInTheDocument()

    const findings = within(screen.getByRole('region', { name: 'Findings' })).getAllByRole('heading', { level: 3 })
    expect(findings.map((h) => h.textContent)).toEqual([
      'Hospital logo file is missing',
      '3 stored files are not linked to any record',
    ])
    expect(screen.getByRole('link', { name: 'Upload Again' })).toHaveAttribute('href', '/admin/settings#hospital-crest')
    expect(screen.getByText('2 in patient photos, 1 in hospital files', { exact: false })).toBeInTheDocument()
  })

  it('shows small files in bytes, not as 0.0 KB', () => {
    renderPage()
    expect(screen.getByText(/a\.jpg · 12 bytes/)).toBeInTheDocument()
    expect(screen.queryByText(/0\.0 KB/)).not.toBeInTheDocument()
  })

  it('folds passed checks into one row with plain names', () => {
    renderPage()
    expect(screen.getByText('Passed · 5 checks')).toBeInTheDocument()
    expect(screen.getAllByText('Treatment package payments').length).toBeGreaterThan(0)
  })

  it('runs a new check only from the button', () => {
    renderPage()
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Run Check Now' }))
    expect(state.mutate).toHaveBeenCalledTimes(1)
  })

  it('lists recorded runs', () => {
    renderPage()
    const table = within(screen.getByRole('region', { name: 'Recent runs' })).getByRole('table')
    expect(within(table).getByText('5 of 7 passed · 1 with a problem · 1 with clean-up')).toBeInTheDocument()
  })

  it('shows the records card as verified only when the record checks pass', () => {
    renderPage()
    expect(screen.getByText('100% Invariant Verified')).toBeInTheDocument()
    expect(screen.getByText('Patient URNs, receipts, ledgers & sessions intact')).toBeInTheDocument()
  })

  it('does not show a green tick when a payment record is wrong', () => {
    state.latest = {
      ...fileProblems,
      checks: fileProblems.checks.map((check) =>
        check.code === 'package_payments'
          ? {
              ...check,
              passed: false,
              discrepancies: [
                {
                  issue: 'overpaid_ledger',
                  severity: 'ERROR',
                  plan_id: 4,
                  patient_id: 9,
                  agreed_price_paise: 100000,
                  paid_sum_paise: 120000,
                  excess_paise: 20000,
                },
              ],
            }
          : check,
      ),
    }
    renderPage()
    const status = screen.getByText('Discrepancies in Records')
    const icon = status.previousElementSibling
    expect(icon).toHaveTextContent('!')
    expect(icon).not.toHaveTextContent('✓')
    expect(screen.getByText('Patient URNs, receipts, ledgers or sessions need follow-up')).toBeInTheDocument()
    expect(screen.queryByText('Patient URNs, receipts, ledgers & sessions intact')).not.toBeInTheDocument()
  })

  it('explains what to do when no check has run yet', () => {
    state.latest = null
    renderPage()
    expect(screen.getByRole('heading', { name: 'No check has been run yet' })).toBeInTheDocument()
  })
})
