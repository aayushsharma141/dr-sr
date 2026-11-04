import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Users } from '../admin/Users'
import { ApiError } from '../../api/client'
import type { UserOut } from '../../api/types'

const lockedUser: UserOut = {
  id: 3,
  username: 'test.reception',
  full_name: 'Test Reception One',
  role: 'RECEPTION',
  doctor_id: null,
  is_active: true,
  must_change_password: false,
  is_locked: true,
  locked_until: '2026-11-01T09:15:00Z',
  last_login_at: null,
  password_changed_at: null,
  created_at: '2026-11-01T09:00:00Z',
  version_id: 2,
}

const mocks = vi.hoisted(() => ({
  unlockMutate: vi.fn(),
}))

vi.mock('../../api/queries', () => ({
  useUsers: () => ({
    data: [lockedUser],
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeactivateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactivateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResetUserPassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlockUser: () => ({ mutateAsync: mocks.unlockMutate, isPending: false }),
  useRevokeUserSessions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLoginHistory: () => ({ data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() }),
  useMe: () => ({ data: undefined }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

describe('Users page unlock failures are persistent inline alerts (UX-03)', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mocks.unlockMutate.mockReset()
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
  })

  afterEach(() => {
    alertSpy.mockRestore()
  })

  function renderUsers() {
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <Users />
        </MemoryRouter>
      </QueryClientProvider>
    )
  }

  it('shows a server rejection as role=alert and does not call window.alert', async () => {
    mocks.unlockMutate.mockRejectedValueOnce(new ApiError(409, 'conflict', 'User changed elsewhere'))
    renderUsers()

    fireEvent.click(screen.getByRole('button', { name: 'Unlock test.reception' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unlock account' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('User changed elsewhere')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('shows a non-API failure too, instead of swallowing it', async () => {
    mocks.unlockMutate.mockRejectedValueOnce(new TypeError('network down'))
    renderUsers()

    fireEvent.click(screen.getByRole('button', { name: 'Unlock test.reception' }))
    fireEvent.click(screen.getByRole('button', { name: 'Unlock account' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not unlock this account. Try again.')
    expect(alertSpy).not.toHaveBeenCalled()
  })
})
