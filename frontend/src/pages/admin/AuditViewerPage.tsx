import { Fragment, useState } from 'react'
import { useAuditActions, useAuditLogs, useMe } from '../../api/queries'
import type { AuditLogOut } from '../../api/types'
import { AppShell } from '../../components/AppShell'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { TableSkeleton } from '../../components/AdminSkeleton'
import { InlineAlert } from '../../components/InlineAlert'

const PAGE_SIZE = 20
const IST_ZONE = 'Asia/Kolkata'
const OUTCOMES = ['SUCCESS', 'FAILURE', 'DENIED'] as const

const INPUT =
  'block min-h-11 w-full rounded border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]'
const LABEL = 'mb-1 block text-sm font-semibold text-slate-800'
const TH = 'px-4 py-3 text-left text-sm font-semibold text-slate-700'

function formatIst(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-IN', { timeZone: IST_ZONE, dateStyle: 'medium', timeStyle: 'medium' })} IST`
}

/** Inclusive IST day bounds for a YYYY-MM-DD date input (the audit API takes datetimes). */
function istDayStart(day: string): string {
  return `${day}T00:00:00+05:30`
}
function istDayEnd(day: string): string {
  return `${day}T23:59:59.999+05:30`
}

function outcomeBadge(outcome: string): string {
  if (outcome === 'SUCCESS') return 'bg-emerald-50 text-emerald-800 border-emerald-300'
  if (outcome === 'DENIED') return 'bg-amber-50 text-amber-900 border-amber-300'
  return 'bg-red-50 text-red-800 border-red-300'
}

// ---------------------------------------------------------------------------
// Before/after diff
// ---------------------------------------------------------------------------

interface FieldDiffRow {
  field: string
  before: unknown
  after: unknown
  inBefore: boolean
  inAfter: boolean
  changed: boolean
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined'
}

function diffAuditData(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): FieldDiffRow[] {
  const keys: string[] = []
  for (const k of Object.keys(before ?? {})) keys.push(k)
  for (const k of Object.keys(after ?? {})) if (!keys.includes(k)) keys.push(k)
  return keys.map((field) => {
    const inBefore = before !== null && Object.prototype.hasOwnProperty.call(before, field)
    const inAfter = after !== null && Object.prototype.hasOwnProperty.call(after, field)
    const b = inBefore ? before?.[field] : undefined
    const a = inAfter ? after?.[field] : undefined
    const changed = inBefore !== inAfter || stableStringify(b) !== stableStringify(a)
    return { field, before: b, after: a, inBefore, inAfter, changed }
  })
}

function DiffValue({ present, value }: { present: boolean; value: unknown }) {
  if (!present) return <span className="italic text-slate-600">not present</span>
  if (value === null) return <span className="font-mono text-slate-700">null</span>
  if (typeof value === 'string') return <span className="break-all font-mono">{value}</span>
  return <span className="break-all font-mono">{JSON.stringify(value)}</span>
}

