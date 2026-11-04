import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, getCsrfToken, setCsrfToken } from '../../api/client'
import { RequireAuth, RequireRole } from '../guards'
import { Forbidden, NotFound } from '../../pages/StatusPages'

function createGuardsRouter(initialEntries = ['/admin']) {
  return createMemoryRouter(
    [
      {
        path: '/login',
        element: <div data-testid="login-page">Login Page</div>,
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
            element: <RequireRole role="ADMIN" />,
            children: [
              {
                path: '/admin',
                element: (
                  <div data-testid="admin-content">
                    Admin Protected Content
                    <button
                      type="button"
                      onClick={() => {
                        void apiFetch('/protected-test').catch(() => undefined)
                      }}
                    >
                      Trigger protected request
                    </button>
                  </div>
                ),
              },
            ],
          },
          {
            element: <RequireRole role="RECEPTION" />,
            children: [
              {
                path: '/reception',
                element: <div data-testid="reception-content">Reception Content</div>,
              },
            ],
          },
          {
            element: <RequireRole role="DOCTOR" />,
            children: [
              {
                path: '/doctor',
                element: <div data-testid="doctor-content">Doctor Content</div>,
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

describe('RequireAuth & RequireRole UX Guards', () => {
  let testQueryClient: QueryClient

  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    })
    setCsrfToken(null)
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders loading status indicator while session query is pending', () => {
    // Return a never-resolving promise to observe pending state
    const mockFetch = vi.fn().mockImplementation(() => new Promise(() => {}))
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('redirects anonymous user (401 from /auth/me) to /login', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'not_authenticated',
                message: 'Authentication required',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
  })

  it('redirects authenticated user with must_change_password=true to /change-password', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 10,
                username: 'new_staff',
                full_name: 'New Staff',
                role: 'RECEPTION',
                doctor_id: null,
                permissions: ['reception:*'],
                must_change_password: true,
                csrf_token: 'csrf_pwd_123',
                version_id: 1,
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/reception'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('change-password-page')).toBeInTheDocument()
    })
  })

  it('redirects user with wrong role to their own home area', async () => {
    // DOCTOR tries to access /admin -> redirected to /doctor
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 12,
                username: 'dr_sharma',
                full_name: 'Dr. Sharma',
                role: 'DOCTOR',
                doctor_id: 5,
                permissions: ['doctor:*'],
                must_change_password: false,
                csrf_token: 'csrf_sharma',
                version_id: 1,
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('doctor-content')).toBeInTheDocument()
      expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument()
    })
  })

  it('renders protected area content when user has the correct role', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
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
                full_name: 'Admin',
                role: 'ADMIN',
                doctor_id: null,
                permissions: ['admin:*'],
                must_change_password: false,
                csrf_token: 'csrf_ok',
                version_id: 1,
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('admin-content')).toBeInTheDocument()
    })
  })


  it('clears cached data and redirects to sign-in when a protected request reports an expired session', async () => {
    testQueryClient.setQueryData(['patients'], [{ id: 1, name: 'Sensitive patient record' }])

    const mockFetch = vi.fn().mockImplementation((url: string) => {
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
                full_name: 'Admin',
                role: 'ADMIN',
                doctor_id: null,
                permissions: ['admin:*'],
                must_change_password: false,
                csrf_token: 'csrf_active_session',
                version_id: 1,
              }),
            ),
        })
      }
      if (url.includes('/api/protected-test')) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'session_expired',
                message: 'Session expired after inactivity',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createGuardsRouter(['/admin'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('admin-content')).toBeInTheDocument()
      expect(getCsrfToken()).toBe('csrf_active_session')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Trigger protected request' }))

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
      expect(testQueryClient.getQueryData(['patients'])).toBeUndefined()
      expect(getCsrfToken()).toBeNull()
    })
  })

  it('renders NotFound page on unknown path', () => {
    const router = createGuardsRouter(['/unknown-path-xyz'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('404 - Not found')).toBeInTheDocument()
  })

  it('renders Forbidden page on /403', () => {
    const router = createGuardsRouter(['/403'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(screen.getByText('403 - Forbidden')).toBeInTheDocument()
  })
})
