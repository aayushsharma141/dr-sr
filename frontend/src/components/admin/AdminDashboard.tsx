import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useManagementOverview } from '../../api/queries'
import type {
  AdminOverview,
  DepartmentCollection,
  ManagementOverview,
  MonthOverMonth,
  OverviewAlertOut,
  RecentAdminActionOut,
} from '../../api/types'
import {
  IconAlertTriangle,
  IconCalendarCheck,
  IconChartBar,
  IconChartDonut,
  IconChartLine,
  IconCheck,
  IconChevronRight,
  IconReceipt,
  IconRupee,
  IconServer,
  IconStethoscope,
  IconTrendingDown,
  IconTrendingUp,
  IconUserPlus,
  IconUsers,
  IconWallet,
  IconHistory,
} from '../icons'

/*
 * Administration Dashboard.
 *   Row 1  key figures: collected this month, collected today, new patients, pending dues
 *   Row 2  collected per month (area chart), collected by department (donut), needs attention
 *   Row 3  patients this month, appointments today, new patients per month, system health
 *   Row 4  doctors today, recent admin actions
 * Every figure comes from GET /admin/overview or GET /admin/management-overview. A figure the
 * server did not send is shown as "Not reported"; nothing is estimated or filled with samples.
 * The hospital does not record expenses, so there is no expense, surplus or utilisation panel.
 */

const NOT_REPORTED = 'Not reported'
const IST = 'Asia/Kolkata'

const CARD = 'rounded-xl border border-slate-200 bg-white p-5 shadow-xs'
const PANEL_TITLE = 'text-sm font-semibold text-slate-900'
const LINK =
  'text-sm font-semibold text-brand-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700'

// ------------------------------------------------------------------------------- formatting

/** Integer paise to whole rupees, no floating-point money maths. */
function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : ''
  return `${sign}₹${Math.floor(Math.abs(paise) / 100).toLocaleString('en-IN')}`
}

/** Short axis and donut labels: ₹950, ₹12.5k, ₹3.4L. */
function shortRupees(paise: number): string {
  const r = Math.round(paise / 100)
  if (r >= 100000) return `₹${(r / 100000).toFixed(r >= 1000000 ? 0 : 1)}L`
  if (r >= 1000) return `₹${(r / 1000).toFixed(r >= 10000 ? 0 : 1)}k`
  return `₹${r}`
}

function count(n: number | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-IN') : NOT_REPORTED
}

function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = value
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u += 1
  }
  return `${u === 0 ? v : v.toFixed(1)} ${units[u]}`
}

function istDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-IN', { timeZone: IST, dateStyle: 'medium', timeStyle: 'short' })
}

function age(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'Unknown'
  const minutes = Math.floor(Math.max(0, Date.now() - then) / 60000)
  if (minutes < 60) return minutes < 1 ? 'Just now' : `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** "SETTINGS_UPDATED" -> "Settings updated". */
function sentence(code: string): string {
  const words = code.replace(/_/g, ' ').toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Wording staff recognise for the commonest recorded actions; the rest are spelled out. */
const ACTION_WORDS: Record<string, string> = {
  AUTH_LOGIN_SUCCEEDED: 'Signed in',
  AUTH_LOGIN_FAILED: 'Sign-in failed',
  AUTH_LOGOUT: 'Signed out',
  SESSION_TAKEOVER: 'Took over a session from another computer',
  INTEGRITY_CHECK_RUN: 'Ran the data integrity check',
  BACKUP_CREATED: 'Created a backup',
  SETTINGS_UPDATED: 'Updated hospital settings',
}

const METHOD_WORDS: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' }

function businessDateLabel(isoDate: string | undefined): string {
  if (!isoDate) return ''
  const d = new Date(`${isoDate}T12:00:00+05:30`)
  return Number.isNaN(d.getTime())
    ? isoDate
    : d.toLocaleDateString('en-IN', { timeZone: IST, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** A round axis top just above the largest value, split into four steps. */
function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] }
  const rough = max / 4
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag
  return { top: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => i * step) }
}

// ------------------------------------------------------------------------------- shared bits

function Panel({
  id,
  title,
  icon,
  action,
  className = '',
  children,
}: {
  id: string
  title: string
  icon: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section aria-labelledby={id} className={`${CARD} flex flex-col ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2 text-brand-700">
          {icon}
          <h2 id={id} className={PANEL_TITLE}>
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="flex-1 pt-4">{children}</div>
    </section>
  )
}

