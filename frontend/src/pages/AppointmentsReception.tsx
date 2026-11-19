import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { TableSkeleton } from '../components/AdminSkeleton'
import { ConflictBanner } from '../components/ConflictBanner'
import { Modal } from '../components/Modal'
import { toast } from '../components/ToastHost'
import { CreateOpdTokenModal } from '../components/checkin/CreateOpdTokenModal'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { PriorityModal } from '../components/checkin/PriorityModal'
import { ReassignModal } from '../components/checkin/ReassignModal'
import {
  AppointmentStatusBadge,
  parsePositiveIntParam,
  useDebouncedValue,
  useIstToday,
} from '../components/reception/AppointmentStatusBadge'
import { useHealth } from '../api/health'
import {
  useAppointments,
  useBookFollowUp,
  useCancelOpdArrival,
  useCloseFollowUp,
  useConsultingDoctors,
  useDoctors,
  useMe,
  useOpdArrivals,
  usePrescriptionFollowUps,
  useReceptionFollowUps,
  useRescheduleAppointment,
  useUpdateAppointmentStatus,
} from '../api/queries'
import type {
  Appointment,
  AppointmentStatus,
  DoctorOut,
  FollowUpBookRequest,
  OpdArrival,
  ReceptionFollowUpResponse,
} from '../api/types'
import { formatToken, istToday } from '../format'
import { ApiError, isVersionConflict } from '../api/client'
import { IconSearch, IconTicket } from '../components/icons'

const PAGE_SIZE = 100

type FollowUpWindow = 'all' | 'today' | 'week' | 'overdue'
type ClinicalFollowUpFilter = 'pending' | 'overdue' | 'booked' | 'closed' | 'all'
export type AppointmentBucket =
  | 'to_arrive'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'rescheduled'
type StatusView =
  | 'active'
  | 'to_arrive'
  | 'checked_in'
  | 'completed'
  | 'no_show'
  | 'cancelled'
  | 'all'
type SortBy = 'token' | 'time'
type LifecycleStatus =
  | 'BOOKED'
  | 'TO_ARRIVE'
  | 'ARRIVED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED'
  | 'RESCHEDULED'

type QueueRow = { key: string; appointment: Appointment; pendingArrival?: OpdArrival }

type CancelTarget =
  | { kind: 'appointment'; appointment: Appointment }
  | { kind: 'arrival'; arrival: OpdArrival }

const IST_TIME_HM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function formatAppointmentTime(appt: Appointment): string {
  if (appt.expected_time) {
    return appt.expected_time.slice(0, 5)
  }
  if (appt.check_in_at) {
    const parsed = new Date(appt.check_in_at)
    if (!Number.isNaN(parsed.getTime())) {
      return IST_TIME_HM.format(parsed)
    }
  }
  return '—'
}

export function isCancelled(a: Appointment): boolean {
  return a.status === 'CANCELLED' || a.consultation_status === 'CANCELLED'
}

/** Mutually exclusive canonical row classifier shared by pills, table filter, and fallback counts. */
export function classifyAppointmentBucket(
  a: Appointment,
  pendingArrival?: OpdArrival,
): AppointmentBucket {
  if (pendingArrival != null) {
    return pendingArrival.status === 'CANCELLED' ? 'cancelled' : 'to_arrive'
  }
  if (isCancelled(a)) return 'cancelled'
  if (a.status === 'RESCHEDULED') return 'rescheduled'
  if (
    a.status === 'DONE' ||
    a.status === 'COMPLETED' ||
    a.consultation_status === 'COMPLETED'
  ) {
    return 'completed'
  }
  if (a.status === 'NO_SHOW') return 'no_show'
  if (
    a.status === 'ARRIVED' ||
    a.status === 'CHECKED_IN' ||
    a.status === 'WAITING' ||
    a.status === 'IN_CONSULTATION' ||
    a.consultation_status === 'WAITING' ||
    a.consultation_status === 'IN_CONSULTATION'
  ) {
    return 'checked_in'
  }
  return 'to_arrive'
}

export function isCheckedIn(a: Appointment, pendingArrival?: OpdArrival): boolean {
  return classifyAppointmentBucket(a, pendingArrival) === 'checked_in'
}

export function isAwaitingArrival(a: Appointment, pendingArrival?: OpdArrival): boolean {
  return classifyAppointmentBucket(a, pendingArrival) === 'to_arrive'
}

function matchesStatusView(bucket: AppointmentBucket, view: StatusView): boolean {
  if (view === 'all') return true
  if (view === 'active') return bucket === 'to_arrive' || bucket === 'checked_in'
  return bucket === view
}

function matchesRowSearch(
  a: Appointment,
  q: string,
  digitsOnly: boolean,
  doctorCabinMap: Map<number, string | null>,
): boolean {
  if (!q) return true
  if (a.patient_name.toLowerCase().includes(q)) return true
  if ((a.patient_urn ?? '').toLowerCase().includes(q)) return true
  if (a.patient_mobile.includes(q)) return true
  if (a.doctor_name_en.toLowerCase().includes(q)) return true
  if (a.token_number != null) {
    if (String(a.token_number) === q || `#${a.token_number}` === q) return true
    if (!digitsOnly) {
      const formatted = formatToken(a.token_number, doctorCabinMap.get(a.doctor_id)).toLowerCase()
      if (formatted.includes(q)) return true
    }
  }
  return false
}

function arrivalAsAppointment(arrival: OpdArrival): Appointment {
  return {
    id: -arrival.id,
    patient_id: -arrival.id,
    patient_urn: '',
    patient_name: arrival.full_name,
    patient_mobile: arrival.mobile,
    patient_age: arrival.age_years,
    doctor_id: arrival.doctor_id,
    department_id: arrival.department_id,
    department_name: arrival.department_name,
    doctor_name_en: arrival.doctor_name_en,
    doctor_name_hi: null,
    appointment_date: arrival.appointment_date,
    token_number: arrival.token_number,
    status: arrival.status === 'CANCELLED' ? 'CANCELLED' : 'TO_ARRIVE',
    status_updated_at: arrival.created_at,
    check_in_at: null,
    cancellation_reason: arrival.cancellation_reason ?? null,
    notes: null,
    source: 'WALK_IN',
    expected_time: null,
    visit_id: null,
    consultation_status: arrival.status === 'CANCELLED' ? 'CANCELLED' : null,
    rescheduled_from_id: null,
    visit_kind: 'NEW',
    priority_level: arrival.priority_level,
    priority_reason: arrival.priority_reason ?? null,
    version_id: arrival.version_id,
    created_at: arrival.created_at,
    updated_at: arrival.created_at,
  }
}

function lifecycleStatus(appt: Appointment, pendingArrival?: OpdArrival): LifecycleStatus {
  if (pendingArrival != null) {
    return pendingArrival.status === 'CANCELLED' ? 'CANCELLED' : 'TO_ARRIVE'
  }
  if (isCancelled(appt)) return 'CANCELLED'
  if (appt.status === 'RESCHEDULED') return 'RESCHEDULED'
  if (appt.status === 'NO_SHOW') return 'NO_SHOW'
  if (
    appt.status === 'DONE' ||
    appt.status === 'COMPLETED' ||
    appt.consultation_status === 'COMPLETED'
  ) {
    return 'COMPLETED'
  }
  if (
    appt.status === 'CHECKED_IN' ||
    appt.status === 'WAITING' ||
    appt.status === 'IN_CONSULTATION' ||
    appt.consultation_status === 'IN_CONSULTATION' ||
    (appt.status === 'ARRIVED' && appt.consultation_status != null)
  ) {
    return 'CHECKED_IN'
  }
  if (appt.status === 'ARRIVED') return 'ARRIVED'
  if (appt.status === 'TO_ARRIVE') return 'TO_ARRIVE'
  return 'BOOKED'
}

const SECONDARY_BUTTON =
  'min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'

