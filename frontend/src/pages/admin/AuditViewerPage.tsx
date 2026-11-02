import { useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { useAuditLogs } from '../../api/queries'
import type { AuditLogOut } from '../../api/types'

export function AuditViewerPage() {
  const [username, setUsername] = useState('')
  const [action, setAction] = useState('')
  const [entityType, setEntityType] = useState('')
  const [outcome, setOutcome] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isPending, isError, error, refetch } = useAuditLogs({
    actor_username: username || undefined,
    action: action || undefined,
    entity_type: entityType || undefined,
    outcome: outcome || undefined,
    page,
    page_size: 20,
  })

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }

  return (
    <AppShell name="Admin" role="ADMIN">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-neutral-500 mb-1">
              <Link to="/admin" className="hover:underline">
                Admin
              </Link>
              <span>/</span>
              <span>Audit Log Viewer</span>
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">System Audit Log</h1>
            <p className="text-sm text-neutral-600 mt-1">
              Immutable, append-only operational and security event log (AUD-02)
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-sm font-medium rounded cursor-pointer"
          >
            Refresh Logs
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label htmlFor="filter-user" className="block text-xs font-semibold text-neutral-700 mb-1">
              User
            </label>
            <input
              id="filter-user"
              type="text"
              placeholder="Filter by username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
            />
          </div>
          <div>
            <label htmlFor="filter-action" className="block text-xs font-semibold text-neutral-700 mb-1">
              Action
            </label>
            <input
              id="filter-action"
              type="text"
              placeholder="e.g. USER_CREATED, PAYMENT_RECORDED"
              value={action}
              onChange={(e) => {
                setAction(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
            />
          </div>
          <div>
            <label htmlFor="filter-entity" className="block text-xs font-semibold text-neutral-700 mb-1">
              Entity Type
            </label>
            <input
              id="filter-entity"
              type="text"
              placeholder="e.g. payment, patient, backup"
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
            />
          </div>
          <div>
            <label htmlFor="filter-outcome" className="block text-xs font-semibold text-neutral-700 mb-1">
              Outcome
            </label>
            <select
              id="filter-outcome"
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value)
                setPage(1)
              }}
              className="w-full px-3 py-1.5 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
            >
              <option value="">All Outcomes</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILURE">FAILURE</option>
            </select>
          </div>
        </div>

        {/* Content Table */}
        <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
          {isPending && (
            <div className="p-8 text-center text-neutral-500">Loading audit records...</div>
          )}

          {isError && (
            <div className="p-8 text-center text-red-600">
              Failed to load audit logs: {error?.message}
            </div>
          )}

          {data && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-neutral-700">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Actor</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Entity</th>
                      <th className="px-4 py-3">Outcome</th>
                      <th className="px-4 py-3 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {data.items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-neutral-500">
                          No audit records found matching criteria.
                        </td>
                      </tr>
                    ) : (
                      data.items.map((log: AuditLogOut) => (
                        <tr key={log.id} className="hover:bg-neutral-50/80">
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-500 font-mono">
                            {new Date(log.occurred_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-medium text-neutral-900">{log.actor_username}</span>
                            <span className="ml-1.5 text-xs text-neutral-500 font-mono">
                              ({log.actor_role})
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-neutral-800">
                            {log.action}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-xs text-neutral-600">
                            {log.entity_type} {log.entity_id ? `(#${log.entity_id})` : ''}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={`inline-block px-2 py-0.5 text-xs font-semibold rounded ${
                                log.outcome === 'SUCCESS'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-red-50 text-red-700 border border-red-200'
                              }`}
                            >
                              {log.outcome}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => toggleExpand(log.id)}
                              className="text-xs text-red-800 hover:text-red-900 font-medium cursor-pointer"
                            >
                              {expandedId === log.id ? 'Hide' : 'Inspect'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Expanded details modal / accordion preview */}
              {expandedId !== null && (
                <div className="p-4 bg-neutral-900 text-neutral-100 border-t border-neutral-300 font-mono text-xs">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-neutral-300">
                      Audit Entry #{expandedId} Payload Diff & Context
                    </span>
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="text-neutral-400 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                  {(() => {
                    const selected = data.items.find((item) => item.id === expandedId)
                    if (!selected) return null
                    return (
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-4 text-xs text-neutral-400">
                          <div>IP: {selected.ip || 'Local/Internal'}</div>
                          <div>Request ID: {selected.request_id || 'CLI/System'}</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                          <div>
                            <span className="text-amber-400 font-semibold block mb-1">Before State:</span>
                            <pre className="p-2 bg-neutral-950 rounded overflow-x-auto text-neutral-300">
                              {selected.before_data
                                ? JSON.stringify(selected.before_data, null, 2)
                                : 'None'}
                            </pre>
                          </div>
                          <div>
                            <span className="text-emerald-400 font-semibold block mb-1">After State:</span>
                            <pre className="p-2 bg-neutral-950 rounded overflow-x-auto text-neutral-300">
                              {selected.after_data
                                ? JSON.stringify(selected.after_data, null, 2)
                                : 'None'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Pagination */}
              <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-xs text-neutral-600">
                <div>
                  Page {data.page} of {data.pages} (Total: {data.total} records)
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={data.page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1 bg-white border border-neutral-300 rounded disabled:opacity-50 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={data.page >= data.pages}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1 bg-white border border-neutral-300 rounded disabled:opacity-50 cursor-pointer"
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
