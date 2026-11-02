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
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users & Permissions' })).not.toBeInTheDocument()
  })

  it('shows doctor clinical workflows and activates the follow-up deep link', () => {
    renderShell('DOCTOR', '/reception/appointments?tab=followup')

    expect(screen.getByRole('link', { name: 'Physiotherapy Treatment' })).toHaveAttribute('href', '/doctor/treatment-plans')
    expect(screen.getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('href', '/reception/appointments?tab=followup')
    expect(screen.getByRole('link', { name: 'Follow-up & Visits' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Users & Permissions' })).not.toBeInTheDocument()
  })

  it('shows all six administration sub-navigation destinations for ADMIN', () => {
    renderShell('ADMIN', '/admin/backups')

    const adminNavigation = screen.getByRole('navigation', { name: 'Administration sections' })
    expect(within(adminNavigation).getByRole('link', { name: 'Doctors & Fees' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(adminNavigation).getByRole('link', { name: 'Users & Roles' })).toHaveAttribute('href', '/admin/users')
    expect(within(adminNavigation).getByRole('link', { name: 'Audit Logs' })).toHaveAttribute('href', '/admin/audit')
    expect(within(adminNavigation).getByRole('link', { name: 'Backup & Restore' })).toHaveAttribute('aria-current', 'page')
    expect(within(adminNavigation).getByRole('link', { name: 'System Integrity' })).toHaveAttribute('href', '/admin/integrity')
    expect(within(adminNavigation).getByRole('link', { name: 'Clinic Settings' })).toHaveAttribute('href', '/admin/settings')

    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/admin/integrity')
    expect(screen.getByRole('link', { name: 'Master Data' })).toHaveAttribute('href', '/admin/doctors')
    expect(screen.queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
  })

  it('opens a keyboard-accessible mobile navigation drawer', async () => {
    const user = userEvent.setup()
    renderShell('RECEPTION')
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    expect(screen.getByRole('button', { name: 'Close navigation menu' })).toBeInTheDocument()
    expect(screen.getAllByRole('navigation', { name: 'Primary navigation' }).length).toBeGreaterThan(0)
  })
})
