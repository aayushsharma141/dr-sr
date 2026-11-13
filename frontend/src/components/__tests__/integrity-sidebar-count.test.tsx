import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '../AppShell'

vi.mock('../../api/queries', () => ({
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

vi.mock('../../api/branding', () => ({
  useClinicBranding: () => ({
    trustNameEn: 'Sri Vashishtha Kalyan Trust',
    trustNameHi: 'श्री वशिष्ठ कल्याण ट्रस्ट',
    hospitalName: 'Kalyan Hospital',
    address: 'Hospital Road, Ara, Bhojpur, Bihar - 802301',
    locationLine: 'Ara, Bhojpur, Bihar',
  }),
}))

vi.mock('../../api/integrity', () => ({
  useLatestIntegrityRun: () => ({
    data: {
      checks: [
        {
          code: 'asset_files',
          severity: 'ERROR',
          discrepancies: [
            { issue: 'missing_asset_file', severity: 'ERROR' },
            { issue: 'orphan_asset_file', severity: 'CLEANUP' },
          ],
        },
        {
          code: 'photo_files',
          severity: 'CLEANUP',
          discrepancies: [{ issue: 'orphan_photo_file', severity: 'CLEANUP' }],
        },
      ],
    },
  }),
}))

describe('Data Integrity sidebar count', () => {
  it('counts problems from the last stored run, not clean-up items', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/admin']}>
          <AppShell name="Admin" role="ADMIN">
            <div />
          </AppShell>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    const links = screen.getAllByRole('link', { name: /^Integrity/ })
    expect(links[0]).toHaveAccessibleName('Integrity, 1 problem')
  })
})
