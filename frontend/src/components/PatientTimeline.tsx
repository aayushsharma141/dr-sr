import React from 'react'
import { usePatientTimeline } from '../api/queries'
import type { TimelineItemOut } from '../api/types'

interface PatientTimelineProps {
  patientId: number
  eventTypes?: string[]
  heading?: string
  onViewReceipt?: (paymentId: number) => void
}

const eventTypeIcons: Record<string, string> = {
  APPOINTMENT: '📅',
  ENCOUNTER: '🩺',
  PRESCRIPTION: '💊',
  TREATMENT_PLAN: '📦',
  TREATMENT_SESSION: '⚡',
  PAYMENT: '💳',
}

const badgeColorClasses: Record<string, string> = {
  default: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  secondary: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300',
  destructive: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  outline: 'border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-300',
}

export const PatientTimeline: React.FC<PatientTimelineProps> = ({
  patientId,
  eventTypes,
  heading = 'Unified Chronological History',
  onViewReceipt,
}) => {
  const { data: timeline, isLoading, error } = usePatientTimeline(patientId)
  const visibleTimeline = eventTypes
    ? (timeline ?? []).filter((item) => eventTypes.includes(item.event_type))
    : timeline

  if (isLoading) {
    return <div className="p-6 text-center text-sm text-slate-500">Loading patient history...</div>
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-red-600">Failed to load patient history.</div>
  }

  if (!visibleTimeline || visibleTimeline.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-800">
        No recorded history found for this patient yet.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900 dark:text-white">
          {heading}
        </h3>
        <span className="text-xs text-slate-600">
          {visibleTimeline.length} interaction(s) recorded
        </span>
      </div>

      <div className="relative border-l-2 border-slate-200 pl-6 space-y-6 dark:border-slate-800">
        {visibleTimeline.map((item: TimelineItemOut) => {
          const icon = eventTypeIcons[item.event_type] || '📌'
          const badgeClass =
            badgeColorClasses[item.badge_variant || 'default'] || badgeColorClasses.default
          const formattedDate = new Date(item.event_date).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })

          return (
            <div key={item.id} className="relative group">
              {/* Dot / Icon */}
              <div className="absolute -left-[35px] top-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-sm shadow-sm dark:border-slate-900 dark:bg-slate-800">
                {icon}
              </div>

              {/* Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-white">
                      {item.title}
                    </span>
                    {item.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-sm font-bold uppercase tracking-wider ${badgeClass}`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-slate-600">{formattedDate}</span>
                </div>

                {item.subtitle && (
                  <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                    {item.subtitle}
                  </p>
                )}

                {item.summary && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {item.summary}
                  </p>
                )}

                {/* Event specific actions */}
                {item.event_type === 'PAYMENT' && onViewReceipt && Boolean(item.metadata?.payment_id) && (
                  <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onViewReceipt(item.metadata.payment_id as number)}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400"
                    >
                      View / Print Receipt Slip →
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
