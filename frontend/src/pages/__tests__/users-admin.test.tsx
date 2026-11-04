import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Users } from '../admin/Users'
import type { LoginHistoryEntry, Me, RevokeUserSessionsOut, UserOut } from '../../api/types'

const mockMe: Me = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  permissions: ['user:read', 'user:update', 'session:revoke', 'audit:read'],
  must_change_password: false,
  csrf_token: 'test-csrf-token',
  version_id: 1,
}

const baseUser: UserOut = {
  id: 1,
  username: 'admin',
  full_name: 'Kalyan Administrator',
  role: 'ADMIN',
  doctor_id: null,
  is_active: true,
  must_change_password: false,
  is_locked: false,
  locked_until: null,
  last_login_at: '2026-11-03T04:30:00Z',
  password_changed_at: '2026-10-01T04:30:00Z',
  created_at: '2026-01-05T04:30:00Z',
  version_id: 3,
}

function makeUsers(): UserOut[] {
  return [
    baseUser,
    {
      ...baseUser,
      id: 2,
      username: 'reception.one',
      full_name: 'Reception One',
      role: 'RECEPTION',
      must_change_password: true,
      last_login_at: null,
      version_id: 4,
    },
    {
      ...baseUser,
      id: 3,
      username: 'locked.user',
      full_name: 'Locked User',
      role: 'RECEPTION',
      is_locked: true,
      // 12.5 minutes from now: the page must show the remaining time from this API value.
      locked_until: new Date(Date.now() + 12.5 * 60_000).toISOString(),
      version_id: 7,
    },
    {
      ...baseUser,
      id: 4,
      username: 'old.staff',
      full_name: 'Old Staff',
      role: 'RECEPTION',
      is_active: false,
      version_id: 2,
    },
    {
      ...baseUser,
      id: 5,
      username: 'dr.sharma',
      full_name: 'Dr. Sharma',
      role: 'DOCTOR',
      doctor_id: 15,
      version_id: 1,
    },
  ]
}

const history: LoginHistoryEntry[] = [
  {
    id: 91,
    occurred_at: '2026-11-03T05:00:00Z',
    action: 'AUTH_LOGIN_THROTTLED',
    outcome: 'DENIED',
    actor_username: 'reception.one',
    ip_address: '192.168.1.20',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    reason: null,
    details: {},
  },
  {
    id: 90,
    occurred_at: '2026-11-03T04:59:00Z',
    action: 'AUTH_LOGIN_FAILED',
    outcome: 'FAILURE',
    actor_username: 'reception.one',
    ip_address: '192.168.1.20',
    user_agent: null,
    reason: null,
    details: { failed_login_count: 3 },
  },
]

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

function stubFetch(extra?: (url: string, init?: RequestInit) => Promise<unknown> | undefined) {
  const calls: Captured[] = []
  const users = makeUsers()
  const fetchMock = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined })
    const custom = extra?.(url, init)
    if (custom) return custom
    if (url.includes('/api/auth/me')) return json(mockMe)
    if (url.endsWith('/api/users') && method === 'GET') return json(users)
    if (/\/api\/users\/\d+\/login-history$/.test(url)) return json(history)
    if (/\/api\/users\/\d+\/revoke-sessions$/.test(url)) {
      const out: RevokeUserSessionsOut = { user_id: 2, revoked_count: 3, kept_current_session: false }
      return json(out)
    }
    if (/\/api\/users\/\d+\/deactivate$/.test(url)) return json({ ...users[1], is_active: false, version_id: 5 })
    return Promise.reject(new Error(`Unhandled: ${method} ${url}`))
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

function renderUsers() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function rowFor(username: string): HTMLElement {
  const cell = screen.getByText(username)
  const row = cell.closest('tr')
  if (!row) throw new Error(`No row for ${username}`)
  return row
}

