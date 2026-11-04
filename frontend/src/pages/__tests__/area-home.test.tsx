import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ADMIN_MODULES } from '../../admin/modules'
import type { AdminOverview } from '../../api/types'
import { AreaHome } from '../AreaHome'

const HOUR = 60 * 60 * 1000

function adminOverview(): AdminOverview {
  const now = Date.now()
  return {
    area: 'admin',
    name: 'Kalyan Administrator',
    role: 'ADMIN',
    user_counts: {
      ADMIN: { active: 1, inactive: 0 },
      RECEPTION: { active: 2, inactive: 1 },
      DOCTOR: { active: 3, inactive: 0 },
    },
    business_date: '2026-11-04',
    registrations_today: 7,
    appointments_today: { BOOKED: 2, ARRIVED: 1, IN_CONSULTATION: 1, DONE: 3, CANCELLED: 0, NO_SHOW: 1 },
    doctors_today: [
      { doctor_id: 1, name: 'Dr. Asha Verma', appointments_today: 5, waiting: 2, in_consultation: 1, done: 2 },
    ],
    collections_today: {
      payments_count: 5,
      gross_paise: 1234550,
      reversals_count: 1,
      reversed_paise: 50000,
      by_method: { CASH: 1000000, UPI: 234550 },
    },
    outstanding_dues_paise: 987600,
    locked_accounts: 2,
    failed_logins_24h: 4,
    recent_admin_actions: [
      {
        occurred_at: new Date(now - HOUR).toISOString(),
        actor_username: 'admin',
        action: 'USER_UNLOCKED',
        entity_type: 'user',
        entity_id: '3',
        outcome: 'SUCCESS',
      },
    ],
    last_backup: {
      filename: 'kalyan_backup_20261104_060000.tar.gz',
      created_at: new Date(now - 3 * HOUR - 5 * 60 * 1000).toISOString(),
      size_bytes: 2 * 1024 * 1024,
      label: 'nightly',
      manifest_readable: true,
    },
    last_backup_failure_at: null,
    last_integrity_check: {
      occurred_at: new Date(now - 2 * 24 * HOUR).toISOString(),
      outcome: 'SUCCESS',
      is_healthy: true,
    },
    storage: { data_free_bytes: 10 * 1024 ** 3, backup_free_bytes: null },
    alerts: [{ code: 'accounts_locked', severity: 'warning', message: '2 user account(s) are currently locked out.' }],
  }
}

