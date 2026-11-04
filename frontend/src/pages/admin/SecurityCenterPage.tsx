import { useMemo, useState } from 'react'
import { useActiveSessions, useAuditLogs, useMe, useRevokeSession, useSecurityPolicy } from '../../api/queries'
import { ApiError } from '../../api/client'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'
import { Modal } from '../../components/Modal'
import { SecurityPolicyEditor } from './SecurityPolicyEditor'
import { ADMIN_REASON_MAX_LENGTH, type ActiveSessionOut, type Role } from '../../api/types'

// ---------------------------------------------------------------------------
// Display helpers (local to this page; every value shown comes from the API)
// ---------------------------------------------------------------------------

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
})

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : DATE_TIME.format(d)
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

/** Auth and security audit actions shown in "Recent security events", with display labels. */
const SECURITY_EVENT_ACTIONS: { action: string; label: string }[] = [
  { action: 'AUTH_LOGIN_FAILED', label: 'Sign-in failed' },
  { action: 'AUTH_ACCOUNT_LOCKED', label: 'Account locked' },
  { action: 'AUTH_LOGIN_THROTTLED', label: 'Sign-in throttled' },
  { action: 'USER_PASSWORD_RESET', label: 'Password reset by administrator' },
  { action: 'AUTH_PASSWORD_CHANGED', label: 'Password changed' },
  { action: 'AUTH_PASSWORD_CHANGE_FAILED', label: 'Password change failed' },
  { action: 'USER_UNLOCKED', label: 'Account unlocked' },
  { action: 'SESSION_REVOKED', label: 'Session revoked' },
  { action: 'USER_SESSIONS_REVOKED', label: 'Signed out everywhere' },
]
const SECURITY_ACTION_LABEL = new Map(SECURITY_EVENT_ACTIONS.map((a) => [a.action, a.label]))
/** Largest page the audit API returns; used to scan for security events when no single action is chosen. */
const SCAN_PAGE_SIZE = 200
const SINGLE_ACTION_PAGE_SIZE = 50

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

function entityLabel(entityType: string): string {
  if (entityType === 'USER') return 'User'
  if (entityType === 'SESSION') return 'Session'
  return entityType.charAt(0) + entityType.slice(1).toLowerCase()
}

function sessionExpiry(s: ActiveSessionOut): { at: string; kind: string } {
  const idle = new Date(s.idle_expires_at).getTime()
  const absolute = new Date(s.absolute_expires_at).getTime()
  return idle <= absolute
    ? { at: s.idle_expires_at, kind: 'if idle' }
    : { at: s.absolute_expires_at, kind: 'maximum length' }
}

const BTN_SECONDARY =
  'px-4 py-2 border border-neutral-300 text-neutral-800 rounded font-medium hover:bg-neutral-50 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer'
const BTN_DANGER =
  'px-4 py-2 bg-red-800 text-white rounded font-medium hover:bg-red-900 min-h-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer'
const SELECT =
  'px-3 py-2 border border-neutral-300 rounded min-h-11 text-sm text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-[#8E1C3D]'
const SECTION = 'rounded-lg border border-neutral-200 bg-white p-5 shadow-xs'

// ---------------------------------------------------------------------------
// (a) Current security policy
// ---------------------------------------------------------------------------

