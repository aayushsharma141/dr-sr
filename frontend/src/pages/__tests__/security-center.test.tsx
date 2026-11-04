import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SecurityCenterPage } from '../admin/SecurityCenterPage'
import type {
  ActiveSessionOut,
  AuditLogListResponse,
  AuditLogOut,
  Me,
  RevokeSessionOut,
  SecurityPolicyOut,
} from '../../api/types'

const mockMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: ['session:read', 'session:revoke', 'security:read', 'audit:read'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const policy: SecurityPolicyOut = {
  session_idle_minutes: 30,
  session_absolute_hours: 12,
  lockout_threshold: 5,
  lockout_minutes: 15,
  throttle_max_failures: 20,
  throttle_window_minutes: 10,
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
  version_id: 1,
  updated_at: '2026-11-04T03:00:00Z',
}

const sessions: ActiveSessionOut[] = [
  {
    id: 11,
    user_id: 1,
    username: 'admin',
    full_name: 'Kalyan Administrator',
    role: 'ADMIN',
    ip_address: '192.168.1.10',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0',
    created_at: '2026-11-04T03:00:00Z',
    last_seen_at: '2026-11-04T04:00:00Z',
    idle_expires_at: '2026-11-04T04:30:00Z',
    absolute_expires_at: '2026-11-04T15:00:00Z',
    is_current: true,
  },
  {
    id: 12,
    user_id: 2,
    username: 'reception.one',
    full_name: 'Reception One',
    role: 'RECEPTION',
    ip_address: '192.168.1.20',
    user_agent: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
    created_at: '2026-11-04T02:00:00Z',
    last_seen_at: '2026-11-04T03:55:00Z',
    idle_expires_at: '2026-11-04T04:25:00Z',
    absolute_expires_at: '2026-11-04T14:00:00Z',
    is_current: false,
  },
]

function auditRow(over: Partial<AuditLogOut>): AuditLogOut {
  return {
    id: 1,
    occurred_at: '2026-11-04T03:30:00Z',
    actor_user_id: null,
    actor_username: 'reception.one',
    actor_role: 'RECEPTION',
    action: 'AUTH_LOGIN_FAILED',
    outcome: 'FAILURE',
    entity_type: 'USER',
    entity_id: '2',
    before_data: null,
    after_data: null,
    reason: null,
    request_id: null,
    ip: '192.168.1.20',
    user_agent: null,
    ...over,
  }
}

const auditPage: AuditLogListResponse = {
  items: [
    auditRow({ id: 5, action: 'AUTH_LOGIN_THROTTLED', outcome: 'DENIED' }),
    auditRow({ id: 4, action: 'PATIENT_REGISTERED', outcome: 'SUCCESS', entity_type: 'PATIENT' }),
    auditRow({ id: 3, action: 'AUTH_LOGIN_FAILED', outcome: 'FAILURE' }),
    auditRow({ id: 2, action: 'USER_UNLOCKED', outcome: 'SUCCESS', actor_username: 'admin', reason: 'Called from desk' }),
  ],
  total: 4,
  page: 1,
  page_size: 200,
  pages: 1,
}

function json(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Headers({ 'content-type': 'application/json' }),
    text: () => Promise.resolve(JSON.stringify(body)),
  })
}

interface Captured {
  url: string
  method: string
  body: unknown
}