function AuditDiff({ log }: { log: AuditLogOut }) {
  const { before_data: before, after_data: after } = log
  if (before === null && after === null) {
    return <p className="text-sm text-slate-700">No before/after data was recorded for this entry.</p>
  }
  const rows = diffAuditData(before, after)
  const changedCount = rows.filter((r) => r.changed).length
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-800">
        {changedCount} of {rows.length} field{rows.length === 1 ? '' : 's'} changed.
      </p>
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full" aria-label={`Field changes for audit entry ${log.id}`}>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Field</th>
                <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Before</th>
                <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">After</th>
                <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, index) => (
                <tr
                  key={r.field}
                  data-changed={r.changed ? 'true' : 'false'}
                  className={`transition-colors ${r.changed ? 'border-l-4 border-l-[#C39A35] bg-[#FFF8E7]' : ''}`}
                  style={{ transitionDelay: `${index * 50}ms` }}
                >
                  <th scope="row" className="px-3 py-2 text-left font-mono text-sm font-semibold text-slate-900">
                    {r.field}
                  </th>
                  <td className="px-3 py-2 text-sm text-slate-800">
                    <DiffValue present={r.inBefore} value={r.before} />
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-800">
                    <DiffValue present={r.inAfter} value={r.after} />
                  </td>
                  <td className="px-3 py-2 text-sm font-semibold text-[#5D0B26]">
                    {!r.changed ? <span className="font-normal text-slate-700">Unchanged</span> : !r.inBefore ? 'Added' : !r.inAfter ? 'Removed' : 'Changed'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="rounded border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-800">Raw JSON</summary>
        <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">Before</p>
            <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-sm text-slate-900">
              {before === null ? 'None' : JSON.stringify(before, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-sm font-semibold text-slate-800">After</p>
            <pre className="overflow-x-auto rounded bg-slate-100 p-2 text-sm text-slate-900">
              {after === null ? 'None' : JSON.stringify(after, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  )
}

function AuditEntryDetails({ log }: { log: AuditLogOut }) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-bold text-slate-900">Audit Entry #{log.id}</p>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <div>
          <dt className="font-semibold text-slate-700">Reason</dt>
          <dd className="text-slate-900">{log.reason ?? 'No reason recorded'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">User agent</dt>
          <dd className="break-all text-slate-900">{log.user_agent ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">IP address</dt>
          <dd className="font-mono text-slate-900">{log.ip ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-700">Request ID</dt>
          <dd className="break-all font-mono text-slate-900">{log.request_id ?? 'Not recorded'}</dd>
        </div>
      </dl>
      <AuditDiff log={log} />
    </div>
  )
}

export function AuditViewerPage() {
  const { data: me } = useMe()
  const [username, setUsername] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [entityId, setEntityId] = useState('')
  const [outcome, setOutcome] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const rangeInverted = dateFrom !== '' && dateTo !== '' && dateFrom > dateTo

  const actions = useAuditActions()
  const { data, isPending, isError, error, refetch, isFetching } = useAuditLogs({
    actor_username: username.trim() || undefined,
    action: action || undefined,
    entity_type: entityType.trim() || undefined,
    entity_id: entityId.trim() || undefined,
    outcome: outcome || undefined,
    date_from: dateFrom ? istDayStart(dateFrom) : undefined,
    date_to: dateTo ? istDayEnd(dateTo) : undefined,
    page,
    page_size: PAGE_SIZE,
  })

  const update = (setter: (v: string) => void) => (v: string) => {
    setter(v)
    setPage(1)
    setExpandedId(null)
  }

  const clearFilters = () => {
    setUsername('')
    setAction('')
    setEntityType('')
    setEntityId('')
    setOutcome('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
    setExpandedId(null)
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <AdminPageHeader
          title="Audit Trail"
          description="Immutable, append-only operational and security event log (AUD-02). Dates are IST business days."
          actions={
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-60"
          >
            {isFetching ? 'Refreshing...' : 'Refresh Logs'}
          </button>
          }
        />

        <form
          role="search"
          aria-label="Audit log filters"
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-4"
        >
          <div>
            <label htmlFor="filter-date-from" className={LABEL}>From date</label>
            <input
              id="filter-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => update(setDateFrom)(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="filter-date-to" className={LABEL}>To date</label>
            <input
              id="filter-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => update(setDateTo)(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="filter-user" className={LABEL}>User</label>
            <input
              id="filter-user"
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => update(setUsername)(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="filter-action" className={LABEL}>Action</label>
            <select
              id="filter-action"
              value={action}
              onChange={(e) => update(setAction)(e.target.value)}
              className={INPUT}
            >
              <option value="">All actions</option>
              {(actions.data ?? []).map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            {actions.isPending && <p className="mt-1 text-sm text-slate-700">Loading actions...</p>}
            {actions.isError && (
              <p className="mt-1 text-sm text-red-800">Action list unavailable: {actions.error.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="filter-entity" className={LABEL}>Entity type</label>
            <input
              id="filter-entity"
              type="text"
              placeholder="e.g. payment, patient, backup"
              value={entityType}
              onChange={(e) => update(setEntityType)(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="filter-entity-id" className={LABEL}>Entity ID</label>
            <input
              id="filter-entity-id"
              type="text"
              value={entityId}
              onChange={(e) => update(setEntityId)(e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="filter-outcome" className={LABEL}>Outcome</label>
            <select
              id="filter-outcome"
              value={outcome}
              onChange={(e) => update(setOutcome)(e.target.value)}
              className={INPUT}
            >
              <option value="">All outcomes</option>
              {OUTCOMES.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-800 hover:border-[#8E1C3D] hover:text-[#5D0B26]"
            >
              Clear filters
            </button>
          </div>
        </form>

        {rangeInverted && (
          <InlineAlert tone="error">The From date is after the To date, so no entries can match.</InlineAlert>
        )}

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs">
          {isPending && (
            <TableSkeleton label="Loading audit records..." rows={5} columns={6} className="border-0" />
          )}

          {isError && (
            <div className="p-4">
              <InlineAlert tone="error">Failed to load audit logs: {error.message}</InlineAlert>
            </div>
          )}

          {data && (
            <>
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full text-left text-sm text-slate-800">
                  <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50">
                    <tr>
                      <th scope="col" className={TH}>Timestamp</th>
                      <th scope="col" className={TH}>Actor</th>
                      <th scope="col" className={TH}>Action</th>
                      <th scope="col" className={TH}>Entity</th>
                      <th scope="col" className={TH}>Outcome</th>
                      <th scope="col" className={`${TH} text-right`}>Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-700">
                          No audit records found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((log, index) => {
                        const expanded = expandedId === log.id
                        const detailsId = `audit-entry-${log.id}`
                        const rowDelay = index * 50
                        return (
                          <Fragment key={log.id}>
                            <tr className={`transition-colors ${expanded ? 'bg-[#FFF8E7]' : 'hover:bg-slate-50'}`} style={{ transitionDelay: `${rowDelay}ms` }}>
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-800">
                                {formatIst(log.occurred_at)}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <span className="font-medium text-slate-900">{log.actor_username}</span>
                                <span className="ml-1.5 font-mono text-sm text-slate-700">({log.actor_role})</span>
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 font-mono text-sm text-slate-900">
                                {log.action}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-800">
                                {log.entity_type} {log.entity_id ? `(#${log.entity_id})` : ''}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3">
                                <span
                                  className={`inline-block rounded border px-2 py-0.5 text-sm font-semibold ${outcomeBadge(log.outcome)}`}
                                >
                                  {log.outcome}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  onClick={() => setExpandedId(expanded ? null : log.id)}
                                  aria-expanded={expanded}
                                  aria-controls={expanded ? detailsId : undefined}
                                  aria-label={`${expanded ? 'Hide' : 'Inspect'} audit entry ${log.id}`}
                                  className="inline-flex min-h-11 items-center rounded px-3 text-sm font-semibold text-[#8E1C3D] hover:bg-[#FFF8E7] hover:text-[#5D0B26]"
                                >
                                  {expanded ? 'Hide' : 'Inspect'}
                                </button>
                              </td>
                            </tr>
                            {expanded && (
                              <tr id={detailsId}>
                                <td colSpan={6} className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                                  <AuditEntryDetails log={log} />
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
                <p>
                  Page {data.page} of {Math.max(1, data.pages)} (Total: {data.total} records)
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => {
                      setPage((p) => Math.max(1, p - 1))
                      setExpandedId(null)
                    }}
                    className="inline-flex min-h-11 items-center rounded border border-slate-300 bg-white px-3 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={data.page >= data.pages}
                    onClick={() => {
                      setPage((p) => p + 1)
                      setExpandedId(null)
                    }}
                    className="inline-flex min-h-11 items-center rounded border border-slate-300 bg-white px-3 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  )
}
