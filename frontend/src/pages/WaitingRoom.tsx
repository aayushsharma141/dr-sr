import { useMemo, useState } from 'react'
import type * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { useAppointments, useDepartments, useDoctors, useMe, useUpdateAppointmentStatus, useVisits } from '../api/queries'
import type { Appointment, PriorityLevel } from '../api/types'
import { ApiError, isVersionConflict } from '../api/client'
import { InlineAlert } from '../components/InlineAlert'
import { toast } from '../components/ToastHost'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { ReassignModal } from '../components/checkin/ReassignModal'
import { AppointmentStatusBadge, getWaitingElapsedMinutes, useIstToday } from '../components/reception/AppointmentStatusBadge'
import { formatIst, formatToken } from '../format'

/**
 * Waiting Room (design §7 item 5, S2 in the UI-SPEC). Reception's queue-management workspace.
 *
 * Three columns: Waiting, In Cabin, Completed, for today. Waiting is ordered by the suggested
 * order (OD-22-07): EMERGENCY by classification time, then PRIORITY, then NORMAL, each by token.
 * Per-doctor positions are computed pre-filter and never stored. Refreshes every 10 seconds and
 * shows when it last updated. There is no Call or Complete control: the doctor starts and
 * completes consultations from My Queue (OD-22-19).
 */

const SUGGESTED_RANK: Record<PriorityLevel, number> = { EMERGENCY: 0, PRIORITY: 1, NORMAL: 2 }

