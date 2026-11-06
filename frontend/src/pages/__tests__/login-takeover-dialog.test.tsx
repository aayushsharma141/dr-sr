import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setCsrfToken } from '../../api/client'
import { Login } from '../Login'
import {
  TakeoverSessionModal,
  formatTimestamp,
} from '../../components/TakeoverSessionModal'
import type { Me } from '../../api/types'

const mockConflictSession = {
  ip: '192.168.1.104',
  user_agent: 'Chrome 134 / Windows 11',
  last_seen_at: '2026-11-06T10:14:00Z',
}

const mockDoctorMe: Me = {
  id: 10,
  username: 'dr_dwivedi',
  full_name: 'Dr. Madan Mohan Dwivedi',
  role: 'DOCTOR',
  doctor_id: 1,
  csrf_token: 'valid-csrf-token',
  must_change_password: false,
  permissions: ['encounters:read', 'encounters:write'],
  version_id: 1,
}

describe('TakeoverSessionModal component', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders active workstation details card and explanatory contract copy', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    render(
      <TakeoverSessionModal
        open={true}
        activeSession={mockConflictSession}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText('Active Session Detected Elsewhere')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.104')).toBeInTheDocument()
    expect(screen.getByText('Chrome 134 / Windows 11')).toBeInTheDocument()
    expect(
      screen.getByText(/Signing in will immediately terminate the active session on workstation/i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take Over Session & Sign In' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel Sign-In Attempt' })).toBeInTheDocument()
  })

  it('triggers onConfirm and onCancel callbacks on button clicks', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()

    const { rerender } = render(
      <TakeoverSessionModal
        open={true}
        activeSession={mockConflictSession}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Take Over Session & Sign In' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)

    rerender(
      <TakeoverSessionModal
        open={true}
        activeSession={mockConflictSession}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Cancel Sign-In Attempt' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('displays loading spinner state during submission', () => {
    render(
      <TakeoverSessionModal
        open={true}
        activeSession={mockConflictSession}
        isSubmitting={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByText('Terminating remote session and signing in...')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Terminating remote session/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel Sign-In Attempt' })).toBeDisabled()
  })
})

describe('Login Page HTTP 409 session takeover flow (DWS-10, T-19-13)', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
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

  function renderLoginPage() {
    const router = createMemoryRouter(
      [
        {
          path: '/login',
          element: <Login />,
        },
        {
          path: '/doctor',
          element: <div data-testid="doctor-dashboard-landing">Doctor Dashboard Landing</div>,
        },
      ],
      { initialEntries: ['/login'] }
    )

    return render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }

  it('intercepts 409 session_in_use, displays TakeoverSessionModal, and resends login with takeover: true', async () => {
    const user = userEvent.setup()
    let loginAttempts = 0
    let lastRequestBody: any = null

    vi.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.includes('/api/auth/setup-status') || url.includes('/setup-status')) {
        return new Response(JSON.stringify({ setup_required: false, allow_bootstrap: false }), {
          status: 200,
        })
      }
      if (url.includes('/api/auth/login') || url.includes('/auth/login')) {
        loginAttempts++
        lastRequestBody = JSON.parse(String(init?.body || '{}'))

        if (loginAttempts === 1) {
          // Return 409 conflict
          return new Response(
            JSON.stringify({
              code: 'session_in_use',
              message: 'An active session already exists for this account on another device.',
              active_session: mockConflictSession,
            }),
            { status: 409, headers: { 'Content-Type': 'application/json' } }
          )
        } else {
          // Return 200 success with takeover
          return new Response(JSON.stringify(mockDoctorMe), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })

    renderLoginPage()

    // Fill credentials
    const usernameInput = screen.getByLabelText(/Username/i)
    const passwordInput = screen.getByLabelText(/^Password/i)
    await user.type(usernameInput, 'dr_dwivedi')
    await user.type(passwordInput, 'SecureDocPass123!')

    // Click Sign In
    const submitBtn = screen.getByRole('button', { name: /Sign in to workspace/i })
    await user.click(submitBtn)

    // Modal should appear displaying remote device details
    expect(await screen.findByText('Active Session Detected Elsewhere')).toBeInTheDocument()
    expect(screen.getByText('192.168.1.104')).toBeInTheDocument()
    expect(screen.getByText('Chrome 134 / Windows 11')).toBeInTheDocument()
    expect(lastRequestBody).toEqual({
      username: 'dr_dwivedi',
      password: 'SecureDocPass123!',
    })

    // Click "Take Over Session & Sign In"
    const takeoverBtn = screen.getByRole('button', { name: 'Take Over Session & Sign In' })
    await user.click(takeoverBtn)

    // Second request sent with takeover: true
    await waitFor(() => {
      expect(loginAttempts).toBe(2)
    })
    expect(lastRequestBody).toEqual({
      username: 'dr_dwivedi',
      password: 'SecureDocPass123!',
      takeover: true,
    })

    // Navigates to doctor dashboard
    expect(await screen.findByTestId('doctor-dashboard-landing')).toBeInTheDocument()
  })

  it('cancelling takeover dismisses modal and clears password field', async () => {
    const user = userEvent.setup()

    vi.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('setup-status')) {
        return new Response(JSON.stringify({ setup_required: false }), { status: 200 })
      }
      if (url.includes('/auth/login')) {
        return new Response(
          JSON.stringify({
            code: 'session_in_use',
            message: 'Session in use',
            active_session: mockConflictSession,
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })

    renderLoginPage()

    const usernameInput = screen.getByLabelText(/Username/i)
    const passwordInput = screen.getByLabelText(/^Password/i)
    await user.type(usernameInput, 'dr_dwivedi')
    await user.type(passwordInput, 'MyPassword123')

    const submitBtn = screen.getByRole('button', { name: /Sign in to workspace/i })
    await user.click(submitBtn)

    expect(await screen.findByText('Active Session Detected Elsewhere')).toBeInTheDocument()

    // Click cancel
    const cancelBtn = screen.getByRole('button', { name: 'Cancel Sign-In Attempt' })
    await user.click(cancelBtn)

    // Modal is gone
    await waitFor(() => {
      expect(screen.queryByText('Active Session Detected Elsewhere')).not.toBeInTheDocument()
    })

    // Password field is cleared
    expect(passwordInput).toHaveValue('')
    // Username stays intact
    expect(usernameInput).toHaveValue('dr_dwivedi')
  })
})