function Delta({ value, unit = '' }: { value: MonthOverMonth; unit?: string }) {
  if (value.change_pct === null) {
    return <span className="text-slate-600">No figure last month to compare</span>
  }
  const up = value.change_pct >= 0
  const Icon = up ? IconTrendingUp : IconTrendingDown
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${up ? 'text-emerald-800' : 'text-red-800'}`}>
        <Icon size={16} aria-hidden="true" />
        {up ? 'Up' : 'Down'} {Math.abs(value.change_pct)}%
      </span>
      <span className="text-slate-600">
        on last month ({unit === '₹' ? rupees(value.previous) : value.previous.toLocaleString('en-IN')})
      </span>
    </span>
  )
}

const CHIP: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  maroon: 'bg-brand-50 text-brand-700 border-rose-100',
  blue: 'bg-sky-50 text-sky-800 border-sky-100',
  amber: 'bg-amber-50 text-amber-800 border-amber-100',
}

function KeyFigure({
  label,
  value,
  icon,
  tone,
  index = 0,
  children,
}: {
  label: string
  value: string
  icon: ReactNode
  tone: keyof typeof CHIP
  index?: number
  children?: ReactNode
}) {
  return (
    <div
      className={`${CARD} admin-fade-up transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border ${CHIP[tone]}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-600">{label}</p>
          <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">{value}</p>
        </div>
      </div>
      {children && <div className="mt-3 text-sm">{children}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------------- charts

/** Area chart drawn to one scale; each point carries its value for hover and screen readers. */
function CollectionsChart({ rows }: { rows: { month: string; paise: number }[] }) {
  const W = 400
  const H = 220
  const left = 48
  const right = 388
  const top = 14
  const bottom = 186
  const { top: yTop, ticks } = niceScale(Math.max(...rows.map((r) => r.paise)))
  const x = (i: number) => left + (i * (right - left)) / Math.max(1, rows.length - 1)
  const y = (v: number) => bottom - (v / yTop) * (bottom - top)
  const line = rows.map((r, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(r.paise)}`).join(' ')
  const area = `${line} L ${x(rows.length - 1)} ${bottom} L ${x(0)} ${bottom} Z`
  const allZero = rows.every((r) => r.paise === 0)

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Collected per month: ${rows.map((r) => `${r.month} ${rupees(r.paise)}`).join(', ')}`}
      >
        <defs>
          <linearGradient id="admin-collections-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-700)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-brand-700)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="var(--color-slate-200)" strokeDasharray="3 3" />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="12" fill="var(--color-slate-600)">
              {allZero ? (t === 0 ? '₹0' : '') : shortRupees(t)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#admin-collections-fill)" className="admin-area-in" />
        <path
          d={line}
          fill="none"
          stroke="var(--color-brand-700)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          className="admin-line-draw"
        />
        {rows.map((r, i) => (
          <circle
            key={r.month}
            cx={x(i)}
            cy={y(r.paise)}
            r="4"
            fill="white"
            stroke="var(--color-brand-700)"
            strokeWidth="2"
            className="admin-area-in"
            style={{ animationDelay: `${0.3 + i * 0.08}s` }}
          >
            <title>{`${r.month}: ${rupees(r.paise)}`}</title>
          </circle>
        ))}
        {rows.map((r, i) => (
          <text key={`${r.month}-x`} x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-slate-600)">
            {r.month}
          </text>
        ))}
      </svg>
      <figcaption className="mt-2 text-xs text-slate-600">
        {allZero ? 'No payments recorded in these six months.' : 'Collected after reversals, by month the payment was taken.'}
      </figcaption>
    </figure>
  )
}

const SLICE_COLORS = [
  'var(--color-brand-700)',
  'var(--color-gold-500)',
  'var(--color-chart-teal)',
  'var(--color-chart-blue)',
  'var(--color-chart-plum)',
]

function DepartmentDonut({ rows, totalPaise }: { rows: DepartmentCollection[]; totalPaise: number }) {
  const R = 36
  const C = 2 * Math.PI * R
  let offset = 0
  const colored = rows.map((d, i) => ({
    ...d,
    color: d.department_id === null ? 'var(--color-chart-muted)' : SLICE_COLORS[i % SLICE_COLORS.length],
  }))

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative h-40 w-40 shrink-0">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={
          rows.length === 0
            ? 'No payments this month'
            : `Collected by department: ${rows.map((d) => `${d.name} ${d.percentage}%`).join(', ')}`
        }>
          <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-slate-100)" strokeWidth="16" />
          {colored.map((d, i) => {
            const len = (d.percentage / 100) * C
            const el = (
              <circle
                key={d.department_id ?? 'none'}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-offset}
                className="admin-donut-in"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <title>{`${d.name}: ${rupees(d.collected_paise)} (${d.percentage}%)`}</title>
              </circle>
            )
            offset += len
            return el
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-base font-bold tabular-nums text-slate-900">{shortRupees(totalPaise)}</span>
          <span className="text-xs text-slate-600">This month</span>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-700">No payments this month yet.</p>
      ) : (
        <ul className="w-full min-w-0 flex-1 space-y-2 text-sm">
          {colored.map((d) => (
            <li key={d.department_id ?? 'none'} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: d.color }} aria-hidden="true" />
                <span className={`truncate ${d.department_id === null ? 'text-slate-600' : 'text-slate-800'}`}>{d.name}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900">{d.percentage}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function MonthBars({ rows, label }: { rows: { month: string; value: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol aria-label={label} className="grid h-full grid-cols-6 items-end gap-2">
      {rows.map((r, i) => (
        <li key={r.month} className="flex h-full flex-col items-center justify-end gap-1">
          <span className="text-xs font-semibold tabular-nums text-slate-700">{r.value}</span>
          <div className="flex h-20 w-full items-end">
            <div
              className={`admin-bar-grow w-full rounded-t ${i === rows.length - 1 ? 'bg-brand-700' : 'bg-brand-700/30'}`}
              style={{ height: `${Math.max(r.value > 0 ? 6 : 0, (r.value / max) * 100)}%`, animationDelay: `${i * 70}ms` }}
            />
          </div>
          <span className="text-xs text-slate-600">{r.month}</span>
        </li>
      ))}
    </ol>
  )
}

// ------------------------------------------------------------------------------- attention

interface AttentionItem {
  key: string
  tone: 'error' | 'warning'
  message: string
  to?: string
}

/** Where each server alert is fixed. Unknown codes still show, without a link. */
const ALERT_TARGETS: Record<string, string> = {
  no_backup_yet: '/admin/backups',
  last_backup_failed: '/admin/backups',
  backup_overdue: '/admin/backups',
  accounts_locked: '/admin/users',
  integrity_issues: '/admin/integrity',
}

function attentionItems(overview: Partial<AdminOverview>): AttentionItem[] {
  const items: AttentionItem[] = (overview.alerts ?? []).map((a: OverviewAlertOut) => ({
    key: a.code,
    tone: a.severity === 'error' ? 'error' : 'warning',
    message: a.message,
    to: ALERT_TARGETS[a.code],
  }))
  const codes = new Set(items.map((i) => i.key))
  const failed = overview.failed_logins_24h ?? 0
  if (failed > 0) {
    items.push({
      key: 'failed_logins',
      tone: 'warning',
      message: `${failed} failed sign-in attempt${failed === 1 ? '' : 's'} in the last 24 hours.`,
      to: '/admin/audit',
    })
  }
  const locked = overview.locked_accounts ?? 0
  if (locked > 0 && !codes.has('accounts_locked')) {
    items.push({
      key: 'locked_accounts',
      tone: 'warning',
      message: `${locked} staff account${locked === 1 ? ' is' : 's are'} locked.`,
      to: '/admin/users',
    })
  }
  return items.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'error' ? -1 : 1))
}

