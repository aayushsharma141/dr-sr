import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AppShell } from '../AppShell'

vi.mock('../../api/queries', () => ({
  useLogout: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useHealth: () => ({
    data: { status: 'ok', db: 'ok', setup_required: false },
    isError: false,
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
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

function renderShell(role: 'ADMIN' | 'RECEPTION' | 'DOCTOR', route = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AppShell name="Test User" role={role}>
          <div>Workspace content</div>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell clinical navigation hierarchy', () => {
  afterEach(() => cleanup())

  it('shows reception workflows without exposing clinical or admin-only modules', () => {
    renderShell('RECEPTION', '/reception/appointments?tab=today')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/reception')
    expect(within(primaryNav).getByRole('link', { name: 'Patient Registration' })).toHaveAttribute('href', '/reception/patients/new')
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('href', '/reception/patients')
    expect(within(primaryNav).getByRole('link', { name: 'Appointments' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Payments' })).toHaveAttribute('href', '/reception/dues')

    expect(within(primaryNav).queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Follow-up & Visits' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Hospital Configuration' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'User & Authority' })).not.toBeInTheDocument()
  })

  it('shows doctor clinical workflows and activates the follow-up deep link', () => {
    renderShell('DOCTOR', '/reception/appointments?tab=followup')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Physiotherapy Treatment' })).toHaveAttribute('href', '/doctor/treatment-plans')
    expect(within(primaryNav).getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('href', '/reception/appointments?tab=followup')
    expect(within(primaryNav).getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'User & Authority' })).not.toBeInTheDocument()
  })

  it('shows administration destinations once in a single primary sidebar for ADMIN without duplicates', () => {
    renderShell('ADMIN', '/admin/backups')

    // Exactly one primary navigation exists
    const navigations = screen.getAllByRole('navigation', { name: 'Primary navigation' })
    expect(navigations.length).toBeGreaterThanOrEqual(1)
    const primaryNav = navigations[0]

    // Verify sections and links for ADMIN
    expect(within(primaryNav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/admin')
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('href', '/reception/patients')
    expect(within(primaryNav).getByRole('link', { name: 'Appointments' })).toHaveAttribute('href', '/reception/appointments?tab=today')
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Payments' })).toHaveAttribute('href', '/reception/dues')

    // Hospital Administration
    expect(within(primaryNav).getByRole('link', { name: 'Hospital Configuration' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).getByRole('link', { name: 'Doctor & Clinical Configuration' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Financial' })).toHaveAttribute('href', '/admin/billing')

    // System Administration
    expect(within(primaryNav).getByRole('link', { name: 'User & Authority' })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: 'Security & Access' })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: 'Audit & Compliance' })).toHaveAttribute('href', '/admin/audit')
    expect(within(primaryNav).getByRole('link', { name: 'Backup, Restore & Data' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'System Health & Maintenance' })).toHaveAttribute('href', '/admin/system')

    // No second Administration sidebar / subnavigation
    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Administration modules' })).not.toBeInTheDocument()

    // No duplicate destinations across the screen
    expect(within(primaryNav).getAllByRole('link', { name: 'Backup, Restore & Data' })).toHaveLength(1)
    expect(within(primaryNav).getAllByRole('link', { name: 'Hospital Configuration' })).toHaveLength(1)

    // Doctor/Reception specific items not exposed
    expect(within(primaryNav).queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
  })

  it('opens a keyboard-accessible mobile navigation drawer', async () => {
    const user = userEvent.setup()
    renderShell('RECEPTION')
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    expect(screen.getAllByRole('button', { name: 'Close navigation menu' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('navigation', { name: 'Primary navigation' }).length).toBeGreaterThan(0)
  })
})
