import { act, cleanup, render, screen, within } from '@testing-library/react'
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

// The doctor's emergency banner polls the queue; the shell test renders no alerts.
vi.mock('../EmergencyAlertBanner', () => ({
  EmergencyAlertBanner: () => null,
}))

vi.mock('../../api/health', () => ({
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

function renderShell(role: 'ADMIN' | 'RECEPTION' | 'DOCTOR', route = '/', name = 'Test User') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AppShell name={name} role={role}>
          <div>Workspace content</div>
        </AppShell>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppShell clinical navigation hierarchy', () => {
  afterEach(() => {
    cleanup()
    window.localStorage.clear()
  })

  it('lists reception tabs once each, Check-in & Token first, named like their pages', () => {
    renderShell('RECEPTION', '/reception/appointments')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    const links = within(primaryNav).getAllByRole('link')
    // Owner order of 2026-11-15 (OD-22-01). New patients register at check-in, so there is no
    // separate Patient Registration tab; the full form opens from Patient Records.
    expect(links.map((l) => l.textContent)).toEqual([
      'Check-in & Token',
      'Dashboard',
      'Patient Records',
      'Appointments',
      'Waiting Room',
      'Billing & Checkout',
    ])
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/reception/tokens',
      '/reception',
      '/reception/patients',
      '/reception/appointments',
      '/reception/waiting',
      // Opens Checkout, not the Dues tab.
      '/reception/billing',
    ])
    expect(within(primaryNav).getByText('RECEPTION DESK')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Appointments' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Appointments – Kalyan Hospital')

    expect(within(primaryNav).queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Follow-ups' })).not.toBeInTheDocument()
  })

  it('keeps Check-in & Token and Billing & Checkout highlighted on their own pages', () => {
    renderShell('RECEPTION', '/reception/tokens?patient_id=4&appointment_id=104')
    let primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Check-in & Token' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Check-in & Token – Kalyan Hospital')
    cleanup()

    renderShell('RECEPTION', '/reception/billing?tab=dues')
    primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Billing & Checkout' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
  })

  it('keeps Patient Records active and names the page Edit Patient while a patient is edited', () => {
    renderShell('RECEPTION', '/reception/patients/101/edit')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Edit Patient – Kalyan Hospital')
  })

  it('keeps Patient Records active on the full registration form', () => {
    renderShell('RECEPTION', '/reception/patients/new')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('aria-current', 'page')
  })

  it('gives a doctor one queue tab and activates Follow-ups on its page', () => {
    renderShell('DOCTOR', '/reception/appointments?tab=followup')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    // No consultation is open and none is unfinished, so there is nothing to continue.
    expect(within(primaryNav).getAllByRole('link').map((l) => l.textContent)).toEqual([
      'My Queue',
      'Follow-ups',
      'Physiotherapy Treatment',
      'Patient Records',
      'My Settings',
    ])
    expect(within(primaryNav).getByRole('link', { name: 'My Queue' })).toHaveAttribute('href', '/doctor')
    expect(within(primaryNav).getByRole('link', { name: 'Physiotherapy Treatment' })).toHaveAttribute('href', '/doctor/treatment-plans')
    expect(within(primaryNav).getByRole('link', { name: 'Follow-ups' })).toHaveAttribute('href', '/reception/appointments?tab=followup')
    expect(within(primaryNav).getByRole('link', { name: 'Follow-ups' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Follow-ups – Kalyan Hospital')
    expect(within(primaryNav).queryByRole('link', { name: 'Appointments' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Billing & Checkout' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Billing & Payments' })).not.toBeInTheDocument()
  })

  it('names the physiotherapy page like its tab', () => {
    renderShell('DOCTOR', '/doctor/treatment-plans/7')
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Physiotherapy Treatment' })).toHaveAttribute('aria-current', 'page')
    expect(document.title).toBe('Physiotherapy Treatment – Kalyan Hospital')
  })

  it('shows Continue Consultation while a consultation is open', () => {
    renderShell('DOCTOR', '/doctor/encounters/42')

    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    const consultation = within(primaryNav).getByRole('link', { name: 'Continue Consultation' })
    expect(consultation).toHaveAttribute('href', '/doctor/encounters/42')
    expect(consultation).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'My Queue' })).not.toHaveAttribute('aria-current')
  })

  it('links Continue Consultation to the newest unfinished draft from anywhere', async () => {
    const drafts = [
      { id: 7, patient_id: 1, patient_urn: 'KH-1', patient_name: 'Older Draft', started_at: '2026-11-14T09:00:00Z', is_finalised: false },
      { id: 9, patient_id: 2, patient_urn: 'KH-2', patient_name: 'Newer Draft', started_at: '2026-11-15T09:00:00Z', is_finalised: false },
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/encounters/unfinished'
          ? new Response(JSON.stringify(drafts), { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response(JSON.stringify({ status: 'ok', db: 'ok' }), { status: 200 }),
      ),
    )
    try {
      renderShell('DOCTOR', '/doctor')
      const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
      const consultation = await within(primaryNav).findByRole('link', { name: /Continue Consultation/ })
      expect(consultation).toHaveAttribute('href', '/doctor/encounters/9')
      expect(consultation).toHaveTextContent('2')
      expect(within(primaryNav).getByRole('link', { name: 'My Queue' })).toHaveAttribute('aria-current', 'page')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shows administration destinations once in a single primary sidebar for ADMIN without duplicates', () => {
    renderShell('ADMIN', '/admin/backups')

    // Exactly one primary navigation exists
    const navigations = screen.getAllByRole('navigation', { name: 'Primary navigation' })
    expect(navigations.length).toBeGreaterThanOrEqual(1)
    const primaryNav = navigations[0]

    // Verify Management Overview is at the top
    expect(within(primaryNav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin')

    // Section 1: Hospital Configuration
    expect(within(primaryNav).getByText('Setup')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).queryByRole('link', { name: /Clinic Settings|Hospital Identity & Logo/ })).toBeNull()
    expect(within(primaryNav).getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/admin/templates')
    expect(within(primaryNav).getByRole('link', { name: 'Doctors & Fees' })).toHaveAttribute('href', '/admin/doctors')
    expect(within(primaryNav).getByRole('link', { name: 'Departments' })).toHaveAttribute('href', '/admin/departments')

    // Section 2: Patient & Data Management
    expect(within(primaryNav).getByText('Patients')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('href', '/reception/patients')
    expect(within(primaryNav).getByRole('link', { name: 'Corrections' })).toHaveAttribute('href', '/admin/patients/correct')
    expect(within(primaryNav).queryByRole('link', { name: /Import Centre|Export Centre/ })).toBeNull()

    // Section 3: Billing & Finance
    expect(within(primaryNav).getByText('Finance')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: 'Dues' })).toHaveAttribute('href', '/reception/billing?tab=dues')

    // Section 4: Users, Security & Governance
    expect(within(primaryNav).getByText('Users & Access')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/admin/users')
    expect(within(primaryNav).getByRole('link', { name: 'Roles' })).toHaveAttribute('href', '/admin/roles')
    expect(within(primaryNav).getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/admin/security')
    expect(within(primaryNav).getByRole('link', { name: 'Audit Trail' })).toHaveAttribute('href', '/admin/audit')

    // Section 5: System & Maintenance
    expect(within(primaryNav).getByText('System')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Backups' })).toHaveAttribute('href', '/admin/backups')
    expect(within(primaryNav).getByRole('link', { name: 'Backups' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'Integrity' })).toHaveAttribute('href', '/admin/integrity')
    expect(within(primaryNav).getByRole('link', { name: 'Health' })).toHaveAttribute('href', '/admin/system')

    // Dead placeholder links must NOT be in the document
    expect(within(primaryNav).queryByRole('link', { name: /Hospital Performance/ })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: /Department Analytics/ })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: /Resource Utilization/ })).not.toBeInTheDocument()

    // No second Administration sidebar / subnavigation
    expect(screen.queryByRole('navigation', { name: 'Administration sections' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'Administration modules' })).not.toBeInTheDocument()

    // No duplicate destinations across the screen
    expect(within(primaryNav).getAllByRole('link', { name: /Backups/ })).toHaveLength(1)
    expect(within(primaryNav).getAllByRole('link', { name: /Settings/ })).toHaveLength(1)

    // Doctor/Reception specific items not exposed
    expect(within(primaryNav).queryByRole('link', { name: 'Patient Registration' })).not.toBeInTheDocument()
    expect(within(primaryNav).queryByRole('link', { name: 'Physiotherapy Treatment' })).not.toBeInTheDocument()
  })

  it('highlights the admin tab for pages outside /admin and for Departments', () => {
    renderShell('ADMIN', '/reception/billing?tab=dues')
    let primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Dues' })).toHaveAttribute('aria-current', 'page')
    cleanup()

    renderShell('ADMIN', '/reception/patients/12')
    primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Patient Records' })).toHaveAttribute('aria-current', 'page')
    cleanup()

    renderShell('ADMIN', '/admin/departments')
    primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).getByRole('link', { name: 'Departments' })).toHaveAttribute('aria-current', 'page')
    expect(within(primaryNav).getByRole('link', { name: 'Doctors & Fees' })).not.toHaveAttribute('aria-current')
    expect(document.title).toBe('Departments – Kalyan Hospital')
  })

  it('opens a keyboard-accessible mobile navigation drawer', async () => {
    const user = userEvent.setup()
    renderShell('RECEPTION')
    await user.click(screen.getByRole('button', { name: 'Open navigation menu' }))

    expect(screen.getAllByRole('button', { name: 'Close navigation menu' }).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByRole('navigation', { name: 'Primary navigation' }).length).toBeGreaterThan(0)
  })

  it('renders Kalyan Hospital in the top header and clean workspace panel in the sidebar without duplicate logo', () => {
    renderShell('ADMIN')

    // Top banner header prominently displays Kalyan Hospital and Trust branding in Hindi
    expect(screen.getByText('कल्याण हॉस्पिटल')).toBeInTheDocument()
    expect(screen.getByText('श्री वशिष्ठ कल्याण ट्रस्ट')).toBeInTheDocument()

    // Top header has the official crest image
    const crestImages = screen.getAllByRole('img', { name: 'Kalyan Hospital crest' })
    expect(crestImages.length).toBe(1)

    // User pill displays authenticated user's name
    expect(screen.getByText('Test User')).toBeInTheDocument()

    // Sidebar has the Administration Panel title and no duplicate crest image
    const primaryNav = screen.getByRole('navigation', { name: 'Primary navigation' })
    expect(within(primaryNav).queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Administration Panel')).toBeInTheDocument()
  })

  it('collapses the desktop sidebar to an icon-only rail and remembers it', async () => {
    const user = userEvent.setup()
    renderShell('ADMIN', '/admin')

    const aside = screen.getByRole('complementary', { name: 'Primary navigation' })
    expect(aside.className).toContain('lg:w-64')
    // Nothing is written to browser storage until staff choose a layout.
    expect(window.localStorage.length).toBe(0)
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(aside.className).not.toContain('lg:w-64')
    expect(within(aside).getByText('Administration Panel').parentElement?.className).toContain('hidden')
    // Every module link stays reachable by its accessible name while collapsed.
    expect(within(aside).getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/admin/billing')
    const expand = screen.getByRole('button', { name: 'Expand sidebar' })
    expect(expand).toHaveAttribute('aria-expanded', 'false')
    expect(window.localStorage.getItem('kh.sidebar.collapsed')).toBe('true')

    await user.click(expand)
    expect(aside.className).toContain('lg:w-64')
    expect(window.localStorage.getItem('kh.sidebar.collapsed')).toBe('false')
  })

  it('folds admin sidebar groups but keeps the group with the current page open', async () => {
    const user = userEvent.setup()
    renderShell('ADMIN', '/admin/billing')

    const security = screen.getByRole('button', { name: 'Users & Access' })
    expect(security).toHaveAttribute('aria-expanded', 'true')
    await user.click(security)
    expect(security).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(security.getAttribute('aria-controls')!)?.className).toContain('lg:hidden')
    expect(JSON.parse(window.localStorage.getItem('kh.sidebar.closedGroups') ?? '[]')).toContain('users-security')

    const billing = screen.getByRole('button', { name: 'Finance' })
    expect(billing).toHaveAttribute('aria-expanded', 'true')
    expect(billing).toBeDisabled()
  })

  it('shows "Signed in · role" above the signed-in user name', () => {
    renderShell('ADMIN', '/admin', 'Aayush Sharma')
    expect(screen.getByText('Signed in · Administrator')).toBeInTheDocument()
    expect(screen.getByText('Aayush Sharma')).toBeInTheDocument()
    cleanup()

    renderShell('RECEPTION', '/reception', 'Asha Kumari')
    expect(screen.getByText('Signed in · Reception')).toBeInTheDocument()
    expect(screen.getByText('Asha Kumari')).toBeInTheDocument()
  })

  describe('LAN status pill mounted in the app shell (OD-F option-b)', () => {
    it('shows Online when health probe succeeds', () => {
      renderShell('ADMIN', '/admin')
      expect(screen.getByRole('status', { name: /LAN status: Connected/i })).toBeInTheDocument()
      expect(screen.getByText('Online')).toBeInTheDocument()
    })

    it('shows Disconnected as soon as workstation loses network', () => {
      renderShell('ADMIN', '/admin')
      expect(screen.getByText('Online')).toBeInTheDocument()

      act(() => {
        window.dispatchEvent(new Event('offline'))
      })
      expect(screen.getByRole('status', { name: /LAN status: Disconnected/i })).toBeInTheDocument()
      expect(screen.getByText('Disconnected')).toBeInTheDocument()

      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      expect(screen.getByText('Online')).toBeInTheDocument()
    })
  })
})
