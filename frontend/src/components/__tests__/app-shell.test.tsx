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
    expect(within(primaryNav).getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin')

    // Section 1: Hospital Configuration
    expect(within(primaryNav).getByText('Setup')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/admin/settings')
    expect(within(primaryNav).queryByRole('link', { name: /Clinic Settings|Hospital Identity & Logo/ })).toBeNull()
    expect(within(primaryNav).getByRole('link', { name: 'Templates' })).toHaveAttribute('href', '/admin/templates')
    expect(within(primaryNav).getByRole('link', { name: 'Doctors & Fees' })).toHaveAttribute('href', '/admin/doctors')

    // Section 2: Patient & Data Management
    expect(within(primaryNav).getByText('Patients')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Corrections' })).toHaveAttribute('href', '/admin/patients/correct')
    expect(within(primaryNav).queryByRole('link', { name: /Import Centre|Export Centre/ })).toBeNull()

    // Section 3: Billing & Finance
    expect(within(primaryNav).getByText('Finance')).toBeInTheDocument()
    expect(within(primaryNav).getByRole('link', { name: 'Receipts' })).toHaveAttribute('href', '/admin/billing')
    expect(within(primaryNav).getByRole('link', { name: 'Dues' })).toHaveAttribute('href', '/reception/dues')

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

  describe('central server status at the foot of the sidebar', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const statusIn = () => within(screen.getByRole('complementary', { name: 'Primary navigation' }))

    it('is green only when the server confirms its database', async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ status: 'ok', db: 'ok', setup_required: false }), { status: 200 }),
      )
      vi.stubGlobal('fetch', fetchMock)
      renderShell('ADMIN', '/admin')

      expect(await statusIn().findByText('LAN connected')).toBeInTheDocument()
      expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }))
    })

    it('reports the database as unavailable when the health check fails on the server', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 500 })))
      renderShell('ADMIN', '/admin')

      expect(await statusIn().findByRole('status')).toHaveTextContent('Database unavailable')
      expect(statusIn().queryByText('LAN connected')).not.toBeInTheDocument()
    })

    it('reports the server as unreachable when the request cannot reach it', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      renderShell('ADMIN', '/admin')

      expect(await statusIn().findByRole('status')).toHaveTextContent('Server unreachable')
    })

    it('shows Offline as soon as the workstation loses its network', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ status: 'ok', db: 'ok' }), { status: 200 })),
      )
      renderShell('ADMIN', '/admin')
      expect(await statusIn().findByText('LAN connected')).toBeInTheDocument()

      act(() => {
        window.dispatchEvent(new Event('offline'))
      })
      expect(statusIn().getByRole('status')).toHaveTextContent('Offline')

      act(() => {
        window.dispatchEvent(new Event('online'))
      })
      expect(await statusIn().findByText('LAN connected')).toBeInTheDocument()
    })
  })
})
