import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { useOverview } from '../api/queries'
import type {
  AdminOverview,
  DoctorOverview,
  OverviewAlertOut,
  RecentAdminActionOut,
  Role,
} from '../api/types'
import {
  ADMIN_MODULE_GROUPS,
  adminModulesInGroup,
  type AdminModule,
} from '../admin/modules'

interface AreaHomeProps {
  area: 'admin' | 'reception' | 'doctor'
}

export function AreaHome({ area }: AreaHomeProps) {
  const { data, isPending, isError, error } = useOverview(area)

  if (isPending) {
    return (
      <div className="p-6">
        <p role="status" className="text-neutral-600">Loading overview...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="p-6">
        <p role="alert" className="text-red-700">
          Failed to load {area} overview: {error.message}
        </p>
      </div>
    )
  }

  if (!data) return null

  const role: Role =
    area === 'admin'
      ? 'ADMIN'
      : area === 'reception'
        ? 'RECEPTION'
        : 'DOCTOR'

  return (
    <AppShell name={data.name} role={role}>
      <div className="space-y-6">
        <div className="bg-white p-6 rounded-lg border border-neutral-200 shadow-xs">
          <h2 className="text-xl font-bold capitalize text-neutral-900">
            {area} Dashboard
          </h2>
          <p className="text-sm text-neutral-600 mt-1">
            Welcome, {data.name} ({role})
          </p>

          {area === 'doctor' && (
            <div className="mt-4 p-4 bg-neutral-50 rounded border border-neutral-200">
              <p className="text-sm text-neutral-700">
                Doctor ID: {(data as DoctorOverview).doctor_id}
              </p>
              <p className="text-sm text-neutral-700">
                Doctor Name: {(data as DoctorOverview).doctor_name_en}
              </p>
            </div>
          )}

          {area === 'reception' && (
            <div className="mt-6 space-y-6">
              <div className="text-sm text-neutral-600">
                Reception area active. Ready for patient check-ins and appointments.
              </div>
              <div>
                <h3 className="text-sm font-semibold text-neutral-700 uppercase tracking-wider mb-3">
                  Reception Operations
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Link
                    to="/reception/appointments"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Appointments & Queue</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Book daily tokens, track arrived patients & manage waiting hall
                    </p>
                  </Link>
                  <Link
                    to="/reception/patients/new"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">+ New Registration</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Register patient demographics, capture photo & generate URN
                    </p>
                  </Link>
                  <Link
                    to="/reception/patients"
                    className="p-4 bg-white rounded border border-neutral-300 hover:border-red-800 hover:shadow-xs transition-all block"
                  >
                    <p className="font-bold text-neutral-900">Patient Directory</p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Search patients by URN, mobile, or name & manage files
                    </p>
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>

        {area === 'admin' && <AdminDashboard overview={data as Partial<AdminOverview>} />}
      </div>
    </AppShell>
  )
}

// ---------------------------------------------------------------------------
// Admin dashboard (module 01). Every figure comes from GET /admin/overview; a field the
// server did not send is shown as "Not reported", never as a made-up zero.
// ---------------------------------------------------------------------------

const NOT_REPORTED = 'Not reported'
const IST_ZONE = 'Asia/Kolkata'

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  BOOKED: 'Booked',
  ARRIVED: 'Arrived',
  IN_CONSULTATION: 'In consultation',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No show',
}

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrators',
  RECEPTION: 'Reception',
  DOCTOR: 'Doctors',
}

/** Integer-paise formatting: no floating-point division of money (BIL-02). */
function formatPaise(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100).toLocaleString('en-IN')
  return `${sign}₹${rupees}.${String(abs % 100).padStart(2, '0')}`
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return 'Unavailable'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 ? value : value.toFixed(2)} ${units[unit]}`
}

function formatIstDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-IN', { timeZone: IST_ZONE, dateStyle: 'medium', timeStyle: 'short' })} IST`
}

/** Elapsed time since `iso`, measured against this workstation's clock. */
function formatAge(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Unknown age'
  const minutes = Math.floor(Math.max(0, now - then) / 60000)
  if (minutes < 1) return 'less than a minute ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function humanise(code: string): string {
  return APPOINTMENT_STATUS_LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase()
}

const CARD = 'rounded-lg border border-slate-200 bg-white p-5 shadow-xs'
const SECTION_HEADING = 'text-base font-bold text-slate-900'
const TH = 'px-3 py-2 text-left text-sm font-semibold text-slate-700'
const TD = 'px-3 py-2 text-sm text-slate-800'