function stubOverview(area: string, body: unknown) {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (url.includes(`/api/${area}/overview`)) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(body)),
      })
    }
    return Promise.reject(new Error(`Unhandled: ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function renderArea(area: 'admin' | 'reception' | 'doctor') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/${area}`]}>
        <AreaHome area={area} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AreaHome admin dashboard', () => {
  it('shows every overview metric from the API, with gross and reversals separate', async () => {
    stubOverview('admin', adminOverview())
    renderArea('admin')

    expect(await screen.findByText('admin Dashboard')).toBeInTheDocument()
    const today = screen.getByRole('region', { name: /^Today/ })
    expect(within(today).getByText(/2026-11-04/)).toBeInTheDocument()
    expect(within(today).getByText('Registrations today').parentElement).toHaveTextContent('7')
    // 2 + 1 + 1 + 3 + 0 + 1 appointments across statuses
    expect(within(today).getByText('Appointments today (all statuses)').parentElement).toHaveTextContent('8')
    expect(within(today).getByText('No show').nextElementSibling).toHaveTextContent('1')

    const gross = within(today).getByText('Gross collected today').parentElement as HTMLElement
    expect(gross).toHaveTextContent('₹12,345.50')
    expect(gross).toHaveTextContent('5 payments recorded today')
    expect(gross).toHaveTextContent('₹10,000.00')
    const reversed = within(today).getByText('Reversed today').parentElement as HTMLElement
    expect(reversed).toHaveTextContent('₹500.00')
    expect(reversed).toHaveTextContent('1 reversal made today')
    expect(reversed).toHaveTextContent('Not subtracted from the gross figure')

    expect(within(today).getByText('Pending dues (all patients)').parentElement).toHaveTextContent('₹9,876.00')
    expect(within(today).getByText('Locked accounts').parentElement).toHaveTextContent('2')
    expect(within(today).getByText('Failed logins (last 24 hours)').parentElement).toHaveTextContent('4')

    const queues = screen.getByRole('region', { name: 'Doctor queues today' })
    const row = within(queues).getByRole('row', { name: /Dr\. Asha Verma/ })
    expect(row).toHaveTextContent('Dr. Asha Verma5212')

    expect(screen.getByText('System User Counts')).toBeInTheDocument()
    expect(screen.getByText('3 active')).toBeInTheDocument()

    const alerts = screen.getByRole('region', { name: 'Alerts' })
    expect(within(alerts).getByText('2 user account(s) are currently locked out.')).toBeInTheDocument()
    expect(within(alerts).getByText('Warning')).toBeInTheDocument()
  })

  it('computes the last backup age from created_at and shows integrity and storage facts', async () => {
    stubOverview('admin', adminOverview())
    renderArea('admin')

    const system = await screen.findByRole('region', { name: 'Backups, integrity and storage' })
    expect(within(system).getByText('3 hours ago')).toBeInTheDocument()
    expect(within(system).getByText('kalyan_backup_20261104_060000.tar.gz')).toBeInTheDocument()
    expect(within(system).getByText(/2\.00 MB/)).toBeInTheDocument()
    expect(within(system).getByText('Healthy')).toBeInTheDocument()
    expect(within(system).getByText(/2 days ago/)).toBeInTheDocument()
    expect(within(system).getByText('10.00 GB')).toBeInTheDocument()
    expect(within(system).getByText('Unavailable')).toBeInTheDocument()

    const recent = screen.getByRole('region', { name: 'Recent admin actions' })
    expect(within(recent).getByText('USER_UNLOCKED')).toBeInTheDocument()
    expect(within(recent).getByText('user #3')).toBeInTheDocument()
  })

  it('renders all 12 registry modules; fixed modules say "Awaiting client decision" and have no link', async () => {
    stubOverview('admin', adminOverview())
    renderArea('admin')

    const grid = await screen.findByRole('region', { name: 'Administration Modules' })
    for (const m of ADMIN_MODULES) {
      expect(within(grid).getAllByText(m.title).length).toBeGreaterThan(0)
    }
    expect(within(grid).getAllByText('Awaiting client decision')).toHaveLength(
      ADMIN_MODULES.filter((m) => m.status === 'fixed').length,
    )

    const fixed = ADMIN_MODULES.find((m) => m.id === 'appointment-workflow')
    const fixedCard = within(grid).getByText(fixed?.title ?? '').closest('li') as HTMLElement
    expect(within(fixedCard).queryByRole('link')).not.toBeInTheDocument()
    expect(fixedCard).toHaveTextContent(fixed?.statusReason ?? '')

    const backupCard = within(grid).getByText('Backup, Restore & Data').closest('li') as HTMLElement
    expect(within(backupCard).getByRole('link', { name: 'Backup & restore' })).toHaveAttribute('href', '/admin/backups')
    expect(within(backupCard).getByRole('link', { name: 'Data integrity' })).toHaveAttribute('href', '/admin/integrity')
  })

  it('shows "Not reported" instead of inventing numbers when the server omits fields', async () => {
    stubOverview('admin', { area: 'admin', name: 'Kalyan Administrator', role: 'ADMIN', user_counts: {} })
    renderArea('admin')

    const today = await screen.findByRole('region', { name: /^Today/ })
    expect(within(today).getByText('Registrations today').parentElement).toHaveTextContent('Not reported')
    expect(within(today).getByText('Gross collected today').parentElement).toHaveTextContent('Not reported')
    expect(within(today).queryByText('0')).not.toBeInTheDocument()
  })
})

describe('AreaHome reception area is unchanged', () => {
  it('keeps the reception operations and shows no admin dashboard', async () => {
    stubOverview('reception', { area: 'reception', name: 'Front Desk', role: 'RECEPTION' })
    renderArea('reception')

    expect(await screen.findByText('reception Dashboard')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Appointments & Queue/ })).toHaveAttribute('href', '/reception/appointments')
    expect(screen.getByRole('link', { name: /New Registration/ })).toHaveAttribute('href', '/reception/patients/new')
    expect(screen.queryByText('Administration Modules')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Alerts' })).not.toBeInTheDocument()
  })
})
