import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { Users } from '../admin/Users'
import { ApiError } from '../../api/client'
import type { UserOut } from '../../api/types'

function user(overrides: Partial<UserOut>): UserOut {
  return {
    id: 10,
    username: 'unused.reception',
    full_name: 'Unused Reception',
    role: 'RECEPTION',
    doctor_id: null,
    is_active: false,
    is_super_admin: false,
    must_change_password: false,
    is_locked: false,
    locked_until: null,
    last_login_at: null,
    password_changed_at: null,
    created_at: '2026-11-01T09:00:00Z',
    version_id: 4,
    ...overrides,
  }
}

const inactive = user({})
const active = user({ id: 11, username: 'active.reception', is_active: true })
const superAdmin = user({ id: 12, username: 'root.admin', role: 'ADMIN', is_active: true, is_super_admin: true })
const me = user({ id: 13, username: 'me.admin', role: 'ADMIN', is_active: true })
const inactiveAdminSelfLike = user({ id: 13, username: 'me.admin', role: 'ADMIN', is_active: false })

const mocks = vi.hoisted(() => ({
  deleteMutate: vi.fn(),
  bulkMutate: vi.fn(),
  users: [] as UserOut[],
}))

vi.mock('../../api/queries', () => ({
  useUsers: () => ({
    data: mocks.users,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeactivateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteUser: () => ({ mutateAsync: mocks.deleteMutate, isPending: false }),
  useBulkDeleteUsers: () => ({ mutateAsync: mocks.bulkMutate, isPending: false }),
  useReactivateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResetUserPassword: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlockUser: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRevokeUserSessions: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLoginHistory: () => ({ data: undefined, isPending: true, isError: false, error: null, refetch: vi.fn() }),
  useMe: () => ({ data: me }),
  useLogout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}))

function renderUsers() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <Users />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('Users page: delete account needs the super admin password', () => {
  beforeEach(() => {
    mocks.deleteMutate.mockReset()
    mocks.users = [inactive, active, superAdmin, me]
  })

  it('offers Delete only for an inactive account that is neither you nor the super admin', () => {
    mocks.users = [inactive, active, superAdmin, inactiveAdminSelfLike]
    renderUsers()

    expect(screen.getByRole('button', { name: 'Delete unused.reception' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete active.reception' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete root.admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete me.admin' })).not.toBeInTheDocument()
    expect(screen.getByText('Super admin')).toBeInTheDocument()
  })

  it('cannot be confirmed until a password is typed, then sends it with the version', async () => {
    mocks.deleteMutate.mockResolvedValueOnce({ id: 10, username: 'unused.reception', deleted: true })
    renderUsers()

    fireEvent.click(screen.getByRole('button', { name: 'Delete unused.reception' }))
    const confirm = screen.getByRole('button', { name: 'Delete account' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Super admin password'), { target: { value: 'Sup3r-Secret!' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)

    await waitFor(() => expect(mocks.deleteMutate).toHaveBeenCalledTimes(1))
    expect(mocks.deleteMutate).toHaveBeenCalledWith({
      id: 10,
      payload: { version_id: 4, reason: null, super_admin_password: 'Sup3r-Secret!' },
    })
    expect(await screen.findByText('Account deleted: unused.reception')).toBeInTheDocument()
  })

  it('shows a wrong-password rejection inline and clears the password field', async () => {
    mocks.deleteMutate.mockRejectedValueOnce(
      new ApiError(403, 'super_admin_password_incorrect', 'The super admin password is not correct.'),
    )
    renderUsers()

    fireEvent.click(screen.getByRole('button', { name: 'Delete unused.reception' }))
    const field = screen.getByLabelText('Super admin password') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The super admin password is not correct.')
    expect(field.value).toBe('')
    expect(screen.queryByText('Account deleted: unused.reception')).not.toBeInTheDocument()
  })

  it('shows the account-has-history refusal from the server', async () => {
    mocks.deleteMutate.mockRejectedValueOnce(
      new ApiError(409, 'user_has_history', 'This account has recorded activity and cannot be deleted. Keep it deactivated instead.'),
    )
    renderUsers()

    fireEvent.click(screen.getByRole('button', { name: 'Delete unused.reception' }))
    fireEvent.change(screen.getByLabelText('Super admin password'), { target: { value: 'right' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Keep it deactivated instead.')
  })
})

describe('Users page: bulk delete with one super admin password', () => {
  const second = user({ id: 14, username: 'second.reception', version_id: 2 })

  beforeEach(() => {
    mocks.bulkMutate.mockReset()
    mocks.users = [inactive, second, active, superAdmin, me]
  })

  it('offers a checkbox only for accounts that can be deleted and counts the selection', () => {
    renderUsers()

    expect(screen.getByRole('checkbox', { name: 'Select unused.reception' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select second.reception' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select active.reception' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select root.admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select me.admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all deletable accounts shown' }))
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('2 accounts selected')

    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument()
  })

  it('sends every selected account with one password and shows which were skipped', async () => {
    mocks.bulkMutate.mockResolvedValueOnce({
      deleted_count: 1,
      skipped_count: 1,
      results: [
        { id: 10, username: 'unused.reception', deleted: true, code: null, message: null },
        {
          id: 14,
          username: 'second.reception',
          deleted: false,
          code: 'user_has_history',
          message: 'This account has recorded activity and cannot be deleted. Keep it deactivated instead.',
        },
      ],
    })
    renderUsers()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all deletable accounts shown' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))

    const confirm = screen.getByRole('button', { name: 'Delete 2 accounts' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Super admin password'), { target: { value: 'Sup3r-Secret!' } })
    fireEvent.click(confirm)

    await waitFor(() => expect(mocks.bulkMutate).toHaveBeenCalledTimes(1))
    expect(mocks.bulkMutate).toHaveBeenCalledWith({
      items: [
        { id: 10, version_id: 4 },
        { id: 14, version_id: 2 },
      ],
      reason: null,
      super_admin_password: 'Sup3r-Secret!',
    })
    expect(await screen.findByText(/Deleted 1 account\. Skipped 1\./)).toBeInTheDocument()
    expect(screen.getByText(/Keep it deactivated instead\./)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('Deleted 1 account, skipped 1.')).toBeInTheDocument()
  })

  it('keeps the dialog open on a wrong password, shows the error and clears the field', async () => {
    mocks.bulkMutate.mockRejectedValueOnce(
      new ApiError(403, 'super_admin_password_incorrect', 'The super admin password is not correct.'),
    )
    renderUsers()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select unused.reception' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected' }))
    const field = screen.getByLabelText('Super admin password') as HTMLInputElement
    fireEvent.change(field, { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1 account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The super admin password is not correct.')
    expect(field.value).toBe('')
    expect(screen.getByRole('button', { name: 'Delete 1 account' })).toBeInTheDocument()
  })
})
