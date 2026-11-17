import { useMemo, useState } from 'react'
import type * as React from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AppShell } from '../components/AppShell'
import { useAppointments, useDepartments, useDoctorDepartments, useDoctors, useMe, useReassignAppointment, useUpdateAppointmentStatus } from '../api/queries'
import type { Appointment, PriorityLevel } from '../api/types'
import { ApiError, isVersionConflict } from '../api/client'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { formatIst, formatToken, istToday } from '../format'

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

function getElapsedMinutes(isoString?: string | null): number | null {
  if (!isoString) return null
  const then = Date.parse(isoString)
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((Date.now() - then) / 60000))
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
  const today = useMemo(() => istToday(), [])
  const list = useAppointments({ appointment_date: today }, { refetchInterval: 10000 })
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
            <h1 id="waiting-room-title" className="text-base font-bold text-neutral-900">Waiting Room</h1>
            <p className="text-sm text-neutral-600">
              {updatedAt
                ? `Last updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
                : 'Loading today’s queue…'}
            </p>
          </div>
          <div className="flex flex-col items-start gap-0.5 text-xs text-neutral-600 sm:items-end">
            <p className="font-semibold text-neutral-800">
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

        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col text-sm font-semibold text-neutral-700">
            Doctor
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
              className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
            >
              <option value="">All doctors</option>
              {(doctors.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm font-semibold text-neutral-700">
            Department
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
            >
              <option value="">All departments</option>
              {(departments.data ?? []).filter((d) => d.is_active).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[240px] flex-1 flex-col text-sm font-semibold text-neutral-700">
            Search by name, URN or token
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
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
          <Column title="Waiting" count={waiting.length} emptyText="No one is waiting.">
            {waiting.map((a, index) => (
              <WaitingCard key={a.id} appt={a} position={positionByAppointmentId.get(a.id) ?? index + 1} />
            ))}
          </Column>
          <Column title="In Cabin" count={inCabin.length} emptyText="No one is in a cabin.">
            {inCabin.map((a) => (
              <InCabinCard key={a.id} appt={a} />
            ))}
          </Column>
          <Column
            title="Completed"
            count={completed.length}
            emptyText="No consultations completed yet today."
            emptyHint="Completed visits appear here ready for checkout."
            emptyAction={
              <Link
                to="/reception/billing"
                className="inline-flex min-h-9 items-center rounded-md border border-neutral-300 bg-white px-3 text-xs font-semibold text-brand-700 hover:bg-neutral-100"
              >
                Open Billing &amp; Checkout →
              </Link>
            }
          >
            {completed.map((a) => (
              <CompletedCard key={a.id} appt={a} />
            ))}
          </Column>
        </div>
      </section>
    </AppShell>
  )
}

function Column({
  title,
  count,
  emptyText,
  emptyHint,
  emptyAction,
  children,
}: {
  title: string
  count: number
  emptyText: string
  emptyHint?: string
  emptyAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section aria-label={title} className="flex max-h-[70vh] flex-col rounded-lg border border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
        <h2 className="text-xs font-bold text-neutral-700">{title}</h2>
        <span className="font-mono text-xs font-semibold text-neutral-700">{count}</span>
      </div>
      <div className="space-y-2.5 overflow-y-auto p-3">
        {count === 0 ? (
          <div className="space-y-1.5 py-2">
            <p className="text-sm font-medium text-neutral-600">{emptyText}</p>
            {emptyHint && <p className="text-xs text-neutral-600">{emptyHint}</p>}
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
    <article className="rounded-lg border border-neutral-200 bg-white p-3 shadow-2xs">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs font-bold text-neutral-900">
            {formatToken(appt.token_number)}
          </span>
          <p data-testid="card-patient-name" className="truncate text-sm font-bold text-neutral-900" title={appt.patient_name}>
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

      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-neutral-600">
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
        <div className="mt-2.5 border-t border-neutral-100 pt-2">
          {children}
        </div>
      )}
    </article>
  )
}

function CancelConsultationForm({
  appt,
  leading,
  extraAction,
}: {
  appt: Appointment
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
        <div className="flex flex-wrap items-center gap-1.5">
          {extraAction}
          <button
            type="button"
            aria-expanded={cancelOpen}
            onClick={toggle}
            className="min-h-9 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Cancel consultation
          </button>
        </div>
      </div>

      {cancelOpen && (
        <form onSubmit={submitCancel} className="mt-2 space-y-2 border-t border-neutral-100 pt-2">
          <label className="block text-xs font-semibold text-neutral-700">
            Reason for cancelling
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900"
            />
          </label>
          <button
            type="submit"
            disabled={cancel.isPending}
            className="min-h-9 rounded-md bg-danger-600 px-3 text-xs font-semibold text-white disabled:opacity-70"
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

function WaitingCard({ appt, position }: { appt: Appointment; position: number }) {
  const [reassignOpen, setReassignOpen] = useState(false)
  const elapsed = getElapsedMinutes(appt.check_in_at ?? appt.status_updated_at ?? appt.created_at)

  return (
    <CardFrame
      appt={appt}
      badge={
        position === 1 ? (
          <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            Next up
          </span>
        ) : undefined
      }
      meta={
        elapsed !== null ? (
          <span className={elapsed >= 30 ? 'font-semibold text-amber-800' : undefined}>
            {elapsed} min waiting
          </span>
        ) : undefined
      }
    >
      <CancelConsultationForm
        appt={appt}
        leading={<span className="text-xs font-medium text-neutral-600">Position {position}</span>}
        extraAction={
          <button
            type="button"
            onClick={() => setReassignOpen(true)}
            className="min-h-9 rounded-md border border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
          >
            Reassign
          </button>
        }
      />

      {reassignOpen && (
        <ReassignDialog appt={appt} onClose={() => setReassignOpen(false)} />
      )}
    </CardFrame>
  )
}

function InCabinCard({ appt }: { appt: Appointment }) {
  const elapsed = getElapsedMinutes(appt.status_updated_at ?? appt.created_at)

  return (
    <CardFrame
      appt={appt}
      meta={elapsed !== null ? <span>In cabin · {elapsed} min</span> : undefined}
    >
      <CancelConsultationForm
        appt={appt}
        leading={
          <>
            <span className="inline-flex items-center rounded-full border border-consult-200 bg-consult-100 px-2 py-0.5 text-xs font-semibold text-consult-900">
              Consultation in progress
            </span>
            <span className="text-xs text-neutral-600">Completed by doctor</span>
          </>
        }
      />
    </CardFrame>
  )
}

function CompletedCard({ appt }: { appt: Appointment }) {
  return (
    <CardFrame appt={appt}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-900">
          Ready for checkout
        </span>
        <Link
          to={`/reception/billing?appointment_id=${appt.id}&patient_id=${appt.patient_id}`}
          className="inline-flex min-h-9 items-center rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
        >
          Collect payment →
        </Link>
      </div>
    </CardFrame>
  )
}

function ReassignDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const queryClient = useQueryClient()
  const doctors = useDoctors(true)
  const reassign = useReassignAppointment()
  const [targetDoctorId, setTargetDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targetId = targetDoctorId ? Number(targetDoctorId) : null
  const targetDepartments = useDoctorDepartments(targetId)
  const sameDepartment =
    targetDepartments.data?.some((d) => d.id === appt.department_id) ?? false
  const needsDepartment = targetId !== null && targetDepartments.isSuccess && !sameDepartment

  const candidates = (doctors.data ?? []).filter((d) => d.id !== appt.doctor_id && d.is_active)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (targetId === null) {
      setError('Choose the doctor to move the patient to.')
      return
    }
    if (needsDepartment && !departmentId) {
      setError('Choose one of this doctor’s departments.')
      return
    }
    const text = reason.trim()
    if (text.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setError(null)
    reassign.mutate(
      {
        id: appt.id,
        body: {
          version_id: appt.version_id,
          new_doctor_id: targetId,
          new_department_id: needsDepartment ? Number(departmentId) : null,
          reason: text,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'department_required') {
            setError('Choose one of this doctor’s departments.')
          } else if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
            void queryClient.invalidateQueries({ queryKey: ['appointments'] })
            setError('This patient was updated by someone else. The queue has refreshed; check it and try again.')
          } else {
            setError('Could not move the patient. The consultation is still waiting. Try again.')
          }
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reassign ${formatToken(appt.token_number)} (${appt.patient_name})?`}
      description={`The old token stays in history. The patient gets a new token from the new doctor's sequence.`}
      variant="warning"
      dismiss="none"
      busy={reassign.isPending}
      className="max-w-md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold text-neutral-700">
          Move to doctor
          <select
            value={targetDoctorId}
            onChange={(e) => {
              setTargetDoctorId(e.target.value)
              setDepartmentId('')
            }}
            className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Choose a doctor</option>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>{d.name_en}</option>
            ))}
          </select>
        </label>

        {needsDepartment && (
          <label className="block text-sm font-semibold text-neutral-700">
            Department for this consultation
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
            >
              <option value="">Choose a department</option>
              {(targetDepartments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm font-semibold text-neutral-700">
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 px-3 text-sm"
          />
        </label>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-4 text-sm font-semibold"
          >
            Keep with current doctor
          </button>
          <button
            type="submit"
            disabled={reassign.isPending}
            className="min-h-[44px] rounded-md bg-danger-600 px-4 text-sm font-semibold text-white disabled:opacity-70"
          >
            {reassign.isPending ? 'Reassigning…' : 'Reassign & issue new token'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
