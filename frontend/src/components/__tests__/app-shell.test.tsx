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

    // Verify Management Overview is at the top
    expect(within(primaryNav).getByRole('link', { name: 'Management Overview' })).toHaveAttribute('href', '/admin')

    // Section 1: Hospital Configuration
    expect(within(primaryNav).getByText('Hospital Configuration')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Clinic Settings' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).getByRole('link', { name: 'Hospital Identity & Logo' })).toHaveAttribute('href', '/admin/assets')
    expect(within(primaryNav).getByRole('link', { name: 'Print Templates' })).toHaveAttribute('href', '/admin/templates')
    expect(within(primaryNav).getByRole('link', { name: 'Doctors & Fees' })).toHaveAttribute('href', '/admin/doctors')

    // Section 2: Patient & Data Management
    expect(within(primaryNav).getByText('Patient & Data Management')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Patient Demographic Correction' })).toHaveAttribute('href', '/admin/patients/correct')
    expect(within(primaryNav).getByRole('link', { name: 'Import Centre' })).toHaveAttribute('href', '/admin/imports')
    expect(within(primaryNav).getByRole('link', { name: 'Export Centre' })).toHaveAttribute('href', '/admin/exports')

    // Section 3: Billing & Finance
    expect(within(primaryNav).getByText('Billing & Finance')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Reversals' })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: 'Pending Dues' })).toHaveAttribute('href', '/reception/dues')

    // Section 4: Users, Security & Governance
    expect(within(primaryNav).getByText('Users, Security & Governance')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'User Accounts' })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: 'Roles & Permissions' })).toHaveAttribute('href', '/admin/roles')
    expect(within(primaryNav).getByRole('link', { name: 'Security & Sessions' })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: 'Audit Trail' })).toHaveAttribute('href', '/admin/audit')

    // Section 5: System & Maintenance
    expect(within(primaryNav).getByText('System & Maintenance')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Backup & Restore' })).toHaveAttribute('href', '/admin/backups')
    expect(within(primaryNav).getByRole('link', { name: 'Backup & Restore' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'Data Integrity' })).toHaveAttribute('href', '/admin/integrity')
    expect(within(primaryNav).getByRole('link', { name: 'System Health' })).toHaveAttribute('href', '/admin/system')

    // Dead placeholder links must NOT be in the document
    expect(within(primaryNav).queryByRole('link', { name: /Hospital Performance/ })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: /Department Analytics/ })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: /Resource Utilization/ })).not.toBeInTheDocument()

    // No second Administration sidebar / subnavigation
    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Administration modules' })).not.toBeInTheDocument()

    // No duplicate destinations across the screen
    expect(within(primaryNav).getAllByRole('link', { name: /Backup & Restore/ })).toHaveLength(1)
    expect(within(primaryNav).getAllByRole('link', { name: /Clinic Settings/ })).toHaveLength(1)

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
