import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AreaHome } from '../AreaHome'
import {
  ADMIN_MODULES,
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
      business_date: '2026-11-09',
      collections_today: {
        gross_paise: 1250000,
        reversed_paise: 0,
        payments_count: 5,
        reversals_count: 0,
        by_method: { CASH: 800000, UPI: 450000 },
      },
      outstanding_dues_paise: 4260000,
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
  useManagementOverview: () => ({
    data: {
      current_month_label: 'Nov 2026',
      previous_month_label: 'Oct 2026',
      collections_paise: { current: 84200000, previous: 74900000, change_pct: 12.4 },
      reversed_this_month: 0,
      reversed_this_month_paise: 0,
      new_patients: { current: 228, previous: 199, change_pct: 14.6 },
      returning_patients_this_month: 1034,
      collection_trend: [
        { month: 'Jun', collected_paise: 58000000 },
        { month: 'Jul', collected_paise: 70000000 },
        { month: 'Aug', collected_paise: 68000000 },
        { month: 'Sep', collected_paise: 74000000 },
        { month: 'Oct', collected_paise: 74900000 },
        { month: 'Nov', collected_paise: 84200000 },
      ],
      department_collections: [
        { department_id: 1, name: 'Orthopaedics', percentage: 45, collected_paise: 37890000 },
        { department_id: 2, name: 'Physiotherapy', percentage: 20, collected_paise: 16840000 },
        { department_id: 3, name: 'General Consultation', percentage: 15, collected_paise: 12630000 },
        { department_id: 4, name: 'Follow-up & Reviews', percentage: 12, collected_paise: 10104000 },
        { department_id: null, name: 'Other Services', percentage: 8, collected_paise: 6736000 },
      ],
      patient_trend: [
        { month: 'Jun', new_patients: 140 },
        { month: 'Jul', new_patients: 175 },
        { month: 'Aug', new_patients: 190 },
        { month: 'Sep', new_patients: 210 },
        { month: 'Oct', new_patients: 225 },
        { month: 'Nov', new_patients: 248 },
      ],
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

      expect([
        'overview',
        'hospital-config',
        'patient-data',
        'billing-finance',
        'users-security',
        'system-maintenance',
      ]).toContain(mod.group)
      expect(['available', 'partial', 'fixed']).toContain(mod.status)
    }
  })

  it('all modules are available with canonical navigation actions', () => {
    for (const mod of ADMIN_MODULES) {
      expect(mod.status).toBe('available')
      expect(mod.actions.length).toBeGreaterThan(0)
    }
  })

  it('implemented modules map to canonical, existing routes', () => {
    for (const mod of ADMIN_MODULES) {
      expect(mod.actions.length).toBeGreaterThan(0)
      for (const action of mod.actions) {
        expect(action.path).toMatch(/^\/(admin|reception)(\/|$)/)
      }
    }
  })

  it('findAdminModuleForPath matches canonical routes correctly', () => {
    expect(findAdminModuleForPath('/admin')?.module.id).toBe('overview')
    expect(findAdminModuleForPath('/admin/settings')?.module.id).toBe('hospital-settings')
    expect(findAdminModuleForPath('/admin/assets')).toBeNull()
    expect(findAdminModuleForPath('/admin/templates')?.module.id).toBe('print-templates')
    expect(findAdminModuleForPath('/admin/doctors')?.module.id).toBe('doctors-fees')
    expect(findAdminModuleForPath('/admin/patients/correct')?.module.id).toBe('patient-correct')
    expect(findAdminModuleForPath('/admin/imports')).toBeNull()
    expect(findAdminModuleForPath('/admin/exports')).toBeNull()
    expect(findAdminModuleForPath('/admin/billing')?.module.id).toBe('billing-reversals')
    expect(findAdminModuleForPath('/reception/dues')?.module.id).toBe('pending-dues')
    expect(findAdminModuleForPath('/admin/users')?.module.id).toBe('user-accounts')
    expect(findAdminModuleForPath('/admin/roles')?.module.id).toBe('roles-matrix')
    expect(findAdminModuleForPath('/admin/security')?.module.id).toBe('security-sessions')
    expect(findAdminModuleForPath('/admin/audit')?.module.id).toBe('audit-trail')
    expect(findAdminModuleForPath('/admin/backups')?.module.id).toBe('backups-restore')
    expect(findAdminModuleForPath('/admin/integrity')?.module.id).toBe('data-integrity')
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

  it('renders the executive administration dashboard and all key figures', () => {
    renderAreaHome()

    // Dashboard heading
    expect(screen.getByRole('heading', { name: 'Administration Dashboard' })).toBeInTheDocument()

    // 4 Key Figure cards
    expect(screen.getByText('Collected this month')).toBeInTheDocument()
    expect(screen.getByText('₹8,42,000')).toBeInTheDocument()

    expect(screen.getByText('Collected today')).toBeInTheDocument()
    expect(screen.getByText('₹12,500')).toBeInTheDocument()

    expect(screen.getByText('New patients this month')).toBeInTheDocument()
    expect(screen.getAllByText('228').length).toBeGreaterThanOrEqual(1)

    expect(screen.getByText('Pending dues')).toBeInTheDocument()
    expect(screen.getByText('₹42,600')).toBeInTheDocument()

    // Pending dues link
    expect(screen.getByRole('link', { name: /Open Pending Dues/ })).toHaveAttribute('href', '/reception/dues')
  })

  it('renders executive performance charts, attention items, patient counts and system health', () => {
    renderAreaHome()

    // Key panels
    expect(screen.getByRole('heading', { name: 'Collected per month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collected by department' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs attention' })).toBeInTheDocument()

    // Patient & health panels
    expect(screen.getByRole('heading', { name: 'Patients this month' })).toBeInTheDocument()
    expect(screen.getByText('Returning')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New patients per month' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'System health' })).toBeInTheDocument()
  })

  it('renders doctors today and recent admin actions panels', () => {
    renderAreaHome()

    expect(screen.getByRole('heading', { name: 'Doctors today' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Recent admin actions' })).toBeInTheDocument()
  })

  it('sidebar renders Management Overview and five canonical sections', () => {
    renderAreaHome()

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })

    // Top link
    expect(within(primaryNav).getByRole('link', { name: /Overview/ })).toHaveAttribute('href', '/admin')

    // Five section headers
    expect(within(primaryNav).getByText('Setup')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Patients')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Finance')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Users & Access')).toBeInTheDocument()
    expect(within(primaryNav).getByText('System')).toBeInTheDocument()

    // Sidebar items match canonical routes
    expect(within(primaryNav).getByRole('link', { name: /Settings/ })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).queryByRole('link', { name: /Hospital Identity & Logo/ })).toBeNull()
    expect(within(primaryNav).getByRole('link', { name: /Templates/ })).toHaveAttribute('href', '/admin/templates')
    expect(within(primaryNav).getByRole('link', { name: /Doctors & Fees/ })).toHaveAttribute('href', '/admin/doctors')

    expect(within(primaryNav).getByRole('link', { name: /Corrections/ })).toHaveAttribute('href', '/admin/patients/correct')
    expect(within(primaryNav).queryByRole('link', { name: /Import Centre|Export Centre/ })).toBeNull()

    expect(within(primaryNav).getByRole('link', { name: /Receipts/ })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: /Dues/ })).toHaveAttribute('href', '/reception/dues')

    expect(within(primaryNav).getByRole('link', { name: /Users/ })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: /Roles/ })).toHaveAttribute('href', '/admin/roles')
    expect(within(primaryNav).getByRole('link', { name: /Sessions/ })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: /Audit Trail/ })).toHaveAttribute('href', '/admin/audit')

    expect(within(primaryNav).getByRole('link', { name: /Backups/ })).toHaveAttribute('href', '/admin/backups')
    expect(within(primaryNav).getByRole('link', { name: /Integrity/ })).toHaveAttribute('href', '/admin/integrity')
    expect(within(primaryNav).getByRole('link', { name: /Health/ })).toHaveAttribute('href', '/admin/system')
  })

  it('renders executive quick actions toolbar with direct operational shortcuts', () => {
    renderAreaHome()

    const quickActions = screen.getByRole('region', { name: 'Executive Quick Actions' })
    expect(quickActions).toBeInTheDocument()

    // 6 Direct action links within the Quick Actions section
    expect(within(quickActions).getByRole('link', { name: /Patient Directory/ })).toHaveAttribute('href', '/reception/patients')
    expect(within(quickActions).getByRole('link', { name: /Pending Dues/ })).toHaveAttribute('href', '/reception/dues')
    expect(within(quickActions).getByRole('link', { name: /Receipts & Reversals/ })).toHaveAttribute('href', '/admin/billing')
    expect(within(quickActions).getByRole('link', { name: /Data Integrity/ })).toHaveAttribute('href', '/admin/integrity')
    expect(within(quickActions).getByRole('link', { name: /Backup & Restore/ })).toHaveAttribute('href', '/admin/backups')
    expect(within(quickActions).getByRole('link', { name: /Audit Trail/ })).toHaveAttribute('href', '/admin/audit')
  })
})