function SecurityPolicySection() {
  const { data, isPending, isError, error, refetch } = useSecurityPolicy()
  const [editing, setEditing] = useState(false)
  const rows: { label: string; value: string }[] = data
    ? [
        { label: 'Sign out after inactivity', value: `${data.session_idle_minutes} minutes` },
        { label: 'Maximum session length', value: `${data.session_absolute_hours} hours` },
        { label: 'Failed sign-ins before lockout', value: String(data.lockout_threshold) },
        { label: 'Lockout duration', value: `${data.lockout_minutes} minutes` },
        { label: 'Sign-in throttle: failed attempts allowed', value: String(data.throttle_max_failures) },
        { label: 'Sign-in throttle: time window', value: `${data.throttle_window_minutes} minutes` },
        {
          label: 'Password length',
          value: `${data.password_min_length} to ${data.password_max_length} characters`,
        },
      ]
    : []
  return (
    <section aria-labelledby="policy-heading" className={SECTION}>
      <h2 id="policy-heading" className="text-lg font-bold text-neutral-900">
        Current security policy
      </h2>
      <p className="mt-1 text-sm text-neutral-700">
        {data?.source === 'administrator'
          ? 'Tightened by an administrator from the values set at server installation.'
          : 'Set at server installation.'}{' '}
        Administrators can make these stricter. Relaxing them needs a server change and client approval.
      </p>
      {isPending && (
        <p role="status" className="mt-4 text-sm text-neutral-700">
          Loading the security policy...
        </p>
      )}
      {isError && (
        <InlineAlert tone="error" className="mt-4">
          Could not load the security policy: {error.message}{' '}
          <button type="button" onClick={() => refetch()} className="min-h-11 cursor-pointer font-medium underline">
            Try again
          </button>
        </InlineAlert>
      )}
      {data && (
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label} className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
              <dt className="text-sm text-neutral-700">{r.label}</dt>
              <dd className="text-base font-semibold text-neutral-900">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {data && (
        <button type="button" onClick={() => setEditing(true)} className={`${BTN_SECONDARY} mt-4`}>
          Tighten policy
        </button>
      )}
      {data && editing && <SecurityPolicyEditor policy={data} onClose={() => setEditing(false)} />}
    </section>
  )
}

// ---------------------------------------------------------------------------
// (b) Active sessions
// ---------------------------------------------------------------------------

function ActiveSessionsSection() {
  const { data, isPending, isError, error, refetch, isFetching } = useActiveSessions()
  const revokeMutation = useRevokeSession()
  const [target, setTarget] = useState<ActiveSessionOut | null>(null)
  const [reason, setReason] = useState('')
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const openRevoke = (s: ActiveSessionOut) => {
    setTarget(s)
    setReason('')
    setRevokeError(null)
  }
  const closeRevoke = () => {
    setTarget(null)
    setReason('')
    setRevokeError(null)
  }

  const handleRevoke = async () => {
    if (!target) return
    setRevokeError(null)
    try {
      await revokeMutation.mutateAsync({
        id: target.id,
        payload: { reason: reason.trim() === '' ? null : reason.trim() },
      })
      setNotice(`Session ended for ${target.username}. They must sign in again on that computer.`)
      closeRevoke()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'session_not_found') {
        setRevokeError('This session has already ended. The list has been refreshed.')
        refetch()
      } else if (err instanceof ApiError && err.code === 'cannot_revoke_current_session') {
        setRevokeError('You cannot end the session you are using now. Use Sign out instead.')
      } else {
        setRevokeError(err instanceof ApiError ? err.message : 'Could not end the session. Check the connection and try again.')
      }
    }
  }

  return (
    <section aria-labelledby="sessions-heading" className={`${SECTION} flex min-h-0 flex-col`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sessions-heading" className="text-lg font-bold text-neutral-900">
            Active sessions
          </h2>
          <p className="mt-1 text-sm text-neutral-700">
            {data
              ? `${data.length} active ${data.length === 1 ? 'session' : 'sessions'}, most recently active first.`
              : 'Signed-in computers, most recently active first.'}
          </p>
        </div>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className={BTN_SECONDARY}>
          {isFetching ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {notice && (
        <InlineAlert tone="success" onDismiss={() => setNotice(null)} className="mt-4">
          {notice}
        </InlineAlert>
      )}
      {isPending && (
        <p role="status" className="mt-4 text-sm text-neutral-700">
          Loading active sessions...
        </p>
      )}
      {isError && (
        <InlineAlert tone="error" className="mt-4">
          Could not load active sessions: {error.message}
        </InlineAlert>
      )}
      {data && data.length === 0 && <p className="mt-4 text-sm text-neutral-700">No active sessions.</p>}
      {data && data.length > 0 && (
        <div className="mt-4 max-h-[60vh] overflow-auto rounded border border-neutral-200">
          <table className="w-full text-left text-sm text-neutral-800">
            <caption className="sr-only">Active sessions</caption>
            <thead className="sticky top-0 bg-neutral-50 text-neutral-700 font-semibold">
              <tr className="border-b border-neutral-200">
                <th scope="col" className="px-3 py-2">User</th>
                <th scope="col" className="px-3 py-2">Role</th>
                <th scope="col" className="px-3 py-2">IP address</th>
                <th scope="col" className="px-3 py-2">Device</th>
                <th scope="col" className="px-3 py-2">Signed in</th>
                <th scope="col" className="px-3 py-2">Last seen</th>
                <th scope="col" className="px-3 py-2">Expires</th>
                <th scope="col" className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {data.map((s) => {
                const exp = sessionExpiry(s)
                return (
                  <tr key={s.id} className={`align-top ${s.is_current ? 'bg-[#FFF8E7]' : 'hover:bg-neutral-50'}`}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-neutral-900">{s.full_name}</div>
                      <div className="font-mono text-neutral-700">{s.username}</div>
                    </td>
                    <td className="px-3 py-2">{ROLE_LABEL[s.role]}</td>
                    <td className="px-3 py-2 font-mono">{s.ip_address ?? '—'}</td>
                    <td className="px-3 py-2" title={s.user_agent ?? undefined}>
                      {shortUserAgent(s.user_agent)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.created_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(s.last_seen_at)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{formatDateTime(exp.at)}</div>
                      <div className="text-neutral-600">{exp.kind}</div>
                    </td>
                    <td className="px-3 py-2">
                      {s.is_current ? (
                        <span className="inline-flex items-center rounded border border-[#C39A35] px-2 py-0.5 text-sm font-medium text-[#5D0B26]">
                          This session
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openRevoke(s)}
                          aria-label={`Revoke session for ${s.username}`}
                          className="px-3 py-1 text-sm font-medium rounded border border-red-300 bg-red-50 text-red-800 hover:bg-red-100 min-h-11 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <Modal
          open
          variant="destructive"
          dismiss="none"
          title={`End session: ${target.username}`}
          onClose={closeRevoke}
          busy={revokeMutation.isPending}
          className="max-w-lg"
        >
          <div className="space-y-4">
            <p className="text-sm text-neutral-700">
              {target.full_name} is signed out on {shortUserAgent(target.user_agent)}
              {target.ip_address ? ` (${target.ip_address})` : ''} and must sign in again there. Their other sessions are
              not affected.
            </p>
            <div>
              <label htmlFor="revoke-reason" className="block text-sm font-medium text-neutral-800 mb-1">
                Reason (optional)
              </label>
              <textarea
                id="revoke-reason"
                rows={3}
                maxLength={ADMIN_REASON_MAX_LENGTH}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="revoke-reason-help"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-11 text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
              <p id="revoke-reason-help" className="mt-1 text-sm text-neutral-600">
                Stored in the audit log. {reason.length}/{ADMIN_REASON_MAX_LENGTH} characters.
              </p>
            </div>
            {revokeError && <InlineAlert tone="error">{revokeError}</InlineAlert>}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                data-autofocus
                onClick={closeRevoke}
                disabled={revokeMutation.isPending}
                className={BTN_SECONDARY}
              >
                Cancel
              </button>
              <button type="button" onClick={handleRevoke} disabled={revokeMutation.isPending} className={BTN_DANGER}>
                {revokeMutation.isPending ? 'Ending session...' : 'End session'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// (c) Recent security events
// ---------------------------------------------------------------------------

function SecurityEventsSection() {
  const [action, setAction] = useState('')
  const [outcome, setOutcome] = useState('')
  const { data, isPending, isError, error, refetch } = useAuditLogs({
    action: action || undefined,
    outcome: outcome || undefined,
    page: 1,
    page_size: action ? SINGLE_ACTION_PAGE_SIZE : SCAN_PAGE_SIZE,
  })

  const events = useMemo(
    () => (data ? data.items.filter((e) => SECURITY_ACTION_LABEL.has(e.action)) : []),
    [data],
  )

  return (
    <section aria-labelledby="events-heading" className={`${SECTION} flex min-h-0 flex-col`}>
      <h2 id="events-heading" className="text-lg font-bold text-neutral-900">
        Recent security events
      </h2>
      <p className="mt-1 text-sm text-neutral-700">
        Failed and throttled sign-ins, lockouts, password resets and changes, unlocks and ended sessions, newest first.
      </p>

      <div className="mt-4 flex flex-wrap gap-4">
        <div>
          <label htmlFor="event-action" className="block text-sm font-medium text-neutral-800 mb-1">
            Event
          </label>
          <select id="event-action" value={action} onChange={(e) => setAction(e.target.value)} className={SELECT}>
            <option value="">All security events</option>
            {SECURITY_EVENT_ACTIONS.map((a) => (
              <option key={a.action} value={a.action}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="event-outcome" className="block text-sm font-medium text-neutral-800 mb-1">
            Outcome
          </label>
          <select id="event-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={SELECT}>
            <option value="">All outcomes</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILURE">Failure</option>
            <option value="DENIED">Denied</option>
          </select>
        </div>
      </div>

      {isPending && (
        <p role="status" className="mt-4 text-sm text-neutral-700">
          Loading security events...
        </p>
      )}
      {isError && (
        <InlineAlert tone="error" className="mt-4">
          Could not load security events: {error.message}{' '}
          <button type="button" onClick={() => refetch()} className="min-h-11 cursor-pointer font-medium underline">
            Try again
          </button>
        </InlineAlert>
      )}
      {data && (
        <p className="mt-4 text-sm text-neutral-700">
          {action
            ? `Showing ${events.length} of ${data.total} matching events.`
            : `Showing ${events.length} security ${events.length === 1 ? 'event' : 'events'} found in the latest ${data.items.length} audit entries. Choose an event type to search the whole audit log.`}
        </p>
      )}
      {data && events.length === 0 && <p className="mt-2 text-sm text-neutral-700">No security events to show.</p>}
      {data && events.length > 0 && (
        <div className="mt-3 max-h-[60vh] overflow-auto rounded border border-neutral-200">
          <table className="w-full text-left text-sm text-neutral-800">
            <caption className="sr-only">Recent security events</caption>
            <thead className="sticky top-0 bg-neutral-50 text-neutral-700 font-semibold">
              <tr className="border-b border-neutral-200">
                <th scope="col" className="px-3 py-2">When</th>
                <th scope="col" className="px-3 py-2">Event</th>
                <th scope="col" className="px-3 py-2">Outcome</th>
                <th scope="col" className="px-3 py-2">Actor</th>
                <th scope="col" className="px-3 py-2">Target</th>
                <th scope="col" className="px-3 py-2">IP address</th>
                <th scope="col" className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {events.map((e) => (
                <tr key={e.id} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(e.occurred_at)}</td>
                  <td className="px-3 py-2">{SECURITY_ACTION_LABEL.get(e.action) ?? e.action}</td>
                  <td className="px-3 py-2">
                    <OutcomeBadge outcome={e.outcome} />
                  </td>
                  <td className="px-3 py-2 font-mono">{e.actor_username}</td>
                  <td className="px-3 py-2">{e.entity_id ? `${entityLabel(e.entity_type)} #${e.entity_id}` : '—'}</td>
                  <td className="px-3 py-2 font-mono">{e.ip ?? '—'}</td>
                  <td className="px-3 py-2 text-neutral-700">{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SecurityCenterPage() {
  const { data: me } = useMe()
  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="flex min-h-0 flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900">Security & Access</h1>
          <p className="mt-1 text-sm text-neutral-700">
            The effective sign-in policy, who is signed in right now, and recent security events.
          </p>
        </div>
        <SecurityPolicySection />
        <ActiveSessionsSection />
        <SecurityEventsSection />
      </div>
    </AppShell>
  )
}
