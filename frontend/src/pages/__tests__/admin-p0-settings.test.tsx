import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/dialog-shim'
import type {
  BackupRunOut,
  BackupSettingsOut,
  BillingConfigurationOut,
  Me,
  PaymentOut,
  SecurityPolicyOut,
} from '../../api/types'
import { BackupSchedulePanel } from '../admin/BackupSchedulePanel'
import { BillingAdminPage } from '../admin/BillingAdminPage'
import { SecurityPolicyEditor } from '../admin/SecurityPolicyEditor'

const me: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: [],
  must_change_password: false,
  csrf_token: 'token',
  version_id: 1,
}

const policy: SecurityPolicyOut = {
  session_idle_minutes: 30,
  session_absolute_hours: 12,
  lockout_threshold: 5,
  lockout_minutes: 15,
  throttle_max_failures: 20,
  throttle_window_minutes: 15,
  password_min_length: 10,
  password_max_length: 128,
  source: 'environment',
  editable: true,
  limits: {
    session_idle_minutes: { baseline: 30, minimum: 5, maximum: 30 },
    session_absolute_hours: { baseline: 12, minimum: 1, maximum: 12 },
    lockout_threshold: { baseline: 5, minimum: 3, maximum: 5 },
    lockout_minutes: { baseline: 15, minimum: 15, maximum: 1440 },
    password_min_length: { baseline: 10, minimum: 10, maximum: 128 },
  },
  version_id: 3,
  updated_at: '2026-11-04T03:00:00Z',
}

const backupSettings: BackupSettingsOut = {
  schedule_enabled: false,
  frequency: 'DAILY',
  run_at: '02:00:00',
  weekly_day: null,
  destination_dir: null,
  retention_count: null,
  version_id: 2,
  updated_at: '2026-11-04T03:00:00Z',
  next_run_at: null,
  overdue: false,
  approved_destinations: ['E:\\KalyanBackups'],
}

const failedRun: BackupRunOut = {
  id: 5,
  trigger: 'SCHEDULED',
  outcome: 'FAILURE',
  started_at: '2026-11-04T20:30:00Z',
  finished_at: '2026-11-04T20:31:00Z',
  filename: null,
  size_bytes: null,
  copied_to: null,
  pruned_count: 0,
  error_type: 'RuntimeError',
}

const billingConfig: BillingConfigurationOut = {
  receipt_sequence_cycle: 'FINANCIAL_YEAR',
  current_cycle_key: '2026-2027',
  receipts_issued_in_cycle: 41,
  next_receipt_number: 'RCP-2026-2027-0042',
  payment_methods: ['CASH', 'UPI', 'CARD'],
  reversal_roles: ['ADMIN'],
}

const payment: PaymentOut = {
  id: 9,
  receipt_number: 'RCP-2026-2027-0041',
  patient_id: 4,
  patient_urn: 'KH-2026-0007',
  patient_name: 'Asha Kumari',
  treatment_plan_id: null,
  treatment_plan_name: null,
  appointment_id: null,
  amount_paise: 123405,
  payment_method: 'UPI',
  notes: null,
  is_reversed: false,
  reversal_reason: null,
  reversed_by_username: null,
  reversed_at: null,
  created_by_username: 'reception',
  created_at: '2026-11-04T05:00:00Z',
}

type Reply = { status?: number; body: unknown }
const requests: { url: string; method: string; body: unknown }[] = []

function stubApi(routes: (url: string, method: string) => Reply | undefined) {
  requests.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      requests.push({ url: input, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const reply = routes(input, method) ?? (input.includes('/api/auth/me') ? { body: me } : { status: 404, body: { code: 'not_found', message: 'none' } })
      const status = reply.status ?? 200
      return Promise.resolve({
        ok: status < 400,
        status,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve(JSON.stringify(reply.body)),
        json: () => Promise.resolve(reply.body),
      })
    }),
  )
}