function compareByToken(a: Appointment, b: Appointment): number {
  return (a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
}

function suggestedOrder(a: Appointment, b: Appointment): number {
  const ra = SUGGESTED_RANK[a.priority_level ?? 'NORMAL'] ?? 2
  const rb = SUGGESTED_RANK[b.priority_level ?? 'NORMAL'] ?? 2
  if (ra !== rb) return ra - rb
  if (ra === 0) {
    const parsedA = Date.parse(a.priority_updated_at ?? a.status_updated_at ?? '')
    const parsedB = Date.parse(b.priority_updated_at ?? b.status_updated_at ?? '')
    const ta = Number.isNaN(parsedA) ? Number.MAX_SAFE_INTEGER : parsedA
    const tb = Number.isNaN(parsedB) ? Number.MAX_SAFE_INTEGER : parsedB
    if (ta !== tb) return ta - tb
  }
  return compareByToken(a, b)
}

function isWaitingRow(a: Appointment): boolean {
  return (a.status === 'ARRIVED' || a.status === 'CHECKED_IN' || a.status === 'WAITING') && a.consultation_status === 'WAITING'
}

function matchesSearch(a: Appointment, query: string): boolean {
  if (!query) return true
  const q = query.trim().toLowerCase()
  return (
    a.patient_name.toLowerCase().includes(q) ||
    a.patient_urn.toLowerCase().includes(q) ||
    formatToken(a.token_number).toLowerCase().includes(q)
  )
}

export function WaitingRoom() {
  const { data: me } = useMe()
  const permissions = me?.permissions ?? []
  const canReassign = permissions.includes('visit:write')
  const canCancel = permissions.includes('appointment:write')
  const canCollect = permissions.includes('payment:create')

  const today = useIstToday()
  const list = useAppointments({ appointment_date: today }, { refetchInterval: 10000 })
  const readyVisitsQuery = useVisits({ readyForCheckout: true }, { refetchInterval: 10_000 })
  const doctors = useDoctors(true)
  const departments = useDepartments()

  const [searchParams, setSearchParams] = useSearchParams()
  const rawDoctorId = searchParams.get('doctor_id') ?? ''
  const validDoctorId = /^[1-9]\d*$/.test(rawDoctorId) ? rawDoctorId : ''
  const doctorFilter =
    !validDoctorId || (doctors.isError && !doctors.data)
      ? ''
      : doctors.data !== undefined && !doctors.data.some((d) => String(d.id) === validDoctorId)
        ? ''
        : validDoctorId
  const setDoctorFilter = (val: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (val) next.set('doctor_id', val)
        else next.delete('doctor_id')
        return next
      },
      { replace: true },
    )
  }
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [search, setSearch] = useState('')

  const all = useMemo(() => list.data?.appointments ?? [], [list.data?.appointments])

  const readyVisitIds = useMemo(
    () => new Set((readyVisitsQuery.data?.visits ?? []).map((v) => v.id)),
    [readyVisitsQuery.data?.visits],
  )

  const activeVisitIds = useMemo(() => {
    const ids = new Set<number>()
    for (const a of all) {
      if (
        a.visit_id != null &&
        a.status !== 'CANCELLED' &&
        (a.consultation_status === 'WAITING' || a.consultation_status === 'IN_CONSULTATION')
      ) {
        ids.add(a.visit_id)
      }
    }
    return ids
  }, [all])

  // Compute 1-based positions independently per doctor before display filters so searching never fakes Position 1.
  const positionByAppointmentId = useMemo(() => {
    const counts = new Map<number, number>()
    const positions = new Map<number, number>()
    for (const a of all.filter(isWaitingRow).sort(suggestedOrder)) {
      const next = (counts.get(a.doctor_id) ?? 0) + 1
      counts.set(a.doctor_id, next)
      positions.set(a.id, next)
    }
    return positions
  }, [all])

  const visible = all.filter(
    (a) =>
      (!doctorFilter || String(a.doctor_id) === doctorFilter) &&
      (!departmentFilter || String(a.department_id ?? '') === departmentFilter) &&
      matchesSearch(a, search),
  )

  const waiting = visible.filter(isWaitingRow).sort(suggestedOrder)
  const inCabin = visible
    .filter((a) => a.status !== 'CANCELLED' && a.consultation_status === 'IN_CONSULTATION')
    .sort(compareByToken)
  const completed = visible
    .filter((a) => a.status !== 'CANCELLED' && a.consultation_status === 'COMPLETED')
    .sort(compareByToken)

  const updatedAt = list.dataUpdatedAt ? new Date(list.dataUpdatedAt) : null

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <section aria-labelledby="waiting-room-title" className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 id="waiting-room-title" className="text-xl font-semibold tracking-tight text-slate-900">Waiting Room</h1>
            <p className="text-sm text-slate-600 tabular-nums">
              {updatedAt
                ? `Last updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                : 'Loading today’s queue…'}
            </p>
          </div>
          <div className="flex flex-col items-start gap-0.5 text-xs text-slate-600 sm:items-end">
            <p className="font-semibold text-slate-800 tabular-nums">
              Waiting: {waiting.length} · In Cabin: {inCabin.length} · Completed: {completed.length}
            </p>
            <p>Doctors start and complete consultations from My Queue</p>
          </div>
        </header>

        {list.isError && (
          <InlineAlert tone="error">
            Could not refresh the queue. The data below may be out of date
            {updatedAt ? ` (last updated ${formatIst(updatedAt.toISOString())}).` : '.'} Try again.
          </InlineAlert>
        )}

        <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Doctor
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="mt-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
            >
              <option value="">All doctors</option>
              {(doctors.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-xs font-semibold text-slate-700">
            Department
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="mt-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
            >
              <option value="">All departments</option>
              {(departments.data ?? []).filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-1 flex-col text-xs font-semibold text-slate-700">
            Search by name, URN or token
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
            />
          </label>
        </div>

        <div
          data-testid="waiting-room-board"
          className={
            completed.length === 0
              ? 'grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.25fr)_minmax(15rem,0.75fr)]'
              : 'grid gap-4 lg:grid-cols-3'
          }
        >
          <Column title="Waiting" count={waiting.length} tone="waiting" emptyText="No one is waiting.">
            {waiting.map((a, index) => (
              <WaitingCard
                key={a.id}
                appt={a}
                position={positionByAppointmentId.get(a.id) ?? index + 1}
                canReassign={canReassign}
                canCancel={canCancel}
              />
            ))}
          </Column>
          <Column title="In Cabin" count={inCabin.length} tone="in_cabin" emptyText="No one is in a cabin.">
            {inCabin.map((a) => (
              <InCabinCard key={a.id} appt={a} canCancel={canCancel} />
            ))}
          </Column>
          <Column
            title="Completed"
            count={completed.length}
            tone="completed"
            emptyText="No consultations completed yet today."
            emptyHint="Completed visits appear here ready for checkout."
            emptyAction={
              canCollect ? (
                <Link
                  to="/reception/billing"
                  className="inline-flex min-h-9 items-center rounded-lg border border-brand-200 bg-brand-50 px-3 text-xs font-semibold text-brand-800 hover:bg-brand-100 transition-colors"
                >
                  Open Billing &amp; Checkout →
                </Link>
              ) : undefined
            }
          >
            {completed.map((a) => (
              <CompletedCard
                key={a.id}
                appt={a}
                readyVisitsLoaded={readyVisitsQuery.isSuccess}
                isReadyForCheckout={a.visit_id != null && readyVisitIds.has(a.visit_id)}
                hasOtherActiveConsultation={a.visit_id != null && activeVisitIds.has(a.visit_id)}
                canCollect={canCollect}
              />
            ))}
          </Column>
        </div>
      </section>
    </AppShell>
  )
}

const COLUMN_COUNT_CLASSES = {
  waiting: 'border-amber-200 bg-amber-50 text-amber-900',
  in_cabin: 'border-blue-200 bg-blue-50 text-blue-800',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800',
} as const

function Column({
  title,
  count,
  tone,
  emptyText,
  emptyHint,
  emptyAction,
  children,
}: {
  title: string
  count: number
  tone: keyof typeof COLUMN_COUNT_CLASSES
  emptyText: string
  emptyHint?: string
  emptyAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="flex lg:max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3.5 py-2.5">
        <h2 className="text-xs font-bold text-slate-800">{title}</h2>
        <span className={`rounded-full border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${COLUMN_COUNT_CLASSES[tone]}`}>{count}</span>
      </div>
      <div className="space-y-2.5 overflow-y-auto p-3">
        {count === 0 ? (
          <div className="space-y-1.5 py-2">
            <p className="text-sm font-medium text-slate-700">{emptyText}</p>
            {emptyHint && <p className="text-xs text-slate-600">{emptyHint}</p>}
            {emptyAction && <div className="pt-1">{emptyAction}</div>}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  )
}

function CardFrame({
  appt,
  badge,
  meta,
  children,
}: {
  appt: Appointment
  badge?: React.ReactNode
  meta?: React.ReactNode
  children?: React.ReactNode
}) {
  const showPriority = Boolean(appt.priority_level && appt.priority_level !== 'NORMAL')
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-2xs transition-colors hover:border-slate-300">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-md bg-slate-900 px-2 py-0.5 font-mono text-xs font-bold text-white tabular-nums">
            {formatToken(appt.token_number)}
          </span>
          <p data-testid="card-patient-name" className="truncate text-sm font-bold text-slate-900" title={appt.patient_name}>
            {appt.patient_name}
          </p>
        </div>
        {(showPriority || badge) && (
          <div className="flex shrink-0 items-center gap-1.5">
            <PriorityBadge level={appt.priority_level} reason={appt.priority_reason} />
            {badge}
          </div>
        )}
      </div>

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-600">
        <span className="truncate">{appt.doctor_name_en}</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono">{appt.patient_urn}</span>
        {meta && (
          <>
            <span aria-hidden="true">·</span>
            {meta}
          </>
        )}
      </p>

      {children && (
        <div className="mt-2.5 border-t border-slate-100 pt-2">
          {children}
        </div>
      )}
    </article>
  )
}

function CancelConsultationForm({
  appt,
  canCancel,
  leading,
  extraAction,
}: {
  appt: Appointment
  canCancel: boolean
  leading?: React.ReactNode
  extraAction?: React.ReactNode
}) {
  const queryClient = useQueryClient()
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancel = useUpdateAppointmentStatus()

  const toggle = () => {
    if (cancelOpen) {
      setCancelOpen(false)
      setReason('')
      setError(null)
    } else {
      setCancelOpen(true)
    }
  }

  const submitCancel = (e: React.FormEvent) => {
    e.preventDefault()
    const text = reason.trim()
    if (text.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setError(null)
    cancel.mutate(
      {
        id: appt.id,
        body: { status: 'CANCELLED', version_id: appt.version_id, cancellation_reason: text },
      },
      {
        onSuccess: () => {
          setCancelOpen(false)
          setReason('')
          setError(null)
          toast.success(`Cancelled consultation for ${appt.patient_name}.`)
        },
        onError: (err) => {
          if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
            void queryClient.invalidateQueries({ queryKey: ['appointments'] })
            setError('This patient was updated by someone else. The queue has refreshed; check it and try again.')
          } else if (err instanceof ApiError && err.code === 'cannot_cancel_finalised') {
            void queryClient.invalidateQueries({ queryKey: ['appointments'] })
            setError('This consultation’s clinical encounter is already finalised and cannot be cancelled.')
          } else if (err instanceof ApiError && err.code === 'visit_not_open') {
            void queryClient.invalidateQueries({ queryKey: ['appointments'] })
            setError('This visit is closed and can no longer be cancelled.')
          } else if (err instanceof ApiError && (err.code === 'invalid_status_transition' || err.code === 'status_unchanged')) {
            void queryClient.invalidateQueries({ queryKey: ['appointments'] })
            setError('This consultation has already changed status. The queue has refreshed.')
          } else {
            setError('Could not cancel the consultation. Try again.')
          }
        },
      },
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">{leading}</div>
        {(extraAction || canCancel) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {extraAction}
            {canCancel && (
              <button
                type="button"
                aria-expanded={cancelOpen}
                onClick={toggle}
                className="min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Cancel consultation
              </button>
            )}
          </div>
        )}
      </div>

      {canCancel && cancelOpen && (
        <form onSubmit={submitCancel} className="mt-2 space-y-2 border-t border-slate-100 pt-2">
          <label className="block text-xs font-semibold text-slate-700">
            Reason for cancelling
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
            />
          </label>
          <button
            type="submit"
            disabled={cancel.isPending}
            className="min-h-9 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 transition-colors disabled:opacity-70"
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel consultation'}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-2">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      )}
    </div>
  )
}

function WaitingCard({
  appt,
  position,
  canReassign,
  canCancel,
}: {
  appt: Appointment
  position: number
  canReassign: boolean
  canCancel: boolean
}) {
  const [reassignOpen, setReassignOpen] = useState(false)
  const hasWaitAnchor = Boolean(appt.check_in_at ?? appt.status_updated_at ?? appt.created_at)
  const elapsed = hasWaitAnchor ? getWaitingElapsedMinutes(appt) : null

  return (
    <CardFrame
      appt={appt}
      badge={
        position === 1 ? (
          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-800">
            Next up
          </span>
        ) : undefined
      }
      meta={
        elapsed !== null ? (
          <span className={elapsed >= 30 ? 'font-semibold text-amber-800 tabular-nums' : 'tabular-nums'}>
            {elapsed} min waiting
          </span>
        ) : undefined
      }
    >
      <CancelConsultationForm
        appt={appt}
        canCancel={canCancel}
        leading={<span className="text-xs font-medium text-slate-600 tabular-nums">Position {position}</span>}
        extraAction={
          canReassign ? (
            <button
              type="button"
              onClick={() => setReassignOpen(true)}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 transition-colors"
            >
              Reassign
            </button>
          ) : undefined
        }
      />

      {canReassign && reassignOpen && (
        <ReassignModal appointment={appt} onClose={() => setReassignOpen(false)} />
      )}
    </CardFrame>
  )
}

function InCabinCard({ appt, canCancel }: { appt: Appointment; canCancel: boolean }) {
  const hasAnchor = Boolean(appt.status_updated_at ?? appt.created_at)
  const elapsed = hasAnchor
    ? getWaitingElapsedMinutes({ status_updated_at: appt.status_updated_at, created_at: appt.created_at })
    : null

  return (
    <CardFrame
      appt={appt}
      meta={elapsed !== null ? <span className="font-medium text-blue-800 tabular-nums">In cabin · {elapsed} min</span> : undefined}
    >
      <CancelConsultationForm
        appt={appt}
        canCancel={canCancel}
        leading={
          <>
            <AppointmentStatusBadge status="IN_CABIN" label="Consultation in progress" />
            <span className="text-xs text-slate-600">Completed by doctor</span>
          </>
        }
      />
    </CardFrame>
  )
}

function CompletedCard({
  appt,
  readyVisitsLoaded,
  isReadyForCheckout,
  hasOtherActiveConsultation,
  canCollect,
}: {
  appt: Appointment
  readyVisitsLoaded: boolean
  isReadyForCheckout: boolean
  hasOtherActiveConsultation: boolean
  canCollect: boolean
}) {
  const billingHref = `/reception/billing?appointment_id=${appt.id}&patient_id=${appt.patient_id}`
  const isReadyFallback = !readyVisitsLoaded || appt.visit_id == null || isReadyForCheckout

  return (
    <CardFrame appt={appt}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {isReadyFallback ? (
          <>
            <AppointmentStatusBadge status="COMPLETED" label="Ready for checkout" />
            {canCollect && (
              <Link
                to={billingHref}
                className="inline-flex min-h-9 items-center rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white hover:bg-brand-800 transition-colors"
              >
                Collect payment →
              </Link>
            )}
          </>
        ) : hasOtherActiveConsultation ? (
          <>
            <AppointmentStatusBadge status="WAITING" label="Other consultation active" />
            {canCollect && (
              <Link
                to={billingHref}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Open billing →
              </Link>
            )}
          </>
        ) : (
          <>
            <AppointmentStatusBadge status="BOOKED" label="Closed / settled" />
            {canCollect && (
              <Link
                to={billingHref}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                View bill →
              </Link>
            )}
          </>
        )}
      </div>
    </CardFrame>
  )
}
