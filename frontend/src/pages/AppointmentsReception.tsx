import { useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { AppointmentBookingModal } from '../components/AppointmentBookingModal'
import {
  useAppointments,
  useDoctors,
  useUpdateAppointmentStatus,
  useMe,
} from '../api/queries'
import type { Appointment, AppointmentStatus, DoctorOut } from '../api/types'

export function AppointmentsReception() {
  const { data: me } = useMe()
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split('T')[0],
  )
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | undefined>(undefined)
  const [isBookingOpen, setIsBookingOpen] = useState(false)
  const [conflictError, setConflictError] = useState<string | null>(null)

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

  const handleSetToday = () => {
    setSelectedDate(new Date().toISOString().split('T')[0])
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
    <AppShell name={me?.full_name || 'Reception Staff'} role="RECEPTION">
      <div className="space-y-6">
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
          <button
            onClick={() => setIsBookingOpen(true)}
            className="px-4 py-2 bg-red-900 text-white rounded font-medium hover:bg-red-800 text-sm shadow-xs flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Book New Appointment
          </button>
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
              <button
                onClick={() => setIsBookingOpen(true)}
                className="px-4 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 text-xs font-semibold rounded"
              >
                Book First Appointment
              </button>
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
    </AppShell>
  )
}