describe('Users page (admin module 02)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows last sign-in, created, pending password change and the lockout with its remaining time', async () => {
    stubFetch()
    renderUsers()

    await screen.findByText('reception.one')
    const reception = rowFor('reception.one')
    expect(within(reception).getByText('Password change pending')).toBeInTheDocument()
    expect(within(reception).getByText('Never')).toBeInTheDocument()

    const admin = rowFor('admin')
    expect(within(admin).getByText('(you)')).toBeInTheDocument()
    expect(within(admin).getByText(/3 Nov 2026/)).toBeInTheDocument() // last sign-in (IST)
    expect(within(admin).getByText(/5 Jan 2026/)).toBeInTheDocument() // created

    const locked = rowFor('locked.user')
    expect(within(locked).getByText('Locked')).toBeInTheDocument()
    expect(within(locked).getByText(/Locked until .*\(1[23] min left\)/)).toBeInTheDocument()
    expect(within(locked).getByRole('button', { name: 'Unlock locked.user' })).toBeInTheDocument()
  })

  it('filters accounts by status with counts taken from the loaded list', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    expect(screen.getByRole('button', { name: 'All (5)' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Locked (1)' }))
    expect(screen.getByText('locked.user')).toBeInTheDocument()
    expect(screen.queryByText('reception.one')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Inactive (1)' }))
    expect(screen.getByText('old.staff')).toBeInTheDocument()
    expect(screen.queryByText('locked.user')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Active (4)' }))
    expect(screen.queryByText('old.staff')).not.toBeInTheDocument()
    expect(screen.getByText('dr.sharma')).toBeInTheDocument()
  })

  it('never offers Doctor in the edit role list and explains that a doctor account must be created new', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    await user.click(screen.getByRole('button', { name: 'Edit reception.one' }))
    const roleSelect = screen.getByLabelText('Role')
    const options = within(roleSelect).getAllByRole('option').map((o) => o.textContent)
    expect(options).toEqual(['Reception', 'Admin'])
    expect(screen.getByText(/create a new account with the Doctor role/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Edit dr.sharma' }))
    expect(screen.getByLabelText('Role')).toBeDisabled()
    expect(screen.getByText(/role cannot be changed/i)).toBeInTheDocument()
  })

  it('sends the optional reason with deactivate', async () => {
    const user = userEvent.setup()
    const calls = stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    await user.click(screen.getByRole('button', { name: 'Deactivate reception.one' }))
    await user.type(screen.getByLabelText('Reason (optional)'), 'Left the clinic')
    await user.click(screen.getByRole('button', { name: 'Deactivate account' }))

    await screen.findByText('Account deactivated: reception.one')
    const post = calls.find((c) => c.url.endsWith('/api/users/2/deactivate'))
    expect(post?.method).toBe('POST')
    expect(post?.body).toEqual({ version_id: 4, reason: 'Left the clinic' })
  })

  it('signs a user out everywhere after a destructive confirmation and reports the count from the API', async () => {
    const user = userEvent.setup()
    const calls = stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere for reception.one' }))
    expect(screen.getByText('Confirm action')).toBeInTheDocument() // destructive variant label
    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }))

    await screen.findByText('Signed out 3 sessions for reception.one.')
    const post = calls.find((c) => c.url.endsWith('/api/users/2/revoke-sessions'))
    expect(post?.method).toBe('POST')
    expect(post?.body).toEqual({ reason: null })
  })

  it('explains in the reset dialog that a reset does not clear an active lockout', async () => {
    const user = userEvent.setup()
    stubFetch()
    renderUsers()
    await screen.findByText('locked.user')

    await user.click(screen.getByRole('button', { name: 'Reset password for locked.user' }))
    expect(screen.getByText(/does not clear the lockout: use Unlock/i)).toBeInTheDocument()
  })

  it('opens the sign-in history for one user with outcome badges including Denied', async () => {
    const user = userEvent.setup()
    const calls = stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    await user.click(screen.getByRole('button', { name: 'Sign-in history for reception.one' }))
    const table = await screen.findByRole('table', { name: 'Sign-in history for reception.one' })
    expect(within(table).getByText('Sign-in throttled')).toBeInTheDocument()
    expect(within(table).getByText('Denied')).toBeInTheDocument()
    expect(within(table).getByText('Failure')).toBeInTheDocument()
    expect(within(table).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(table).getByText('Failed login count: 3')).toBeInTheDocument()
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/api/users/2/login-history'))).toBe(true))
  })

  it('hides deactivate and reset for the signed-in administrator', async () => {
    stubFetch()
    renderUsers()
    await screen.findByText('reception.one')

    expect(screen.queryByRole('button', { name: 'Deactivate admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset password for admin' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out everywhere for admin' })).toBeInTheDocument()
  })
})
