import { useState, type FormEvent } from 'react'
import {
  useCreateUser,
  useDeactivateUser,
  useReactivateUser,
  useResetUserPassword,
  useUnlockUser,
  useUpdateUser,
  useUsers,
} from '../../api/queries'
import { ApiError, apiFetch } from '../../api/client'
import { AppShell } from '../../components/AppShell'
import { ConflictBanner } from '../../components/ConflictBanner'
import type { Role, UserCreatedOut, UserOut } from '../../api/types'

export function Users() {
  const { data: users, isPending, isError, error, refetch: refetchUsers } = useUsers()

  // Modals state
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserOut | null>(null)
  const [confirmAction, setConfirmAction] = useState<{
    type: 'deactivate' | 'reactivate' | 'reset-password'
    user: UserOut
  } | null>(null)
  const [tempPasswordNotice, setTempPasswordNotice] = useState<{
    username: string
    password: string
  } | null>(null)

  // Create form state
  const [newUsername, setNewUsername] = useState('')
  const [newFullName, setNewFullName] = useState('')
  const [newRole, setNewRole] = useState<Role>('RECEPTION')
  const [newDoctorName, setNewDoctorName] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  // Edit form state
  const [editFullName, setEditFullName] = useState('')
  const [editRole, setEditRole] = useState<Role>('RECEPTION')
  const [editVersionId, setEditVersionId] = useState(1)
  const [editError, setEditError] = useState<string | null>(null)
  const [isConflict, setIsConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)

  // Action error state
  const [actionError, setActionError] = useState<string | null>(null)

  // Mutations
  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser()
  const deactivateMutation = useDeactivateUser()
  const reactivateMutation = useReactivateUser()
  const resetPasswordMutation = useResetUserPassword()
  const unlockMutation = useUnlockUser()

  const openCreateDialog = () => {
    setNewUsername('')
    setNewFullName('')
    setNewRole('RECEPTION')
    setNewDoctorName('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const openEditDialog = (u: UserOut) => {
    setEditUser(u)
    setEditFullName(u.full_name)
    setEditRole(u.role)
    setEditVersionId(u.version_id)
    setEditError(null)
    setIsConflict(false)
  }

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setCreateError(null)

    try {
      const created: UserCreatedOut = await createMutation.mutateAsync({
        username: newUsername,
        full_name: newFullName,
        role: newRole,
        doctor_name_en: newRole === 'DOCTOR' ? newDoctorName : null,
      })
      setCreateOpen(false)
      setTempPasswordNotice({
        username: created.username,
        password: created.temporary_password,
      })
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setCreateError(err.message)
      } else {
        setCreateError('Failed to create user. Please check the network connection.')
      }
    }
  }

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setEditError(null)
    setIsConflict(false)

    try {
      await updateMutation.mutateAsync({
        id: editUser.id,
        payload: {
          full_name: editFullName,
          role: editRole,
          version_id: editVersionId,
        },
      })
      setEditUser(null)
      refetchUsers()
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.code === 'version_conflict') {
          setIsConflict(true)
        } else {
          setEditError(err.message)
        }
      } else {
        setEditError('Failed to update user.')
      }
    }
  }

  const handleReloadLatest = async () => {
    if (!editUser) return
    setIsReloading(true)
    try {
      const latest = await apiFetch<UserOut>(`/users/${editUser.id}`)
      setEditUser(latest)
      setEditFullName(latest.full_name)
      setEditRole(latest.role)
      setEditVersionId(latest.version_id)
      setIsConflict(false)
      setEditError(null)
    } catch {
      setEditError('Failed to reload latest record.')
    } finally {
      setIsReloading(false)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    setActionError(null)
    const { type, user } = confirmAction

    try {
      if (type === 'deactivate') {
        await deactivateMutation.mutateAsync({
          id: user.id,
          payload: { version_id: user.version_id },
        })
      } else if (type === 'reactivate') {
        await reactivateMutation.mutateAsync({
          id: user.id,
          payload: { version_id: user.version_id },
        })
      } else if (type === 'reset-password') {
        const res = await resetPasswordMutation.mutateAsync({
          id: user.id,
          payload: { version_id: user.version_id },
        })
        setTempPasswordNotice({
          username: user.username,
          password: res.temporary_password,
        })
      }
      setConfirmAction(null)
      refetchUsers()
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setActionError(err.message)
      } else {
        setActionError('Action failed.')
      }
    }
  }

  const handleUnlock = async (u: UserOut) => {
    try {
      await unlockMutation.mutateAsync({
        id: u.id,
        payload: { version_id: u.version_id },
      })
      refetchUsers()
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        alert(err.message)
      }
    }
  }

  return (
    <AppShell name="System Administrator" role="ADMIN">
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900">User Management</h2>
            <p className="text-sm text-neutral-600 mt-1">
              Configure system user accounts, roles, access status, and password resets.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateDialog}
            className="px-4 py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800 min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer self-start sm:self-auto"
          >
            Create User
          </button>
        </div>

        {isPending && (
          <div className="p-8 text-center bg-white rounded border border-neutral-200">
            <p role="status" className="text-neutral-600">Loading user accounts...</p>
          </div>
        )}

        {isError && (
          <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded text-red-900">
            Failed to load users: {error.message}
          </div>
        )}

        {users && (
          <div className="bg-white rounded-lg border border-neutral-200 overflow-x-auto shadow-xs">
            <table className="w-full text-left text-sm text-neutral-800">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-700 uppercase font-semibold text-xs tracking-wider">
                <tr>
                  <th scope="col" className="px-4 py-3">Username</th>
                  <th scope="col" className="px-4 py-3">Full Name</th>
                  <th scope="col" className="px-4 py-3">Role</th>
                  <th scope="col" className="px-4 py-3">Doctor ID</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Lockout</th>
                  <th scope="col" className="px-4 py-3">Ver</th>
                  <th scope="col" className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-neutral-900 font-mono">
                      {u.username}
                    </td>
                    <td className="px-4 py-3">{u.full_name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{u.role}</td>
                    <td className="px-4 py-3 text-neutral-500 font-mono">
                      {u.doctor_id ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          u.is_active
                            ? 'bg-green-100 text-green-800'
                            : 'bg-neutral-100 text-neutral-800'
                        }`}
                      >
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.is_locked ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                          Locked
                        </span>
                      ) : (
                        <span className="text-neutral-400 text-xs">Clear</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                      v{u.version_id}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditDialog(u)}
                          className="px-2 py-1 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                        >
                          Edit
                        </button>
                        {u.is_active ? (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'deactivate', user: u })}
                            className="px-2 py-1 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'reactivate', user: u })}
                            className="px-2 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-green-800 cursor-pointer"
                          >
                            Reactivate
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setConfirmAction({ type: 'reset-password', user: u })}
                          className="px-2 py-1 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                        >
                          Reset Password
                        </button>
                        {u.is_locked && (
                          <button
                            type="button"
                            onClick={() => handleUnlock(u)}
                            className="px-2 py-1 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-amber-800 cursor-pointer"
                          >
                            Unlock
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Create User Dialog */}
        {createOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-dialog-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-lg w-full p-6 shadow-xl space-y-4">
              <h3 id="create-dialog-title" className="text-xl font-bold text-neutral-900">
                Create User Account
              </h3>

              {createError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
                  {createError}
                </div>
              )}

              <form onSubmit={handleCreateSubmit} className="space-y-4">
                <div>
                  <label htmlFor="create-username" className="block text-sm font-medium text-neutral-800 mb-1">
                    Username
                  </label>
                  <input
                    id="create-username"
                    type="text"
                    required
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="create-fullname" className="block text-sm font-medium text-neutral-800 mb-1">
                    Full Name
                  </label>
                  <input
                    id="create-fullname"
                    type="text"
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="create-role" className="block text-sm font-medium text-neutral-800 mb-1">
                    Role
                  </label>
                  <select
                    id="create-role"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as Role)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  >
                    <option value="RECEPTION">Reception</option>
                    <option value="DOCTOR">Doctor</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>

                {newRole === 'DOCTOR' && (
                  <div>
                    <label htmlFor="create-doctor-name" className="block text-sm font-medium text-neutral-800 mb-1">
                      Doctor English Name
                    </label>
                    <input
                      id="create-doctor-name"
                      type="text"
                      required
                      value={newDoctorName}
                      onChange={(e) => setNewDoctorName(e.target.value)}
                      placeholder="e.g. Dr. Ashok Kumar"
                      className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                    />
                  </div>
                )}

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded font-medium hover:bg-neutral-50 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createMutation.isPending}
                    className="px-4 py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
                  >
                    {createMutation.isPending ? 'Creating...' : 'Create Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit User Dialog */}
        {editUser && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-dialog-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-lg w-full p-6 shadow-xl space-y-4">
              <h3 id="edit-dialog-title" className="text-xl font-bold text-neutral-900">
                Edit User: {editUser.username}
              </h3>

              {isConflict && (
                <ConflictBanner
                  onReload={handleReloadLatest}
                  isReloading={isReloading}
                />
              )}

              {editError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
                  {editError}
                </div>
              )}

              <form onSubmit={handleEditSubmit} className="space-y-4">
                <div>
                  <label htmlFor="edit-fullname" className="block text-sm font-medium text-neutral-800 mb-1">
                    Full Name
                  </label>
                  <input
                    id="edit-fullname"
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="edit-role" className="block text-sm font-medium text-neutral-800 mb-1">
                    Role
                  </label>
                  <select
                    id="edit-role"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as Role)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  >
                    <option value="RECEPTION">Reception</option>
                    <option value="DOCTOR">Doctor</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditUser(null)}
                    className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded font-medium hover:bg-neutral-50 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={updateMutation.isPending || isReloading}
                    className="px-4 py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
                  >
                    {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Confirmation Dialog for Destructive Actions */}
        {confirmAction && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-md w-full p-6 shadow-xl space-y-4">
              <h3 id="confirm-dialog-title" className="text-lg font-bold text-neutral-900 capitalize">
                Confirm {confirmAction.type.replace('-', ' ')}
              </h3>
              <p className="text-sm text-neutral-600">
                Are you sure you want to {confirmAction.type.replace('-', ' ')} user account{' '}
                <strong className="font-mono">{confirmAction.user.username}</strong>?
              </p>

              {actionError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
                  {actionError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmAction(null)
                    setActionError(null)
                  }}
                  className="px-4 py-2 border border-neutral-300 text-neutral-700 rounded font-medium hover:bg-neutral-50 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAction}
                  disabled={
                    deactivateMutation.isPending ||
                    reactivateMutation.isPending ||
                    resetPasswordMutation.isPending
                  }
                  className="px-4 py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800 min-h-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Temporary Password Notice Dialog */}
        {tempPasswordNotice && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="temp-pwd-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-md w-full p-6 shadow-xl space-y-4">
              <h3 id="temp-pwd-title" className="text-lg font-bold text-neutral-900">
                Temporary Password Generated
              </h3>
              <p className="text-sm text-neutral-600">
                Account: <strong className="font-mono">{tempPasswordNotice.username}</strong>
              </p>

              <div className="p-3 bg-neutral-100 rounded border border-neutral-300">
                <label htmlFor="temp-pwd-input" className="block text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-1">
                  Temporary Password
                </label>
                <input
                  id="temp-pwd-input"
                  type="text"
                  readOnly
                  value={tempPasswordNotice.password}
                  onFocus={(e) => e.target.select()}
                  className="w-full font-mono text-base font-bold bg-white px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 select-all"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 font-medium">
                Please write down this temporary password now. It will not be shown again.
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setTempPasswordNotice(null)}
                  className="px-4 py-2 bg-neutral-900 text-white rounded font-medium hover:bg-neutral-800 min-h-[44px] focus-visible:outline-2 focus-visible:outline-neutral-800 cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
