import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getCsrfToken, setCsrfToken } from '../../api/client'
import { ChangePassword } from '../ChangePassword'
import type { Me } from '../../api/types'

const MUST_CHANGE_ME: Me = {
  id: 5,
  username: 'temp_doc',
  full_name: 'Dr. Temporary',
  role: 'DOCTOR',
  doctor_id: 15,
  permissions: ['doctor:*'],
  must_change_password: true,
  csrf_token: 'initial_csrf_1',
  version_id: 1,
}

const UPDATED_ME: Me = {
  ...MUST_CHANGE_ME,
  must_change_password: false,
  csrf_token: 'new_csrf_after_pwd_change',
}

function createChangePasswordRouter() {
  return createMemoryRouter(
    [
      {
        path: '/change-password',
        element: <ChangePassword />,
      },
      {
        path: '/doctor',
        element: <div data-testid="doctor-home">Doctor Home Dashboard</div>,
      },
      {
        path: '/login',
        element: <div data-testid="login-page">Login Page</div>,
      },
    ],
    { initialEntries: ['/change-password'] },
  )
}

describe('ChangePassword Screen & Contract', () => {
  let testQueryClient: QueryClient

  beforeEach(() => {
    testQueryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    })
    setCsrfToken('initial_csrf_1')
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('renders fields labelled Current password, New password, and Confirm new password', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(MUST_CHANGE_ME)),
        })
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(screen.getByLabelText('Current password')).toBeInTheDocument()
    expect(screen.getByLabelText('New password')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /change password/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows field error with aria-invalid when passwords do not match', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(MUST_CHANGE_ME)),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Current password'), 'CurrentPassword123!')
    await user.type(screen.getByLabelText('New password'), 'NewValidPassword123!')
    await user.type(screen.getByLabelText('Confirm new password'), 'MismatchPassword999!')
    await user.click(screen.getByRole('button', { name: /change password/i }))

    expect(screen.getByText('New passwords do not match')).toBeInTheDocument()
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(mockFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/auth/change-password'),
      expect.anything(),
    )
  })

  it('renders server current_password_invalid error next to current password field', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(MUST_CHANGE_ME)),
        })
      }
      if (url.includes('/api/auth/change-password')) {
        return Promise.resolve({
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'current_password_invalid',
                message: 'Current password does not match.',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Current password'), 'WrongCurrentPass!')
    await user.type(screen.getByLabelText('New password'), 'NewPassword123!')
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPassword123!')
    await user.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(
        screen.getByText('Current password does not match.'),
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Current password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('renders server password_policy error next to new password field', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(MUST_CHANGE_ME)),
        })
      }
      if (url.includes('/api/auth/change-password')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          statusText: 'Unprocessable Entity',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'password_policy',
                message: 'Password must not be in the list of commonly compromised passwords.',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Current password'), 'CurrentPassword123!')
    await user.type(screen.getByLabelText('New password'), 'password1234')
    await user.type(screen.getByLabelText('Confirm new password'), 'password1234')
    await user.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(
        screen.getByText(
          'Password must not be in the list of commonly compromised passwords.',
        ),
      ).toBeInTheDocument()
    })
    expect(screen.getByLabelText('New password')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  it('success updates csrf_token, refetches me, and navigates to role home', async () => {
    let changePasswordCallCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/auth/me')) {
        const payload = changePasswordCallCount > 0 ? UPDATED_ME : MUST_CHANGE_ME
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(payload)),
        })
      }
      if (url.includes('/api/auth/change-password') && init?.method === 'POST') {
        changePasswordCallCount += 1
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                csrf_token: 'new_csrf_after_pwd_change',
              }),
            ),
        })
      }
      return Promise.reject(new Error(`Unhandled: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await user.type(screen.getByLabelText('Current password'), 'CurrentPassword123!')
    await user.type(screen.getByLabelText('New password'), 'ValidNewPassword123!')
    await user.type(screen.getByLabelText('Confirm new password'), 'ValidNewPassword123!')
    await user.click(screen.getByRole('button', { name: /change password/i }))

    await waitFor(() => {
      expect(screen.getByTestId('doctor-home')).toBeInTheDocument()
    })

    expect(getCsrfToken()).toBe('new_csrf_after_pwd_change')
  })

  it('allows signing out directly from the forced-change page', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/auth/me')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(MUST_CHANGE_ME)),
        })
      }
      if (url.includes('/api/auth/logout')) {
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
    const router = createChangePasswordRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    const signOutBtn = screen.getByRole('button', { name: /sign out/i })
    await user.click(signOutBtn)

    await waitFor(() => {
      expect(screen.getByTestId('login-page')).toBeInTheDocument()
    })
  })
})
