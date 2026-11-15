import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { TableSkeleton } from '../components/AdminSkeleton'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import {
  useAppointments,
  useDoctors,
  usePrescriptionFollowUps,
  useUpdateAppointmentStatus,
  useMe,
} from '../api/queries'
import type { Appointment, AppointmentStatus, DoctorOut } from '../api/types'
import { formatToken, istToday } from '../format'
import { isVersionConflict } from '../api/client'
import { IconTicket, IconUserPlus } from '../components/icons'

type FollowUpWindow = 'all' | 'today' | 'week' | 'overdue'

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: 'Booked',
  ARRIVED: 'Waiting',
  IN_CONSULTATION: 'With doctor',
  DONE: 'Completed',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
  RESCHEDULED: 'Rescheduled',
}

const STATUS_CLASS: Record<AppointmentStatus, string> = {
  BOOKED: 'bg-blue-50 text-blue-800 ring-blue-200',
  ARRIVED: 'bg-amber-50 text-amber-800 ring-amber-200',
  IN_CONSULTATION: 'bg-purple-50 text-purple-800 ring-purple-200',
  DONE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  CANCELLED: 'bg-slate-100 text-slate-700 ring-slate-200',
  NO_SHOW: 'bg-slate-100 text-slate-700 ring-slate-200',
  RESCHEDULED: 'bg-slate-100 text-slate-700 ring-slate-200',
}

const SECONDARY_BUTTON =
  'min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'

function localDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function FollowUpVisits() {
  const [selectedWindow, setSelectedWindow] = useState<FollowUpWindow>('all')
  const [recallNotifiedId, setRecallNotifiedId] = useState<number | null>(null)
  const today = localDateValue(new Date())
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 6)

  const dateRange =
    selectedWindow === 'today'
      ? { date_from: today, date_to: today }
      : selectedWindow === 'week'
        ? { date_from: today, date_to: localDateValue(weekEnd) }
        : selectedWindow === 'overdue'
          ? (() => {
            const yesterday = new Date()
            yesterday.setDate(yesterday.getDate() - 1)
            return { date_to: localDateValue(yesterday) }
          })()
          : undefined

  const { data, isPending, isError, error, refetch } = usePrescriptionFollowUps(dateRange)
  const followUps = data ?? []

  const windows: { key: FollowUpWindow; label: string }[] = [
    { key: 'all', label: 'All Follow-ups' },
    { key: 'today', label: 'Due Today' },
    { key: 'week', label: 'Next 7 Days' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <section className="space-y-4" aria-labelledby="followups-heading">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 id="followups-heading" className="text-lg font-bold text-slate-900">
            Prescription return dates
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Return dates recorded on your prescriptions. These are clinical follow-up reminders,
            not booked appointment tokens.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
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
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
              selectedWindow === window.key
                ? 'border-[#5D0B26] bg-[#5D0B26] text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26]',
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
          <p className="mt-2 text-sm text-slate-500">
            Follow-up dates are added when a prescription is issued. Only prescriptions authored by your account are shown.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5">
            <h3 className="text-sm font-bold text-slate-900">Prescription follow-up list</h3>
            <span className="text-xs font-medium text-slate-500">{followUps.length} record{followUps.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wide text-slate-600">
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
                {followUps.map((item, index) => {
                  const rowDelay = index * 50
                  const date = item.follow_up_date || ''
                  const overdue = date < today
                  const dueToday = date === today
                  const status = overdue ? 'Overdue' : dueToday ? 'Due today' : 'Upcoming'
                  const statusClass = overdue
                    ? 'bg-rose-50 text-rose-800 ring-rose-200'
                    : dueToday
                      ? 'bg-amber-50 text-amber-800 ring-amber-200'
                      : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80 transition-colors" style={{ transitionDelay: `${rowDelay}ms` }}>
                      <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">
                        {date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/reception/patients/${item.patient_id}`} className="font-semibold text-[#5D0B26] hover:underline">
                          {item.patient_name}
                        </Link>
                        <span className="mt-0.5 block font-mono text-xs text-slate-500">{item.patient_urn}</span>
                      </td>
                      <td className="max-w-sm px-4 py-3 text-slate-700">{item.diagnosis}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        Rx #{item.id}<span className="ml-2 text-xs text-slate-500">· {item.items_count} item{item.items_count === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${statusClass}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {recallNotifiedId === item.id ? (
                            <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                              ✓ Marked to recall (this screen only)
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setRecallNotifiedId(item.id)}
                              title="Marks this patient on your screen only. Reception is not notified."
                              className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-amber-50/70 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                            >
                              📞 Mark to recall
                            </button>
                          )}
                          <Link
                            to={`/doctor?patient_id=${item.patient_id}`}
                            className="inline-flex min-h-9 items-center rounded-lg bg-[#5D0B26] px-2.5 text-xs font-semibold text-white hover:bg-[#8E1C3D]"
                          >
                            ⚡ Cabin
                          </Link>
                          <Link
                            to={`/reception/patients/${item.patient_id}`}
                            className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                          >
                            Open patient
                          </Link>
                        </div>
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
  )
}

/** Check-in happens at Check-in & Token, which opens with this patient and booking chosen. */
function CheckInLink({ appt }: { appt: Appointment }) {
  return (
    <Link
      to={`/reception/tokens?patient_id=${appt.patient_id}&appointment_id=${appt.id}`}
      className="inline-flex min-h-9 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-amber-700"
    >
      Check In
    </Link>
  )
}

/** The action a receptionist can take on one booking, given where the patient is now. */
function RowActions({
  appt,
  onMarkNoShow,
  onCancel,
  showCallCabin = false,
}: {
  appt: Appointment
  onMarkNoShow: () => void
  onCancel: () => void
  /** A doctor viewing their own schedule can jump to the cabin for a waiting patient. */
  showCallCabin?: boolean
}) {
  switch (appt.status) {
    case 'BOOKED':
      return (
        <div className="flex flex-wrap justify-end gap-2">
          <CheckInLink appt={appt} />
          <button type="button" onClick={onMarkNoShow} className={SECONDARY_BUTTON}>No-Show</button>
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
        </div>
      )
    case 'ARRIVED':
      return (
        <div className="flex flex-wrap justify-end gap-2">
          {showCallCabin && (
            <Link
              to={`/doctor?token=${appt.token_number}`}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#5D0B26] px-3 text-xs font-semibold text-white shadow-xs hover:bg-[#8E1C3D]"
            >
              ⚡ Call Cabin
            </Link>
          )}
          <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>Cancel</button>
        </div>
      )
    case 'NO_SHOW':
      // A patient marked not arrived can still check in late, the same day.
      return (
        <div className="flex justify-end">
          <CheckInLink appt={appt} />
        </div>
      )
    case 'IN_CONSULTATION':
      return <span className="text-xs font-semibold italic text-purple-700">With doctor</span>
    case 'DONE':
      return (
        <Link
          to={`/reception/billing?appointment_id=${appt.id}&patient_id=${appt.patient_id}`}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-900 hover:bg-emerald-100"
        >
          Billing &rarr;
        </Link>
      )
    case 'CANCELLED':
    case 'RESCHEDULED':
      return <span className="text-xs text-slate-500">—</span>
  }
}

export function AppointmentsReception() {
  const { data: me } = useMe()
  const isDoctor = me?.role === 'DOCTOR'
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const canManageAppointments = me?.permissions.includes('appointment:write') === true
  const canViewFollowUps = me?.permissions.includes('prescription:read') === true
  // Reception sees only Appointments here. A doctor arrives from the Follow-ups sidebar tab and
  // can switch to Schedule (bookings by date); their live queue for today is My Queue.
  const activeTab: 'today' | 'followup' =
    canViewFollowUps && (requestedTab === 'followup' || (isDoctor && requestedTab !== 'today')) ? 'followup' : 'today'
  const selectTab = (tab: 'today' | 'followup') => setSearchParams({ tab })
  const todayLabel = isDoctor ? 'Schedule' : 'Appointments'
  const pageTitle = activeTab === 'followup' ? 'Follow-ups' : todayLabel
  const pageDescription =
    activeTab === 'followup'
      ? 'Return dates recorded on your prescriptions.'
      : isDoctor
        ? 'Bookings by date and doctor. Your live queue for today is on My Queue.'
        : 'Bookings by date and doctor: who is booked, waiting, not arrived or cancelled. Patients are checked in at Check-in & Token.'
  const [selectedDate, setSelectedDate] = useState(istToday)
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined)
  const [emergencyHold, setEmergencyHold] = useState(false)
  const [delayMinutes, setDelayMinutes] = useState<number | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Pre-filter to logged-in doctor if role is DOCTOR and not explicitly modified
  useEffect(() => {
    if (isDoctor && me?.doctor_id && selectedDoctorId === undefined) {
      setSelectedDoctorId(me.doctor_id)
    }
  }, [isDoctor, me?.doctor_id, selectedDoctorId])

  // Cancel dialog state
  const [cancellingAppt, setCancellingAppt] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const { data: doctors } = useDoctors(false)
  const {
    data: appointmentsData,
    isPending,
    isError,
    error,
    refetch,
  } = useAppointments({
    appointment_date: selectedDate,
    doctor_id: selectedDoctorId,
  })

  const updateStatusMutation = useUpdateAppointmentStatus()

  const handleDateShift = (days: number) => {
    const d = new Date(selectedDate)
    d.setDate(d.getDate() + days)
    setSelectedDate(d.toISOString().split('T')[0])
  }

  const handleUpdateStatus = async (
    appt: Appointment,
    newStatus: AppointmentStatus,
    reason?: string,
  ) => {
    setConflictError(null)
    setActionError(null)
    try {
      await updateStatusMutation.mutateAsync({
        id: appt.id,
        body: {
          status: newStatus,
          version_id: appt.version_id,
          cancellation_reason: reason || null,
        },
      })
      if (cancellingAppt) {
        setCancellingAppt(null)
        setCancelReason('')
      }
    } catch (err: unknown) {
      if (isVersionConflict(err)) {
        setConflictError('Appointment was modified concurrently by another session.')
      } else {
        setActionError(err instanceof Error ? err.message : 'Failed to update status.')
      }
    }
  }

  const appointments = appointmentsData?.appointments || []
  const countWith = (status: AppointmentStatus) => appointments.filter((a) => a.status === status).length

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">{pageTitle}</h1>
            <p className="mt-0.5 text-sm text-slate-600">{pageDescription}</p>
          </div>
          {canManageAppointments ? (
            <div className="flex flex-wrap gap-2">
              <Link
                to="/reception/patients/new"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
              >
                <IconUserPlus className="h-4 w-4 text-emerald-800" />
                New patient
              </Link>
              <Link
                to="/reception/tokens"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#124832] px-4 text-sm font-semibold text-white shadow-xs hover:bg-[#0D3822]"
              >
                <IconTicket className="h-4 w-4" />
                Check-in &amp; Token
              </Link>
            </div>
          ) : (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">Read-only schedule</span>
          )}
        </div>

        {/* Tabs only when there is a choice: reception has a single view here. */}
        {canViewFollowUps && (
          <div role="tablist" aria-label="Appointment workspace" className="flex flex-wrap gap-2 border-b border-slate-200">
            <button
              type="button"
              role="tab"
              id="appointments-tab-followup"
              aria-controls="appointments-panel-followup"
              aria-selected={activeTab === 'followup'}
              onClick={() => selectTab('followup')}
              className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === 'followup' ? 'border-[#C39A35] text-[#5D0B26]' : 'border-transparent text-slate-600 hover:text-[#5D0B26]'}`}
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
              className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === 'today' ? 'border-[#C39A35] text-[#5D0B26]' : 'border-transparent text-slate-600 hover:text-[#5D0B26]'}`}
            >
              {todayLabel}
            </button>
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
                  refetch()
                }}
              />
            )}

            {actionError && (
              <InlineAlert tone="error" onDismiss={() => setActionError(null)}>
                {actionError}
              </InlineAlert>
            )}

            {/* DOCTOR OPD SESSION & PACING CONTROLS */}
            {isDoctor && (
              <div className="rounded-2xl border border-[#5D0B26]/20 bg-gradient-to-r from-[#5D0B26]/5 to-slate-50 p-4 shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <span>🩺 OPD Cabin Pacing & Doctor Schedule</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                        emergencyHold
                          ? 'bg-rose-700 text-white'
                          : delayMinutes
                            ? 'bg-amber-600 text-white'
                            : 'bg-[#5D0B26] text-white'
                      }`}>
                        {emergencyHold ? '⚠️ EMERGENCY HOLD (THIS SCREEN ONLY)' : delayMinutes ? `⏱ ${delayMinutes}m DELAY (THIS SCREEN ONLY)` : '🟢 ON SCHEDULE'}
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
                      className={`min-h-9 px-3 text-xs font-semibold rounded-lg border transition ${
                        emergencyHold
                          ? 'bg-rose-700 text-white border-rose-800'
                          : 'bg-white text-rose-800 border-rose-300 hover:bg-rose-50'
                      }`}
                    >
                      {emergencyHold ? '✓ Resume Normal Queue' : '🛑 Mark emergency hold'}
                    </button>

                    <button
                      type="button"
                      onClick={() => setDelayMinutes(delayMinutes ? null : 15)}
                      className={`min-h-9 px-3 text-xs font-semibold rounded-lg border transition ${
                        delayMinutes
                          ? 'bg-amber-600 text-white border-amber-700'
                          : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'
                      }`}
                    >
                      {delayMinutes ? '✓ Clear delay note' : '⏱ Note 15 min delay'}
                    </button>
                  </div>
                </div>

                {emergencyHold && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-2.5 text-xs text-rose-900 font-medium flex items-center justify-between">
                    <span>⚠️ Emergency hold is marked on this screen only. Reception has not been told: phone them to stop sending new walk-ins.</span>
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

            {/* One toolbar: the day, the doctor, and the counts for that day. */}
            <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div>
                <label htmlFor="queue-date" className="mb-1 block text-xs font-semibold uppercase text-slate-600">Date</label>
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={() => handleDateShift(-1)} className={SECONDARY_BUTTON} aria-label="Previous day">&larr;</button>
                  <input
                    id="queue-date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="min-h-9 rounded-lg border border-slate-300 px-2 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                  />
                  <button type="button" onClick={() => handleDateShift(1)} className={SECONDARY_BUTTON} aria-label="Next day">&rarr;</button>
                  <button type="button" onClick={() => setSelectedDate(istToday())} className={SECONDARY_BUTTON}>Today</button>
                </div>
              </div>
              <div>
                <label htmlFor="doctor-filter" className="mb-1 block text-xs font-semibold uppercase text-slate-600">Doctor</label>
                <select
                  id="doctor-filter"
                  value={selectedDoctorId ?? ''}
                  onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : undefined)}
                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#8E1C3D]"
                >
                  <option value="">All doctors</option>
                  {doctors?.map((d: DoctorOut) => (
                    <option key={d.id} value={d.id}>
                      {d.name_en}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
                <span><strong>{appointments.length}</strong> booked</span>
                <span><strong>{countWith('ARRIVED')}</strong> waiting</span>
                <span><strong>{countWith('IN_CONSULTATION')}</strong> with doctor</span>
                <span><strong>{countWith('DONE')}</strong> completed</span>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              {isPending ? (
                <TableSkeleton label="Loading appointments schedule..." rows={5} columns={5} />
              ) : isError ? (
                <div className="p-8 text-center text-red-700">Failed to load appointments: {error.message}</div>
              ) : appointments.length === 0 ? (
                <div className="space-y-4 p-12 text-center">
                  <p className="text-sm font-medium text-slate-600">No bookings for this date and doctor.</p>
                  {canManageAppointments && (
                    <Link to="/reception/patients/new" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50">
                      <IconUserPlus className="h-4 w-4 text-emerald-800" />
                      New patient
                    </Link>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">Token</th>
                        <th scope="col" className="px-4 py-3">Patient</th>
                        <th scope="col" className="px-4 py-3">Doctor</th>
                        <th scope="col" className="px-4 py-3">Status</th>
                        <th scope="col" className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {appointments.map((appt) => (
                        <tr key={appt.id} className="hover:bg-slate-50/80">
                          <td className="px-4 py-3">
                            <span className="inline-flex rounded bg-slate-100 px-2.5 py-1 font-mono text-sm font-bold text-slate-900">
                              {formatToken(appt.token_number)}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <Link to={`/reception/patients/${appt.patient_id}`} className="block font-semibold text-[#5D0B26] hover:underline">
                              {appt.patient_name}
                            </Link>
                            <span className="flex gap-2 font-mono text-xs text-slate-500">
                              <span>{appt.patient_urn}</span>
                              <span>&bull;</span>
                              <span>{appt.patient_mobile}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-medium text-slate-900">{appt.doctor_name_en}</span>
                            {appt.doctor_name_hi && (
                              <span className="block font-hindi text-xs text-slate-500">{appt.doctor_name_hi}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${STATUS_CLASS[appt.status]}`}>
                              {STATUS_LABEL[appt.status]}
                            </span>
                            {appt.status === 'CANCELLED' && appt.cancellation_reason && (
                              <span className="mt-1 block max-w-xs truncate text-xs text-slate-500">{appt.cancellation_reason}</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {canManageAppointments ? (
                              <RowActions
                                appt={appt}
                                onMarkNoShow={() => handleUpdateStatus(appt, 'NO_SHOW')}
                                onCancel={() => setCancellingAppt(appt)}
                                showCallCabin={isDoctor}
                              />
                            ) : (
                              <span className="text-xs font-medium text-slate-500">View only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {cancellingAppt && (
              <Modal
                open
                variant="destructive"
                title="Cancel Appointment"
                onClose={() => setCancellingAppt(null)}
                busy={updateStatusMutation.isPending}
                className="max-w-md"
              >
                <div className="space-y-4">
                  <p className="text-xs text-neutral-600">
                    Provide a cancellation reason for {cancellingAppt.token_number != null ? `Token ${formatToken(cancellingAppt.token_number)}` : 'this booking'} ({cancellingAppt.patient_name}).
                  </p>
                  <textarea
                    data-autofocus
                    aria-label="Cancellation reason"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Reason for cancellation (e.g. Patient called to reschedule)..."
                    rows={3}
                    required
                    className="w-full rounded border border-neutral-300 p-2 text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
                  />
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCancellingAppt(null)
                        setCancelReason('')
                      }}
                      className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      disabled={!cancelReason.trim() || updateStatusMutation.isPending}
                      onClick={() => handleUpdateStatus(cancellingAppt, 'CANCELLED', cancelReason.trim())}
                      className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      Confirm Cancellation
                    </button>
                  </div>
                </div>
              </Modal>
            )}
          </div>
        ) : (
          canViewFollowUps ? (
            <div id="appointments-panel-followup" role="tabpanel" aria-labelledby="appointments-tab-followup">
              <FollowUpVisits />
            </div>
          ) : (
            <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Prescription follow-up information is available to the treating doctor only. Return to the token queue to continue.
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