function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return isoDate
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function formatIsoDateIn(isoDate: string): string {
  if (!isoDate) return '—'
  const d = new Date(`${isoDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return isoDate
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function BookFollowUpModal({
  item,
  today,
  onClose,
}: {
  item: ReceptionFollowUpResponse
  today: string
  onClose: () => void
}) {
  const defaultDate = item.recommended_date >= today ? item.recommended_date : today
  const [appointmentDate, setAppointmentDate] = useState(defaultDate)
  const [notes, setNotes] = useState('')
  const [needsOverride, setNeedsOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const bookMutation = useBookFollowUp()
  const inFlightRef = useRef(false)
  const busy = bookMutation.isPending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current || busy) return
    if (needsOverride && overrideReason.trim().length < 5) {
      setErrorMsg('Please enter an override reason of at least 5 characters.')
      return
    }
    inFlightRef.current = true
    setErrorMsg(null)
    try {
      const body: FollowUpBookRequest = {
        appointment_date: appointmentDate || null,
        notes: notes.trim() || null,
      }
      if (needsOverride && overrideReason.trim()) {
        body.override_reason = overrideReason.trim()
      }
      await bookMutation.mutateAsync({ id: item.id, body })
      toast.success(
        `Booked follow-up appointment for ${item.patient_name} on ${appointmentDate || item.recommended_date}.`,
      )
      onClose()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'duplicate_appointment') {
        setNeedsOverride(true)
      }
      setErrorMsg(err instanceof Error ? err.message : 'Failed to book follow-up appointment.')
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <Modal
      open
      variant="info"
      title="Book Follow-up Appointment"
      onClose={onClose}
      busy={busy}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-600">
          Schedule {item.patient_name} ({item.patient_urn}) with {item.recommended_doctor_name}.
          Recommended date: {formatIsoDateIn(item.recommended_date)}.
        </p>
        {errorMsg && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <div>
          <label htmlFor="followup-book-date" className="mb-1 block text-xs font-semibold text-slate-700">
            Appointment date
          </label>
          <input
            id="followup-book-date"
            data-autofocus
            type="date"
            value={appointmentDate}
            disabled={busy}
            onChange={(e) => setAppointmentDate(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        <div>
          <label htmlFor="followup-book-notes" className="mb-1 block text-xs font-semibold text-slate-700">
            Notes (optional)
          </label>
          <textarea
            id="followup-book-notes"
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional scheduling notes for reception…"
            rows={2}
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        {needsOverride && (
          <div>
            <label htmlFor="followup-book-override" className="mb-1 block text-xs font-semibold text-slate-700">
              Override reason *
            </label>
            <input
              id="followup-book-override"
              type="text"
              value={overrideReason}
              disabled={busy}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="At least 5 characters to override duplicate booking"
              minLength={5}
              required
              className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
            />
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!appointmentDate || busy || (needsOverride && overrideReason.trim().length < 5)}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            {busy ? 'Booking…' : 'Confirm Booking'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function CloseFollowUpModal({
  item,
  onClose,
}: {
  item: ReceptionFollowUpResponse
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const closeMutation = useCloseFollowUp()
  const inFlightRef = useRef(false)
  const busy = closeMutation.isPending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current || busy) return
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setErrorMsg('Please enter at least 3 characters for the closure reason.')
      return
    }
    inFlightRef.current = true
    setErrorMsg(null)
    try {
      await closeMutation.mutateAsync({ id: item.id, body: { reason: trimmed } })
      toast.success(`Closed follow-up recommendation for ${item.patient_name}.`)
      onClose()
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to close follow-up recommendation.')
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <Modal
      open
      variant="destructive"
      title="Close Follow-up Recommendation"
      onClose={onClose}
      busy={busy}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-600">
          Close unbooked follow-up for {item.patient_name} ({item.patient_urn}), recommended for{' '}
          {formatIsoDateIn(item.recommended_date)}.
        </p>
        {errorMsg && (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <div>
          <label htmlFor="followup-close-reason" className="mb-1 block text-xs font-semibold text-slate-700">
            Closure reason *
          </label>
          <textarea
            id="followup-close-reason"
            data-autofocus
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Patient declined follow-up or already seen elsewhere…"
            rows={3}
            minLength={3}
            required
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Keep open
          </button>
          <button
            type="submit"
            disabled={reason.trim().length < 3 || busy}
            className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
          >
            {busy ? 'Closing…' : 'Confirm Close'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ReceptionFollowUpsQueue({ mode }: { mode: 'reception' | 'admin' | 'doctor' }) {
  const [filter, setFilter] = useState<ClinicalFollowUpFilter>('pending')
  const [bookingTarget, setBookingTarget] = useState<ReceptionFollowUpResponse | null>(null)
  const [closingTarget, setClosingTarget] = useState<ReceptionFollowUpResponse | null>(null)
  const today = useIstToday()

  const canBook = mode === 'reception'
  const canClose = mode === 'reception' || mode === 'doctor'

  const queryParams =
    filter === 'pending'
      ? { status: 'PENDING' }
      : filter === 'overdue'
        ? { overdue: true }
        : filter === 'booked'
          ? { status: 'BOOKED' }
          : filter === 'closed'
            ? { status: 'CLOSED' }
            : undefined

  const { data, isPending, isFetching, isError, error, refetch } = useReceptionFollowUps(queryParams, true)
  const items = data ?? []

  const filterButtons: { key: ClinicalFollowUpFilter; label: string }[] = [
    { key: 'pending', label: 'Pending' },
    { key: 'overdue', label: 'Overdue' },
    { key: 'booked', label: 'Booked' },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
  ]

  const heading =
    mode === 'doctor' ? 'Clinical Follow-up Recommendations' : 'Follow-up Recommendations'
  const description =
    mode === 'doctor'
      ? 'Follow-up dates recommended during your consultations. Reception books the appointment; you can close unbooked pending recommendations.'
      : 'Doctor-recommended follow-up dates ready for scheduling. Clinical remarks remain private to the treating doctor.'

  return (
    <section className="space-y-4" aria-labelledby="clinical-followups-heading">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 id="clinical-followups-heading" className="text-lg font-bold text-slate-900">
            {heading}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div role="group" aria-label="Follow-up recommendation status filters" className="flex flex-wrap gap-2">
        {filterButtons.map((btn) => (
          <button
            key={btn.key}
            type="button"
            aria-pressed={filter === btn.key}
            onClick={() => setFilter(btn.key)}
            className={[
              'min-h-10 rounded-full border px-4 text-sm font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
              filter === btn.key
                ? 'border-brand-700 bg-brand-700 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-brand-700 hover:text-brand-800',
            ].join(' ')}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {isPending ? (
        <TableSkeleton label="Loading follow-up recommendations…" rows={5} columns={5} />
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
          Unable to load follow-up recommendations: {error.message}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
          <p className="font-semibold text-slate-800">No follow-up recommendations in this view</p>
          <p className="mt-1.5 text-sm text-slate-600">
            Follow-up recommendations appear here once a doctor records a target follow-up date during a consultation.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-bold text-slate-900">Recommendations queue</h3>
            <span className="text-xs font-medium text-slate-600 tabular-nums">
              {items.length} record{items.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="px-4 py-3">Recommended Date</th>
                  <th scope="col" className="px-4 py-3">Patient</th>
                  <th scope="col" className="px-4 py-3">Doctor</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((item) => {
                  const isPendingStatus = item.status === 'PENDING'
                  const isOverdue = isPendingStatus && item.recommended_date < today
                  const statusLabel =
                    item.status === 'BOOKED'
                      ? 'Booked'
                      : item.status === 'CLOSED'
                        ? 'Closed'
                        : isOverdue
                          ? 'Overdue'
                          : 'Pending'
                  const statusClass =
                    item.status === 'BOOKED'
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                      : item.status === 'CLOSED'
                        ? 'bg-slate-100 text-slate-700 ring-slate-200'
                        : isOverdue
                          ? 'bg-red-50 text-red-800 ring-red-200'
                          : 'bg-amber-50 text-amber-800 ring-amber-200'

                  return (
                    <tr key={item.id} className="hover:bg-slate-50 transition-colors duration-150">
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800 tabular-nums">
                        {formatIsoDateIn(item.recommended_date)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/reception/patients/${item.patient_id}`}
                          className="font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                        >
                          {item.patient_name}
                        </Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-600">
                          <span className="font-mono">{item.patient_urn}</span>
                          {item.patient_mobile && (
                            <span className="tabular-nums">{item.patient_mobile}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {item.recommended_doctor_name}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${statusClass}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!canBook && !canClose ? (
                          <span className="text-xs font-medium text-slate-600">View only</span>
                        ) : isPendingStatus ? (
                          <div className="flex items-center justify-end gap-2">
                            {canBook && (
                              <button
                                type="button"
                                onClick={() => setBookingTarget(item)}
                                className="inline-flex min-h-9 items-center rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white hover:bg-brand-800 transition-colors cursor-pointer"
                              >
                                Book Appointment
                              </button>
                            )}
                            {canClose && (
                              <button
                                type="button"
                                onClick={() => setClosingTarget(item)}
                                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-red-300 hover:bg-red-50 hover:text-red-800 transition-colors cursor-pointer"
                              >
                                Close
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {canBook && bookingTarget && (
        <BookFollowUpModal
          item={bookingTarget}
          today={today}
          onClose={() => setBookingTarget(null)}
        />
      )}

      {canClose && closingTarget && (
        <CloseFollowUpModal
          item={closingTarget}
          onClose={() => setClosingTarget(null)}
        />
      )}
    </section>
  )
}

function FollowUpVisits({ isDoctor }: { isDoctor: boolean }) {
  const [selectedWindow, setSelectedWindow] = useState<FollowUpWindow>('all')
  const today = istToday()

  const dateRange =
    selectedWindow === 'today'
      ? { date_from: today, date_to: today }
      : selectedWindow === 'week'
        ? { date_from: today, date_to: shiftIsoDate(today, 6) }
        : selectedWindow === 'overdue'
          ? { date_to: shiftIsoDate(today, -1) }
          : undefined

  // GET /api/prescriptions/follow-ups is DOCTOR-only; strictly gate on isDoctor.
  const { data, isPending, isError, error, refetch } = usePrescriptionFollowUps(dateRange, isDoctor)
  const followUps = data ?? []

  const windows: { key: FollowUpWindow; label: string }[] = [
    { key: 'all', label: 'All Follow-ups' },
    { key: 'today', label: 'Due Today' },
    { key: 'week', label: 'Next 7 Days' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <div className="space-y-8">
      <ReceptionFollowUpsQueue mode="doctor" />

      <section className="space-y-4" aria-labelledby="followups-heading">
        <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 id="followups-heading" className="text-lg font-bold text-slate-900">
              Prescription return dates
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">
              Return dates recorded on your authorised prescriptions. These are clinical follow-up
              reminders, not booked appointment tokens.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            Refresh
          </button>
        </div>

        <div className="flex flex-wrap gap-2" aria-label="Follow-up date filters">
          {windows.map((window) => (
            <button
              key={window.key}
              type="button"
              aria-pressed={selectedWindow === window.key}
              onClick={() => setSelectedWindow(window.key)}
              className={[
                'min-h-11 rounded-full border px-4 text-sm font-semibold transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
                selectedWindow === window.key
                  ? 'border-brand-700 bg-brand-700 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-brand-700 hover:text-brand-800',
              ].join(' ')}
            >
              {window.label}
            </button>
          ))}
        </div>

        {isPending ? (
          <TableSkeleton label="Loading prescription follow-ups…" rows={5} columns={6} />
        ) : isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-900" role="alert">
            Unable to load follow-ups: {error.message}
          </div>
        ) : followUps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center">
            <p className="font-semibold text-slate-800">No follow-ups in this date range</p>
            <p className="mt-2 text-sm text-slate-600">
              Follow-up dates are added when a prescription is authorised. Only prescriptions authored by your account are shown.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
              <h3 className="text-sm font-bold text-slate-900">Prescription follow-up list</h3>
              <span className="text-xs font-medium text-slate-600 tabular-nums">
                {followUps.length} record{followUps.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-3">Follow-up date</th>
                    <th scope="col" className="px-4 py-3">Patient</th>
                    <th scope="col" className="px-4 py-3">Diagnosis</th>
                    <th scope="col" className="px-4 py-3">Prescription</th>
                    <th scope="col" className="px-4 py-3">Status</th>
                    <th scope="col" className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {followUps.map((item) => {
                    const date = item.follow_up_date || ''
                    const overdue = date < today
                    const dueToday = date === today
                    const status = overdue ? 'Overdue' : dueToday ? 'Due today' : 'Upcoming'
                    const statusClass = overdue
                      ? 'bg-red-50 text-red-800 ring-red-200'
                      : dueToday
                        ? 'bg-amber-50 text-amber-800 ring-amber-200'
                        : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors duration-150">
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800 tabular-nums">
                          {formatIsoDateIn(date)}
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            to={`/reception/patients/${item.patient_id}`}
                            className="font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                          >
                            {item.patient_name}
                          </Link>
                          <span className="mt-0.5 block font-mono text-xs text-slate-600">{item.patient_urn}</span>
                        </td>
                        <td className="max-w-sm px-4 py-3 text-slate-700">{item.diagnosis}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 tabular-nums">
                          Rx #{item.id}
                          <span className="ml-2 text-xs text-slate-600">
                            · {item.items_count} item{item.items_count === 1 ? '' : 's'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${statusClass}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/reception/patients/${item.patient_id}`}
                            className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-brand-700 hover:text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
                          >
                            Open patient
                          </Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

type MenuItem = {
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** Row action controls: at most 1 primary CTA plus a viewport-positioned More menu. */
function RowActions({
  appt,
  pendingArrival,
  today,
  isReception,
  canManageAppointments,
  canCheckIn,
  canCreateArrival,
  busy,
  menuOpen,
  onMenuOpenChange,
  onCheckIn,
  onRegisterArrival,
  onRegisterPatient,
  onChangePriority,
  onTransferDoctor,
  onReschedule,
  onMarkNoShow,
  onCancel,
}: {
  appt: Appointment
  pendingArrival?: OpdArrival
  today: string
  isReception: boolean
  canManageAppointments: boolean
  canCheckIn: boolean
  canCreateArrival: boolean
  busy: boolean
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onCheckIn: () => void
  onRegisterArrival: () => void
  onRegisterPatient: () => void
  onChangePriority: (trigger: HTMLButtonElement | null) => void
  onTransferDoctor: () => void
  onReschedule: () => void
  onMarkNoShow: () => void
  onCancel: () => void
}) {
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  const bucket = classifyAppointmentBucket(appt, pendingArrival)
  const cancelled = isCancelled(appt)

  const primaryCta = (() => {
    if (!isReception || appt.appointment_date !== today) return null
    if (bucket !== 'to_arrive' && appt.status !== 'NO_SHOW') return null
    if (pendingArrival != null) {
      return canCreateArrival ? { label: 'Register', onClick: onRegisterArrival } : null
    }
    if (
      appt.status === 'BOOKED' ||
      appt.status === 'NO_SHOW' ||
      appt.status === 'REGISTERED' ||
      (appt.status === 'TO_ARRIVE' && Boolean(appt.patient_urn))
    ) {
      return canCheckIn ? { label: 'Check in', onClick: onCheckIn } : null
    }
    if (appt.status === 'TO_ARRIVE' && !appt.patient_urn) {
      return canCreateArrival ? { label: 'Register', onClick: onRegisterPatient } : null
    }
    return null
  })()

  const menuItems: MenuItem[] = []
  const canChangeArrivalPriority =
    pendingArrival != null &&
    pendingArrival.status === 'TO_ARRIVE' &&
    pendingArrival.appointment_date === today &&
    canManageAppointments
  const canChangeApptPriority =
    !pendingArrival &&
    !cancelled &&
    (appt.consultation_status === 'WAITING' || appt.consultation_status === 'IN_CONSULTATION') &&
    canCheckIn
  if (canChangeArrivalPriority || canChangeApptPriority) {
    menuItems.push({
      label: 'Change priority',
      onSelect: () => onChangePriority(moreButtonRef.current),
    })
  }
  const canTransferDoctor =
    isReception &&
    canCheckIn &&
    !pendingArrival &&
    !cancelled &&
    (appt.status === 'ARRIVED' || appt.status === 'CHECKED_IN' || appt.status === 'WAITING') &&
    appt.consultation_status === 'WAITING'
  if (canTransferDoctor) {
    menuItems.push({ label: 'Transfer doctor', onSelect: onTransferDoctor })
  }
  if (
    !pendingArrival &&
    isReception &&
    (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE' || appt.status === 'NO_SHOW')
  ) {
    menuItems.push({ label: 'Reschedule', onSelect: onReschedule })
  }
  if (
    !pendingArrival &&
    canManageAppointments &&
    appt.appointment_date <= today &&
    (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE')
  ) {
    menuItems.push({ label: 'No-Show', disabled: busy, onSelect: onMarkNoShow })
  }
  if (pendingArrival != null && pendingArrival.status === 'TO_ARRIVE' && canManageAppointments) {
    menuItems.push({ label: 'Cancel arrival', danger: true, onSelect: onCancel })
  }
  if (
    !pendingArrival &&
    ((canManageAppointments &&
      (appt.status === 'BOOKED' || appt.status === 'TO_ARRIVE' || appt.status === 'REGISTERED')) ||
      (isReception &&
        (appt.status === 'ARRIVED' || appt.status === 'CHECKED_IN' || appt.status === 'WAITING') &&
        appt.consultation_status === 'WAITING'))
  ) {
    menuItems.push({ label: 'Cancel booking', danger: true, onSelect: onCancel })
  }

  useLayoutEffect(() => {
    if (!menuOpen || !moreButtonRef.current) return
    const rect = moreButtonRef.current.getBoundingClientRect()
    const menuWidth = 160
    const estimatedHeight = menuItems.length * 36 + 12
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow
    const top = openUp ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
    setMenuPos({ top, left })
  }, [menuOpen, menuItems.length])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuContainerRef.current?.contains(e.target as Node)) {
        onMenuOpenChange(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onMenuOpenChange(false)
        moreButtonRef.current?.focus()
      }
    }
    const onScrollOrResize = () => {
      onMenuOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [menuOpen, onMenuOpenChange])

  if (!primaryCta && menuItems.length === 0) {
    return <span className="text-xs text-slate-500">—</span>
  }

  return (
    <div className="flex flex-wrap items-center justify-start gap-1.5 md:justify-end">
      {primaryCta && (
        <button
          type="button"
          onClick={primaryCta.onClick}
          className="inline-flex min-h-9 items-center whitespace-nowrap rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white shadow-2xs hover:bg-brand-800 transition-colors cursor-pointer"
        >
          {primaryCta.label}
        </button>
      )}
      {menuItems.length > 0 && (
        <div ref={menuContainerRef} className="relative">
          <button
            ref={moreButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => onMenuOpenChange(!menuOpen)}
            className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-brand-700 hover:text-brand-800 transition-colors cursor-pointer"
          >
            More
          </button>
          {menuOpen && (
            <div
              role="menu"
              style={
                menuPos
                  ? { position: 'fixed', top: menuPos.top, left: menuPos.left }
                  : { position: 'fixed' }
              }
              className="z-50 flex min-w-[9.5rem] flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
            >
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    onMenuOpenChange(false)
                    item.onSelect()
                  }}
                  className={`min-h-8 w-full rounded-md px-2.5 py-1 text-left text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer ${
                    item.danger
                      ? 'text-red-700 hover:bg-red-50'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-brand-800'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RescheduleModal({
  appt,
  onClose,
  onConflict,
}: {
  appt: Appointment
  onClose: () => void
  onConflict: () => void
}) {
  const today = useIstToday()
  const requiresTomorrowMin = appt.status !== 'BOOKED' && appt.appointment_date === today
  const minDate = requiresTomorrowMin ? shiftIsoDate(today, 1) : today
  const [date, setDate] = useState(() =>
    appt.appointment_date >= minDate ? appt.appointment_date : minDate,
  )
  const [time, setTime] = useState(() => appt.expected_time?.slice(0, 5) ?? '')
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const rescheduleMutation = useRescheduleAppointment()
  const inFlightRef = useRef(false)
  const busy = rescheduleMutation.isPending

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!date || inFlightRef.current || rescheduleMutation.isPending) return
    inFlightRef.current = true
    setErrorMsg(null)
    try {
      await rescheduleMutation.mutateAsync({
        id: appt.id,
        body: {
          version_id: appt.version_id,
          appointment_date: date,
          expected_time: time ? (time.length === 5 ? `${time}:00` : time) : null,
          reason: reason.trim() || null,
        },
      })
      toast.success(`Rescheduled ${appt.patient_name}'s appointment to ${date}.`)
      onClose()
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        onConflict()
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to reschedule appointment.')
      }
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <Modal
      open
      variant="info"
      title="Reschedule Appointment"
      onClose={onClose}
      busy={busy}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-slate-600">
          Move {appt.patient_name}&apos;s booking (currently {appt.appointment_date}
          {appt.expected_time ? ` · ${appt.expected_time.slice(0, 5)}` : ''}) to another date or time.
        </p>
        {appt.status !== 'BOOKED' && (
          <p className="text-xs font-medium text-amber-800">
            Choose a future date to reschedule this booking.
          </p>
        )}
        {errorMsg && (
          <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        )}
        <div>
          <label htmlFor="reschedule-date" className="mb-1 block text-xs font-semibold text-slate-700">
            New date *
          </label>
          <input
            id="reschedule-date"
            data-autofocus
            type="date"
            min={minDate}
            value={date}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
            required
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        <div>
          <label htmlFor="reschedule-time" className="mb-1 block text-xs font-semibold text-slate-700">
            Expected time (optional)
          </label>
          <input
            id="reschedule-time"
            type="time"
            value={time}
            disabled={busy}
            onChange={(e) => setTime(e.target.value)}
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        <div>
          <label htmlFor="reschedule-reason" className="mb-1 block text-xs font-semibold text-slate-700">
            Reason (optional)
          </label>
          <input
            id="reschedule-reason"
            type="text"
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Patient requested another day"
            className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Keep current date
          </button>
          <button
            type="submit"
            disabled={!date || busy}
            className="rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
          >
            Confirm Reschedule
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function AppointmentsReception() {
  const { data: me } = useMe()
  const isDoctor = me?.role === 'DOCTOR'
  const isReception = me?.role === 'RECEPTION'
  const permissions = me?.permissions ?? []
  const canManageAppointments = permissions.includes('appointment:write')
  const canCheckIn = permissions.includes('visit:write')
  const canCreateArrival =
    permissions.includes('patient:create') && permissions.includes('appointment:write')
  const canReadFollowUps = permissions.includes('appointment:read')
  const canViewFollowUps = canReadFollowUps || isDoctor
  const canOpenTokenModal =
    isReception && (canCheckIn || canCreateArrival || canManageAppointments)
  const canActOnRows = canManageAppointments || canCheckIn || canCreateArrival

  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  // Reception & Admin default to Appointments (tab=today) and can switch to Follow-ups.
  // Doctors default to Follow-ups (tab=followup) and can switch to Schedule (tab=today).
  const activeTab: 'today' | 'followup' =
    canViewFollowUps && (requestedTab === 'followup' || (isDoctor && requestedTab !== 'today')) ? 'followup' : 'today'
  const selectTab = (tab: 'today' | 'followup') => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('tab', tab)
        return next
      },
      { replace: true },
    )
  }
  const todayLabel = isDoctor ? 'Schedule' : 'Appointments'
  const pageTitle = activeTab === 'followup' ? 'Follow-ups' : todayLabel
  const pageDescription =
    activeTab === 'followup'
      ? isDoctor
        ? 'Clinical follow-up recommendations and return dates recorded on your authorised prescriptions.'
        : 'Doctor-recommended follow-up dates ready for appointment scheduling.'
      : isDoctor
        ? 'Your scheduled bookings by date. Your live queue for today is on My Queue.'
        : 'Check in patients, issue OPD tokens, and manage bookings by date and doctor. Live queue is managed in Waiting Room.'

  const locationNotice = (location.state as { notice?: string } | null)?.notice
  useEffect(() => {
    if (locationNotice) {
      toast.success(locationNotice)
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [locationNotice, location.pathname, location.search, navigate])

  const today = useIstToday()
  const prevTodayRef = useRef(today)
  const [selectedDate, setSelectedDate] = useState(today)
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search.trim(), 250)
  const [statusView, setStatusView] = useState<StatusView>('active')
  const [sortBy, setSortBy] = useState<SortBy>('token')
  const [offset, setOffset] = useState(0)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const [modalBooking, setModalBooking] = useState<Appointment | null>(null)
  const [priorityTarget, setPriorityTarget] = useState<QueueRow | null>(null)
  const priorityTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [reassigningAppt, setReassigningAppt] = useState<Appointment | null>(null)
  const [reschedulingAppt, setReschedulingAppt] = useState<Appointment | null>(null)
  const [emergencyHold, setEmergencyHold] = useState(false)
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)

  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])
  const health = useHealth(15000)
  const isDisconnected = !isOnline || health.isError

  const isPastDate = selectedDate < today
  const isFutureDate = selectedDate > today

  const selectDate = (nextDate: string) => {
    setSelectedDate(nextDate)
    setOffset(0)
  }
  const selectDoctor = (nextDoctorId: number | undefined) => {
    setSelectedDoctorId(nextDoctorId)
    setOffset(0)
  }
  const selectStatusView = (nextView: StatusView) => {
    setStatusView(nextView)
    setOffset(0)
  }
  const selectSortBy = (nextSort: SortBy) => {
    setSortBy(nextSort)
    setOffset(0)
  }

  const presetPatientId = parsePositiveIntParam(searchParams.get('patient_id'))
  const presetAppointmentId = parsePositiveIntParam(searchParams.get('appointment_id'))
  const openTokenParam = searchParams.get('action') === 'token'
  const hasDeepLink = presetPatientId != null || presetAppointmentId != null || openTokenParam
  const [deepLinkConsumed, setDeepLinkConsumed] = useState(false)

  const clearDeepLinkParams = () => {
    if (
      !searchParams.has('patient_id') &&
      !searchParams.has('appointment_id') &&
      !searchParams.has('action')
    ) {
      return
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('patient_id')
        next.delete('appointment_id')
        next.delete('action')
        return next
      },
      { replace: true },
    )
  }

  useEffect(() => {
    if (isReception && hasDeepLink && !deepLinkConsumed) {
      setDeepLinkConsumed(true)
      setModalBooking(null)
      setTokenModalOpen(true)
    } else if (!hasDeepLink && deepLinkConsumed) {
      setDeepLinkConsumed(false)
    }
  }, [isReception, hasDeepLink, deepLinkConsumed])

  const openBlankTokenModal = () => {
    setModalBooking(null)
    setTokenModalOpen(true)
  }

  const openCheckInModal = (appt: Appointment) => {
    setModalBooking(appt)
    setTokenModalOpen(true)
  }

  const closeTokenModal = () => {
    setTokenModalOpen(false)
    setModalBooking(null)
    clearDeepLinkParams()
  }

  // Roll selectedDate across IST midnight only if the user stayed on the previous today
  useEffect(() => {
    if (prevTodayRef.current !== today) {
      const previousToday = prevTodayRef.current
      prevTodayRef.current = today
      setSelectedDate((current) => (current === previousToday ? today : current))
    }
  }, [today])

  // Doctors are strictly scoped to their own schedule (cross-doctor queries 403 scope_forbidden).
  const effectiveDoctorId = isDoctor ? (me?.doctor_id ?? undefined) : selectedDoctorId

  // Reset pagination whenever query filters or sort change
  useEffect(() => {
    setOffset(0)
  }, [selectedDate, effectiveDoctorId, debouncedSearch, sortBy, statusView])

  // Close any open row menu when filters, sort, or page change
  useEffect(() => {
    setOpenMenuKey(null)
  }, [statusView, selectedDate, effectiveDoctorId, search, sortBy, offset])

  // Cancel dialog state (supports both appointments and pending OPD arrivals)
  const [cancellingTarget, setCancellingTarget] = useState<CancelTarget | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelError, setCancelError] = useState<string | null>(null)
  const statusUpdateInFlightRef = useRef(false)

  const closeCancel = () => {
    setCancellingTarget(null)
    setCancelReason('')
    setCancelError(null)
  }

  const { data: doctors } = useDoctors(false)
  const { options: consultingDoctors } = useConsultingDoctors()
  const doctorCabinMap = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const o of consultingDoctors) {
      if (o.doctor.cabin_code) {
        map.set(o.doctor.id, o.doctor.cabin_code)
      }
    }
    return map
  }, [consultingDoctors])

  const {
    data: appointmentsData,
    isPending,
    isFetching,
    isError,
    error,
    refetch,
  } = useAppointments(
    {
      appointment_date: selectedDate,
      doctor_id: effectiveDoctorId,
      status_bucket: statusView,
      sort_by: sortBy,
      search: debouncedSearch || undefined,
      limit: PAGE_SIZE,
      offset,
    },
    { enabled: activeTab === 'today' && Boolean(me) },
  )

  const {
    data: arrivalsData,
    isLoading: arrivalsLoading,
    isFetching: arrivalsFetching,
    isError: arrivalsError,
    error: arrivalsErrorValue,
    refetch: refetchArrivals,
  } = useOpdArrivals(selectedDate, {
    enabled: activeTab === 'today' && isReception,
    doctor_id: effectiveDoctorId,
  })

  const updateStatusMutation = useUpdateAppointmentStatus()
  const cancelArrivalMutation = useCancelOpdArrival()
  const cancelBusy = updateStatusMutation.isPending || cancelArrivalMutation.isPending
  const isRefreshing = isFetching || (isReception && arrivalsFetching)

  const handleDateShift = (days: number) => {
    const base = selectedDate || today
    selectDate(shiftIsoDate(base, days))
  }

  const handleUpdateStatus = async (
    appt: Appointment,
    newStatus: AppointmentStatus,
    reason?: string,
  ) => {
    if (statusUpdateInFlightRef.current || updateStatusMutation.isPending) return
    statusUpdateInFlightRef.current = true
    const inCancelModal = newStatus === 'CANCELLED'
    setConflictError(null)
    if (inCancelModal) setCancelError(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: appt.id,
        body: {
          status: newStatus,
          version_id: appt.version_id,
          cancellation_reason: reason || null,
        },
      })
      if (inCancelModal) {
        closeCancel()
        toast.success(`Cancelled appointment for ${appt.patient_name}.`)
      } else if (newStatus === 'NO_SHOW') {
        toast.info(`Marked ${appt.patient_name} as No-Show.`)
      } else {
        toast.success(`Updated appointment status for ${appt.patient_name}.`)
      }
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        if (inCancelModal) closeCancel()
        setConflictError('Appointment was modified concurrently by another session.')
      } else if (inCancelModal) {
        setCancelError(err instanceof Error ? err.message : 'Failed to cancel appointment.')
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to update status.')
      }
    } finally {
      statusUpdateInFlightRef.current = false
    }
  }

  const handleCancelArrival = async (arrival: OpdArrival, reason: string) => {
    if (statusUpdateInFlightRef.current || cancelArrivalMutation.isPending) return
    statusUpdateInFlightRef.current = true
    setConflictError(null)
    setCancelError(null)
    try {
      await cancelArrivalMutation.mutateAsync({
        id: arrival.id,
        body: {
          version_id: arrival.version_id,
          reason,
        },
      })
      closeCancel()
      toast.success(`Cancelled arrival for ${arrival.full_name}.`)
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        closeCancel()
        setConflictError('Arrival was modified concurrently by another session.')
      } else {
        setCancelError(err instanceof Error ? err.message : 'Failed to cancel arrival.')
      }
    } finally {
      statusUpdateInFlightRef.current = false
    }
  }

  const appointments = useMemo(
    () => appointmentsData?.appointments ?? [],
    [appointmentsData],
  )
  const pendingArrivals = useMemo(() => {
    if (!isReception) return []
    const all = (arrivalsData?.arrivals ?? []).filter((a) => a.status !== 'REGISTERED')
    return selectedDoctorId != null
      ? all.filter((a) => a.doctor_id === selectedDoctorId)
      : all
  }, [isReception, arrivalsData, selectedDoctorId])

  const searchFilteredAppointments = useMemo<QueueRow[]>(() => {
    const q = search.trim().toLowerCase()
    const digitsOnly = /^\d+$/.test(q)
    const rows: QueueRow[] = appointments.map((appointment) => ({
      key: `appointment-${appointment.id}`,
      appointment,
    }))
    if (!q) return rows
    return rows.filter(({ appointment }) => matchesRowSearch(appointment, q, digitsOnly, doctorCabinMap))
  }, [appointments, search, doctorCabinMap])

  const searchFilteredArrivals = useMemo<QueueRow[]>(() => {
    const q = search.trim().toLowerCase()
    const digitsOnly = /^\d+$/.test(q)
    const rows: QueueRow[] = pendingArrivals.map((arrival) => ({
      key: `arrival-${arrival.id}`,
      pendingArrival: arrival,
      appointment: arrivalAsAppointment(arrival),
    }))
    if (!q) return rows
    return rows.filter(({ appointment }) => matchesRowSearch(appointment, q, digitsOnly, doctorCabinMap))
  }, [pendingArrivals, search, doctorCabinMap])

  const bucketCounts = useMemo(() => {
    let arrivalToArrive = 0
    let arrivalCancelled = 0
    for (const { pendingArrival } of searchFilteredArrivals) {
      if (pendingArrival?.status === 'CANCELLED') arrivalCancelled += 1
      else arrivalToArrive += 1
    }

    const serverCounts = appointmentsData?.bucket_counts
    if (serverCounts) {
      const to_arrive = serverCounts.to_arrive + arrivalToArrive
      const checked_in = serverCounts.checked_in
      const completed = serverCounts.completed
      const no_show = serverCounts.no_show
      const cancelled = serverCounts.cancelled + arrivalCancelled
      const active = to_arrive + checked_in
      const all = serverCounts.all + arrivalToArrive + arrivalCancelled
      return { active, to_arrive, checked_in, completed, no_show, cancelled, all }
    }

    let to_arrive = 0
    let checked_in = 0
    let completed = 0
    let no_show = 0
    let cancelled = 0
    let rescheduled = 0
    for (const { appointment, pendingArrival } of [
      ...searchFilteredAppointments,
      ...searchFilteredArrivals,
    ]) {
      const bucket = classifyAppointmentBucket(appointment, pendingArrival)
      if (bucket === 'to_arrive') to_arrive += 1
      else if (bucket === 'checked_in') checked_in += 1
      else if (bucket === 'completed') completed += 1
      else if (bucket === 'no_show') no_show += 1
      else if (bucket === 'cancelled') cancelled += 1
      else if (bucket === 'rescheduled') rescheduled += 1
    }
    const active = to_arrive + checked_in
    const all = to_arrive + checked_in + completed + no_show + cancelled + rescheduled
    return { active, to_arrive, checked_in, completed, no_show, cancelled, all }
  }, [appointmentsData?.bucket_counts, searchFilteredAppointments, searchFilteredArrivals])

  const visibleRows = useMemo(() => {
    const merged =
      offset === 0
        ? [...searchFilteredAppointments, ...searchFilteredArrivals]
        : searchFilteredAppointments
    const filtered = merged.filter(({ appointment, pendingArrival }) =>
      matchesStatusView(classifyAppointmentBucket(appointment, pendingArrival), statusView),
    )
    return [...filtered].sort(({ appointment: x }, { appointment: y }) => {
      const tokX = x.token_number ?? Number.MAX_SAFE_INTEGER
      const tokY = y.token_number ?? Number.MAX_SAFE_INTEGER
      const tx = x.expected_time ?? '99:99:99'
      const ty = y.expected_time ?? '99:99:99'
      if (sortBy === 'time') {
        if (tx !== ty) return tx.localeCompare(ty)
        if (tokX !== tokY) return tokX - tokY
        return x.id - y.id
      }
      if (tokX !== tokY) return tokX - tokY
      if (tx !== ty) return tx.localeCompare(ty)
      return x.id - y.id
    })
  }, [offset, searchFilteredAppointments, searchFilteredArrivals, statusView, sortBy])

  const totalAppointments = appointmentsData?.total ?? appointments.length
  const showPagination = totalAppointments > PAGE_SIZE
  const pageStart = totalAppointments === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + appointments.length, totalAppointments)
  const hasPrevPage = offset > 0
  const hasNextPage = offset + PAGE_SIZE < totalAppointments
  const visiblePendingArrivalsCount =
    offset === 0 ? visibleRows.filter((r) => r.pendingArrival != null).length : 0

  const emptyMessage = search.trim()
    ? 'No appointments match your search.'
    : isPastDate
      ? 'No appointments recorded for this past date.'
      : isFutureDate
        ? 'No bookings scheduled for this upcoming date.'
        : statusView === 'active'
          ? 'No active appointments for this date and doctor.'
          : statusView === 'to_arrive'
            ? 'No patients awaiting arrival for this date and doctor.'
            : statusView === 'checked_in'
              ? 'No checked-in patients for this date and doctor.'
              : statusView === 'completed'
                ? 'No completed consultations for this date and doctor.'
                : statusView === 'no_show'
                  ? 'No no-show appointments for this date and doctor.'
                  : statusView === 'cancelled'
                    ? 'No cancelled appointments for this date and doctor.'
                    : 'No appointments for this date and doctor.'

  const tableLoading = isPending || (isReception && arrivalsLoading)

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{pageTitle}</h1>
            <p className="mt-0.5 text-sm text-slate-600">{pageDescription}</p>
          </div>
          {canOpenTokenModal && activeTab === 'today' ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={openBlankTokenModal}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-brand-700 px-4 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 transition-colors cursor-pointer"
              >
                <IconTicket className="h-4 w-4" aria-hidden="true" />
                Create OPD Token
              </button>
            </div>
          ) : !canManageAppointments && !canCheckIn ? (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">
              {activeTab === 'followup' ? 'Read-only follow-ups' : 'Read-only schedule'}
            </span>
          ) : null}
        </div>

        {isDisconnected && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-900"
          >
            <span>Server connection lost — displayed queue data may be outdated.</span>
            <button
              type="button"
              onClick={() => {
                void health.refetch()
                void refetch()
                if (isReception) void refetchArrivals()
              }}
              className="inline-flex min-h-9 items-center rounded-lg border border-red-300 bg-white px-3 text-xs font-semibold text-red-800 hover:bg-red-100 transition-colors cursor-pointer"
            >
              Retry Connection
            </button>
          </div>
        )}

        {canViewFollowUps && (
          <div role="tablist" aria-label="Appointment workspace" className="flex flex-wrap gap-2 border-b border-slate-200">
            {isDoctor ? (
              <>
                <button
                  type="button"
                  role="tab"
                  id="appointments-tab-followup"
                  aria-controls="appointments-panel-followup"
                  aria-selected={activeTab === 'followup'}
                  onClick={() => selectTab('followup')}
                  className={`min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors ${activeTab === 'followup' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-800'}`}
                >
                  Follow-ups
                </button>
                <button
                  type="button"
                  role="tab"
                  id="appointments-tab-today"
                  aria-controls="appointments-panel-today"
                  aria-selected={activeTab === 'today'}
                  onClick={() => selectTab('today')}
                  className={`min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors ${activeTab === 'today' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-800'}`}
                >
                  {todayLabel}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  id="appointments-tab-today"
                  aria-controls="appointments-panel-today"
                  aria-selected={activeTab === 'today'}
                  onClick={() => selectTab('today')}
                  className={`min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors ${activeTab === 'today' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-800'}`}
                >
                  {todayLabel}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="appointments-tab-followup"
                  aria-controls="appointments-panel-followup"
                  aria-selected={activeTab === 'followup'}
                  onClick={() => selectTab('followup')}
                  className={`min-h-11 border-b-2 px-4 text-sm font-semibold transition-colors ${activeTab === 'followup' ? 'border-brand-700 text-brand-800' : 'border-transparent text-slate-600 hover:text-brand-800'}`}
                >
                  Follow-ups
                </button>
              </>
            )}
          </div>
        )}

        {activeTab === 'today' ? (
          <div
            id="appointments-panel-today"
            role={canViewFollowUps ? 'tabpanel' : undefined}
            aria-labelledby={canViewFollowUps ? 'appointments-tab-today' : undefined}
            className="space-y-4"
          >
            {conflictError && (
              <ConflictBanner
                onReload={() => {
                  setConflictError(null)
                  void refetch()
                  if (isReception) void refetchArrivals()
                }}
              />
            )}

            {isPastDate && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900"
              >
                <span>
                  Viewing historical appointments for {selectedDate} — check-in and token creation are available for today only.
                </span>
                <button
                  type="button"
                  onClick={() => selectDate(today)}
                  className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  Return to Today
                </button>
              </div>
            )}

            {isFutureDate && (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-medium text-sky-900"
              >
                <span>
                  Viewing upcoming appointments for {selectedDate} — new entries will be created as advance bookings without tokens.
                </span>
                <button
                  type="button"
                  onClick={() => selectDate(today)}
                  className="inline-flex min-h-9 items-center rounded-lg border border-sky-300 bg-white px-3 text-xs font-semibold text-sky-900 hover:bg-sky-100 transition-colors cursor-pointer"
                >
                  Return to Today
                </button>
              </div>
            )}

            {/* DOCTOR OPD SESSION & PACING CONTROLS */}
            {isDoctor && (
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <span>🩺 OPD Cabin Pacing & Doctor Schedule</span>
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                        emergencyHold
                          ? 'bg-red-50 text-red-800 border-red-200'
                          : delayMinutes
                            ? 'bg-amber-50 text-amber-900 border-amber-200'
                            : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      }`}>
                        {emergencyHold ? 'On hold (this screen only)' : delayMinutes ? `${delayMinutes}m delay (this screen only)` : 'On schedule'}
                      </span>
                    </h2>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Morning OPD: 09:00 AM – 01:00 PM · Evening OPD: 04:00 PM – 07:00 PM
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setEmergencyHold(!emergencyHold)}
                      className={`min-h-9 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                        emergencyHold
                          ? 'bg-red-700 text-white border-red-800'
                          : 'bg-white text-red-800 border-red-300 hover:bg-red-50'
                      }`}
                    >
                      {emergencyHold ? 'Resume normal queue' : 'Mark emergency hold'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setDelayMinutes(delayMinutes ? null : 15)}
                      className={`min-h-9 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                        delayMinutes
                          ? 'bg-amber-700 text-white border-amber-800'
                          : 'bg-white text-amber-900 border-amber-300 hover:bg-amber-50'
                      }`}
                    >
                      {delayMinutes ? 'Clear delay note' : 'Note 15 min delay'}
                    </button>
                  </div>
                </div>

                {emergencyHold && (
                  <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 text-xs text-red-900 font-medium flex items-center justify-between">
                    <span>Emergency hold is marked on this screen only. Reception has not been told: phone them to stop sending new walk-ins.</span>
                    <span className="font-mono text-xs font-bold">NOT SENT</span>
                  </div>
                )}

                {delayMinutes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-900 font-medium flex items-center justify-between">
                    <span>⏱ A delay of about {delayMinutes} minutes is noted on this screen only. Reception and the waiting-hall TV have not been told.</span>
                    <span className="font-mono text-xs font-bold">NOT SENT</span>
                  </div>
                )}
              </div>
            )}

            {/* One toolbar: date, search, doctor, sort, and refresh. */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
              <div>
                <label htmlFor="queue-date" className="mb-1 block text-xs font-semibold text-slate-600">Date</label>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button type="button" onClick={() => handleDateShift(-1)} className={SECONDARY_BUTTON} aria-label="Previous day">&larr;</button>
                  <input
                    id="queue-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => selectDate(e.target.value)}
                    className="min-h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                  />
                  <button type="button" onClick={() => handleDateShift(1)} className={SECONDARY_BUTTON} aria-label="Next day">&rarr;</button>
                  <button type="button" onClick={() => selectDate(today)} className={SECONDARY_BUTTON}>Today</button>
                </div>
              </div>

              <div className="min-w-[14rem] flex-1">
                <label htmlFor="appointments-search" className="sr-only">
                  Search appointments
                </label>
                <div className="relative">
                  <IconSearch
                    aria-hidden="true"
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                  />
                  <input
                    id="appointments-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, URN, mobile or token"
                    className="min-h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                  />
                </div>
              </div>

              {isDoctor ? (
                <div className="flex items-center">
                  <span
                    data-testid="doctor-schedule-scope-pill"
                    className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700"
                  >
                    Showing your schedule
                  </span>
                </div>
              ) : (
                <div>
                  <label htmlFor="doctor-filter" className="mb-1 block text-xs font-semibold text-slate-600">Doctor</label>
                  <select
                    id="doctor-filter"
                    value={selectedDoctorId ?? ''}
                    onChange={(e) => selectDoctor(e.target.value ? Number(e.target.value) : undefined)}
                    className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                  >
                    <option value="">All doctors</option>
                    {doctors?.map((d: DoctorOut) => (
                      <option key={d.id} value={d.id}>
                        {d.name_en}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="appointments-sort" className="mb-1 block text-xs font-semibold text-slate-600">
                  Sort by
                </label>
                <select
                  id="appointments-sort"
                  value={sortBy}
                  onChange={(e) => selectSortBy(e.target.value as SortBy)}
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
                >
                  <option value="token">Token number</option>
                  <option value="time">Appointment time</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => {
                  void refetch()
                  if (isReception) void refetchArrivals()
                }}
                disabled={isRefreshing}
                aria-label="Refresh appointments"
                className={SECONDARY_BUTTON}
              >
                {isRefreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
              {!tableLoading && !isError && (
                <div
                  role="group"
                  aria-label="Filter appointments"
                  className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3"
                >
                  {(
                    [
                      { key: 'active', label: `Active (${bucketCounts.active})` },
                      { key: 'to_arrive', label: `To Arrive (${bucketCounts.to_arrive})` },
                      { key: 'checked_in', label: `Checked In (${bucketCounts.checked_in})` },
                      { key: 'completed', label: `Completed (${bucketCounts.completed})` },
                      { key: 'no_show', label: `No-Show (${bucketCounts.no_show})` },
                      { key: 'cancelled', label: `Cancelled (${bucketCounts.cancelled})` },
                      { key: 'all', label: `All (${bucketCounts.all})` },
                    ] as const
                  ).map((pill) => (
                    <button
                      key={pill.key}
                      type="button"
                      aria-pressed={statusView === pill.key}
                      onClick={() => selectStatusView(pill.key)}
                      className={[
                        'min-h-9 rounded-full border px-3.5 text-xs font-semibold transition-colors tabular-nums cursor-pointer',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700',
                        statusView === pill.key
                          ? 'border-brand-700 bg-brand-700 text-white'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-brand-700 hover:text-brand-800',
                      ].join(' ')}
                    >
                      {pill.label}
                    </button>
                  ))}
                </div>
              )}

              {isReception && arrivalsError && (
                <div
                  role="alert"
                  className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800"
                >
                  <span>
                    Pending arrivals could not load:{' '}
                    {arrivalsErrorValue instanceof Error ? arrivalsErrorValue.message : 'failed to load'}.
                  </span>
                  <button
                    type="button"
                    onClick={() => void refetchArrivals()}
                    className="inline-flex min-h-8 items-center rounded-lg border border-red-300 bg-white px-2.5 text-xs font-semibold text-red-800 hover:bg-red-100 transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}

              {tableLoading ? (
                <TableSkeleton label="Loading appointments schedule..." rows={5} columns={8} />
              ) : isError ? (
                <div role="alert" className="flex flex-col items-center gap-3 p-8 text-center text-sm text-red-800">
                  <p>Failed to load appointments: {error.message}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void refetch()
                      if (isReception) void refetchArrivals()
                    }}
                    className="inline-flex min-h-9 items-center rounded-lg border border-red-300 bg-white px-3.5 text-xs font-semibold text-red-800 hover:bg-red-50 transition-colors cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              ) : visibleRows.length === 0 ? (
                <div className="space-y-4 p-12 text-center">
                  <p className="text-sm font-medium text-slate-600">{emptyMessage}</p>
                  {isPastDate ? (
                    <button
                      type="button"
                      onClick={() => selectDate(today)}
                      className="inline-flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      Return to Today
                    </button>
                  ) : canOpenTokenModal && statusView !== 'cancelled' ? (
                    <button
                      type="button"
                      onClick={openBlankTokenModal}
                      className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand-700 px-4 text-xs font-bold text-white hover:bg-brand-800 transition-colors cursor-pointer"
                    >
                      <IconTicket className="h-4 w-4" aria-hidden="true" />
                      {isFutureDate ? 'Book Appointment' : 'Create OPD Token'}
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="block md:table w-full text-left text-sm">
                      <thead className="hidden md:table-header-group border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <tr>
                          <th scope="col" className="px-4 py-3">Token</th>
                          <th scope="col" className="px-4 py-3">Time</th>
                          <th scope="col" className="px-4 py-3">Patient</th>
                          <th scope="col" className="px-4 py-3">Department</th>
                          <th scope="col" className="px-4 py-3">Doctor</th>
                          <th scope="col" className="px-4 py-3">Status</th>
                          <th scope="col" className="px-4 py-3">Priority</th>
                          <th scope="col" className="px-4 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="block md:table-row-group divide-y divide-slate-100">
                        {visibleRows.map((row) => {
                          const { key, appointment: appt, pendingArrival } = row
                          const stage = lifecycleStatus(appt, pendingArrival)
                          const cabinCode = doctorCabinMap.get(appt.doctor_id)
                          return (
                            <tr key={key} className="block md:table-row p-4 md:p-0 space-y-2 md:space-y-0 hover:bg-slate-50 transition-colors duration-150">
                              <td className="inline-block md:table-cell mr-2 md:mr-0 whitespace-nowrap md:px-4 md:py-3 font-mono text-sm font-bold text-[#5D0B26] tabular-nums">
                                {appt.token_number != null ? formatToken(appt.token_number, cabinCode) : '—'}
                              </td>
                              <td className="inline-block md:table-cell mr-2 md:mr-0 whitespace-nowrap md:px-4 md:py-3 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                                {formatAppointmentTime(appt)}
                              </td>
                              <td className="block md:table-cell md:px-4 md:py-3">
                                {pendingArrival ? (
                                  <>
                                    <span className="block font-semibold text-slate-900">
                                      {pendingArrival.full_name}
                                    </span>
                                    <span className="block text-xs text-slate-600">
                                      Pending registration
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <Link
                                      to={`/reception/patients/${appt.patient_id}`}
                                      className="block font-semibold text-brand-700 hover:text-brand-800 hover:underline"
                                    >
                                      {appt.patient_name}
                                    </Link>
                                    <span className="block font-mono text-xs text-slate-600">
                                      {appt.patient_urn}
                                    </span>
                                  </>
                                )}
                              </td>
                              <td className="block md:table-cell md:px-4 md:py-3 text-slate-700">
                                {appt.department_name || '—'}
                              </td>
                              <td className="block md:table-cell md:px-4 md:py-3">
                                <span className="font-medium text-slate-900">{appt.doctor_name_en}</span>
                              </td>
                              <td className="block md:table-cell md:px-4 md:py-3">
                                <AppointmentStatusBadge
                                  status={stage === 'ARRIVED' ? 'TO_ARRIVE' : stage}
                                  label={stage === 'ARRIVED' ? 'Arrived' : undefined}
                                />
                                {isCancelled(appt) && appt.cancellation_reason && (
                                  <span className="mt-1 block max-w-xs truncate text-xs text-slate-600">
                                    {appt.cancellation_reason}
                                  </span>
                                )}
                              </td>
                              <td className="block md:table-cell md:px-4 md:py-3">
                                <PriorityBadge
                                  level={appt.priority_level ?? 'NORMAL'}
                                  reason={appt.priority_reason}
                                  showNormal
                                />
                              </td>
                              <td className="block md:table-cell pt-1 md:pt-3 md:px-4 md:py-3 md:text-right">
                                {canActOnRows ? (
                                  <RowActions
                                    appt={appt}
                                    pendingArrival={pendingArrival}
                                    today={today}
                                    isReception={isReception}
                                    canManageAppointments={canManageAppointments}
                                    canCheckIn={canCheckIn}
                                    canCreateArrival={canCreateArrival}
                                    busy={updateStatusMutation.isPending}
                                    menuOpen={openMenuKey === key}
                                    onMenuOpenChange={(open) => setOpenMenuKey(open ? key : null)}
                                    onCheckIn={() => openCheckInModal(appt)}
                                    onRegisterArrival={() => {
                                      if (pendingArrival) {
                                        navigate(
                                          `/reception/patients/new?arrival_id=${pendingArrival.id}&doctor_id=${pendingArrival.doctor_id}`,
                                        )
                                      }
                                    }}
                                    onRegisterPatient={() => {
                                      navigate(
                                        appt.patient_id
                                          ? `/reception/patients/${appt.patient_id}/edit?appointment_id=${appt.id}`
                                          : `/reception/patients/new?appointment_id=${appt.id}`,
                                      )
                                    }}
                                    onChangePriority={(trigger) => {
                                      priorityTriggerRef.current = trigger
                                      setPriorityTarget(row)
                                    }}
                                    onTransferDoctor={() => setReassigningAppt(appt)}
                                    onReschedule={() => setReschedulingAppt(appt)}
                                    onMarkNoShow={() => handleUpdateStatus(appt, 'NO_SHOW')}
                                    onCancel={() => {
                                      setCancelReason('')
                                      setCancelError(null)
                                      setCancellingTarget(
                                        pendingArrival
                                          ? { kind: 'arrival', arrival: pendingArrival }
                                          : { kind: 'appointment', appointment: appt },
                                      )
                                    }}
                                  />
                                ) : (
                                  <span className="text-xs font-medium text-slate-600">View only</span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {showPagination && (
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700 tabular-nums">
                      <span>
                        Showing {pageStart}–{pageEnd} of {totalAppointments} appointments
                        {offset === 0 && visiblePendingArrivalsCount > 0
                          ? ` (+ ${visiblePendingArrivalsCount} pending walk-in registration${visiblePendingArrivalsCount === 1 ? '' : 's'})`
                          : ''}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={!hasPrevPage || isFetching}
                          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                          className={SECONDARY_BUTTON}
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          disabled={!hasNextPage || isFetching}
                          onClick={() => setOffset(offset + PAGE_SIZE)}
                          className={SECONDARY_BUTTON}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {isReception && (
              <CreateOpdTokenModal
                open={tokenModalOpen}
                onClose={closeTokenModal}
                initialDate={selectedDate}
                initialPatientId={modalBooking ? null : presetPatientId}
                initialAppointmentId={modalBooking ? null : presetAppointmentId}
                initialBooking={modalBooking}
                onClearPreset={clearDeepLinkParams}
              />
            )}

            {priorityTarget && (
              <PriorityModal
                open
                appointment={priorityTarget.appointment}
                pendingArrival={priorityTarget.pendingArrival}
                cabinCode={doctorCabinMap.get(priorityTarget.appointment.doctor_id)}
                onClose={() => {
                  setPriorityTarget(null)
                  const trigger = priorityTriggerRef.current
                  priorityTriggerRef.current = null
                  queueMicrotask(() => {
                    if (trigger?.isConnected) trigger.focus()
                  })
                }}
              />
            )}

            {reassigningAppt && (
              <ReassignModal
                open
                appointment={reassigningAppt}
                onClose={() => setReassigningAppt(null)}
              />
            )}

            {reschedulingAppt && (
              <RescheduleModal
                appt={reschedulingAppt}
                onClose={() => setReschedulingAppt(null)}
                onConflict={() => {
                  setReschedulingAppt(null)
                  setConflictError('Appointment was modified concurrently by another session.')
                }}
              />
            )}

            {cancellingTarget && (
              <Modal
                open
                variant="destructive"
                title={cancellingTarget.kind === 'arrival' ? 'Cancel Arrival' : 'Cancel Appointment'}
                onClose={closeCancel}
                busy={cancelBusy}
                className="max-w-md"
              >
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (statusUpdateInFlightRef.current || cancelBusy) return
                    const trimmed = cancelReason.trim()
                    if (trimmed.length < 3) {
                      setCancelError('Please enter at least 3 characters for the cancellation reason.')
                      return
                    }
                    if (cancellingTarget.kind === 'arrival') {
                      void handleCancelArrival(cancellingTarget.arrival, trimmed)
                    } else {
                      void handleUpdateStatus(cancellingTarget.appointment, 'CANCELLED', trimmed)
                    }
                  }}
                  className="space-y-4"
                >
                  <p className="text-xs text-slate-600">
                    {cancellingTarget.kind === 'arrival'
                      ? `Provide a cancellation reason for ${cancellingTarget.arrival.full_name} (${cancellingTarget.arrival.appointment_date}).`
                      : `Provide a cancellation reason for ${cancellingTarget.appointment.patient_name} (${cancellingTarget.appointment.appointment_date}${cancellingTarget.appointment.expected_time ? ` · ${cancellingTarget.appointment.expected_time.slice(0, 5)}` : ''}).`}
                  </p>
                  {cancelError && (
                    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {cancelError}
                    </div>
                  )}
                  <div>
                    <label htmlFor="cancel-reason" className="mb-1 block text-xs font-semibold text-slate-700">
                      Cancellation reason *
                    </label>
                    <textarea
                      id="cancel-reason"
                      data-autofocus
                      value={cancelReason}
                      disabled={cancelBusy}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="Reason for cancellation (e.g. Patient called to reschedule)..."
                      rows={3}
                      minLength={3}
                      required
                      className="w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-700/20 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      disabled={cancelBusy}
                      onClick={closeCancel}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {cancellingTarget.kind === 'arrival' ? 'Keep arrival' : 'Keep appointment'}
                    </button>
                    <button
                      type="submit"
                      disabled={cancelReason.trim().length < 3 || cancelBusy}
                      className="rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Confirm Cancellation
                    </button>
                  </div>
                </form>
              </Modal>
            )}
          </div>
        ) : (
          canViewFollowUps ? (
            <div id="appointments-panel-followup" role="tabpanel" aria-labelledby="appointments-tab-followup">
              {isDoctor ? (
                <FollowUpVisits isDoctor={isDoctor} />
              ) : (
                <ReceptionFollowUpsQueue mode={isReception ? 'reception' : 'admin'} />
              )}
            </div>
          ) : (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Follow-up information requires appointment read access. Return to the schedule to continue.
              <button type="button" onClick={() => selectTab('today')} className="ml-2 font-semibold underline">
                Open today&apos;s queue
              </button>
            </div>
          )
        )}
      </div>
    </AppShell>
  )
}
