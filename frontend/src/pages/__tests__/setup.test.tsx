import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Setup } from '../Setup'
import { LoginRoute } from '../../router'

function createSetupTestRouter(initialEntries = ['/setup']) {
  return createMemoryRouter(
    [
      {
        path: '/setup',
        element: <Setup />,
      },
      {
        path: '/login',
        element: <LoginRoute />,
      },
    ],
    { initialEntries },
  )
}

describe('First-Run Setup Wizard Screen & Routing (EG-17)', () => {
  let testQueryClient: QueryClient

  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    })
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('routes visiting /login to /setup when setup_required is true (200)', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createSetupTestRouter(['/login'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('Initial System Setup')).toBeInTheDocument()
      expect(screen.getByLabelText('Setup code')).toBeInTheDocument()
    })
  })

  it('redirects visiting /setup to /login with closed notice when status is 410', async () => {
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

    const router = createSetupTestRouter(['/setup'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(
        screen.getByText('Setup wizard is closed. Administrator already exists.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /sign in/i }),
      ).toBeInTheDocument()
    })
  })

  it('shows required labels, console file hint, and client mismatch validation', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createSetupTestRouter(['/setup'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Setup code')).toBeInTheDocument()
    })

    expect(
      screen.getByText(/Displayed on the server console and saved in backend\\var\\setup-code\.txt/i),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Full name')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toBeInTheDocument()

    // Test client-side mismatch
    await user.type(screen.getByLabelText('Setup code'), 'ABC123XYZ4')
    await user.type(screen.getByLabelText('Username'), 'superadmin')
    await user.type(screen.getByLabelText('Full name'), 'Super Administrator')
    await user.type(screen.getByLabelText('Password'), 'ValidAdminPass123!')
    await user.type(screen.getByLabelText('Confirm password'), 'DifferentPass999!')
    await user.click(screen.getByRole('button', { name: /complete setup/i }))

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm password')).toHaveFocus()
  })

  it('displays wrong-code message and moves focus on 403 setup_code_invalid', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
        })
      }
      if (url.includes('/api/setup/admin') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'setup_code_invalid',
                message: 'Invalid setup code',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createSetupTestRouter(['/setup'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Setup code')).toBeInTheDocument()
    })

    const codeInput = screen.getByLabelText('Setup code')
    await user.type(codeInput, 'WRONGCODE99')
    await user.type(screen.getByLabelText('Username'), 'superadmin')
    await user.type(screen.getByLabelText('Full name'), 'Super Administrator')
    await user.type(screen.getByLabelText('Password'), 'ValidAdminPass123!')
    await user.type(screen.getByLabelText('Confirm password'), 'ValidAdminPass123!')
    await user.click(screen.getByRole('button', { name: /complete setup/i }))

    await waitFor(() => {
      expect(
        screen.getByText('The setup code is not correct. Read it again on the server PC.'),
      ).toBeInTheDocument()
    })
    expect(codeInput).toHaveFocus()
  })

  it('displays server password_policy error and moves focus on 422', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/setup/status')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
        })
      }
      if (url.includes('/api/setup/admin') && init?.method === 'POST') {
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'password_policy',
                message: 'Password must not match common weak passwords.',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createSetupTestRouter(['/setup'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Setup code')).toBeInTheDocument()
    })

    const passwordInput = screen.getByLabelText('Password')
    await user.type(screen.getByLabelText('Setup code'), 'CORRECT1234')
    await user.type(screen.getByLabelText('Username'), 'superadmin')
    await user.type(screen.getByLabelText('Full name'), 'Super Administrator')
    await user.type(passwordInput, 'weakpassword')
    await user.type(screen.getByLabelText('Confirm password'), 'weakpassword')
    await user.click(screen.getByRole('button', { name: /complete setup/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Password must not match common weak passwords.'),
      ).toBeInTheDocument()
    })
    expect(passwordInput).toHaveFocus()
  })

  it('success (201) routes to /login with "Administrator created. Please sign in."', async () => {
    let setupCompleted = false

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/setup/status')) {
        if (!setupCompleted) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve(JSON.stringify({ setup_required: true })),
          })
        }
        return Promise.resolve({
          ok: false,
          status: 410,
          statusText: 'Gone',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify({ code: 'setup_closed' })),
        })
      }
      if (url.includes('/api/setup/admin') && init?.method === 'POST') {
        setupCompleted = true
        return Promise.resolve({
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                id: 1,
                username: 'superadmin',
                full_name: 'Hospital Superintendent',
                role: 'ADMIN',
                doctor_id: null,
                is_active: true,
                must_change_password: false,
                is_locked: false,
                last_login_at: null,
                created_at: '2026-10-31T00:00:00Z',
                version_id: 1,
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createSetupTestRouter(['/setup'])
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Setup code')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('Setup code'), 'VALIDCODE10')
    await user.type(screen.getByLabelText('Username'), 'superadmin')
    await user.type(screen.getByLabelText('Full name'), 'Hospital Superintendent')
    await user.type(screen.getByLabelText('Password'), 'ValidAdminPass123!')
    await user.type(screen.getByLabelText('Confirm password'), 'ValidAdminPass123!')
    await user.click(screen.getByRole('button', { name: /complete setup/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Administrator created. Please sign in.'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /sign in/i }),
      ).toBeInTheDocument()
    })
  })
})