function NeedsAttention({ overview, className }: { overview: Partial<AdminOverview>; className?: string }) {
  const items = attentionItems(overview)
  return (
    <Panel
      id="admin-attention"
      title="Needs attention"
      icon={<IconAlertTriangle size={20} aria-hidden="true" />}
      className={`${items.some((i) => i.tone === 'error') ? 'border-red-200' : ''} ${className ?? ''}`}
      action={
        items.length > 0 ? (
          <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-700 px-1.5 text-xs font-bold text-white">
            {items.length}
          </span>
        ) : undefined
      }
    >
      {overview.alerts === undefined ? (
        <p className="text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-800">
          <IconCheck size={18} aria-hidden="true" />
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="-my-2 divide-y divide-slate-100">
          {items.map((item, itemIndex) => {
            const body = (
              <>
                <span className="min-w-0">
                  <span className={`mr-1.5 rounded px-1.5 py-0.5 text-xs font-semibold ${item.tone === 'error' ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'}`}>
                    {item.tone === 'error' ? 'Problem' : 'Check'}
                  </span>
                  <span className="text-slate-800">{item.message}</span>
                </span>
                {item.to && <IconChevronRight size={18} className="shrink-0 text-slate-500" aria-hidden="true" />}
              </>
            )
            return (
              <li key={item.key}>
                {item.to ? (
                  <Link
                    to={item.to}
                    className="admin-fade-up flex items-center justify-between gap-2 rounded py-3 text-sm transition-colors hover:bg-slate-50/70 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
                    style={{ animationDelay: `${itemIndex * 60}ms` }}
                  >
                    {body}
                  </Link>
                ) : (
                  <div
                    className="admin-fade-up flex items-center justify-between gap-2 rounded py-3 text-sm transition-colors hover:bg-slate-50/70"
                    style={{ animationDelay: `${itemIndex * 60}ms` }}
                  >
                    {body}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------------------ row panels

const APPOINTMENT_SEGMENTS = [
  { key: 'waiting', label: 'Waiting', color: 'bg-amber-500', codes: ['BOOKED', 'ARRIVED'] },
  { key: 'in', label: 'In consultation', color: 'bg-consult-600', codes: ['IN_CONSULTATION'] },
  { key: 'done', label: 'Done', color: 'bg-emerald-600', codes: ['DONE'] },
  { key: 'off', label: 'Cancelled or no-show', color: 'bg-slate-400', codes: ['CANCELLED', 'NO_SHOW'] },
]

function AppointmentsToday({ overview }: { overview: Partial<AdminOverview> }) {
  const appts = overview.appointments_today
  const segments = APPOINTMENT_SEGMENTS.map((s) => ({
    ...s,
    n: s.codes.reduce((sum, c) => sum + (appts?.[c] ?? 0), 0),
  }))
  const total = segments.reduce((s, x) => s + x.n, 0)
  return (
    <Panel id="admin-appointments" title="Appointments today" icon={<IconCalendarCheck size={20} aria-hidden="true" />}>
      {!appts ? (
        <p className="text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : (
        <>
          <p className="text-3xl font-bold tabular-nums text-slate-900">{total}</p>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
            {segments.map(
              (s, index) =>
                s.n > 0 && (
                  <div
                    key={s.key}
                    className={`${s.color} admin-segment-grow`}
                    style={{ width: `${(s.n / total) * 100}%`, animationDelay: `${index * 90}ms` }}
                  />
                ),
            )}
          </div>
          <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-sm">
            {segments.map((s) => (
              <div key={s.key} className="contents">
                <dt className="flex items-center gap-2 text-slate-700">
                  <span className={`h-2.5 w-2.5 rounded-sm ${s.color}`} aria-hidden="true" />
                  {s.label}
                </dt>
                <dd className="text-right font-semibold tabular-nums">{s.n}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Panel>
  )
}

function SystemHealth({ overview }: { overview: Partial<AdminOverview> }) {
  const backup = overview.last_backup
  const integrity = overview.last_integrity_check
  const storage = overview.storage
  const staff = overview.user_counts
  const rows: { label: string; value: string; ok: boolean | null; to: string }[] = [
    {
      label: 'Last backup',
      value: backup === undefined ? NOT_REPORTED : backup === null ? 'None yet' : age(backup.created_at),
      ok: backup === undefined ? null : backup !== null && !overview.last_backup_failure_at,
      to: '/admin/backups',
    },
    {
      label: 'Data integrity',
      value:
        integrity === undefined
          ? NOT_REPORTED
          : integrity === null
            ? 'Never run'
            : integrity.is_healthy === true
              ? 'Healthy'
              : integrity.is_healthy === false
                ? 'Problems found'
                : 'Unknown',
      ok: integrity === undefined || integrity === null ? null : integrity.is_healthy === true,
      to: '/admin/integrity',
    },
    {
      label: 'Free disk space',
      value: storage ? bytes(storage.data_free_bytes) : NOT_REPORTED,
      ok: storage ? storage.data_free_bytes !== null : null,
      to: '/admin/system',
    },
    {
      label: 'Staff accounts',
      value: staff ? `${Object.values(staff).reduce((s, c) => s + c.active, 0)} active` : NOT_REPORTED,
      ok: staff ? true : null,
      to: '/admin/users',
    },
  ]
  const allOk = rows.every((r) => r.ok === true)
  return (
    <Panel
      id="admin-system"
      title="System health"
      icon={<IconServer size={20} aria-hidden="true" />}
      action={
        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${allOk ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
          {allOk ? 'Healthy' : 'Check'}
        </span>
      }
    >
      <ul className="space-y-2.5 text-sm">
        {rows.map((r, index) => (
          <li key={r.label}>
            <Link
              to={r.to}
              className="admin-fade-up flex items-center justify-between gap-3 rounded px-1 py-0.5 transition-colors hover:bg-slate-50/70 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <span className="flex items-center gap-2 text-slate-700">
                {r.ok === false ? (
                  <IconAlertTriangle size={16} className="text-amber-700" aria-label="Needs checking" />
                ) : (
                  <IconCheck size={16} className={r.ok ? 'text-emerald-700' : 'text-slate-500'} aria-hidden="true" />
                )}
                {r.label}
              </span>
              <span className="font-semibold tabular-nums text-slate-900">{r.value}</span>
            </Link>
          </li>
        ))}
      </ul>
      {backup && <p className="mt-3 text-xs text-slate-600">Backup taken {istDateTime(backup.created_at)}, {bytes(backup.size_bytes)}.</p>}
    </Panel>
  )
}

function DoctorsToday({ overview }: { overview: Partial<AdminOverview> }) {
  const doctors = overview.doctors_today
  return (
    <Panel id="admin-doctors" title="Doctors today" icon={<IconStethoscope size={20} aria-hidden="true" />}>
      {doctors === undefined ? (
        <p className="text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : doctors.length === 0 ? (
        <p className="text-sm text-slate-700">No active doctors.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th scope="col" className="pb-2 pr-3 font-medium">Doctor</th>
                <th scope="col" className="px-3 pb-2 text-right font-medium">Waiting</th>
                <th scope="col" className="px-3 pb-2 text-right font-medium">In consultation</th>
                <th scope="col" className="px-3 pb-2 text-right font-medium">Done</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 tabular-nums">
              {doctors.map((d, index) => (
                <tr
                  key={d.doctor_id}
                  className="admin-fade-up transition-colors hover:bg-slate-50/70"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  <td className="py-2 pr-3 font-medium text-slate-900">{d.name}</td>
                  <td className="px-3 py-2 text-right">{d.waiting}</td>
                  <td className="px-3 py-2 text-right">{d.in_consultation}</td>
                  <td className="px-3 py-2 text-right">{d.done}</td>
                  <td className="py-2 pl-3 text-right font-semibold">{d.appointments_today}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function RecentAdminActions({ actions }: { actions: RecentAdminActionOut[] | undefined }) {
  return (
    <Panel
      id="admin-recent"
      title="Recent admin actions"
      icon={<IconHistory size={20} aria-hidden="true" />}
      action={
        <Link to="/admin/audit" className={LINK}>
          Open Audit Trail
        </Link>
      }
    >
      {actions === undefined ? (
        <p className="text-sm text-slate-700">{NOT_REPORTED}</p>
      ) : actions.length === 0 ? (
        <p className="text-sm text-slate-700">No admin actions recorded yet.</p>
      ) : (
        <ul className="-my-2 divide-y divide-slate-100 text-sm">
          {actions.slice(0, 6).map((a, i) => (
            <li
              key={`${a.occurred_at}-${a.action}-${i}`}
              className="admin-fade-up flex flex-wrap items-baseline justify-between gap-x-3 rounded py-2 transition-colors hover:bg-slate-50/70"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <span className="min-w-0 text-slate-900">
                {ACTION_WORDS[a.action] ?? sentence(a.action)}
                <span className="text-slate-600"> by {a.actor_username ?? 'System'}</span>
                {a.outcome !== 'SUCCESS' && <span className="ml-1 font-semibold text-red-800">({sentence(a.outcome)})</span>}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-slate-600">{istDateTime(a.occurred_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------------------------- page

export function AdminDashboard({ overview }: { overview: Partial<AdminOverview> }) {
  const monthly = useManagementOverview()
  // An older server sends a different shape; treat it as unavailable rather than guess.
  const month: ManagementOverview | undefined = monthly.data?.collections_paise ? monthly.data : undefined
  const monthFailed = monthly.isError || (monthly.data !== undefined && !month)
  const monthNote = monthFailed ? 'Could not be loaded' : 'Loading…'
  const cash = overview.collections_today

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Administration Dashboard</h1>
          <p className="mt-1 text-sm text-slate-600">{businessDateLabel(overview.business_date)}</p>
        </div>
        {month && <p className="text-sm text-slate-600">Month figures: {month.current_month_label}, compared with {month.previous_month_label}</p>}
      </div>

      <section aria-labelledby="admin-key-figures">
        <h2 id="admin-key-figures" className="sr-only">
          Key figures
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KeyFigure
            index={0}
            label="Collected this month"
            value={month ? rupees(month.collections_paise.current) : monthNote}
            icon={<IconRupee size={22} aria-hidden="true" />}
            tone="green"
          >
            {month && <Delta value={month.collections_paise} unit="₹" />}
          </KeyFigure>
          <KeyFigure
            index={1}
            label="Collected today"
            value={cash ? rupees(cash.gross_paise - cash.reversed_paise) : NOT_REPORTED}
            icon={<IconReceipt size={22} aria-hidden="true" />}
            tone="maroon"
          >
            {cash && (
              <p className="text-slate-700">
                {Object.entries(cash.by_method)
                  .filter(([, p]) => p > 0)
                  .map(([m, p]) => `${METHOD_WORDS[m] ?? sentence(m)} ${rupees(p)}`)
                  .join(', ') || `${cash.payments_count} payments`}
                {cash.reversals_count > 0 && `; ${rupees(cash.reversed_paise)} reversed`}
              </p>
            )}
          </KeyFigure>
          <KeyFigure
            index={2}
            label="New patients this month"
            value={month ? count(month.new_patients.current) : monthNote}
            icon={<IconUserPlus size={22} aria-hidden="true" />}
            tone="blue"
          >
            {month && <Delta value={month.new_patients} />}
          </KeyFigure>
          <KeyFigure
            index={3}
            label="Pending dues"
            value={typeof overview.outstanding_dues_paise === 'number' ? rupees(overview.outstanding_dues_paise) : NOT_REPORTED}
            icon={<IconWallet size={22} aria-hidden="true" />}
            tone="amber"
          >
            <Link to="/reception/dues" className={LINK}>
              Open Pending Dues
            </Link>
          </KeyFigure>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Panel
          id="admin-collections"
          title="Collected per month"
          icon={<IconChartLine size={20} aria-hidden="true" />}
          className="lg:col-span-5"
        >
          {month ? (
            <CollectionsChart rows={month.collection_trend.map((m) => ({ month: m.month, paise: m.collected_paise }))} />
          ) : (
            <p className="text-sm text-slate-700">{monthNote}</p>
          )}
        </Panel>
        <Panel
          id="admin-departments"
          title="Collected by department"
          icon={<IconChartDonut size={20} aria-hidden="true" />}
          className="lg:col-span-4"
        >
          {month ? (
            <>
              <DepartmentDonut rows={month.department_collections} totalPaise={month.collections_paise.current} />
              <p className="mt-4 text-xs text-slate-600">Payments count against the department of the appointment they were taken for.</p>
            </>
          ) : (
            <p className="text-sm text-slate-700">{monthNote}</p>
          )}
        </Panel>
        <NeedsAttention overview={overview} className="lg:col-span-3" />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Panel id="admin-patients" title="Patients this month" icon={<IconUsers size={20} aria-hidden="true" />}>
          {month ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-600">New</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900">{count(month.new_patients.current)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Returning</p>
                <p className="text-3xl font-bold tabular-nums text-slate-900">{count(month.returning_patients_this_month)}</p>
              </div>
              <p className="col-span-2 text-xs text-slate-600">Returning means registered before this month and seen again.</p>
            </div>
          ) : (
            <p className="text-sm text-slate-700">{monthNote}</p>
          )}
        </Panel>
        <AppointmentsToday overview={overview} />
        <Panel id="admin-patient-trend" title="New patients per month" icon={<IconChartBar size={20} aria-hidden="true" />}>
          {month ? (
            <MonthBars
              label="New patients per month, last six months"
              rows={month.patient_trend.map((m) => ({ month: m.month, value: m.new_patients }))}
            />
          ) : (
            <p className="text-sm text-slate-700">{monthNote}</p>
          )}
        </Panel>
        <SystemHealth overview={overview} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <DoctorsToday overview={overview} />
        <RecentAdminActions actions={overview.recent_admin_actions} />
      </div>
    </div>
  )
}
