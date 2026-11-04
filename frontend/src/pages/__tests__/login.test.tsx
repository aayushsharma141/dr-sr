import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '../../api/client'
import { RequireAuth, RequireRole } from '../../auth/guards'
import { ROLE_HOME } from '../../auth/roles'
import { AreaHome } from '../AreaHome'
import { Login } from '../Login'
import { Forbidden, NotFound } from '../StatusPages'
import type { Me } from '../../api/types'
import { useOutletContext } from 'react-router'

function RootRedirect() {
  const me = useOutletContext<Me>()
  return <div data-testid="redirect-to">{ROLE_HOME[me.role]}</div>
}

function createTestRouter(initialEntries = ['/login']) {
  return createMemoryRouter(
    [
      {
        path: '/login',
        element: <Login />,
      },
      {
        path: '/setup',
        element: <div data-testid="setup-page">Setup Wizard Page</div>,
      },
      {
        path: '/change-password',
        element: <div data-testid="change-password-page">Change Password Page</div>,
      },
      {
        path: '/403',
        element: <Forbidden />,
      },
      {
        element: <RequireAuth />,
        children: [
          {
            path: '/',
            element: <RootRedirect />,
          },
          {
            element: <RequireRole role="ADMIN" />,
            children: [
              {
                path: '/admin',
                element: <AreaHome area="admin" />,
              },
            ],
          },
          {
            element: <RequireRole role="RECEPTION" />,
            children: [
              {
                path: '/reception',
                element: <AreaHome area="reception" />,
              },
            ],
          },
          {
            element: <RequireRole role="DOCTOR" />,
            children: [
              {
                path: '/doctor',
                element: <AreaHome area="doctor" />,
              },
            ],
          },
        ],
      },
      {
        path: '*',
        element: <NotFound />,
      },
    ],
    { initialEntries },
  )
}

