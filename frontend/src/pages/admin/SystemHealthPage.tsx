import type { ReactNode } from 'react'
import { useMe, useSystemStatus } from '../../api/queries'
import type { StorageVolumeOut, SystemStatusOut } from '../../api/types'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'

// Admin module 12: System Health & Maintenance. Shows the raw facts reported by
// GET /system/status. No thresholds are applied: the page never labels a value "low" or "high".

const IST_ZONE = 'Asia/Kolkata'

const STORAGE_LABELS: Record<string, string> = {
  photos: 'Patient photos',
  backups: 'Backups',
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return 'Unavailable'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

function formatIst(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-IN', {
    timeZone: IST_ZONE,
    dateStyle: 'medium',
    timeStyle: 'medium',
  })} IST`
}

function formatUptime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const days = Math.floor(s / 86400)
  const hours = Math.floor((s % 86400) / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days} d`)
  if (days > 0 || hours > 0) parts.push(`${hours} h`)
  parts.push(`${minutes} min`)
  return parts.join(' ')
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-xs">
      <dt className="text-sm font-semibold text-slate-700">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold text-slate-900">{children}</dd>
    </div>
  )
}

function UsageBar({ volume }: { volume: StorageVolumeOut }) {
  const { total_bytes: total, free_bytes: free } = volume
  if (total === null || free === null || total <= 0) {
    return <span className="text-sm text-slate-700">Unavailable</span>
  }
  const usedPercent = Math.min(100, Math.max(0, ((total - free) / total) * 100))
  const rounded = Math.round(usedPercent * 10) / 10
  const name = STORAGE_LABELS[volume.label] ?? volume.label
  return (
    <div className="flex items-center gap-3">
      <div
        role="meter"
        aria-label={`${name} volume used`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={rounded}
        aria-valuetext={`${rounded}% used`}
        className="h-3 w-40 overflow-hidden rounded-full border border-slate-300 bg-slate-100"
      >
        <div className="h-full bg-[#8E1C3D]" style={{ width: `${usedPercent}%` }} />
      </div>
      <span className="text-sm font-semibold text-slate-800">{rounded}% used</span>
    </div>
  )
}

function RevisionNotice({ status }: { status: SystemStatusOut }) {
  if (status.revision_matches) {
    return (
      <InlineAlert tone="success">
        Database schema revision matches the code head revision ({status.code_head_revision ?? 'unknown'}).
      </InlineAlert>
    )
  }
  return (
    <InlineAlert tone="error">
      <p className="font-semibold">Database schema revision does not match the code head revision.</p>
      <p>
        Database: {status.db_revision ?? 'not recorded'} · Code head: {status.code_head_revision ?? 'unknown'}
      </p>
    </InlineAlert>
  )
}

export function SystemHealthPage() {
  const { data: me } = useMe()
  const { data, isPending, isError, error, refetch, isFetching, dataUpdatedAt } = useSystemStatus()

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">System Health & Maintenance</h1>
            <p className="mt-1 text-sm text-slate-700">
              Server, database and storage facts as reported by the server.
              {dataUpdatedAt > 0 && ` Fetched ${new Date(dataUpdatedAt).toLocaleTimeString('en-IN')}.`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex min-h-11 items-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            {isFetching ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {isPending && (
          <p role="status" className="text-sm text-slate-700">
            Loading system status...
          </p>
        )}
        {isError && (
          <InlineAlert tone="error">Failed to load system status: {error.message}</InlineAlert>
        )}

        {data && (
          <>
            <RevisionNotice status={data} />

            <section aria-labelledby="system-runtime-heading" className="space-y-3">
              <h2 id="system-runtime-heading" className="text-base font-bold text-slate-900">
                Application and database
              </h2>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <Fact label="Application version">{data.app_version}</Fact>
                <Fact label="Environment">{data.environment}</Fact>
                <Fact label="Database revision">
                  <span className="font-mono">{data.db_revision ?? 'Not recorded'}</span>
                </Fact>
                <Fact label="Code head revision">
                  <span className="font-mono">{data.code_head_revision ?? 'Unknown'}</span>
                </Fact>
                <Fact label="PostgreSQL version">{data.postgres_version}</Fact>
                <Fact label="Database size">{formatBytes(data.db_size_bytes)}</Fact>
                <Fact label="Database connections">{data.db_connections}</Fact>
                <Fact label="Frontend served by this server">{data.frontend_served ? 'Yes' : 'No'}</Fact>
                <Fact label="Server time (IST)">{formatIst(data.server_time_ist)}</Fact>
                <Fact label="Server process started">{formatIst(data.process_started_at)}</Fact>
                <Fact label="Uptime">{formatUptime(data.uptime_seconds)}</Fact>
              </dl>
            </section>

            <section
              aria-labelledby="system-storage-heading"
              className="rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
            >
              <h2 id="system-storage-heading" className="text-base font-bold text-slate-900">
                Storage
              </h2>
              {data.storage.length === 0 ? (
                <p className="mt-2 text-sm text-slate-700">No storage volumes reported.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Volume</th>
                        <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Path</th>
                        <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-700">Free</th>
                        <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-700">Total</th>
                        <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-700">Usage</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.storage.map((v) => (
                        <tr key={v.label}>
                          <td className="px-3 py-2 text-sm font-medium text-slate-900">
                            {STORAGE_LABELS[v.label] ?? v.label}
                          </td>
                          <td className="break-all px-3 py-2 font-mono text-sm text-slate-800">{v.path_label}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-slate-800">
                            {formatBytes(v.free_bytes)}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right text-sm text-slate-800">
                            {formatBytes(v.total_bytes)}
                          </td>
                          <td className="px-3 py-2">
                            <UsageBar volume={v} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  )
}