function MetricTile({
  label,
  value,
  children,
}: {
  label: string
  value: string
  children?: ReactNode
}) {
  return (
    <div className={CARD}>
      <p className="text-sm font-semibold text-slate-700">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#5D0B26]">{value}</p>
      {children && <div className="mt-2 text-sm text-slate-700">{children}</div>}
    </div>
  )
}

function countValue(n: number | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-IN') : NOT_REPORTED
}

function AlertsPanel({ alerts }: { alerts: OverviewAlertOut[] | undefined }) {
  return (
    <section aria-labelledby="admin-alerts-heading" className={CARD}>
      <h3 id="admin-alerts-heading" className={SECTION_HEADING}>
        Alerts
      </h3>
      {alerts === undefined ? (
        <p className="mt-2 text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : alerts.length === 0 ? (
        <p className="mt-2 text-sm text-slate-700">No alerts reported by the server.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {alerts.map((alert) => {
            const isError = alert.severity === 'error'
            return (
              <li
                key={alert.code}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                  isError
                    ? 'border-red-300 bg-red-50 text-red-900'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <span className="shrink-0 rounded px-2 py-0.5 font-bold uppercase">
                  {isError ? 'Error' : alert.severity === 'warning' ? 'Warning' : alert.severity}
                </span>
                <span>{alert.message}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function TodayMetrics({ overview }: { overview: Partial<AdminOverview> }) {
  const appointments = overview.appointments_today
  const appointmentsTotal =
    appointments === undefined
      ? undefined
      : Object.values(appointments).reduce((sum, n) => sum + n, 0)
  const collections = overview.collections_today

  return (
    <section aria-labelledby="admin-today-heading" className="space-y-3">
      <h3 id="admin-today-heading" className={SECTION_HEADING}>
        Today{overview.business_date ? ` (${overview.business_date}, IST business day)` : ''}
      </h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Registrations today" value={countValue(overview.registrations_today)} />

        <MetricTile label="Appointments today (all statuses)" value={countValue(appointmentsTotal)}>
          {appointments && (
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {Object.entries(appointments).map(([status, n]) => (
                <div key={status} className="contents">
                  <dt>{humanise(status)}</dt>
                  <dd className="text-right font-semibold">{n}</dd>
                </div>
              ))}
            </dl>
          )}
        </MetricTile>

        <MetricTile
          label="Gross collected today"
          value={collections ? formatPaise(collections.gross_paise) : NOT_REPORTED}
        >
          {collections && (
            <>
              <p>
                {collections.payments_count} payment{collections.payments_count === 1 ? '' : 's'} recorded
                today, including any later reversed.
              </p>
              {Object.keys(collections.by_method).length > 0 && (
                <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {Object.entries(collections.by_method).map(([method, paise]) => (
                    <div key={method} className="contents">
                      <dt>{method}</dt>
                      <dd className="text-right font-semibold">{formatPaise(paise)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </MetricTile>

        <MetricTile
          label="Reversed today"
          value={collections ? formatPaise(collections.reversed_paise) : NOT_REPORTED}
        >
          {collections && (
            <p>
              {collections.reversals_count} reversal{collections.reversals_count === 1 ? '' : 's'} made
              today, whichever day the payment was collected. Not subtracted from the gross figure.
            </p>
          )}
        </MetricTile>

        <MetricTile
          label="Pending dues (all patients)"
          value={
            typeof overview.outstanding_dues_paise === 'number'
              ? formatPaise(overview.outstanding_dues_paise)
              : NOT_REPORTED
          }
        >
          <Link to="/reception/dues" className="font-semibold text-[#8E1C3D] underline">
            Open pending dues
          </Link>
        </MetricTile>

        <MetricTile label="Locked accounts" value={countValue(overview.locked_accounts)}>
          <Link to="/admin/users" className="font-semibold text-[#8E1C3D] underline">
            Open user accounts
          </Link>
        </MetricTile>

        <MetricTile label="Failed logins (last 24 hours)" value={countValue(overview.failed_logins_24h)}>
          <Link to="/admin/audit" className="font-semibold text-[#8E1C3D] underline">
            Open audit log
          </Link>
        </MetricTile>
      </div>
    </section>
  )
}

function DoctorQueues({ overview }: { overview: Partial<AdminOverview> }) {
  const doctors = overview.doctors_today
  return (
    <section aria-labelledby="admin-queues-heading" className={CARD}>
      <h3 id="admin-queues-heading" className={SECTION_HEADING}>
        Doctor queues today
      </h3>
      {doctors === undefined ? (
        <p className="mt-2 text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : doctors.length === 0 ? (
        <p className="mt-2 text-sm text-slate-700">No active doctors.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className={TH}>Doctor</th>
                <th scope="col" className={`${TH} text-right`}>Appointments</th>
                <th scope="col" className={`${TH} text-right`}>Waiting</th>
                <th scope="col" className={`${TH} text-right`}>In consultation</th>
                <th scope="col" className={`${TH} text-right`}>Done</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doctors.map((d) => (
                <tr key={d.doctor_id}>
                  <td className={`${TD} font-medium`}>{d.name}</td>
                  <td className={`${TD} text-right`}>{d.appointments_today}</td>
                  <td className={`${TD} text-right`}>{d.waiting}</td>
                  <td className={`${TD} text-right`}>{d.in_consultation}</td>
                  <td className={`${TD} text-right`}>{d.done}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function StaffByRole({ overview }: { overview: Partial<AdminOverview> }) {
  const counts = overview.user_counts
  return (
    <section aria-labelledby="admin-staff-heading" className={CARD}>
      <h3 id="admin-staff-heading" className={SECTION_HEADING}>
        System User Counts
      </h3>
      <p className="text-sm text-slate-700">Active staff accounts by role</p>
      {counts === undefined ? (
        <p className="mt-2 text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : Object.keys(counts).length === 0 ? (
        <p className="mt-2 text-sm text-slate-700">No user accounts reported.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Object.entries(counts).map(([roleName, c]) => (
            <li key={roleName} className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-700">{ROLE_LABELS[roleName] ?? roleName}</p>
              <p className="text-lg font-bold text-slate-900">{c.active} active</p>
              <p className="text-sm text-slate-700">{c.inactive} inactive</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SystemState({ overview }: { overview: Partial<AdminOverview> }) {
  const backup = overview.last_backup
  const integrity = overview.last_integrity_check
  const storage = overview.storage
  return (
    <section aria-labelledby="admin-system-heading" className="space-y-3">
      <h3 id="admin-system-heading" className={SECTION_HEADING}>
        Backups, integrity and storage
      </h3>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className={CARD}>
          <p className="text-sm font-semibold text-slate-700">Last backup</p>
          {backup === undefined ? (
            <p className="mt-1 text-sm text-slate-700">{NOT_REPORTED}</p>
          ) : backup === null ? (
            <p className="mt-1 text-lg font-bold text-slate-900">No backup archive found</p>
          ) : (
            <div className="mt-1 space-y-1 text-sm text-slate-800">
              <p className="text-lg font-bold text-[#5D0B26]">{formatAge(backup.created_at)}</p>
              <p>{formatIstDateTime(backup.created_at)}</p>
              <p className="break-all font-mono">{backup.filename}</p>
              <p>
                {formatBytes(backup.size_bytes)}
                {backup.label ? ` · label ${backup.label}` : ''}
              </p>
              {!backup.manifest_readable && (
                <p className="font-semibold text-red-800">The archive manifest could not be read.</p>
              )}
            </div>
          )}
          {overview.last_backup_failure_at && (
            <p className="mt-2 text-sm font-semibold text-red-800">
              Last failed backup attempt: {formatIstDateTime(overview.last_backup_failure_at)}
            </p>
          )}
          <Link to="/admin/backups" className="mt-2 inline-block text-sm font-semibold text-[#8E1C3D] underline">
            Open backup & restore
          </Link>
        </div>

        <div className={CARD}>
          <p className="text-sm font-semibold text-slate-700">Last integrity check</p>
          {integrity === undefined ? (
            <p className="mt-1 text-sm text-slate-700">{NOT_REPORTED}</p>
          ) : integrity === null ? (
            <p className="mt-1 text-lg font-bold text-slate-900">No integrity check recorded</p>
          ) : (
            <div className="mt-1 space-y-1 text-sm text-slate-800">
              <p className="text-lg font-bold text-[#5D0B26]">
                {integrity.is_healthy === true
                  ? 'Healthy'
                  : integrity.is_healthy === false
                    ? 'Discrepancies found'
                    : 'Result not recorded'}
              </p>
              <p>{formatIstDateTime(integrity.occurred_at)} ({formatAge(integrity.occurred_at)})</p>
              <p>Outcome: {integrity.outcome}</p>
            </div>
          )}
          <Link to="/admin/integrity" className="mt-2 inline-block text-sm font-semibold text-[#8E1C3D] underline">
            Open data integrity
          </Link>
        </div>

        <div className={CARD}>
          <p className="text-sm font-semibold text-slate-700">Storage free</p>
          {storage === undefined ? (
            <p className="mt-1 text-sm text-slate-700">{NOT_REPORTED}</p>
          ) : (
            <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-slate-800">
              <dt>Data volume</dt>
              <dd className="text-right font-semibold">{formatBytes(storage.data_free_bytes)}</dd>
              <dt>Backup volume</dt>
              <dd className="text-right font-semibold">{formatBytes(storage.backup_free_bytes)}</dd>
            </dl>
          )}
          <Link to="/admin/system" className="mt-2 inline-block text-sm font-semibold text-[#8E1C3D] underline">
            Open system health
          </Link>
        </div>
      </div>
    </section>
  )
}

function RecentAdminActions({ actions }: { actions: RecentAdminActionOut[] | undefined }) {
  return (
    <section aria-labelledby="admin-recent-heading" className={CARD}>
      <h3 id="admin-recent-heading" className={SECTION_HEADING}>
        Recent admin actions
      </h3>
      {actions === undefined ? (
        <p className="mt-2 text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : actions.length === 0 ? (
        <p className="mt-2 text-sm text-slate-700">No admin actions recorded yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className={TH}>When</th>
                <th scope="col" className={TH}>User</th>
                <th scope="col" className={TH}>Action</th>
                <th scope="col" className={TH}>Entity</th>
                <th scope="col" className={TH}>Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {actions.map((a, i) => (
                <tr key={`${a.occurred_at}-${a.action}-${i}`}>
                  <td className={`${TD} whitespace-nowrap`}>{formatIstDateTime(a.occurred_at)}</td>
                  <td className={TD}>{a.actor_username ?? 'System'}</td>
                  <td className={`${TD} font-mono`}>{a.action}</td>
                  <td className={TD}>
                    {a.entity_type ?? '-'}
                    {a.entity_id ? ` #${a.entity_id}` : ''}
                  </td>
                  <td className={TD}>{a.outcome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Link to="/admin/audit" className="mt-2 inline-block text-sm font-semibold text-[#8E1C3D] underline">
        Open full audit log
      </Link>
    </section>
  )
}

function ModuleCard({ module }: { module: AdminModule }) {
  const isFixed = module.status === 'fixed'
  return (
    <li
      className={`flex flex-col rounded-lg border p-4 ${
        isFixed ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200 bg-white shadow-xs'
      }`}
    >
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-sm text-slate-600" aria-hidden="true">
          {module.number}
        </span>
        <span className="font-bold text-slate-900">{module.title}</span>
      </p>
      <p className="mt-1 text-sm text-slate-700">{module.description}</p>
      {isFixed ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          <p className="font-semibold">Awaiting client decision</p>
          {module.statusReason && <p>{module.statusReason}</p>}
        </div>
      ) : (
        <>
          {module.status === 'partial' && module.statusReason && (
            <p className="mt-2 text-sm text-slate-700">
              <span className="font-semibold">Partial: </span>
              {module.statusReason}
            </p>
          )}
          <ul className="mt-3 flex flex-wrap gap-2">
            {module.links.map((link) => (
              <li key={link.path}>
                <Link
                  to={link.path}
                  className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-3 text-sm font-semibold text-[#8E1C3D] hover:border-[#8E1C3D] hover:bg-[#FFF8E7] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </li>
  )
}

function ModuleGrid() {
  return (
    <section aria-labelledby="admin-modules-heading" className="space-y-4">
      <h3 id="admin-modules-heading" className={SECTION_HEADING}>
        Administration Modules
      </h3>
      {ADMIN_MODULE_GROUPS.map((group) => (
        <div key={group.id}>
          <h4 className="mb-2 text-sm font-bold uppercase tracking-wide text-[#8E1C3D]">{group.label}</h4>
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {adminModulesInGroup(group.id).map((m) => (
              <ModuleCard key={m.id} module={m} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function AdminDashboard({ overview }: { overview: Partial<AdminOverview> }) {
  return (
    <div className="space-y-6">
      <AlertsPanel alerts={overview.alerts} />
      <TodayMetrics overview={overview} />
      <DoctorQueues overview={overview} />
      <StaffByRole overview={overview} />
      <SystemState overview={overview} />
      <RecentAdminActions actions={overview.recent_admin_actions} />
      <ModuleGrid />
    </div>
  )
}
