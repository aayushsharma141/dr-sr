import { useNavigate } from 'react-router'
import type { Appointment } from '../dashboard-service'

interface TodaysScheduleProps {
  appointments?: Appointment[]
  isLoading?: boolean
}

export function TodaysSchedule({ appointments = [], isLoading }: TodaysScheduleProps) {
  const navigate = useNavigate()

  // Format HH:MM:SS into 12-hour AM/PM
  const formatTime = (timeStr?: string | null, dateStr?: string | null) => {
    if (!timeStr) {
      if (dateStr) {
        const d = new Date(dateStr)
        if (!isNaN(d.getTime())) {
          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      }
      return 'Today'
    }
    const parts = timeStr.split(':')
    if (parts.length >= 2) {
      const hour = parseInt(parts[0], 10)
      const minute = parts[1]
      const period = hour >= 12 ? 'PM' : 'AM'
      const displayHour = hour % 12 === 0 ? 12 : hour % 12
      return `${String(displayHour).padStart(2, '0')}:${minute} ${period}`
    }
    return timeStr
  }

  // Filter or take upcoming/pre-booked appointments (max 5)
  const displayList = appointments.slice(0, 5)

  return (
    <div
      data-testid="todays-schedule-card"
      className="bg-white rounded-xl border border-slate-200/80 shadow-2xs overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <h2 className="text-sm font-bold text-slate-900">
            Today's Schedule ({appointments.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={() => navigate('/reception/appointments?tab=schedule')}
          className="text-xs font-semibold text-rose-700 hover:text-rose-800 transition-colors cursor-pointer"
        >
          View Full
        </button>
      </div>

      {/* Appointment List */}
      <div className="p-4 divide-y divide-slate-100">
        {isLoading ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            <span className="inline-block w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full animate-spin mr-2" />
            Loading schedule...
          </div>
        ) : displayList.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            No upcoming appointments scheduled for today.
          </div>
        ) : (
          displayList.map((item) => {
            const isCheckedIn =
              item.status === 'ARRIVED' ||
              item.status === 'CHECKED_IN' ||
              item.status === 'IN_CONSULTATION' ||
              item.status === 'COMPLETED' ||
              item.status === 'DONE'

            const tagLabel = item.notes?.slice(0, 16) || 'Review'

            return (
              <div
                key={item.id}
                className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                  <span className="font-semibold text-slate-800 tabular-nums shrink-0">
                    {formatTime(item.expected_time, item.appointment_date)}
                  </span>
                  <span className="font-bold text-slate-900 truncate">
                    {item.patient_name}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="px-2 py-0.5 rounded-full text-2xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                    {tagLabel}
                  </span>
                  {isCheckedIn ? (
                    <span
                      title="Checked in"
                      className="w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-xs"
                    >
                      ✓
                    </span>
                  ) : (
                    <span className="text-2xs text-slate-400 font-medium">Pending</span>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
