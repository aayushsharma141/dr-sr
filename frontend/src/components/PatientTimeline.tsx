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
  default: 'bg-rose-50 text-[#8E1C3D] border border-rose-200',
  secondary: 'bg-slate-100 text-slate-800 border border-slate-200',
  destructive: 'bg-red-50 text-red-700 border border-red-200',
  outline: 'border border-slate-300 text-slate-700',
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
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        <div className="h-6 w-6 rounded-md bg-slate-300 mx-auto animate-bounce" />
        <p className="mt-4">Loading patient history...</p>
      </div>
    )
  }

  if (error) {
    return <div className="p-6 text-center text-sm text-red-600">Failed to load patient history.</div>
  }

  if (!visibleTimeline || visibleTimeline.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 flex flex-col items-center gap-3" >
        <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-2xl opacity-50">
          <svg className="h-6 w-6 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">            <circle cx="9" cy="21" r="1" />            <circle cx="20" cy="10" r="1" />            <circle cx="9" cy="3" r="1" />          </svg>        </div>        <p className="text-sm font-medium text-slate-600">No recorded history found for this patient yet.</p>      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">
          {heading}
        </h3>
        <span className="text-xs text-slate-600 font-medium">
          {visibleTimeline.length} interaction(s) recorded
        </span>
      </div>

      <div className="relative border-l-2 border-slate-200 pl-6 space-y-6">
        {visibleTimeline.map((item: TimelineItemOut, index) => {
          const icon = eventTypeIcons[item.event_type] || '📌'
          const badgeClass =
            badgeColorClasses[item.badge_variant || 'default'] || badgeColorClasses.default
          const formattedDate = new Date(item.event_date).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })

          const rowDelay = index * 50

          return (
            <div key={item.id} className="relative group" style={{ transitionDelay: `${rowDelay}ms` }}>
              {/* Dot / Icon */}
              <div className="absolute -left-[35px] top-0 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-100 text-sm shadow-xs">
                {icon}
              </div>

              {/* Card */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs transition hover:shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900">
                      {item.title}
                    </span>
                    {item.badge && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${badgeClass}`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium text-slate-700 font-medium">{formattedDate}</span>
                </div>

                {item.subtitle && (
                  <p className="mt-1 text-xs font-medium text-slate-700">
                    {item.subtitle}
                  </p>
                )}

                {item.summary && (
                  <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                    {item.summary}
                  </p>
                )}

                {/* Event specific actions */}
                {item.event_type === 'PAYMENT' && onViewReceipt && Boolean(item.metadata?.payment_id) && (
                  <div className="mt-3 pt-2 border-t border-slate-100 flex justify-end">
                    <button
                      type="button"
                      onClick={() => onViewReceipt(item.metadata.payment_id as number)}
                      className="text-xs font-semibold text-[#8E1C3D] hover:underline hover:text-[#741732]"
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
