import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AreaHome } from '../AreaHome'
import {
  ADMIN_MODULES,
  ADMIN_MODULE_GROUPS,
  adminModulesInGroup,
  findAdminModuleForPath,
} from '../../admin/modules'

vi.mock('../../api/queries', () => ({
  useLogout: () => ({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  }),
  useOverview: () => ({
    data: {
      name: 'Superintendent Admin',
      role: 'ADMIN',
      alerts: [],
      user_counts: {
        ADMIN: { active: 1, inactive: 0 },
        RECEPTION: { active: 2, inactive: 0 },
        DOCTOR: { active: 1, inactive: 0 },
      },
      doctor_queues: [],
      system_state: {
        storage_free: { data_volume_bytes: 1000000000, backup_volume_bytes: 1000000000 },
      },
      recent_admin_actions: [],
    },
    isPending: false,
    isError: false,
    error: null,
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

function renderAreaHome() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/admin']}>
        <AreaHome area="admin" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Administration Module Registry Invariants', () => {
  it('contains unique module IDs and display orders', () => {
    const ids = new Set<string>()
    const orders = new Set<number>()

    for (const mod of ADMIN_MODULES) {
      expect(ids.has(mod.id), `Duplicate module ID: ${mod.id}`).toBe(false)
      ids.add(mod.id)

      expect(orders.has(mod.displayOrder), `Duplicate displayOrder: ${mod.displayOrder}`).toBe(false)
      orders.add(mod.displayOrder)

      expect(['hospital', 'system']).toContain(mod.group)
      expect(['available', 'partial', 'fixed']).toContain(mod.status)
    }
  })

  it('unimplemented/fixed modules have zero navigation actions (no misleading destinations)', () => {
    const fixedModules = ADMIN_MODULES.filter((m) => m.status === 'fixed')
    expect(fixedModules.length).toBeGreaterThanOrEqual(2)

    for (const mod of fixedModules) {
      expect(mod.actions, `Fixed module ${mod.id} must not have actions`).toHaveLength(0)
      expect(mod.statusReason).toBeTruthy()
    }
  })

  it('implemented modules map to canonical, existing routes', () => {
    const activeModules = ADMIN_MODULES.filter((m) => m.status !== 'fixed')
    for (const mod of activeModules) {
      expect(mod.actions.length).toBeGreaterThan(0)
      for (const action of mod.actions) {
        expect(action.path).toMatch(/^\/(admin|reception)\//)
      }
    }
  })

  it('findAdminModuleForPath matches canonical routes correctly', () => {
    expect(findAdminModuleForPath('/admin/settings')?.module.id).toBe('hospital-configuration')
    expect(findAdminModuleForPath('/admin/doctors')?.module.id).toBe('doctor-clinical')
    expect(findAdminModuleForPath('/admin/billing')?.module.id).toBe('billing-financial')
    expect(findAdminModuleForPath('/admin/users')?.module.id).toBe('user-authority')
    expect(findAdminModuleForPath('/admin/roles')?.module.id).toBe('user-authority')
    expect(findAdminModuleForPath('/admin/security')?.module.id).toBe('security-access')
    expect(findAdminModuleForPath('/admin/audit')?.module.id).toBe('audit-compliance')
    expect(findAdminModuleForPath('/admin/backups')?.module.id).toBe('backup-data')
    expect(findAdminModuleForPath('/admin/integrity')?.module.id).toBe('backup-data')
    expect(findAdminModuleForPath('/admin/system')?.module.id).toBe('system-health')
  })
})

describe('Administration Dashboard & Single Sidebar Layout', () => {
  afterEach(() => cleanup())

  it('renders exactly one primary sidebar and no duplicate subnavigation panel', () => {
    renderAreaHome()

    // Exactly one primary navigation sidebar exists
    const primaryNavs = screen.getAllByRole('navigation', { name: 'Primary navigation' })
    expect(primaryNavs.length).toBe(1)

    // No secondary administration sidebar
    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Administration modules' })).not.toBeInTheDocument()
  })

  it('renders both Hospital and System Administration module cards on the dashboard', () => {
    renderAreaHome()

    // Dashboard heading
    expect(screen.getByRole('heading', { name: 'Administration Dashboard' })).toBeInTheDocument()

    // Modules section
    const modulesSection = screen.getByRole('region', { name: 'Administration Modules' })
    expect(within(modulesSection).getByRole('heading', { name: 'Administration Modules' })).toBeInTheDocument()

    // Both groups are rendered
    for (const group of ADMIN_MODULE_GROUPS) {
      expect(within(modulesSection).getByRole('heading', { name: group.label })).toBeInTheDocument()
      for (const mod of adminModulesInGroup(group.id)) {
        expect(within(modulesSection).getByText(mod.title)).toBeInTheDocument()
        expect(within(modulesSection).getByText(mod.description)).toBeInTheDocument()
      }
    }

    // Pending decision badges are visible on fixed modules
    const pendingBadges = within(modulesSection).getAllByText('Pending Decision')
    expect(pendingBadges.length).toBe(2)

    // Action links navigate to canonical paths
    expect(within(modulesSection).getByRole('link', { name: 'Clinic settings' })).toHaveAttribute('href', '/admin/settings')
    expect(within(modulesSection).getByRole('link', { name: 'Doctors & fees' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(modulesSection).getByRole('link', { name: 'Billing & reversals' })).toHaveAttribute('href', '/admin/billing')
    expect(within(modulesSection).getByRole('link', { name: 'User accounts' })).toHaveAttribute('href', '/admin/users')
    expect(within(modulesSection).getByRole('link', { name: 'Roles & permissions' })).toHaveAttribute('href', '/admin/roles')
    expect(within(modulesSection).getByRole('link', { name: 'Security & access' })).toHaveAttribute('href', '/admin/security')
    expect(within(modulesSection).getByRole('link', { name: 'Audit log viewer' })).toHaveAttribute('href', '/admin/audit')
    expect(within(modulesSection).getByRole('link', { name: 'Backup & restore' })).toHaveAttribute('href', '/admin/backups')
    expect(within(modulesSection).getByRole('link', { name: 'Data integrity' })).toHaveAttribute('href', '/admin/integrity')
    expect(within(modulesSection).getByRole('link', { name: 'System health' })).toHaveAttribute('href', '/admin/system')
  })

  it('sidebar and dashboard card destinations match for all canonical routes', () => {
    renderAreaHome()

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })

    // Sidebar items match canonical routes
    expect(within(primaryNav).getByRole('link', { name: 'Hospital Configuration' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).getByRole('link', { name: 'Doctor & Clinical Configuration' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Financial' })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: 'User & Authority' })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: 'Security & Access' })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: 'Audit & Compliance' })).toHaveAttribute('href', '/admin/audit')
    expect(within(primaryNav).getByRole('link', { name: 'Backup, Restore & Data' })).toHaveAttribute('href', '/admin/backups')
    expect(within(primaryNav).getByRole('link', { name: 'System Health & Maintenance' })).toHaveAttribute('href', '/admin/system')
  })
})
