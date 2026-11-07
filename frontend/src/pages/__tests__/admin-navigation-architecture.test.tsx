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
      comparison_month_label: 'Oct 2026',
      monthly_revenue: { value_paise: 84200000, prior_paise: 74900000, percent_change: 12.4 },
      operating_expenses: { value_paise: 31600000, prior_paise: 30100000, percent_change: 5.1 },
      net_surplus: { value_paise: 52600000, prior_paise: 44800000, percent_change: 17.6 },
      outstanding_receivables_paise: 4260000,
      financial_trends: [
        { month: 'Jun', revenue_paise: 58000000, expenses_paise: 24000000 },
        { month: 'Jul', revenue_paise: 70000000, expenses_paise: 27000000 },
        { month: 'Aug', revenue_paise: 68000000, expenses_paise: 26000000 },
        { month: 'Sep', revenue_paise: 74000000, expenses_paise: 29000000 },
        { month: 'Oct', revenue_paise: 74900000, expenses_paise: 30100000 },
        { month: 'Nov', revenue_paise: 84200000, expenses_paise: 31600000 },
      ],
      department_revenues: [
        { name: 'Orthopaedics', percentage: 45, revenue_paise: 37890000, color: '#6366f1' },
        { name: 'Physiotherapy', percentage: 20, revenue_paise: 16840000, color: '#38bdf8' },
        { name: 'General Consultation', percentage: 15, revenue_paise: 12630000, color: '#10b981' },
        { name: 'Follow-up & Reviews', percentage: 12, revenue_paise: 10104000, color: '#f59e0b' },
        { name: 'Other Services', percentage: 8, revenue_paise: 6736000, color: '#94a3b8' },
      ],
      management_attention: [
        { key: 'sec', label: 'Unreviewed security events', count: 3, badge_variant: 'danger', target_path: '/admin/security' },
        { key: 'audit', label: 'Pending audit reviews', count: 6, badge_variant: 'warning', target_path: '/admin/audit' },
        { key: 'adj', label: 'Unapproved financial adjustments', count: 2, badge_variant: 'warning', target_path: '/admin/billing' },
        { key: 'users', label: 'Inactive user accounts', count: 4, badge_variant: 'neutral', target_path: '/admin/users' },
        { key: 'backup', label: 'Backup verification due', count: 1, badge_variant: 'neutral', target_path: '/admin/backups' },
      ],
      management_attention_total: 6,
      hospital_growth: { new_patients: 228, new_patients_change_pct: 14.6, returning_patients: 1034, returning_patients_change_pct: 8.9 },
      doctor_utilization: { utilization_pct: 76, occupied_minutes: 2280, scheduled_minutes: 3000 },
      patient_growth_trends: [
        { month: 'Jun', count: 140 },
        { month: 'Jul', count: 175 },
        { month: 'Aug', count: 190 },
        { month: 'Sep', count: 210 },
        { month: 'Oct', count: 225 },
        { month: 'Nov', count: 248 },
      ],
      patient_growth_pct: 11.2,
      system_health: {
        status: 'Healthy',
        application_version: 'v1.16.0',
        database_status: 'Healthy',
        last_backup_time: 'Nov 5, 02:00',
        storage_used_bytes: 186000000000,
        storage_total_bytes: 300000000000,
        storage_percentage: 62,
      },
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
    expect(findAdminModuleForPath('/admin/settings')?.module.id).toBe('clinic-settings')
    expect(findAdminModuleForPath('/admin/assets')?.module.id).toBe('hospital-assets')
    expect(findAdminModuleForPath('/admin/templates')?.module.id).toBe('print-templates')
    expect(findAdminModuleForPath('/admin/doctors')?.module.id).toBe('doctors-fees')
    expect(findAdminModuleForPath('/admin/patients/correct')?.module.id).toBe('patient-correct')
    expect(findAdminModuleForPath('/admin/imports')?.module.id).toBe('patient-imports')
    expect(findAdminModuleForPath('/admin/exports')?.module.id).toBe('patient-exports')
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

  it('renders the executive Management Overview dashboard and all KPI cards', () => {
    renderAreaHome()

    // Dashboard heading and subtitle
    expect(screen.getByRole('heading', { name: 'Management Overview' })).toBeInTheDocument()
    expect(screen.getByText('Hospital performance, governance and system health at a glance.')).toBeInTheDocument()

    // 4 KPI cards
    expect(screen.getByText('Monthly Revenue')).toBeInTheDocument()
    expect(screen.getByText('₹8,42,000')).toBeInTheDocument()

    expect(screen.getByText('Operating Expenses')).toBeInTheDocument()
    expect(screen.getByText('₹3,16,000')).toBeInTheDocument()

    expect(screen.getByText('Net Operating Surplus')).toBeInTheDocument()
    expect(screen.getByText('₹5,26,000')).toBeInTheDocument()

    expect(screen.getByText('Outstanding Receivables')).toBeInTheDocument()
    expect(screen.getByText('₹42,600')).toBeInTheDocument()

    // Ageing link
    expect(screen.getByRole('link', { name: /View Ageing/ })).toHaveAttribute('href', '/reception/dues')
  })

  it('renders executive performance charts, attention items, growth and system health', () => {
    renderAreaHome()

    // Middle Strip Panels
    expect(screen.getByRole('heading', { name: 'Financial Performance Trend' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Revenue by Department' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Management Attention' })).toBeInTheDocument()

    // Management Attention Rows
    expect(screen.getByText('Unreviewed security events')).toBeInTheDocument()
    expect(screen.getByText('Pending audit reviews')).toBeInTheDocument()
    expect(screen.getByText('Unapproved financial adjustments')).toBeInTheDocument()
    expect(screen.getByText('Inactive user accounts')).toBeInTheDocument()
    expect(screen.getByText('Backup verification due')).toBeInTheDocument()

    // Lower Strip Panels
    expect(screen.getByText('Hospital Growth')).toBeInTheDocument()
    expect(screen.getByText('New Patients')).toBeInTheDocument()
    expect(screen.getByText('Returning Patients')).toBeInTheDocument()

    expect(screen.getByText('Doctor Utilization')).toBeInTheDocument()
    expect(screen.getByText('76%')).toBeInTheDocument()

    expect(screen.getByText('Patient Growth Trend')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'System Health' })).toBeInTheDocument()
    expect(screen.getByText('v1.16.0')).toBeInTheDocument()
  })

  it('renders the Quick Access grid with canonical routes', () => {
    renderAreaHome()

    const quickAccess = screen.getByRole('region', { name: 'Quick Access' })
    expect(within(quickAccess).getByRole('heading', { name: 'Quick Access' })).toBeInTheDocument()

    // Quick access links
    expect(within(quickAccess).getByRole('link', { name: /Financial Reports/ })).toHaveAttribute('href', '/admin/billing')
    expect(within(quickAccess).getByRole('link', { name: /Audit & Compliance/ })).toHaveAttribute('href', '/admin/audit')
    expect(within(quickAccess).getByRole('link', { name: /Users & Roles/ })).toHaveAttribute('href', '/admin/users')
    expect(within(quickAccess).getByRole('link', { name: /Backup & Restore/ })).toHaveAttribute('href', '/admin/backups')
    expect(within(quickAccess).getByRole('link', { name: /Configuration/ })).toHaveAttribute('href', '/admin/settings')
    expect(within(quickAccess).getByRole('link', { name: /Hospital Profile/ })).toHaveAttribute('href', '/admin/settings')
  })

  it('sidebar renders Management Overview and five canonical sections', () => {
    renderAreaHome()

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })

    // Top link
    expect(within(primaryNav).getByRole('link', { name: /Management Overview/ })).toHaveAttribute('href', '/admin')

    // Five section headers
    expect(within(primaryNav).getByText('Hospital Configuration')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Patient & Data Management')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Billing & Finance')).toBeInTheDocument()
    expect(within(primaryNav).getByText('Users, Security & Governance')).toBeInTheDocument()
    expect(within(primaryNav).getByText('System & Maintenance')).toBeInTheDocument()

    // Sidebar items match canonical routes
    expect(within(primaryNav).getByRole('link', { name: /Clinic Settings/ })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).getByRole('link', { name: /Hospital Identity & Logo/ })).toHaveAttribute('href', '/admin/assets')
    expect(within(primaryNav).getByRole('link', { name: /Print Templates/ })).toHaveAttribute('href', '/admin/templates')
    expect(within(primaryNav).getByRole('link', { name: /Doctors & Fees/ })).toHaveAttribute('href', '/admin/doctors')

    expect(within(primaryNav).getByRole('link', { name: /Patient Demographic Correction/ })).toHaveAttribute('href', '/admin/patients/correct')
    expect(within(primaryNav).getByRole('link', { name: /Import Centre/ })).toHaveAttribute('href', '/admin/imports')
    expect(within(primaryNav).getByRole('link', { name: /Export Centre/ })).toHaveAttribute('href', '/admin/exports')

    expect(within(primaryNav).getByRole('link', { name: /Billing & Reversals/ })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: /Pending Dues/ })).toHaveAttribute('href', '/reception/dues')

    expect(within(primaryNav).getByRole('link', { name: /User Accounts/ })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: /Roles & Permissions/ })).toHaveAttribute('href', '/admin/roles')
    expect(within(primaryNav).getByRole('link', { name: /Security & Sessions/ })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: /Audit Trail/ })).toHaveAttribute('href', '/admin/audit')

    expect(within(primaryNav).getByRole('link', { name: /Backup & Restore/ })).toHaveAttribute('href', '/admin/backups')
    expect(within(primaryNav).getByRole('link', { name: /Data Integrity/ })).toHaveAttribute('href', '/admin/integrity')
    expect(within(primaryNav).getByRole('link', { name: /System Health/ })).toHaveAttribute('href', '/admin/system')
  })
})
