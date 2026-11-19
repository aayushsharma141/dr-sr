import type { DoctorDashboardTodayGlance } from '../dashboard-service'

interface TodayGlanceProps {
  glance?: DoctorDashboardTodayGlance
  isLoading?: boolean
}

export function TodayGlance({ glance, isLoading }: TodayGlanceProps) {
  const completed = glance?.completed ?? 0
  const inProgress = glance?.in_progress ?? 0
  const pending = glance?.pending ?? 0
  const total = glance?.total ?? (completed + inProgress + pending)

  // SVG Donut calculation
  const radius = 38
  const circumference = 2 * Math.PI * radius // ~238.76

  const completedPct = total > 0 ? completed / total : 0
  const inProgressPct = total > 0 ? inProgress / total : 0
  const pendingPct = total > 0 ? pending / total : 0

  const completedLen = completedPct * circumference
  const inProgressLen = inProgressPct * circumference
  const pendingLen = pendingPct * circumference

  // Offsets (SVG strokeDashoffset counts backwards; starting at 12 o'clock means -90 deg rotation)
  const completedOffset = 0
  const inProgressOffset = -completedLen
  const pendingOffset = -(completedLen + inProgressLen)

  return (
    <div
      data-testid="today-glance-card"
      className="bg-white rounded-xl border border-slate-200/80 shadow-2xs p-5 flex flex-col justify-between"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
            />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-slate-900">My Today at a Glance</h2>
      </div>

      {/* Donut & Legend Container */}
      <div className="flex items-center justify-around gap-4 py-2">
        {/* SVG Donut */}
        <div className="relative w-32 h-32 flex items-center justify-center shrink-0">
          <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
            {/* Background track */}
            <circle
              cx="50"
              cy="50"
              r={radius}
              fill="transparent"
              stroke="#f1f5f9"
              strokeWidth="9"
            />

            {/* Zero State Guard: when total === 0, show neutral ring */}
            {total === 0 ? (
              <circle
                cx="50"
                cy="50"
                r={radius}
                fill="transparent"
                stroke="#e2e8f0"
                strokeWidth="9"
                data-testid="donut-neutral-track"
              />
            ) : (
              <>
                {/* 1. Completed Segment (Emerald) */}
                {completedLen > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="transparent"
                    stroke="#10b981"
                    strokeWidth="9"
                    strokeDasharray={`${completedLen} ${circumference - completedLen}`}
                    strokeDashoffset={completedOffset}
                    data-testid="donut-completed-segment"
                  />
                )}

                {/* 2. In Progress Segment (Blue) */}
                {inProgressLen > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="transparent"
                    stroke="#3b82f6"
                    strokeWidth="9"
                    strokeDasharray={`${inProgressLen} ${circumference - inProgressLen}`}
                    strokeDashoffset={inProgressOffset}
                    data-testid="donut-inprogress-segment"
                  />
                )}

                {/* 3. Pending / Draft Segment (Slate) */}
                {pendingLen > 0 && (
                  <circle
                    cx="50"
                    cy="50"
                    r={radius}
                    fill="transparent"
                    stroke="#94a3b8"
                    strokeWidth="9"
                    strokeDasharray={`${pendingLen} ${circumference - pendingLen}`}
                    strokeDashoffset={pendingOffset}
                    data-testid="donut-pending-segment"
                  />
                )}
              </>
            )}
          </svg>

          {/* Center Text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {isLoading ? (
              <span className="w-6 h-6 border-2 border-slate-300 border-t-emerald-600 rounded-full animate-spin" />
            ) : (
              <>
                <span
                  data-testid="donut-center-completed"
                  className="text-2xl font-black text-slate-900 tabular-nums leading-none"
                >
                  {completed}
                </span>
                <span className="text-3xs font-semibold text-slate-500 uppercase tracking-wider mt-0.5">
                  Completed
                </span>
              </>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col gap-2 text-xs min-w-32">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
            <span className="text-slate-500 font-medium">Total Consultations</span>
            <span data-testid="glance-total" className="font-bold text-slate-900 tabular-nums">
              {total}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Completed
            </span>
            <span data-testid="glance-completed" className="font-bold text-slate-900 tabular-nums">
              {completed}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              In Progress
            </span>
            <span data-testid="glance-in-progress" className="font-bold text-slate-900 tabular-nums">
              {inProgress}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-slate-600 font-medium">
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              Pending / Draft
            </span>
            <span data-testid="glance-pending" className="font-bold text-slate-900 tabular-nums">
              {pending}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
