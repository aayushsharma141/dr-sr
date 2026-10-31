import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Users } from '../../pages/admin/Users'
import type { UserOut } from '../../api/types'

const INITIAL_USER: UserOut = {
  id: 42,
  username: 'reception_staff',
  full_name: 'Original Receptionist Name',
  role: 'RECEPTION',
  doctor_id: null,
  is_active: true,
  must_change_password: false,
  is_locked: false,
  last_login_at: null,
  created_at: '2026-10-31T00:00:00Z',
  version_id: 1,
}

const CONFLICT_UPDATED_USER: UserOut = {
  ...INITIAL_USER,
  full_name: 'Modified By Another Admin',
  version_id: 2,
}

function createTestUsersRouter() {
  return createMemoryRouter(
    [
      {
        path: '/admin/users',
        element: <Users />,
      },
    ],
    { initialEntries: ['/admin/users'] },
  )
}

describe('D-08 ConflictBanner & 409 Handling', () => {
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

  it('shows ConflictBanner with exact text and Reload latest on version_conflict, keeps typed input, and resets on reload', async () => {
    let patchAttemptCount = 0

    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      // 1. Initial users list
      if (url.endsWith('/api/users') && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([INITIAL_USER])),
        })
      }

      // 2. Stale PATCH request -> returns 409 version_conflict envelope
      if (url.includes('/api/users/42') && init?.method === 'PATCH') {
        patchAttemptCount += 1
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'version_conflict',
                message: 'Record was modified by another user',
                entity: 'user',
                id: 42,
              }),
            ),
        })
      }

      // 3. Reload latest user request -> returns fresh user with version_id: 2
      if (url.includes('/api/users/42') && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify(CONFLICT_UPDATED_USER)),
        })
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestUsersRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    // Wait for table to load
    await waitFor(() => {
      expect(screen.getByText('reception_staff')).toBeInTheDocument()
    })

    // Click "Edit"
    const editBtn = screen.getByRole('button', { name: /^edit$/i })
    await user.click(editBtn)

    // Edit modal should open with current name
    const fullNameInput = screen.getByLabelText('Full Name')
    expect(fullNameInput).toHaveValue('Original Receptionist Name')

    // Admin types new name "My Attempted Name"
    await user.clear(fullNameInput)
    await user.type(fullNameInput, 'My Attempted Name')
    expect(fullNameInput).toHaveValue('My Attempted Name')

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)

    // Assert ConflictBanner is rendered with EXACT wording
    await waitFor(() => {
      expect(
        screen.getByText('Record was modified by another user'),
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Reload latest' }),
      ).toBeInTheDocument()
    })

    expect(patchAttemptCount).toBe(1)

    // The user's typed input MUST remain visible (never silently overwritten before reload)
    expect(fullNameInput).toHaveValue('My Attempted Name')

    // Click "Reload latest"
    const reloadBtn = screen.getByRole('button', { name: 'Reload latest' })
    await user.click(reloadBtn)

    // Form resets to latest fetched values and banner is dismissed
    await waitFor(() => {
      expect(fullNameInput).toHaveValue('Modified By Another Admin')
      expect(
        screen.queryByText('Record was modified by another user'),
      ).not.toBeInTheDocument()
    })
  })

  it('shows standard alert message and NEVER ConflictBanner on non-conflict 409 errors (e.g. role_change_not_allowed)', async () => {
    const mockFetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/users') && (!init || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve(JSON.stringify([INITIAL_USER])),
        })
      }

      if (url.includes('/api/users/42') && init?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          statusText: 'Conflict',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () =>
            Promise.resolve(
              JSON.stringify({
                code: 'role_change_not_allowed',
                message: 'Doctor role change requires linked doctor profile updates',
              }),
            ),
        })
      }

      return Promise.reject(new Error(`Unhandled URL: ${url}`))
    })
    vi.stubGlobal('fetch', mockFetch)

    const user = userEvent.setup()
    const router = createTestUsersRouter()
    render(
      <QueryClientProvider client={testQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByText('reception_staff')).toBeInTheDocument()
    })

    const editBtn = screen.getByRole('button', { name: /^edit$/i })
    await user.click(editBtn)

    const saveBtn = screen.getByRole('button', { name: /save changes/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(
        screen.getByText('Doctor role change requires linked doctor profile updates'),
      ).toBeInTheDocument()
    })

    // Banner should NEVER appear for non-version conflicts
    expect(
      screen.queryByText('Record was modified by another user'),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Reload latest' }),
    ).not.toBeInTheDocument()
  })
})
