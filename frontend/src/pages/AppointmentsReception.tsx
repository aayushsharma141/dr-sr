import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { AppointmentBookingModal } from '../components/AppointmentBookingModal'
import {
  useAppointments,
  useDoctors,
  usePrescriptionFollowUps,
  useUpdateAppointmentStatus,
  useMe,
} from '../api/queries'
import type { Appointment, AppointmentStatus, DoctorOut } from '../api/types'


type FollowUpWindow = 'all' | 'today' | 'week' | 'overdue'
type AppointmentTab = 'today' | 'scheduled' | 'followup'

function clinicDateValue(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function clinicToday() {
  return clinicDateValue(new Date())
}

function clinicDateAfter(days: number) {
  const [year, month, day] = clinicToday().split('-').map(Number)
  return clinicDateValue(new Date(Date.UTC(year, month - 1, day + days, 12)))
}

function visitTypeLabel(value: Appointment['visit_type']) {
  switch (value) {
    case 'NEW_CONSULTATION': return 'New consultation'
    case 'FOLLOW_UP': return 'Follow-up review'
    case 'PHYSIOTHERAPY_SESSION': return 'Physiotherapy visit'
    case 'REVIEW': return 'Progress review'
    default: return 'Visit'
  }
}

function FollowUpVisits() {
  const [selectedWindow, setSelectedWindow] = useState<FollowUpWindow>('all')
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
    { key: 'all', label: 'All dated follow-ups' },
    { key: 'today', label: 'Due today' },
    { key: 'week', label: 'Next 7 days' },
    { key: 'overdue', label: 'Overdue' },
  ]

  return (
    <section className="space-y-4" aria-labelledby="followups-heading">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 id="followups-heading" className="text-lg font-bold text-slate-900">
            Follow-up & Visits
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
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500" role="status">
          Loading prescription follow-ups…
        </div>
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
              <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600">
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
                    ? 'bg-rose-50 text-rose-800 ring-rose-200'
                    : dueToday
                      ? 'bg-amber-50 text-amber-800 ring-amber-200'
                      : 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/80">
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
                        Rx #{item.id}<span className="ml-2 text-xs text-slate-400">· {item.items_count} item{item.items_count === 1 ? '' : 's'}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${statusClass}`}>
                          {status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/reception/patients/${item.patient_id}`}
                          className="inline-flex min-h-10 items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
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
  )
}

export function AppointmentsReception() {
  const { data: me } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const canManageAppointments = me?.permissions.includes('appointment:write') === true
  const canViewFollowUps = me?.permissions.includes('prescription:read') === true
  const activeTab: AppointmentTab =
    requestedTab === 'scheduled'
      ? 'scheduled'
      : requestedTab === 'followup' && canViewFollowUps
        ? 'followup'
        : 'today'
  const selectTab = (tab: AppointmentTab) => setSearchParams({ tab })
  const [selectedDate, setSelectedDate] = useState(clinicToday)
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined)
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [bookingMode, setBookingMode] = useState<'WALK_IN' | 'SCHEDULED'>('WALK_IN')
  const [conflictError, setConflictError] = useState<string | null>(null)

  // Cancel dialog state
  const [cancellingAppt, setCancellingAppt] = useState<Appointment | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const { data: doctors } = useDoctors(true)
  const clinicRangeStart = clinicToday()
  const clinicRangeEnd = clinicDateAfter(30)
  const appointmentFilters =
    activeTab === 'scheduled'
      ? {
          date_from: clinicRangeStart,
          date_to: clinicRangeEnd,
          doctor_id: selectedDoctorId,
          booking_mode: 'SCHEDULED' as const,
          has_token: false,
          status: 'BOOKED',
        }
      : {
          appointment_date: selectedDate,
          doctor_id: selectedDoctorId,
          has_token: true,
        }
  const {
    data: appointmentsData,
    isPending,
    isError,
    error,
    refetch,
  } = useAppointments(appointmentFilters, activeTab !== 'followup')

  const updateStatusMutation = useUpdateAppointmentStatus()

  const handleDateShift = (days: number) => {
    const [year, month, day] = selectedDate.split('-').map(Number)
    setSelectedDate(clinicDateValue(new Date(Date.UTC(year, month - 1, day + days, 12))))
  }

  const handleSetToday = () => {
    setSelectedDate(clinicToday())
  }

  const handleUpdateStatus = async (
    appt: Appointment,
    newStatus: AppointmentStatus,
    reason?: string,
  ) => {
    setConflictError(null)
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
      if (err instanceof Error) {
        setConflictError(err.message)
      } else {
        setConflictError('Failed to update status.')
      }
    }
  }

  const appointments = appointmentsData?.appointments || []

  // Compute metrics
  const totalCount = appointments.length
  const waitingCount = appointments.filter((a) => a.status === 'ARRIVED').length
  const inConsultCount = appointments.filter((a) => a.status === 'IN_CONSULTATION').length
  const doneCount = appointments.filter((a) => a.status === 'DONE').length

  const getStatusBadge = (status: AppointmentStatus) => {
    switch (status) {
      case 'BOOKED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Booked</span>
      case 'ARRIVED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Arrived (Waiting)</span>
      case 'IN_CONSULTATION':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800">In Consultation</span>
      case 'DONE':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-800">Completed</span>
      case 'CANCELLED':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200 text-neutral-700">Cancelled</span>
      case 'NO_SHOW':
        return <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-200 text-neutral-700">No Show</span>
    }
  }

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-6">
        <div role="tablist" aria-label="Appointment workspace" className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
          <button
            type="button"
            role="tab"
            id="appointments-tab-today"
            aria-controls="appointments-panel-today"
            aria-selected={activeTab === 'today'}
            onClick={() => selectTab('today')}
            className={`min-h-11 rounded-lg border-b-2 px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] ${activeTab === 'today' ? 'border-[#C39A35] bg-white text-[#5D0B26]' : 'border-transparent text-slate-600 hover:bg-white hover:text-[#5D0B26]'}`}
          >
            Today's Queue
          </button>
          <button
            type="button"
            role="tab"
            id="appointments-tab-scheduled"
            aria-controls="appointments-panel-scheduled"
            aria-selected={activeTab === 'scheduled'}
            onClick={() => selectTab('scheduled')}
            className={`min-h-11 rounded-lg border-b-2 px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] ${activeTab === 'scheduled' ? 'border-[#C39A35] bg-white text-[#5D0B26]' : 'border-transparent text-slate-600 hover:bg-white hover:text-[#5D0B26]'}`}
          >
            Scheduled Visits
          </button>
          {canViewFollowUps && (
            <button
              type="button"
              role="tab"
              id="appointments-tab-followup"
              aria-controls="appointments-panel-followup"
              aria-selected={activeTab === 'followup'}
              onClick={() => selectTab('followup')}
              className={`min-h-11 rounded-lg border-b-2 px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] ${activeTab === 'followup' ? 'border-[#C39A35] bg-white text-[#5D0B26]' : 'border-transparent text-slate-600 hover:bg-white hover:text-[#5D0B26]'}`}
            >
              Prescription Follow-up Reminders
            </button>
          )}
        </div>

        {activeTab === 'today' ? (
          <div id="appointments-panel-today" role="tabpanel" aria-labelledby="appointments-tab-today" className="space-y-6">
        {conflictError && (
          <ConflictBanner
            onReload={() => {
              setConflictError(null)
              refetch()
            }}
          />
        )}

        {/* Header bar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-lg border border-neutral-200 shadow-xs">
          <div>
            <h2 className="text-xl font-bold text-neutral-900">
              Reception Appointments & Token Queue
            </h2>
            <p className="text-xs text-neutral-500 mt-1">
              Book daily tokens, track arrival in waiting hall, and coordinate with doctors.
            </p>
          </div>
          {canManageAppointments ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setBookingMode('WALK_IN')
                  setIsBookingOpen(true)
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#5D0B26] px-4 text-sm font-semibold text-white shadow-xs hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Walk-in Token
              </button>
              <button
                type="button"
                onClick={() => {
                  setBookingMode('SCHEDULED')
                  setIsBookingOpen(true)
                }}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-[#5D0B26] bg-white px-4 text-sm font-semibold text-[#5D0B26] hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3v3m10-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Z" />
                </svg>
                Schedule Future Visit
              </button>
            </div>
          ) : (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-600">Read-only schedule</span>
          )}
        </div>

        {/* Date Filter & Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Date & Doctor Navigator */}
          <div className="bg-white p-5 rounded-lg border border-neutral-200 space-y-4 shadow-xs">
            <div>
              <label htmlFor="queue-date" className="block text-xs font-semibold text-neutral-600 uppercase mb-2">
                Queue Date
              </label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDateShift(-1)}
                  className="px-2 py-1.5 border border-neutral-300 rounded text-xs font-bold hover:bg-neutral-50"
                  title="Previous Day"
                >
                  &larr;
                </button>
                <input
                  id="queue-date"
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="flex-1 p-1.5 border border-neutral-300 rounded text-sm text-center font-medium focus:outline-none focus:ring-1 focus:ring-red-800"
                />
                <button
                  onClick={() => handleDateShift(1)}
                  className="px-2 py-1.5 border border-neutral-300 rounded text-xs font-bold hover:bg-neutral-50"
                  title="Next Day"
                >
                  &rarr;
                </button>
                <button
                  onClick={handleSetToday}
                  className="px-2.5 py-1.5 bg-neutral-100 hover:bg-neutral-200 rounded text-xs font-semibold text-neutral-800"
                >
                  Today
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="doctor-filter" className="block text-xs font-semibold text-neutral-600 uppercase mb-2">
                Filter by Doctor
              </label>
              <select
                id="doctor-filter"
                value={selectedDoctorId ?? ''}
                onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              >
                <option value="">All Consulting Doctors</option>
                {doctors?.map((d: DoctorOut) => (
                  <option key={d.id} value={d.id}>
                    {d.name_en}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Metrics summary */}
          <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs flex flex-col justify-center">
              <span className="text-xs uppercase font-semibold text-neutral-500">Total Booked</span>
              <span className="text-2xl font-bold text-neutral-900 mt-1">{totalCount}</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-amber-200 bg-amber-50/30 shadow-xs flex flex-col justify-center">
              <span className="text-xs uppercase font-semibold text-amber-800">Waiting (Arrived)</span>
              <span className="text-2xl font-bold text-amber-900 mt-1">{waitingCount}</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-purple-200 bg-purple-50/30 shadow-xs flex flex-col justify-center">
              <span className="text-xs uppercase font-semibold text-purple-800">In Consultation</span>
              <span className="text-2xl font-bold text-purple-900 mt-1">{inConsultCount}</span>
            </div>
            <div className="bg-white p-4 rounded-lg border border-green-200 bg-green-50/30 shadow-xs flex flex-col justify-center">
              <span className="text-xs uppercase font-semibold text-green-800">Completed</span>
              <span className="text-2xl font-bold text-green-900 mt-1">{doneCount}</span>
            </div>
          </div>
        </div>

        {/* Appointments Table */}
        <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-200 flex justify-between items-center">
            <h3 className="font-bold text-neutral-900">
              Appointments Schedule ({selectedDate})
            </h3>
            <span className="text-xs text-neutral-500 font-mono">
              {appointments.length} record{appointments.length === 1 ? '' : 's'}
            </span>
          </div>

          {isPending ? (
            <div className="p-8 text-center text-neutral-500">Loading appointments schedule...</div>
          ) : isError ? (
            <div className="p-8 text-center text-red-700">Failed to load appointments: {error.message}</div>
          ) : appointments.length === 0 ? (
            <div className="p-12 text-center text-neutral-500 space-y-3">
              <p>No appointments booked for this date and filter.</p>
              {canManageAppointments && (
                <button
                  type="button"
                  onClick={() => {
                    setBookingMode('WALK_IN')
                    setIsBookingOpen(true)
                  }}
                  className="min-h-11 rounded-lg bg-slate-100 px-4 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                >
                  Add First Walk-in Token
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-neutral-50 text-neutral-600 font-semibold border-b border-neutral-200 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-4">Token #</th>
                    <th className="py-3 px-4">Patient</th>
                    <th className="py-3 px-4">Doctor</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Remarks</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {appointments.map((appt) => (
                    <tr key={appt.id} className="hover:bg-neutral-50/80 transition-colors">
                      <td className="py-3 px-4 font-mono font-bold text-neutral-900 text-base">
                        <span className="inline-flex items-center px-2.5 py-1 rounded bg-neutral-100 text-neutral-900">
                          #{appt.token_number}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          to={`/reception/patients/${appt.patient_id}`}
                          className="font-bold text-red-950 hover:underline block"
                        >
                          {appt.patient_name}
                        </Link>
                        <div className="text-xs text-neutral-500 font-mono flex gap-2 mt-0.5">
                          <span>{appt.patient_urn}</span>
                          <span>&bull;</span>
                          <span>{appt.patient_mobile}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-medium text-neutral-900">{appt.doctor_name_en}</span>
                        {appt.doctor_name_hi && (
                          <span className="text-xs text-neutral-500 block font-hindi">
                            {appt.doctor_name_hi}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        {getStatusBadge(appt.status)}
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-500 max-w-xs truncate">
                        {appt.notes || (appt.cancellation_reason ? `Reason: ${appt.cancellation_reason}` : '-')}
                      </td>
                      <td className="py-3 px-4 text-right space-x-2">
                        {canManageAppointments ? (
                          <>
                        {appt.status === 'BOOKED' && (
                          <button
                            onClick={() => handleUpdateStatus(appt, 'ARRIVED')}
                            disabled={updateStatusMutation.isPending}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold shadow-xs"
                          >
                            Mark Arrived
                          </button>
                        )}
                        {(appt.status === 'BOOKED' || appt.status === 'ARRIVED') && (
                          <>
                            <button
                              onClick={() => setCancellingAppt(appt)}
                              className="px-2 py-1 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 rounded text-xs font-medium"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(appt, 'NO_SHOW')}
                              className="px-2 py-1 border border-neutral-300 hover:bg-neutral-100 text-neutral-700 rounded text-xs font-medium"
                            >
                              No-Show
                            </button>
                          </>
                        )}
                        {appt.status === 'IN_CONSULTATION' && (
                          <span className="text-xs text-purple-700 font-semibold italic">With Doctor</span>
                        )}
                        {appt.status === 'DONE' && (
                          <span className="text-xs text-green-700 font-semibold">&check; Done</span>
                        )}
                          </>
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

        {/* Booking Modal */}
        <AppointmentBookingModal
          isOpen={isBookingOpen}
          onClose={() => setIsBookingOpen(false)}
          initialDoctorId={selectedDoctorId}
          initialDate={selectedDate}
          initialMode={bookingMode}
          onSuccess={() => refetch()}
        />

        {/* Cancellation Reason Dialog */}
        {cancellingAppt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
              <h3 className="text-lg font-bold text-neutral-900">Cancel Appointment</h3>
              <p className="text-xs text-neutral-600">
                Provide a cancellation reason for Token #{cancellingAppt.token_number} ({cancellingAppt.patient_name}).
              </p>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Reason for cancellation (e.g. Patient called to reschedule)..."
                rows={3}
                required
                className="w-full p-2 border border-neutral-300 rounded text-sm focus:outline-none focus:ring-1 focus:ring-red-800"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setCancellingAppt(null)
                    setCancelReason('')
                  }}
                  className="px-3 py-1.5 border border-neutral-300 rounded text-sm hover:bg-neutral-50"
                >
                  Close
                </button>
                <button
                  type="button"
                  disabled={!cancelReason.trim() || updateStatusMutation.isPending}
                  onClick={() => handleUpdateStatus(cancellingAppt, 'CANCELLED', cancelReason.trim())}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-800 text-white rounded text-sm font-medium disabled:opacity-50"
                >
                  Confirm Cancellation
                </button>
              </div>
            </div>
          </div>
        )}
          </div>
        ) : activeTab === 'scheduled' ? (
          <div id="appointments-panel-scheduled" role="tabpanel" aria-labelledby="appointments-tab-scheduled" className="space-y-5">
            {conflictError && (
              <ConflictBanner
                onReload={() => {
                  setConflictError(null)
                  refetch()
                }}
              />
            )}

            <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#8E1C3D]">Future bookings</p>
                <h2 className="mt-1 text-xl font-bold text-slate-900">Scheduled Visits</h2>
                <p className="mt-1 max-w-2xl text-sm text-slate-600">
                  Date-based bookings for the next 30 clinic days. No fixed time is promised; the daily token is allocated when reception checks the patient in.
                </p>
              </div>
              {canManageAppointments && (
                <button
                  type="button"
                  onClick={() => {
                    setBookingMode('SCHEDULED')
                    setIsBookingOpen(true)
                  }}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-[#5D0B26] px-4 text-sm font-semibold text-white hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                >
                  Schedule Future Visit
                </button>
              )}
            </section>

            <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <label htmlFor="scheduled-doctor-filter" className="block text-xs font-bold uppercase tracking-wide text-slate-600">Filter by doctor</label>
                <select
                  id="scheduled-doctor-filter"
                  value={selectedDoctorId ?? ''}
                  onChange={(event) => setSelectedDoctorId(event.target.value ? Number(event.target.value) : undefined)}
                  className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 sm:min-w-64"
                >
                  <option value="">All consulting doctors</option>
                  {doctors?.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name_en}</option>)}
                </select>
              </div>
              <div className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{appointments.length}</span> pending scheduled visit{appointments.length === 1 ? '' : 's'}
                <span className="ml-2 text-xs text-slate-500">· {clinicRangeStart} to {clinicRangeEnd}</span>
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="font-bold text-slate-900">Upcoming scheduled visits</h3>
                <p className="mt-1 text-xs text-slate-500">Token numbers are intentionally blank until the patient arrives on the booked clinic date.</p>
              </div>
              {isPending ? (
                <div role="status" className="p-12 text-center text-sm text-slate-500">Loading scheduled visits…</div>
              ) : isError ? (
                <div role="alert" className="p-8 text-center text-sm text-rose-800">Unable to load scheduled visits: {error.message}</div>
              ) : appointments.length === 0 ? (
                <div className="space-y-3 p-12 text-center">
                  <p className="font-semibold text-slate-800">No pending scheduled visits in this date range.</p>
                  <p className="text-sm text-slate-500">Walk-in tokens and prescription reminders are managed in their separate workflows.</p>
                  {canManageAppointments && (
                    <button
                      type="button"
                      onClick={() => {
                        setBookingMode('SCHEDULED')
                        setIsBookingOpen(true)
                      }}
                      className="inline-flex min-h-11 items-center rounded-lg border border-[#5D0B26] px-4 text-sm font-semibold text-[#5D0B26] hover:bg-rose-50"
                    >
                      Create scheduled visit
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                      <tr>
                        <th scope="col" className="px-4 py-3">Clinic date</th>
                        <th scope="col" className="px-4 py-3">Patient</th>
                        <th scope="col" className="px-4 py-3">Visit category</th>
                        <th scope="col" className="px-4 py-3">Doctor</th>
                        <th scope="col" className="px-4 py-3">Token</th>
                        <th scope="col" className="px-4 py-3">Status</th>
                        <th scope="col" className="px-4 py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {appointments.map((appt) => {
                        const dueToday = appt.appointment_date === clinicToday()
                        return (
                          <tr key={appt.id} className="hover:bg-slate-50/80">
                            <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-800">{appt.appointment_date}</td>
                            <td className="px-4 py-3">
                              <Link to={`/reception/patients/${appt.patient_id}`} className="font-semibold text-[#5D0B26] hover:underline">{appt.patient_name}</Link>
                              <span className="mt-0.5 block font-mono text-xs text-slate-500">{appt.patient_urn} · {appt.patient_mobile}</span>
                            </td>
                            <td className="px-4 py-3 text-slate-700">{visitTypeLabel(appt.visit_type)}</td>
                            <td className="px-4 py-3 text-slate-700">{appt.doctor_name_en}</td>
                            <td className="px-4 py-3">
                              <span className="inline-flex rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-800">At check-in</span>
                            </td>
                            <td className="px-4 py-3">{getStatusBadge(appt.status)}</td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex justify-end gap-2">
                                {canManageAppointments && dueToday && appt.status === 'BOOKED' && (
                                  <button
                                    type="button"
                                    onClick={() => handleUpdateStatus(appt, 'ARRIVED')}
                                    disabled={updateStatusMutation.isPending}
                                    className="min-h-10 rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                                  >
                                    Mark Arrived · Allocate token
                                  </button>
                                )}
                                {canManageAppointments && appt.status === 'BOOKED' && (
                                  <button
                                    type="button"
                                    onClick={() => setCancellingAppt(appt)}
                                    className="min-h-10 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                  >
                                    Cancel
                                  </button>
                                )}
                                {!canManageAppointments && <span className="text-xs text-slate-500">View only</span>}
                                {canManageAppointments && !dueToday && <span className="self-center text-xs text-slate-500">Check-in opens on visit date</span>}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <AppointmentBookingModal
              isOpen={isBookingOpen}
              onClose={() => setIsBookingOpen(false)}
              initialDoctorId={selectedDoctorId}
              initialMode="SCHEDULED"
              onSuccess={() => refetch()}
            />

            {cancellingAppt && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div role="dialog" aria-modal="true" aria-labelledby="scheduled-cancel-title" className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-xl">
                  <h3 id="scheduled-cancel-title" className="text-lg font-bold text-slate-900">Cancel scheduled visit</h3>
                  <p className="text-sm text-slate-600">
                    Cancel booking #{cancellingAppt.id} for {cancellingAppt.patient_name} on {cancellingAppt.appointment_date}?
                  </p>
                  <textarea
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    placeholder="Reason for cancellation (required)…"
                    rows={3}
                    className="w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
                  />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => { setCancellingAppt(null); setCancelReason('') }} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700">Keep booking</button>
                    <button
                      type="button"
                      disabled={!cancelReason.trim() || updateStatusMutation.isPending}
                      onClick={() => handleUpdateStatus(cancellingAppt, 'CANCELLED', cancelReason.trim())}
                      className="min-h-11 rounded-lg bg-rose-700 px-4 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      Confirm cancellation
                    </button>
                  </div>
                </div>
              </div>
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
                Open today's queue
              </button>
            </div>
          )
        )}
      </div>
    </AppShell>
  )
}