function renderWithClient(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SecurityPolicyEditor', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockReset()
  })

  it('needs a reason and blocks a value outside the allowed range', async () => {
    stubApi(() => undefined)
    const user = userEvent.setup()
    renderWithClient(<SecurityPolicyEditor policy={policy} onClose={onClose} />)

    const save = screen.getByRole('button', { name: 'Save policy' })
    expect(save).toBeDisabled()

    await user.type(screen.getByLabelText('Reason for this change'), 'Tightened after review')
    expect(save).toBeEnabled()

    const idle = screen.getByLabelText('Sign out after inactivity')
    await user.clear(idle)
    await user.type(idle, '45')
    expect(idle).toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()
  })

  it('sends every value with the version and reason, then closes', async () => {
    stubApi((url, method) => (url.includes('/security/policy') && method === 'PATCH' ? { body: policy } : undefined))
    const user = userEvent.setup()
    renderWithClient(<SecurityPolicyEditor policy={policy} onClose={onClose} />)

    const idle = screen.getByLabelText('Sign out after inactivity')
    await user.clear(idle)
    await user.type(idle, '15')
    await user.type(screen.getByLabelText('Reason for this change'), 'Tightened after review')
    await user.click(screen.getByRole('button', { name: 'Save policy' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const patch = requests.find((r) => r.method === 'PATCH')
    expect(patch?.body).toEqual({
      version_id: 3,
      session_idle_minutes: 15,
      session_absolute_hours: 12,
      lockout_threshold: 5,
      lockout_minutes: 15,
      password_min_length: 10,
      reason: 'Tightened after review',
    })
  })

  it('shows the conflict banner on a stale save and stays open', async () => {
    stubApi((url, method) =>
      url.includes('/security/policy') && method === 'PATCH'
        ? { status: 409, body: { code: 'version_conflict', message: 'stale' } }
        : undefined,
    )
    const user = userEvent.setup()
    renderWithClient(<SecurityPolicyEditor policy={policy} onClose={onClose} />)

    await user.type(screen.getByLabelText('Reason for this change'), 'Tightened after review')
    await user.click(screen.getByRole('button', { name: 'Save policy' }))

    expect(await screen.findByRole('button', { name: /reload latest/i })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('BackupSchedulePanel', () => {
  function routes(settings: BackupSettingsOut, runs: BackupRunOut[] = []) {
    return (url: string, method: string): Reply | undefined => {
      if (url.includes('/backup-settings')) return { body: method === 'PATCH' ? { ...settings, schedule_enabled: true, version_id: 3 } : settings }
      if (url.includes('/backup-runs')) return { body: runs }
      return undefined
    }
  }

  it('saves the schedule with retention and the approved second copy', async () => {
    stubApi(routes(backupSettings))
    const user = userEvent.setup()
    renderWithClient(<BackupSchedulePanel />)

    await user.click(await screen.findByRole('checkbox', { name: 'Run scheduled backups' }))
    await user.selectOptions(screen.getByLabelText('Second copy'), 'E:\\KalyanBackups')
    await user.type(screen.getByLabelText('Scheduled backups to keep'), '14')
    await user.type(screen.getByLabelText('Reason for this change'), 'Client approved schedule')
    await user.click(screen.getByRole('button', { name: 'Save schedule' }))

    expect(await screen.findByText('Backup schedule saved.')).toBeInTheDocument()
    expect(requests.find((r) => r.method === 'PATCH')?.body).toEqual({
      version_id: 2,
      schedule_enabled: true,
      frequency: 'DAILY',
      run_at: '02:00',
      weekly_day: null,
      destination_dir: 'E:\\KalyanBackups',
      retention_count: 14,
      reason: 'Client approved schedule',
    })
  })

  it('warns that retention permanently deletes only scheduled backups', async () => {
    stubApi(routes(backupSettings))
    renderWithClient(<BackupSchedulePanel />)
    expect(await screen.findByText(/manual and safety backups are never removed/)).toBeInTheDocument()
  })

  it('reports an overdue schedule and failed runs', async () => {
    stubApi(routes({ ...backupSettings, schedule_enabled: true, overdue: true }, [failedRun]))
    renderWithClient(<BackupSchedulePanel />)

    expect(await screen.findByText(/A scheduled backup did not run/)).toBeInTheDocument()
    expect(await screen.findByText('Failed (RuntimeError)')).toBeInTheDocument()
  })
})

describe('BillingAdminPage', () => {
  function routes(url: string): Reply | undefined {
    if (url.includes('/billing/configuration')) return { body: billingConfig }
    if (url.includes('/billing/ledger')) return { body: [payment] }
    return undefined
  }

  it('shows the rules in force and formats paise exactly', async () => {
    stubApi(routes)
    renderWithClient(<BillingAdminPage />)

    expect(await screen.findByText('RCP-2026-2027-0042')).toBeInTheDocument()
    expect(screen.getByText('CASH, UPI, CARD')).toBeInTheDocument()
    expect(await screen.findByText('₹1,234.05')).toBeInTheDocument()
  })

  it('searches the ledger and reverses a payment with a reason', async () => {
    stubApi((url, method) =>
      method === 'POST' && url.includes('/reverse') ? { body: { ...payment, is_reversed: true } } : routes(url),
    )
    const user = userEvent.setup()
    renderWithClient(<BillingAdminPage />)

    await user.type(await screen.findByLabelText('Receipt number, URN or patient name'), 'Asha')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(requests.some((r) => r.url.includes('q=Asha'))).toBe(true))

    await user.click(await screen.findByRole('button', { name: 'Reverse receipt RCP-2026-2027-0041' }))
    await user.type(await screen.findByLabelText(/justification/i), 'Duplicate entry')
    await user.click(screen.getByRole('button', { name: 'Confirm Reversal' }))

    await waitFor(() => expect(requests.some((r) => r.url.includes('/payments/9/reverse'))).toBe(true))
    expect(requests.find((r) => r.url.includes('/reverse'))?.body).toEqual({ reversal_reason: 'Duplicate entry' })
    expect(await screen.findByText('Receipt RCP-2026-2027-0041 was reversed.')).toBeInTheDocument()
  })
})
