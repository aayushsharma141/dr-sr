import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { AppShell } from '../AppShell'

vi.mock('../../api/queries', () => ({
  useLogout: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
}))

function renderShell(role: 'ADMIN' | 'RECEPTION' | 'DOCTOR', route = '/') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell name="Test User" role={role}>
        <div>Workspace content</div>
      </AppShell>
    </MemoryRouter>,
  )
}

describe('AppShell clinical navigation hierarchy', () => {
  afterEach(() => cleanup())

  it('shows reception workflows without exposing clinical or admin-only modules', () => {
    renderShell('RECEPTION', '/reception/appointments?tab=today')

    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/reception')
    expect(screen.getByRole('link', { name: 'Patient Registration' })).toHaveAttribute('href', '/reception/patients/new')
    expect(screen.getByRole('link', { name: 'Patient Records' })).toHaveAttribute('href', '/reception/patients')
    expect(screen.getByRole('link', { name: 'Appointments' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Billing & Payments' })).toHaveAttribute('href', '/reception/dues')

    expect(screen.queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Follow-up & Visits' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Audit & Compliance' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'User & Authority' })).not.toBeInTheDocument()
  })

  it('shows doctor clinical workflows and activates the follow-up deep link', () => {
    renderShell('DOCTOR', '/reception/appointments?tab=followup')

    expect(screen.getByRole('link', { name: 'Physiotherapy Treatment' })).toHaveAttribute('href', '/doctor/treatment-plans')
    expect(screen.getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('href', '/reception/appointments?tab=followup')
    expect(screen.getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'User & Authority' })).not.toBeInTheDocument()
  })

  it('shows the grouped administration sub-navigation from the module registry for ADMIN', () => {
    renderShell('ADMIN', '/admin/backups')

    const adminNavigation = screen.getByRole('navigation', { name: 'Administration sections' })
    const hospital = within(adminNavigation).getByRole('region', { name: 'Hospital Administration' })
    const system = within(adminNavigation).getByRole('region', { name: 'System Administration' })

    // Hospital Administration: 01, 03, 04, 06 (three links), 08. 05 and 07 are fixed: not shown.
    expect(within(hospital).getByRole('link', { name: 'Administration Dashboard' })).toHaveAttribute('href', '/admin')
    expect(within(hospital).getByRole('link', { name: 'Hospital Configuration' })).toHaveAttribute('href', '/admin/settings')
    expect(within(hospital).getByRole('link', { name: 'Doctor & Clinical Configuration' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(hospital).getByRole('link', { name: 'Consultation fees' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(hospital).getByRole('link', { name: 'Receipt numbering cycle' })).toHaveAttribute('href', '/admin/settings')
    expect(within(hospital).getByRole('link', { name: 'Pending dues' })).toHaveAttribute('href', '/reception/dues')
    expect(within(hospital).getByRole('link', { name: 'Prescription & Print' })).toHaveAttribute('href', '/admin/settings')
    expect(within(adminNavigation).queryByText('Appointment & Workflow Settings')).not.toBeInTheDocument()
    expect(within(adminNavigation).queryByText('Physiotherapy Configuration')).not.toBeInTheDocument()

    // System Administration: 02 (two links), 09, 10, 11 (two links), 12.
    expect(within(system).getByRole('link', { name: 'User accounts' })).toHaveAttribute('href', '/admin/users')
    expect(within(system).getByRole('link', { name: 'Roles & permissions' })).toHaveAttribute('href', '/admin/roles')
    expect(within(system).getByRole('link', { name: 'Security & Access' })).toHaveAttribute('href', '/admin/security')
    expect(within(system).getByRole('link', { name: 'Audit & Compliance' })).toHaveAttribute('href', '/admin/audit')
    expect(within(system).getByRole('link', { name: 'Backup & restore' })).toHaveAttribute('aria-current', 'page')
    expect(within(system).getByRole('link', { name: 'Data integrity' })).toHaveAttribute('href', '/admin/integrity')
    expect(within(system).getByRole('link', { name: 'System Health & Maintenance' })).toHaveAttribute('href', '/admin/system')

    // Exactly one sub-navigation entry is current.
    expect(
      within(adminNavigation).getAllByRole('link').filter((l) => l.getAttribute('aria-current') === 'page'),
    ).toHaveLength(1)

    expect(screen.queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
  })

  it('marks only the owning module current for a page shared by several modules', () => {
    renderShell('ADMIN', '/admin/settings')

    const adminNavigation = screen.getByRole('navigation', { name: 'Administration sections' })
    const current = within(adminNavigation)
      .getAllByRole('link')
      .filter((l) => l.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName('Hospital Configuration')
    expect(within(adminNavigation).getByRole('link', { name: 'Receipt numbering cycle' })).not.toHaveAttribute('aria-current')
    expect(within(adminNavigation).getByRole('link', { name: 'Prescription & Print' })).not.toHaveAttribute('aria-current')
  })

  it('drives the ADMIN sidebar entries and breadcrumbs from the module registry', () => {
    renderShell('ADMIN', '/admin/roles')

    const primary = screen.getAllByRole('navigation', { name: 'Primary navigation' })[0]
    expect(within(primary).getByRole('link', { name: 'User & Authority' })).toHaveAttribute('href', '/admin/users')
    // Module 02 owns both /admin/users and /admin/roles.
    expect(within(primary).getByRole('link', { name: 'User & Authority' })).toHaveAttribute('aria-current', 'page')
    expect(within(primary).getByRole('link', { name: 'Hospital Configuration' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primary).getByRole('link', { name: 'Doctor & Clinical Configuration' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(primary).getByRole('link', { name: 'Security & Access' })).toHaveAttribute('href', '/admin/security')
    expect(within(primary).getByRole('link', { name: 'Audit & Compliance' })).toHaveAttribute('href', '/admin/audit')
    expect(within(primary).getByRole('link', { name: 'Backup, Restore & Data' })).toHaveAttribute('href', '/admin/backups')
    expect(within(primary).getByRole('link', { name: 'System Health & Maintenance' })).toHaveAttribute('href', '/admin/system')
    expect(within(primary).queryByRole('link', { name: 'Users & Permissions' })).not.toBeInTheDocument()
    expect(within(primary).queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
    expect(within(primary).queryByRole('link', { name: 'Master Data' })).not.toBeInTheDocument()

    const breadcrumbs = screen.getByRole('navigation', { name: 'Breadcrumbs' })
    expect(within(breadcrumbs).getByRole('link', { name: 'Administration Dashboard' })).toHaveAttribute('href', '/admin')
    expect(within(breadcrumbs).getByRole('link', { name: 'User & Authority' })).toHaveAttribute('href', '/admin/users')
    expect(within(breadcrumbs).getByText('Roles & permissions')).toHaveAttribute('aria-current', 'location')
  })

  it('shows the administration sub-navigation on the admin dashboard and never for other roles', () => {
    renderShell('ADMIN', '/admin')
    const adminNavigation = screen.getByRole('navigation', { name: 'Administration sections' })
    expect(within(adminNavigation).getByRole('link', { name: 'Administration Dashboard' })).toHaveAttribute('aria-current', 'page')
    cleanup()

    renderShell('RECEPTION', '/reception/dues')
    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).not.toBeInTheDocument()
  })

  it('collapses the administration sub-navigation behind a toggle on narrow widths', async () => {
    const user = userEvent.setup()
    renderShell('ADMIN', '/admin/audit')

    const toggle = screen.getByRole('button', { name: 'All modules' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('navigation', { name: 'Administration sections' })).toHaveClass('hidden', 'lg:block')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide modules' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Administration sections' })).toHaveClass('block')
  })

  it('opens a keyboard-accessible mobile navigation drawer', async () => {
    const user = userEvent.setup()
    renderShell('RECEPTION')
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: 'Primary navigation' }).length).toBeGreaterThan(0)
  })
})
