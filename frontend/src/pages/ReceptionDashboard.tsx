import { useState, useMemo, useEffect } from 'react'
import { Link } from 'react-router'
import { formatPaise } from '../format'
import {
  IconCheck,
  IconClock,
  IconStethoscope,
  IconUserPlus,
  IconRupee,
  IconAlertCircle,
  IconAlertTriangle,
  IconRefresh,
} from '../components/icons'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import {
  AppointmentStatusBadge,
  getWaitingElapsedMinutes,
  useIstToday,
} from '../components/reception/AppointmentStatusBadge'
import { useAppointments, useDoctors, useOpdArrivals, useOverview } from '../api/queries'
import type { ReceptionOverview, Appointment, PriorityLevel } from '../api/types'

const PREVIEW_LIMIT = 5

const SUGGESTED_RANK: Record<PriorityLevel, number> = {
  EMERGENCY: 0,
  PRIORITY: 1,
  NORMAL: 2,
}

function formatUpdatedAt(timestamp: number): string {
  return timestamp
    ? new Date(timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : 'Not updated'
}

function parseTimestampOrMax(isoString?: string | null): number {
  if (!isoString) return Number.MAX_SAFE_INTEGER
  const parsed = Date.parse(isoString)
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed
}

function isCancelledOrClosed(appt: Appointment): boolean {
  return (
    appt.status === 'CANCELLED' ||
    appt.status === 'NO_SHOW' ||
    appt.status === 'RESCHEDULED' ||
    appt.consultation_status === 'CANCELLED'
  )
}

function isCompletedAppointment(appt: Appointment): boolean {
  if (isCancelledOrClosed(appt)) return false
  return (
    appt.status === 'DONE' ||
    appt.status === 'COMPLETED' ||
    appt.consultation_status === 'COMPLETED'
  )
}

function isInCabinAppointment(appt: Appointment): boolean {
  if (isCancelledOrClosed(appt) || isCompletedAppointment(appt)) return false
  return (
    appt.status === 'IN_CONSULTATION' ||
    appt.consultation_status === 'IN_CONSULTATION'
  )
}

function isWaitingAppointment(appt: Appointment): boolean {
  if (isCancelledOrClosed(appt) || isCompletedAppointment(appt) || isInCabinAppointment(appt)) {
    return false
  }
  return (
    appt.status === 'ARRIVED' ||
    appt.status === 'CHECKED_IN' ||
    appt.status === 'WAITING' ||
    appt.consultation_status === 'WAITING'
  )
}

function isBookedAppointment(appt: Appointment): boolean {
  if (
    isCancelledOrClosed(appt) ||
    isCompletedAppointment(appt) ||
    isInCabinAppointment(appt) ||
    isWaitingAppointment(appt)
  ) {
    return false
  }
  return (
    appt.status === 'BOOKED' ||
    appt.status === 'TO_ARRIVE' ||
    appt.status === 'REGISTERED'
  )
}

function compareByToken(a: Appointment, b: Appointment): number {
  return (a.token_number ?? Number.MAX_SAFE_INTEGER) - (b.token_number ?? Number.MAX_SAFE_INTEGER)
}

function compareWaitingSuggestedOrder(a: Appointment, b: Appointment): number {
  const rankA = SUGGESTED_RANK[a.priority_level ?? 'NORMAL'] ?? 2
  const rankB = SUGGESTED_RANK[b.priority_level ?? 'NORMAL'] ?? 2
  if (rankA !== rankB) return rankA - rankB
  if (rankA === 0) {
    const tsA = parseTimestampOrMax(a.priority_updated_at ?? a.status_updated_at)
    const tsB = parseTimestampOrMax(b.priority_updated_at ?? b.status_updated_at)
    if (tsA !== tsB) return tsA - tsB
  }
  return compareByToken(a, b)
}

interface ReceptionDashboardProps {
  overview: ReceptionOverview
}

export function ReceptionDashboard({ overview: initialOverview }: ReceptionDashboardProps) {
  const {
    data: liveOverview,
    refetch: refetchOverview,
    dataUpdatedAt: summaryUpdatedAt,
    isRefetchError: summaryRefetchError,
  } = useOverview<ReceptionOverview>('reception', { refetchInterval: 30000 })
  const overview = liveOverview || initialOverview

  const todayStr = useIstToday(overview?.business_date)

  // Live polling for appointments queue (10s), pending arrivals (10s), and overview (30s)
  const {
    data: appointmentsData,
    isLoading: queueLoading,
    refetch: refetchQueue,
    dataUpdatedAt: queueUpdatedAt,
    isError: queueError,
  } = useAppointments({ appointment_date: todayStr })

  const {
    data: arrivalsData,
    refetch: refetchArrivals,
  } = useOpdArrivals(todayStr)

  const { data: doctors } = useDoctors(true)

  // Unfreeze 30-minute wait alerts even when TanStack Query structural sharing preserves array refs.
  const [clockNow, setClockNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setClockNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const nowTick = Math.max(clockNow, queueUpdatedAt || 0)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null)

  const handleManualRefresh = async () => {
    setIsRefreshing(true)
    setRefreshMessage(null)
    try {
      const [queueResult, summaryResult, arrivalsResult] = await Promise.all([
        refetchQueue(),
        refetchOverview(),
        refetchArrivals(),
      ])
      const failedSections = [
        queueResult.isError && 'queue',
        summaryResult.isError && 'summary',
        arrivalsResult.isError && 'arrivals',
      ].filter(Boolean)
      setRefreshMessage(
        failedSections.length
          ? `${failedSections.join(' and ')} refresh failed. Last successful values are still shown.`
          : 'Queue and summary refreshed.',
      )
    } catch {
      setRefreshMessage('Queue and summary refresh failed. Last successful values are still shown.')
    } finally {
      setIsRefreshing(false)
    }
  }

  const allAppointments = useMemo(() => appointmentsData?.appointments ?? [], [appointmentsData])
  const activeVisitsAppts = useMemo(
    () => allAppointments.filter((a) => !isCancelledOrClosed(a)),
    [allAppointments],
  )
  const pendingArrivals = useMemo(
    () => (arrivalsData?.arrivals ?? []).filter((a) => a.status === 'TO_ARRIVE'),
    [arrivalsData],
  )

  const waitingAppts = useMemo(() => allAppointments.filter(isWaitingAppointment), [allAppointments])
  const inConsultationAppts = useMemo(() => allAppointments.filter(isInCabinAppointment), [allAppointments])
  const doneAppts = useMemo(() => allAppointments.filter(isCompletedAppointment), [allAppointments])
  const bookedAppts = useMemo(() => allAppointments.filter(isBookedAppointment), [allAppointments])

  const delayedAppts = useMemo(
    () => waitingAppts.filter((a) => getWaitingElapsedMinutes(a, nowTick) >= 30),
    [waitingAppts, nowTick],
  )

  const sortedWaitingAppts = useMemo(
    () => [...waitingAppts].sort(compareWaitingSuggestedOrder),
    [waitingAppts],
  )
  const sortedInConsultationAppts = useMemo(
    () => [...inConsultationAppts].sort(compareByToken),
    [inConsultationAppts],
  )
  const activeQueue = useMemo(
    () => [...sortedWaitingAppts, ...sortedInConsultationAppts],
    [sortedWaitingAppts, sortedInConsultationAppts],
  )
  const previewQueue = useMemo(() => activeQueue.slice(0, PREVIEW_LIMIT), [activeQueue])

  const doctorWorkloadRows = useMemo(() => {
    if (doctors && appointmentsData) {
      return doctors.map((doc) => {
        const docWaiting = sortedWaitingAppts.filter((a) => a.doctor_id === doc.id)
        const docInCabin = sortedInConsultationAppts.filter((a) => a.doctor_id === doc.id)
        return {
          doctor_id: doc.id,
          name: doc.name_en,
          waitingCount: docWaiting.length,
          inCabinCount: docInCabin.length,
          nextToken: docWaiting.find((a) => a.token_number != null)?.token_number ?? null,
        }
      })
    }
    if (overview.doctors_today && overview.doctors_today.length > 0) {
      return overview.doctors_today.map((doc) => ({
        doctor_id: doc.doctor_id,
        name: doc.name,
        waitingCount: doc.arrived_waiting ?? doc.waiting,
        inCabinCount: doc.in_consultation,
        nextToken: doc.next_token ?? null,
      }))
    }
    return (doctors ?? []).map((doc) => ({
      doctor_id: doc.id,
      name: doc.name_en,
      waitingCount: 0,
      inCabinCount: 0,
      nextToken: null,
    }))
  }, [doctors, appointmentsData, overview.doctors_today, sortedWaitingAppts, sortedInConsultationAppts])

  const grossPaise = overview.collections_today?.gross_paise ?? 0
  const reversedPaise = overview.collections_today?.reversed_paise ?? 0
  const outstandingDuesPaise = overview.outstanding_dues_paise ?? 0

  const attentionCount =
    (delayedAppts.length > 0 ? 1 : 0) +
    (outstandingDuesPaise > 0 ? 1 : 0) +
    (bookedAppts.length > 0 ? 1 : 0) +
    (pendingArrivals.length > 0 ? 1 : 0)

  return (
    <div className="w-full space-y-4 pb-8">
      {/* 1. Compact Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white px-4 py-3.5 rounded-xl border border-neutral-200 shadow-2xs">
        <div>
          <h1 className="text-xl font-bold text-neutral-900 tracking-tight">
            Reception Dashboard
          </h1>
          <p className="text-xs text-neutral-600 font-medium">
            Front Desk &amp; Reception Command Center
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right">
            <p className="text-xs text-neutral-600">Queue updated: {formatUpdatedAt(queueUpdatedAt)}</p>
            <p className="text-xs text-neutral-600">Summary updated: {formatUpdatedAt(summaryUpdatedAt)}</p>
          </div>

          <button
            type="button"
            onClick={handleManualRefresh}
            aria-label="Refresh queue and summary"
            disabled={isRefreshing}
            className="min-h-11 min-w-11 inline-flex items-center justify-center border border-neutral-300 rounded-lg text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400"
          >
            <IconRefresh size={18} className={isRefreshing ? 'animate-spin text-emerald-700' : ''} />
          </button>
        </div>
      </div>

      {refreshMessage && (
        <p role={refreshMessage.includes('failed') ? 'alert' : 'status'} className="text-sm text-neutral-700">
          {refreshMessage}
        </p>
      )}
      {queueError && !refreshMessage && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm text-amber-900">
          Queue refresh failed. {allAppointments.length ? 'Last successful queue is still shown.' : 'Try refreshing the queue.'}
        </p>
      )}
      {summaryRefetchError && !refreshMessage && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm text-amber-900">
          Summary refresh failed. Last successful values are still shown.
        </p>
      )}

      {/* 2. Six Compact Operational KPI Cards */}
      <div className="admin-stagger grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
        <Link
          to="/reception/appointments"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-neutral-400 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">Active Visits</span>
            <span className="p-1.5 rounded-lg bg-sky-50 text-sky-700 group-hover:scale-105 transition-transform">
              <IconUserPlus size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-neutral-900">
            {activeVisitsAppts.length}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">Walk-in + booked</p>
        </Link>

        <Link
          to="/reception/waiting"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-amber-300 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">Waiting</span>
            <span className="p-1.5 rounded-lg bg-amber-100 text-amber-800 group-hover:scale-105 transition-transform">
              <IconClock size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-amber-900">
            {waitingAppts.length}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">Awaiting consultation</p>
        </Link>

        <Link
          to="/reception/waiting"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-consult-300 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">In Cabin</span>
            <span className="p-1.5 rounded-lg bg-consult-100 text-consult-800 group-hover:scale-105 transition-transform">
              <IconStethoscope size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-consult-900">
            {inConsultationAppts.length}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">With doctors right now</p>
        </Link>

        <Link
          to="/reception/waiting"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-emerald-300 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">Completed</span>
            <span className="p-1.5 rounded-lg bg-emerald-100 text-emerald-800 group-hover:scale-105 transition-transform">
              <IconCheck size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-emerald-900">
            {doneAppts.length}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">Ready for checkout</p>
        </Link>

        <Link
          to="/reception/billing?tab=dues"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-rose-300 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">Dues Pending</span>
            <span className="p-1.5 rounded-lg bg-rose-100 text-rose-800 group-hover:scale-105 transition-transform">
              <IconAlertCircle size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-rose-900">
            {formatPaise(outstandingDuesPaise)}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">Outstanding balances</p>
        </Link>

        <Link
          to="/reception/reports"
          className="text-left bg-white px-3.5 py-2.5 rounded-xl border border-neutral-200 hover:border-teal-300 transition-colors shadow-2xs hover:shadow-xs group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-neutral-600">Payments today</span>
            <span className="p-1.5 rounded-lg bg-teal-100 text-teal-800 group-hover:scale-105 transition-transform">
              <IconRupee size={15} />
            </span>
          </div>
          <div className="mt-1 text-xl font-bold leading-tight text-teal-900">
            {formatPaise(grossPaise)}
          </div>
          <p className="text-xs text-neutral-600 mt-0.5">Reversed today: {formatPaise(reversedPaise)}</p>
        </Link>
      </div>

      {/* 3. Needs Attention Banner */}
      {attentionCount > 0 && (
        <section
          aria-labelledby="needs-attention-heading"
          className="bg-amber-50/60 border border-amber-200/80 rounded-xl px-4 py-3 space-y-2"
        >
          <div className="flex items-center gap-2">
            <IconAlertTriangle size={16} className="text-amber-800 shrink-0" />
            <h2 id="needs-attention-heading" className="text-xs font-bold text-amber-950">
              Needs Attention ({attentionCount})
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2.5">
            {delayedAppts.length > 0 && (
              <div className="p-2.5 bg-white rounded-lg border border-amber-300 flex items-center justify-between gap-2 shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-amber-900">
                    {delayedAppts.length} patient(s) waiting over 30 minutes
                  </p>
                  <p className="text-xs text-neutral-600">Check cabin delays</p>
                </div>
                <Link
                  to="/reception/waiting"
                  aria-label="View delayed patients"
                  className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 rounded transition-colors shrink-0"
                >
                  View
                </Link>
              </div>
            )}

            {outstandingDuesPaise > 0 && (
              <div className="p-2.5 bg-white rounded-lg border border-rose-200 flex items-center justify-between gap-2 shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-rose-900">
                    {formatPaise(outstandingDuesPaise)} pending dues
                  </p>
                  <p className="text-xs text-neutral-600">Payment follow-up required</p>
                </div>
                <Link
                  to="/reception/billing?tab=dues"
                  className="px-2.5 py-1 text-xs font-semibold bg-rose-100 text-rose-900 hover:bg-rose-200 rounded transition-colors shrink-0"
                >
                  Review
                </Link>
              </div>
            )}

            {bookedAppts.length > 0 && (
              <div className="p-2.5 bg-white rounded-lg border border-sky-200 flex items-center justify-between gap-2 shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-sky-900">
                    {bookedAppts.length} booked patient(s) not checked in
                  </p>
                  <p className="text-xs text-neutral-600">Awaiting arrival at desk</p>
                </div>
                <Link
                  to="/reception/tokens"
                  className="px-2.5 py-1 text-xs font-semibold bg-sky-100 text-sky-900 hover:bg-sky-200 rounded transition-colors shrink-0"
                >
                  Check in
                </Link>
              </div>
            )}

            {pendingArrivals.length > 0 && (
              <div className="p-2.5 bg-white rounded-lg border border-amber-200 flex items-center justify-between gap-2 shadow-2xs">
                <div>
                  <p className="text-xs font-bold text-amber-900">
                    {pendingArrivals.length} walk-in patient(s) awaiting full registration
                  </p>
                  <p className="text-xs text-neutral-600">Temporary tokens issued</p>
                </div>
                <Link
                  to="/reception/tokens"
                  className="px-2.5 py-1 text-xs font-semibold bg-amber-100 text-amber-900 hover:bg-amber-200 rounded transition-colors shrink-0"
                >
                  Register
                </Link>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 4. Main 2-Column Command Center Workspace */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left Column (8 cols): Compact Live Queue Preview */}
        <section
          aria-labelledby="live-queue-heading"
          className="xl:col-span-8 bg-white rounded-xl border border-neutral-200 shadow-2xs overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-neutral-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 id="live-queue-heading" className="text-sm font-bold text-neutral-900">
                Live Queue
              </h2>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse" />
                Live data
              </span>
              <span className="text-xs text-neutral-600">
                {activeQueue.length > 0
                  ? `Showing ${previewQueue.length} of ${activeQueue.length} active`
                  : '0 active'}
              </span>
            </div>

            <Link
              to="/reception/waiting"
              className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 hover:underline"
            >
              Open Waiting Room →
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-neutral-50/80 text-neutral-600 text-xs font-semibold border-b border-neutral-200">
                  <th className="py-2.5 px-3.5 w-16 text-center">Token</th>
                  <th className="py-2.5 px-3.5">Patient</th>
                  <th className="py-2.5 px-3.5">Doctor</th>
                  <th className="py-2.5 px-3.5">Status &amp; Wait</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 text-xs">
                {queueLoading && allAppointments.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-neutral-600">
                      Loading live queue...
                    </td>
                  </tr>
                ) : previewQueue.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 px-4 text-center">
                      <div className="max-w-xs mx-auto space-y-2">
                        <p className="text-sm font-semibold text-neutral-800">
                          No active patients in queue
                        </p>
                        <p className="text-xs text-neutral-600">
                          Patients currently waiting or in cabin will appear here automatically.
                        </p>
                        <div className="pt-1">
                          <Link
                            to="/reception/waiting"
                            className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-100 text-neutral-800 hover:bg-neutral-200 transition-colors"
                          >
                            Open Waiting Room
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  previewQueue.map((appt) => {
                    const inCabin = isInCabinAppointment(appt)
                    const elapsed = getWaitingElapsedMinutes(appt, nowTick)
                    const isDelayed = !inCabin && elapsed >= 30

                    return (
                      <tr key={appt.id} className="hover:bg-neutral-50/80 transition-colors">
                        <td className="py-2.5 px-3.5 text-center">
                          <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold bg-neutral-900 text-white font-mono">
                            {appt.token_number == null
                              ? '—'
                              : `#${String(appt.token_number).padStart(2, '0')}`}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link
                                to={`/reception/patients/${appt.patient_id}`}
                                className="font-bold text-neutral-900 hover:text-emerald-800 transition-colors"
                              >
                                {appt.patient_name}
                              </Link>
                              <PriorityBadge level={appt.priority_level} reason={appt.priority_reason} />
                            </div>
                            <span className="text-xs text-neutral-600 font-mono">{appt.patient_urn}</span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5">
                          <div className="font-medium text-neutral-800">{appt.doctor_name_en}</div>
                          <span className="text-xs text-neutral-600">
                            {appt.department_name || 'Department not recorded'}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5">
                          {inCabin ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <AppointmentStatusBadge status="IN_CABIN" />
                              <span className="text-xs font-medium text-consult-800">In consultation</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-start gap-0.5">
                              <AppointmentStatusBadge status="WAITING" />
                              <span
                                className={`inline-flex items-center gap-1 text-xs ${
                                  isDelayed ? 'font-bold text-amber-800' : 'font-medium text-neutral-700'
                                }`}
                              >
                                {isDelayed && <IconAlertCircle size={13} className="text-amber-700" />}
                                {elapsed} min waiting
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {activeQueue.length > PREVIEW_LIMIT && (
            <div className="px-4 py-2.5 border-t border-neutral-200 bg-neutral-50/70 text-center">
              <Link
                to="/reception/waiting"
                className="text-xs font-semibold text-emerald-800 hover:text-emerald-900 hover:underline"
              >
                View all {activeQueue.length} active patients in Waiting Room →
              </Link>
            </div>
          )}
        </section>

        {/* Right Column (4 cols): Streamlined Doctor Workload */}
        <section
          aria-labelledby="doctor-workload-heading"
          className="xl:col-span-4 bg-white p-4 rounded-xl border border-neutral-200 shadow-2xs space-y-3"
        >
          <div className="flex items-center justify-between">
            <h2 id="doctor-workload-heading" className="text-sm font-bold text-neutral-900 tracking-tight">
              Doctor Workload
            </h2>
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              Live Status
            </span>
          </div>

          {doctorWorkloadRows.length === 0 ? (
            <p className="text-xs text-neutral-600 py-4 text-center">No active doctors available.</p>
          ) : (
            <div className="space-y-2">
              {doctorWorkloadRows.map((doc) => (
                <Link
                  key={doc.doctor_id}
                  to={`/reception/waiting?doctor_id=${doc.doctor_id}`}
                  className="block w-full text-left px-3 py-2.5 rounded-lg border border-neutral-200 hover:border-emerald-300 hover:bg-neutral-50/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                      <span className="text-xs font-bold text-neutral-900 truncate">{doc.name}</span>
                    </div>

                    <span className="px-2 py-0.5 bg-neutral-900 text-white rounded text-xs font-mono font-bold shrink-0">
                      Next: {doc.nextToken != null ? `#${String(doc.nextToken).padStart(2, '0')}` : '—'}
                    </span>
                  </div>

                  <div className="mt-1.5 flex items-center gap-3 text-xs">
                    <span className="text-amber-800 font-semibold">
                      Waiting: <span className="font-bold text-amber-900">{doc.waitingCount}</span>
                    </span>
                    <span className="text-consult-800 font-semibold">
                      In Cabin: <span className="font-bold text-consult-900">{doc.inCabinCount}</span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