describe('Login & Role Navigation Flow', () => {
  let testQueryClient: QueryClient

  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    setCsrfToken(null)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders login form and queries inputs strictly by label text', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument()
  })

  it('successful ADMIN login navigates to /admin and loads overview', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/login') || url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 1,
                username: 'superadmin',
                full_name: 'Dr. Superintendent',
                role: 'ADMIN',
                doctor_id: null,
                permissions: ['admin:*'],
                must_change_password: false,
                csrf_token: 'csrf_admin_123',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/admin/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                area: 'admin',
                name: 'Dr. Superintendent',
                role: 'ADMIN',
                user_counts: {
                  ADMIN: { active: 1, inactive: 0 },
                  RECEPTION: { active: 2, inactive: 0 },
                  DOCTOR: { active: 3, inactive: 0 },
                },
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Username'), 'superadmin')
    await user.type(screen.getByLabelText('Password'), 'ValidAdminPass123!')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText('admin Dashboard')).toBeInTheDocument()
      expect(screen.getByText('System User Counts')).toBeInTheDocument()
      expect(screen.getByText(/3 active/)).toBeInTheDocument()
    })
  })

  it('successful RECEPTION login navigates to /reception and loads overview', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/login') || url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 2,
                username: 'reception1',
                full_name: 'Reception Desk',
                role: 'RECEPTION',
                doctor_id: null,
                permissions: ['reception:*'],
                must_change_password: false,
                csrf_token: 'csrf_rec_123',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/reception/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                area: 'reception',
                name: 'Reception Desk',
                role: 'RECEPTION',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Username'), 'reception1')
    await user.type(screen.getByLabelText('Password'), 'ValidRecPass123!')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText('reception Dashboard')).toBeInTheDocument()
      expect(
        screen.getByText(/Reception area active. Ready for patient check-ins/i),
      ).toBeInTheDocument()
    })
  })

  it('successful DOCTOR login navigates to /doctor and loads overview', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/login') || url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 3,
                username: 'dr_kumar',
                full_name: 'Dr. Kumar',
                role: 'DOCTOR',
                doctor_id: 10,
                permissions: ['doctor:*'],
                must_change_password: false,
                csrf_token: 'csrf_doc_123',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/doctor/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                area: 'doctor',
                name: 'Dr. Kumar',
                role: 'DOCTOR',
                doctor_id: 10,
                doctor_name_en: 'Dr. Ashok Kumar',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Username'), 'dr_kumar')
    await user.type(screen.getByLabelText('Password'), 'ValidDocPass123!')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.getByText('doctor Dashboard')).toBeInTheDocument()
      expect(screen.getByText(/Doctor ID: 10/)).toBeInTheDocument()
      expect(screen.getByText(/Doctor Name: Dr. Ashok Kumar/)).toBeInTheDocument()
    })
  })

  it('displays generic 401 message with role=alert on invalid credentials', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/login')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'invalid_credentials',
                message:
                  'Invalid username or password, or the account is temporarily locked. Wait 15 minutes or ask an administrator.',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Username'), 'bad_user')
    await user.type(screen.getByLabelText('Password'), 'bad_password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Invalid username or password, or the account is temporarily locked. Wait 15 minutes or ask an administrator.',
    )
  })

  it('displays distinct 429 message with Retry-After seconds on rate limit', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/login')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          headers: new Headers({
            'content-type': 'application/json',
            'Retry-After': '900',
          }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'too_many_attempts',
                message: 'Too many failed login attempts. Please wait 900 seconds before trying again.',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Username'), 'locked_user')
    await user.type(screen.getByLabelText('Password'), 'any_password')
    await user.click(screen.getByRole('button', { name: /sign in/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Too many failed login attempts. Please wait 900 seconds before trying again.',
    )
  })

  it('displays idle logout message when reason=expired is in search params', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createTestRouter(['/login?reason=expired'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('You were signed out because this computer was left inactive'),
      ).toBeInTheDocument()
    })
  })

  it('displays setup notice with link when setup_required is true and no notice when closed (410)', async () => {
    // 1. Setup required = true -> notice appears
    const mockFetchRequired = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetchRequired)

    const router1 = createTestRouter(['/login'])
    const { unmount } = render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router1} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('No administrator exists yet - open the setup wizard'),
      ).toBeInTheDocument()
      expect(screen.getByRole('link', { name: /setup wizard/i })).toHaveAttribute(
        'href',
        '/setup',
      )
    })
    unmount()

    // 2. Setup closed (410) -> no notice
    const mockFetchClosed = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetchClosed)

    const router2 = createTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router2} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.queryByText('No administrator exists yet - open the setup wizard'),
      ).not.toBeInTheDocument()
    })
  })

  it('reload case: mounts app, GET /auth/me returns csrf_token t1, and logout POST carries X-CSRF-Token t1', async () => {
    let capturedLogoutHeaders: Record<string, string> = {}

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 1,
                username: 'superadmin',
                full_name: 'Dr. Superintendent',
                role: 'ADMIN',
                doctor_id: null,
                permissions: ['admin:*'],
                must_change_password: false,
                csrf_token: 't1',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/admin/overview')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                area: 'admin',
                name: 'Dr. Superintendent',
                role: 'ADMIN',
                user_counts: {},
              }),
            ),
        })
      }
      if (url.includes('/api/auth/logout')) {
        capturedLogoutHeaders = (init?.headers as Record<string, string>) || {}
        return Promise.resolve({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: new Headers(),
          text: () => Promise.resolve(''),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    // Mount directly on protected route /admin (simulating reload while authenticated)
    const router = createTestRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('admin Dashboard')).toBeInTheDocument()
    })

    // Click "Sign out"
    const signOutBtn = screen.getByRole('button', { name: /sign out/i })
    await user.click(signOutBtn)

    await waitFor(() => {
      expect(capturedLogoutHeaders['X-CSRF-Token']).toBe('t1')
    })
  })
})
