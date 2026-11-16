import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { getWorkstations, type WorkstationOut } from '../../api/admin-data-ops'
import { IconServer, IconAlertTriangle } from '../../components/icons'

export function WorkstationMonitorPage() {
  const [workstations, setWorkstations] = useState<WorkstationOut[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)

  const fetchWorkstations = useCallback(async () => {
    try {
      setError(null)
      const data = await getWorkstations()
      setWorkstations(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch LAN workstations status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchWorkstations()
  }, [fetchWorkstations])

  // Periodic polling every 15 seconds if auto-refresh is active
  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(() => {
      fetchWorkstations()
    }, 15000)
    return () => clearInterval(timer)
  }, [autoRefresh, fetchWorkstations])

  const onlineCount = workstations.filter((w) => w.status === 'ONLINE').length
  const idleCount = workstations.filter((w) => w.status === 'IDLE').length
  const offlineCount = workstations.filter((w) => w.status === 'OFFLINE').length

  const getStatusBadge = (status: 'ONLINE' | 'IDLE' | 'OFFLINE') => {
    switch (status) {
      case 'ONLINE':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Online
          </span>
        )
      case 'IDLE':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Idle
          </span>
        )
      case 'OFFLINE':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
            Offline
          </span>
        )
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <AdminPageHeader
        title="LAN Workstations Monitor"
        description="Live telemetry and connectivity status of client terminals operating across Kalyan Hospital local area network."
        eyebrow="System & Maintenance"
        icon={<IconServer className="h-6 w-6 text-brand-700" />}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-700 focus:ring-brand-700"
              />
              Auto-refresh (15s)
            </label>
            <button
              type="button"
              onClick={fetchWorkstations}
              disabled={loading}
              className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <IconAlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Total Terminals</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{workstations.length}</div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-xs">
          <div className="text-xs font-medium text-emerald-800">Online Now</div>
          <div className="mt-1 text-2xl font-bold text-emerald-700">{onlineCount}</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 shadow-xs">
          <div className="text-xs font-medium text-amber-800">Idle Terminals</div>
          <div className="mt-1 text-2xl font-bold text-amber-700">{idleCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-xs">
          <div className="text-xs font-medium text-slate-500">Offline Terminals</div>
          <div className="mt-1 text-2xl font-bold text-slate-700">{offlineCount}</div>
        </div>
      </div>

      {/* Workstations Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Registered Hospital LAN Terminals ({workstations.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Heartbeat status updates emitted automatically by active doctor, reception, and billing desks.
          </p>
        </div>

        {loading && workstations.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-600">Loading workstation statuses...</div>
        ) : workstations.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-600">
            No workstations have reported a heartbeat yet. Heartbeats start automatically when workstations open the app.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-700">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Terminal / Hostname</th>
                  <th className="px-4 py-3">LAN IP Address</th>
                  <th className="px-4 py-3">App Version</th>
                  <th className="px-4 py-3">Active User</th>
                  <th className="px-4 py-3 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {workstations.map((ws) => (
                  <tr key={ws.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">{getStatusBadge(ws.status)}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{ws.terminal_name || ws.hostname}</div>
                      <div className="text-xs font-mono text-slate-500">{ws.hostname}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-slate-700">
                      {ws.ip_address || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">
                      {ws.app_version || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900">
                      {ws.last_username ? `@${ws.last_username}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-slate-600">
                      {new Date(ws.last_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