function stubFetch(revoke?: () => Promise<unknown>) {
  const calls: Captured[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url.includes('/api/auth/me')) return json(mockMe)
      if (url.includes('/api/security/policy')) return json(policy)
      if (/\/api\/sessions\/\d+\/revoke$/.test(url)) {
        if (revoke) return revoke()
        const out: RevokeSessionOut = { id: 12, user_id: 2, revoked_at: '2026-11-04T04:01:00Z' }
        return json(out)
      }
      if (url.endsWith('/api/sessions')) return json(sessions)
      if (url.includes('/api/audit-logs')) return json(auditPage)
      return Promise.reject(new Error(`Unhandled: ${method} ${url}`))
    }),
  )
  return calls
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SecurityCenterPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Security & Access centre (admin module 09)', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the read-only security policy from the API with the installation note', async () => {
    stubFetch()
    renderPage()

    const section = screen.getByRole('region', { name: 'Current security policy' })
    expect(await within(section).findByText('30 minutes')).toBeInTheDocument()
    expect(within(section).getByText(/Set at server installation/)).toBeInTheDocument()
    expect(within(section).getByText('12 hours')).toBeInTheDocument()
    expect(within(section).getByText('5')).toBeInTheDocument()
    expect(within(section).getByText('10 to 128 characters')).toBeInTheDocument()
    expect(within(section).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(section).queryByRole('spinbutton')).not.toBeInTheDocument()
  })

  it('lists active sessions; the current session shows "This session" and cannot be revoked', async () => {
    stubFetch()
    renderPage()

    const section = screen.getByRole('region', { name: 'Active sessions' })
    const table = await within(section).findByRole('table', { name: 'Active sessions' })
    const current = within(table).getByText('admin').closest('tr') as HTMLElement
    expect(within(current).getByText('This session')).toBeInTheDocument()
    expect(within(current).queryByRole('button')).not.toBeInTheDocument()
    expect(within(current).getByText('Edge on Windows')).toBeInTheDocument()

    const other = within(table).getByText('reception.one').closest('tr') as HTMLElement
    expect(within(other).getByText('Firefox on Linux')).toBeInTheDocument()
    expect(within(other).getByText('192.168.1.20')).toBeInTheDocument()
    expect(within(other).getByText('if idle')).toBeInTheDocument()
    expect(within(other).getByRole('button', { name: 'Revoke session for reception.one' })).toBeInTheDocument()
    expect(within(section).getByText(/2 active sessions/)).toBeInTheDocument()
  })

  it('revokes a session after a destructive confirmation and sends the optional reason', async () => {
    const user = userEvent.setup()
    const calls = stubFetch()
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Revoke session for reception.one' }))
    expect(screen.getByText('Confirm action')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Reason (optional)'), 'Shared PC left signed in')
    await user.click(screen.getByRole('button', { name: 'End session' }))

    await screen.findByText(/Session ended for reception.one/)
    const post = calls.find((c) => c.url.endsWith('/api/sessions/12/revoke'))
    expect(post?.method).toBe('POST')
    expect(post?.body).toEqual({ reason: 'Shared PC left signed in' })
  })

  it('keeps the dialog open with a clear message when the session already ended', async () => {
    const user = userEvent.setup()
    stubFetch(() => json({ code: 'session_not_found', message: 'Session not found' }, 404))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Revoke session for reception.one' }))
    await user.click(screen.getByRole('button', { name: 'End session' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('This session has already ended.')
  })

  it('shows only auth and security events with outcome badges including Denied', async () => {
    stubFetch()
    renderPage()

    const section = screen.getByRole('region', { name: 'Recent security events' })
    const table = await within(section).findByRole('table', { name: 'Recent security events' })
    expect(within(table).getByText('Sign-in throttled')).toBeInTheDocument()
    expect(within(table).getByText('Denied')).toBeInTheDocument()
    expect(within(table).getByText('Sign-in failed')).toBeInTheDocument()
    expect(within(table).getByText('Failure')).toBeInTheDocument()
    expect(within(table).getByText('Account unlocked')).toBeInTheDocument()
    expect(within(table).getByText('Called from desk')).toBeInTheDocument()
    expect(within(table).queryByText('PATIENT_REGISTERED')).not.toBeInTheDocument()
    expect(within(section).getByText(/Showing 3 security events found in the latest 4 audit entries/)).toBeInTheDocument()
  })

  it('filters the audit log by the chosen security action and outcome on the server', async () => {
    const user = userEvent.setup()
    const calls = stubFetch()
    renderPage()

    await screen.findByRole('table', { name: 'Recent security events' })
    await user.selectOptions(screen.getByLabelText('Event'), 'AUTH_ACCOUNT_LOCKED')
    await user.selectOptions(screen.getByLabelText('Outcome'), 'DENIED')

    await waitFor(() =>
      expect(
        calls.some(
          (c) => c.url.includes('/api/audit-logs?') && c.url.includes('action=AUTH_ACCOUNT_LOCKED') && c.url.includes('outcome=DENIED'),
        ),
      ).toBe(true),
    )
  })
})
