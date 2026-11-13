import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  useCreateUser,
  useDeactivateUser,
  useDeleteUser,
  useLoginHistory,
  useMe,
  useReactivateUser,
  useResetUserPassword,
  useRevokeUserSessions,
  useUnlockUser,
  useUpdateUser,
  useUsers,
} from '../../api/queries'
import { ApiError, apiFetch } from '../../api/client'
import { AppShell } from '../../components/AppShell'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { TableSkeleton } from '../../components/AdminSkeleton'
import { Modal } from '../../components/Modal'
import { ConflictBanner } from '../../components/ConflictBanner'
import { InlineAlert } from '../../components/InlineAlert'
import {
  ADMIN_REASON_MAX_LENGTH,
  type LoginHistoryEntry,
  type Role,
  type UserCreatedOut,
  type UserOut,
  type UserUpdate,
} from '../../api/types'

// ---------------------------------------------------------------------------
// Display helpers (local to this page; every value shown comes from the API)
// ---------------------------------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d)
}

/** "12 min left", "1 h 5 min left", or null once the lock time has passed. */
function formatRemaining(untilIso: string, nowMs: number): string | null {
  const ms = new Date(untilIso).getTime() - nowMs
  if (Number.isNaN(ms) || ms <= 0) return null
  const totalMin = Math.ceil(ms / 60000)
  if (totalMin < 60) return `${totalMin} min left`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return m === 0 ? `${h} h left` : `${h} h ${m} min left`
}

/** Re-renders every `intervalMs` so remaining lock times stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

function shortUserAgent(ua: string | null): string {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (browser && os) return `${browser} on ${os}`
  if (browser || os) return (browser ?? os) as string
  return ua.length > 40 ? `${ua.slice(0, 40)}…` : ua
}

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  RECEPTION: 'Reception',
  DOCTOR: 'Doctor',
}

const HISTORY_ACTION_LABEL: Record<string, string> = {
  AUTH_LOGIN_SUCCEEDED: 'Signed in',
  AUTH_LOGIN_FAILED: 'Sign-in failed',
  AUTH_ACCOUNT_LOCKED: 'Account locked',
  AUTH_LOGIN_THROTTLED: 'Sign-in throttled',
  AUTH_LOGOUT: 'Signed out',
  AUTH_PASSWORD_CHANGED: 'Password changed',
  AUTH_PASSWORD_CHANGE_FAILED: 'Password change failed',
  USER_UNLOCKED: 'Unlocked by administrator',
  USER_PASSWORD_RESET: 'Password reset by administrator',
  USER_SESSIONS_REVOKED: 'Signed out everywhere',
  SESSION_REVOKED: 'Session revoked',
}

function OutcomeBadge({ outcome }: { outcome: string }) {
  const style =
    outcome === 'SUCCESS'
      ? 'bg-green-100 text-green-900 border-green-300'
      : outcome === 'DENIED'
        ? 'bg-amber-100 text-amber-900 border-amber-300'
        : outcome === 'FAILURE'
          ? 'bg-red-100 text-red-900 border-red-300'
          : 'bg-neutral-100 text-neutral-800 border-neutral-300'
  const label =
    outcome === 'SUCCESS' ? 'Success' : outcome === 'DENIED' ? 'Denied' : outcome === 'FAILURE' ? 'Failure' : outcome
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-sm font-medium ${style}`}>{label}</span>
  )
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

// ---------------------------------------------------------------------------
// Account action dialog configuration
// ---------------------------------------------------------------------------

type ActionType = 'deactivate' | 'reactivate' | 'reset-password' | 'unlock' | 'revoke-sessions' | 'delete'
type StatusFilter = 'all' | 'active' | 'inactive' | 'locked'

const ACTION_COPY: Record<
  ActionType,
  { title: string; confirm: string; busy: string; destructive: boolean; body: string; failed: string }
> = {
  deactivate: {
    title: 'Deactivate account',
    confirm: 'Deactivate account',
    busy: 'Deactivating...',
    destructive: true,
    failed: 'Could not deactivate this account. Try again.',
    body: 'The user will not be able to sign in, and every active session of this account is signed out. You can reactivate the account later.',
  },
  reactivate: {
    title: 'Reactivate account',
    confirm: 'Reactivate account',
    busy: 'Reactivating...',
    destructive: false,
    failed: 'Could not reactivate this account. Try again.',
    body: 'The user will be able to sign in again with their existing password.',
  },
  'reset-password': {
    title: 'Reset password',
    confirm: 'Reset password',
    busy: 'Resetting...',
    destructive: true,
    failed: 'Could not reset the password. Try again.',
    body: 'A new temporary password is issued and shown once. The user must change it at the next sign-in, and every active session of this account is signed out.',
  },
  unlock: {
    title: 'Unlock account',
    confirm: 'Unlock account',
    busy: 'Unlocking...',
    destructive: false,
    failed: 'Could not unlock this account. Try again.',
    body: 'Clears the failed sign-in count and the lockout so the user can sign in again straight away.',
  },
  delete: {
    title: 'Delete account',
    confirm: 'Delete account',
    busy: 'Deleting...',
    destructive: true,
    failed: 'Could not delete this account. Try again.',
    body: 'Permanently removes this account. It only works for an account that has never been used: if it has signed in or has any recorded activity, it must stay deactivated instead. This cannot be undone. Enter the super admin password to confirm.',
  },
  'revoke-sessions': {
    title: 'Sign out everywhere',
    confirm: 'Sign out everywhere',
    busy: 'Signing out...',
    destructive: true,
    failed: 'Could not sign this account out. Try again.',
    body: 'Ends every active session of this account on every computer. The user must sign in again. If this is your own account, the session you are using now stays signed in.',
  },
}

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
  { id: 'locked', label: 'Locked' },
]

function matchesFilter(u: UserOut, f: StatusFilter): boolean {
  if (f === 'active') return u.is_active
  if (f === 'inactive') return !u.is_active
  if (f === 'locked') return u.is_locked
  return true
}

const BTN_PRIMARY =
  'px-4 py-2 bg-[#8E1C3D] text-white rounded font-medium hover:bg-[#5D0B26] min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer'
const BTN_DANGER =
  'px-4 py-2 bg-red-800 text-white rounded font-medium hover:bg-red-900 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer'
const BTN_SECONDARY =
  'px-4 py-2 border border-neutral-300 text-neutral-800 rounded font-medium hover:bg-neutral-50 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer'
const BTN_ROW =
  'px-3 py-1 text-sm font-medium rounded border min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer whitespace-nowrap'
const INPUT =
  'w-full px-3 py-2 border border-neutral-300 rounded min-h-11 text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'

// ---------------------------------------------------------------------------
// Login history dialog
// ---------------------------------------------------------------------------

function historyDetails(entry: LoginHistoryEntry, username: string): string[] {
  const parts: string[] = []
  if (entry.actor_username && entry.actor_username !== username) parts.push(`By ${entry.actor_username}`)
  if (entry.reason) parts.push(`Reason: ${entry.reason}`)
  for (const [k, v] of Object.entries(entry.details ?? {})) {
    if (k === 'reason' || v === null || v === '') continue
    const label = k.replace(/_/g, ' ')
    const value = k.endsWith('_until') || k.endsWith('_at') ? formatDateTime(String(v)) : String(v)
    parts.push(`${label.charAt(0).toUpperCase()}${label.slice(1)}: ${value}`)
  }
  return parts
}

function LoginHistoryDialog({ user, onClose }: { user: UserOut; onClose: () => void }) {
  const { data, isPending, isError, error, refetch } = useLoginHistory(user.id)
  return (
    <Modal
      open
      title={`Sign-in history: ${user.username}`}
      description="Latest 50 sign-in, lockout, unlock, password and session events for this account."
      onClose={onClose}
      dismiss="any"
      className="max-w-5xl"
    >
      {isPending && <TableSkeleton label="Loading sign-in history..." rows={4} columns={4} />}
      {isError && (
        <InlineAlert tone="error">
          Could not load the sign-in history: {error.message}{' '}
          <button type="button" onClick={() => refetch()} className="underline font-medium cursor-pointer min-h-11">
            Try again
          </button>
        </InlineAlert>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-neutral-700">No sign-in or security events are recorded for this account yet.</p>
      )}
      {data && data.length > 0 && (
        <div className="max-h-[60vh] overflow-auto rounded border border-neutral-200">
          <table className="w-full text-left text-sm text-neutral-800">
            <caption className="sr-only">Sign-in history for {user.username}</caption>
            <thead className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 text-neutral-700 font-semibold">
              <tr>
                <th scope="col" className="px-3 py-2">When</th>
                <th scope="col" className="px-3 py-2">Event</th>
                <th scope="col" className="px-3 py-2">Outcome</th>
                <th scope="col" className="px-3 py-2">IP address</th>
                <th scope="col" className="px-3 py-2">Device</th>
                <th scope="col" className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.map((entry, index) => {
                const details = historyDetails(entry, user.username)
                const rowDelay = index * 50
                return (
                  <tr key={entry.id} className="align-top transition-colors" style={{ transitionDelay: `${rowDelay}ms` }}>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(entry.occurred_at)}</td>
                    <td className="px-3 py-2">{HISTORY_ACTION_LABEL[entry.action] ?? entry.action}</td>
                    <td className="px-3 py-2">
                      <OutcomeBadge outcome={entry.outcome} />
                    </td>
                    <td className="px-3 py-2 font-mono">{entry.ip_address ?? '—'}</td>
                    <td className="px-3 py-2" title={entry.user_agent ?? undefined}>
                      {shortUserAgent(entry.user_agent)}
                    </td>
                    <td className="px-3 py-2 text-neutral-700">
                      {details.length === 0 ? '—' : details.map((d) => <div key={d}>{d}</div>)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end pt-4">
        <button type="button" data-autofocus onClick={onClose} className={BTN_SECONDARY}>
          Close
        </button>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function Users() {
  const { data: me } = useMe()
  const { data: users, isPending, isError, error, refetch: refetchUsers } = useUsers()
  const now = useNow(30000)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [successNotice, setSuccessNotice] = useState<string | null>(null)

  // Modals state
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserOut | null>(null)
  const [historyUser, setHistoryUser] = useState<UserOut | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: ActionType; user: UserOut } | null>(null)
  const [actionReason, setActionReason] = useState('')
  const [superAdminPassword, setSuperAdminPassword] = useState('')
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
  const revokeSessionsMutation = useRevokeUserSessions()
  const deleteMutation = useDeleteUser()

  const actionBusy =
    deleteMutation.isPending ||
    deactivateMutation.isPending ||
    reactivateMutation.isPending ||
    resetPasswordMutation.isPending ||
    unlockMutation.isPending ||
    revokeSessionsMutation.isPending

  const counts = useMemo(() => {
    const list = users ?? []
    return {
      all: list.length,
      active: list.filter((u) => matchesFilter(u, 'active')).length,
      inactive: list.filter((u) => matchesFilter(u, 'inactive')).length,
      locked: list.filter((u) => matchesFilter(u, 'locked')).length,
    } satisfies Record<StatusFilter, number>
  }, [users])

  const visibleUsers = useMemo(
    () => (users ?? []).filter((u) => matchesFilter(u, statusFilter)),
    [users, statusFilter],
  )

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

  const openAction = (type: ActionType, user: UserOut) => {
    setActionError(null)
    setActionReason('')
    setSuperAdminPassword('')
    setConfirmAction({ type, user })
  }

  const closeAction = () => {
    setConfirmAction(null)
    setActionError(null)
    setActionReason('')
    setSuperAdminPassword('')
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
      setCreateError(errorMessage(err, 'Failed to create user. Please check the network connection.'))
    }
  }

  const handleEditSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!editUser) return
    setEditError(null)
    setIsConflict(false)

    const payload: UserUpdate = { full_name: editFullName, version_id: editVersionId }
    if (editRole !== editUser.role) payload.role = editRole

    try {
      await updateMutation.mutateAsync({ id: editUser.id, payload })
      setSuccessNotice(`Account updated: ${editUser.username}`)
      setEditUser(null)
      refetchUsers()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'version_conflict') {
        setIsConflict(true)
      } else {
        setEditError(errorMessage(err, 'Failed to update user.'))
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
    } catch (err: unknown) {
      setEditError(errorMessage(err, 'Failed to reload latest record.'))
    } finally {
      setIsReloading(false)
    }
  }

  const handleConfirmAction = async () => {
    if (!confirmAction) return
    setActionError(null)
    const { type, user } = confirmAction
    const reason = actionReason.trim() === '' ? null : actionReason.trim()
    const payload = { version_id: user.version_id, reason }

    try {
      if (type === 'deactivate') {
        await deactivateMutation.mutateAsync({ id: user.id, payload })
        setSuccessNotice(`Account deactivated: ${user.username}`)
      } else if (type === 'reactivate') {
        await reactivateMutation.mutateAsync({ id: user.id, payload })
        setSuccessNotice(`Account reactivated: ${user.username}`)
      } else if (type === 'reset-password') {
        const res = await resetPasswordMutation.mutateAsync({ id: user.id, payload })
        setSuccessNotice(null)
        setTempPasswordNotice({ username: user.username, password: res.temporary_password })
      } else if (type === 'unlock') {
        await unlockMutation.mutateAsync({ id: user.id, payload })
        setSuccessNotice(`Account unlocked: ${user.username}`)
      } else if (type === 'delete') {
        await deleteMutation.mutateAsync({
          id: user.id,
          payload: { ...payload, super_admin_password: superAdminPassword },
        })
        setSuccessNotice(`Account deleted: ${user.username}`)
      } else {
        const res = await revokeSessionsMutation.mutateAsync({ id: user.id, payload: { reason } })
        const count = res.revoked_count
        const sessions = count === 1 ? '1 session' : `${count} sessions`
        setSuccessNotice(
          `Signed out ${sessions} for ${user.username}.${res.kept_current_session ? ' Your current session was kept.' : ''}`,
        )
      }
      setConfirmAction(null)
      setActionReason('')
      setSuperAdminPassword('')
      refetchUsers()
    } catch (err: unknown) {
      setActionError(errorMessage(err, ACTION_COPY[type].failed))
      // A rejected password is never kept in the field for another try.
      if (type === 'delete') setSuperAdminPassword('')
    }
  }

  const isSelf = (u: UserOut) => me?.id === u.id

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <AdminPageHeader
          title="User Accounts"
          description="Staff sign-in accounts, roles, account status, lockouts and password resets."
          actions={
            <button type="button" onClick={openCreateDialog} className={BTN_PRIMARY}>
              Create User
            </button>
          }
        />

        {successNotice && (
          <InlineAlert tone="success" onDismiss={() => setSuccessNotice(null)}>
            {successNotice}
          </InlineAlert>
        )}

        {isPending && <TableSkeleton label="Loading user accounts..." rows={5} columns={6} />}

        {isError && <InlineAlert tone="error">Failed to load users: {error.message}</InlineAlert>}

        {users && (
          <>
            <div role="group" aria-label="Filter accounts by status" className="flex flex-wrap gap-2">
              {FILTERS.map((f) => {
                const active = statusFilter === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatusFilter(f.id)}
                    className={`px-4 py-2 rounded-full border text-sm font-medium min-h-11 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] ${
                      active
                        ? 'border-[#8E1C3D] bg-[#FFF8E7] text-[#5D0B26]'
                        : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    {f.label} ({counts[f.id]})
                  </button>
                )
              })}
            </div>

            <div className="bg-white rounded-lg border border-neutral-200 max-h-[70vh] overflow-auto shadow-xs">
              <table className="w-full text-left text-sm text-neutral-800">
                <caption className="sr-only">User accounts</caption>
                <thead className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 text-neutral-700 font-semibold">
                  <tr>
                    <th scope="col" className="px-4 py-3">Account</th>
                    <th scope="col" className="px-4 py-3">Role</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3">Last sign-in</th>
                    <th scope="col" className="px-4 py-3">Created</th>
                    <th scope="col" className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {visibleUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-neutral-700">
                        No accounts match this filter.
                      </td>
                    </tr>
                  )}
                  {visibleUsers.map((u, index) => {
                    const remaining = u.locked_until ? formatRemaining(u.locked_until, now) : null
                    const rowDelay = index * 50
                    const self = isSelf(u)
                    return (
                      <tr key={u.id} className="align-top hover:bg-neutral-50 transition-colors" style={{ transitionDelay: `${rowDelay}ms` }}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-neutral-900">
                            {u.full_name}
                            {self && <span className="ml-2 text-sm font-normal text-neutral-600">(you)</span>}
                          </div>
                          <div className="font-mono text-neutral-700">{u.username}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            {ROLE_LABEL[u.role]}
                            {u.is_super_admin && (
                              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded border text-sm font-medium bg-[#FFF8E7] text-[#5D0B26] border-[#8E1C3D]">
                                Super admin
                              </span>
                            )}
                          </div>
                          {u.doctor_id !== null && (
                            <div className="text-neutral-600">Doctor profile #{u.doctor_id}</div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded border text-sm font-medium ${
                                u.is_active
                                  ? 'bg-green-100 text-green-900 border-green-300'
                                  : 'bg-neutral-100 text-neutral-800 border-neutral-300'
                              }`}
                            >
                              {u.is_active ? 'Active' : 'Inactive'}
                            </span>
                            {u.is_locked && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded border text-sm font-medium bg-red-100 text-red-900 border-red-300">
                                Locked
                              </span>
                            )}
                            {u.must_change_password && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded border text-sm font-medium bg-amber-100 text-amber-900 border-amber-300">
                                Password change pending
                              </span>
                            )}
                          </div>
                          {u.is_locked && u.locked_until && (
                            <p className="mt-1 text-neutral-700">
                              Locked until {formatDateTime(u.locked_until)}
                              {remaining ? ` (${remaining})` : ' (lock time has passed; refresh to update)'}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(u.last_login_at)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(u.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditDialog(u)}
                              aria-label={`Edit ${u.username}`}
                              className={`${BTN_ROW} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100`}
                            >
                              Edit
                            </button>
                            {u.is_locked && (
                              <button
                                type="button"
                                onClick={() => openAction('unlock', u)}
                                aria-label={`Unlock ${u.username}`}
                                className={`${BTN_ROW} border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100`}
                              >
                                Unlock
                              </button>
                            )}
                            {!self && (
                              <button
                                type="button"
                                onClick={() => openAction('reset-password', u)}
                                aria-label={`Reset password for ${u.username}`}
                                className={`${BTN_ROW} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100`}
                              >
                                Reset password
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openAction('revoke-sessions', u)}
                              aria-label={`Sign out everywhere for ${u.username}`}
                              className={`${BTN_ROW} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100`}
                            >
                              Sign out everywhere
                            </button>
                            <button
                              type="button"
                              onClick={() => setHistoryUser(u)}
                              aria-label={`Sign-in history for ${u.username}`}
                              className={`${BTN_ROW} border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-100`}
                            >
                              Sign-in history
                            </button>
                            {!self &&
                              (u.is_active ? (
                                <button
                                  type="button"
                                  onClick={() => openAction('deactivate', u)}
                                  aria-label={`Deactivate ${u.username}`}
                                  className={`${BTN_ROW} border-red-300 bg-red-50 text-red-800 hover:bg-red-100`}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openAction('reactivate', u)}
                                  aria-label={`Reactivate ${u.username}`}
                                  className={`${BTN_ROW} border-green-300 bg-green-50 text-green-900 hover:bg-green-100`}
                                >
                                  Reactivate
                                </button>
                              ))}
                            {!self && !u.is_active && !u.is_super_admin && (
                              <button
                                type="button"
                                onClick={() => openAction('delete', u)}
                                aria-label={`Delete ${u.username}`}
                                className={`${BTN_ROW} border-red-800 bg-white text-red-800 hover:bg-red-50`}
                              >
                                Delete
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Create User Dialog */}
        {createOpen && (
          <Modal open title="Create User Account" onClose={() => setCreateOpen(false)} busy={createMutation.isPending} className="max-w-lg">
            {createError && <InlineAlert tone="error" className="mb-4">{createError}</InlineAlert>}

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label htmlFor="create-username" className="block text-sm font-medium text-neutral-800 mb-1">
                  Username
                </label>
                <input
                  id="create-username"
                  data-autofocus
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className={INPUT}
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
                  className={INPUT}
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
                  className={INPUT}
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
                    className={INPUT}
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setCreateOpen(false)} className={BTN_SECONDARY}>
                  Cancel
                </button>
                <button type="submit" disabled={createMutation.isPending} className={BTN_PRIMARY}>
                  {createMutation.isPending ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Edit User Dialog */}
        {editUser && (
          <Modal open title={`Edit User: ${editUser.username}`} onClose={() => setEditUser(null)} busy={updateMutation.isPending} className="max-w-lg">
            {isConflict && <ConflictBanner onReload={handleReloadLatest} isReloading={isReloading} />}

            {editError && <InlineAlert tone="error" className="mb-4">{editError}</InlineAlert>}

            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label htmlFor="edit-fullname" className="block text-sm font-medium text-neutral-800 mb-1">
                  Full Name
                </label>
                <input
                  id="edit-fullname"
                  data-autofocus
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className={INPUT}
                />
              </div>

              <div>
                <label htmlFor="edit-role" className="block text-sm font-medium text-neutral-800 mb-1">
                  Role
                </label>
                {editUser.role === 'DOCTOR' ? (
                  <select id="edit-role" value="DOCTOR" disabled aria-describedby="edit-role-help" className={`${INPUT} bg-neutral-100`}>
                    <option value="DOCTOR">Doctor</option>
                  </select>
                ) : (
                  <select
                    id="edit-role"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as Role)}
                    disabled={isSelf(editUser)}
                    aria-describedby="edit-role-help"
                    className={`${INPUT} disabled:bg-neutral-100`}
                  >
                    <option value="RECEPTION">Reception</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                )}
                <p id="edit-role-help" className="mt-1 text-sm text-neutral-600">
                  {editUser.role === 'DOCTOR'
                    ? 'A doctor account is linked to its doctor profile, so its role cannot be changed.'
                    : isSelf(editUser)
                      ? 'You cannot change the role of your own account.'
                      : 'An existing account cannot be changed to Doctor. To give someone a doctor sign-in, create a new account with the Doctor role.'}
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" onClick={() => setEditUser(null)} className={BTN_SECONDARY}>
                  Cancel
                </button>
                <button type="submit" disabled={updateMutation.isPending || isReloading} className={BTN_PRIMARY}>
                  {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </Modal>
        )}

        {/* Confirmation dialog for account actions */}
        {confirmAction && (
          <Modal
            open
            title={`${ACTION_COPY[confirmAction.type].title}: ${confirmAction.user.username}`}
            variant={ACTION_COPY[confirmAction.type].destructive ? 'destructive' : 'warning'}
            onClose={closeAction}
            dismiss="none"
            busy={actionBusy}
            className="max-w-lg"
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-700">{ACTION_COPY[confirmAction.type].body}</p>

              {confirmAction.type === 'reset-password' && (
                <InlineAlert tone="info">
                  {confirmAction.user.is_locked
                    ? 'This account is locked. Resetting the password does not clear the lockout: use Unlock as well so the user can sign in.'
                    : 'Resetting the password does not clear a lockout. If the account becomes locked, use Unlock.'}
                </InlineAlert>
              )}

              {confirmAction.type === 'delete' && (
                <div>
                  <label htmlFor="super-admin-password" className="block text-sm font-medium text-neutral-800 mb-1">
                    Super admin password
                  </label>
                  <input
                    id="super-admin-password"
                    type="password"
                    autoComplete="off"
                    required
                    value={superAdminPassword}
                    onChange={(e) => setSuperAdminPassword(e.target.value)}
                    aria-describedby="super-admin-password-help"
                    className={INPUT}
                  />
                  <p id="super-admin-password-help" className="mt-1 text-sm text-neutral-600">
                    The password of the super admin account, not your own. It is checked once and never stored.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="action-reason" className="block text-sm font-medium text-neutral-800 mb-1">
                  Reason (optional)
                </label>
                <textarea
                  id="action-reason"
                  rows={3}
                  maxLength={ADMIN_REASON_MAX_LENGTH}
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  aria-describedby="action-reason-help"
                  className={INPUT}
                />
                <p id="action-reason-help" className="mt-1 text-sm text-neutral-600">
                  Stored in the audit log. {actionReason.length}/{ADMIN_REASON_MAX_LENGTH} characters.
                </p>
              </div>

              {actionError && <InlineAlert tone="error">{actionError}</InlineAlert>}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button type="button" data-autofocus onClick={closeAction} disabled={actionBusy} className={BTN_SECONDARY}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAction}
                  disabled={actionBusy || (confirmAction.type === 'delete' && superAdminPassword === '')}
                  className={ACTION_COPY[confirmAction.type].destructive ? BTN_DANGER : BTN_PRIMARY}
                >
                  {actionBusy ? ACTION_COPY[confirmAction.type].busy : ACTION_COPY[confirmAction.type].confirm}
                </button>
              </div>
            </div>
          </Modal>
        )}

        {historyUser && <LoginHistoryDialog user={historyUser} onClose={() => setHistoryUser(null)} />}

        {/* Temporary Password Notice Dialog */}
        {tempPasswordNotice && (
          <Modal open title="Temporary Password Generated" onClose={() => setTempPasswordNotice(null)} dismiss="none" className="max-w-md">
            <div className="space-y-4">
              <p className="text-sm text-neutral-700">
                Account: <strong className="font-mono">{tempPasswordNotice.username}</strong>
              </p>

              <div className="p-3 bg-neutral-100 rounded border border-neutral-300">
                <label htmlFor="temp-pwd-input" className="block text-sm font-semibold text-neutral-700 mb-1">
                  Temporary Password
                </label>
                <input
                  id="temp-pwd-input"
                  type="text"
                  readOnly
                  value={tempPasswordNotice.password}
                  onFocus={(e) => e.target.select()}
                  className="w-full font-mono text-base font-bold bg-white px-3 py-2 border border-neutral-300 rounded min-h-11 text-neutral-900 select-all"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900 font-medium">
                Please write down this temporary password now. It will not be shown again.
              </div>

              <div className="flex justify-end pt-2">
                <button type="button" onClick={() => setTempPasswordNotice(null)} className={BTN_PRIMARY}>
                  Done
                </button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  )
}
