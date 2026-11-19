import { useNavigate } from 'react-router'
import type { TreatmentPlanOut } from '../dashboard-service'

interface RecentTreatmentPlansProps {
  plans?: TreatmentPlanOut[]
  isLoading?: boolean
}

export function RecentTreatmentPlans({ plans = [], isLoading }: RecentTreatmentPlansProps) {
  const navigate = useNavigate()

  // Display the top 2-3 active plans
  const displayPlans = plans.slice(0, 3)

  return (
    <div
      data-testid="recent-treatment-plans-card"
      className="bg-white rounded-xl border border-slate-200/80 shadow-2xs p-5 flex flex-col justify-between"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <h2 className="text-sm font-bold text-slate-900">Recent Treatment Plans</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate('/doctor/treatment-plans')}
          className="text-xs font-semibold text-rose-700 hover:text-rose-800 transition-colors cursor-pointer"
        >
          View All
        </button>
      </div>

      {/* Plan list */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            <span className="inline-block w-4 h-4 border-2 border-rose-700 border-t-transparent rounded-full animate-spin mr-2" />
            Loading treatment plans...
          </div>
        ) : displayPlans.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            No active treatment plans found.
          </div>
        ) : (
          displayPlans.map((plan) => {
            const total = plan.total_sessions ?? 0
            const completed = plan.completed_sessions ?? 0
            // Zero Guard: ensure no division by zero
            const progress = total > 0 ? Math.round((completed / total) * 100) : 0

            return (
              <div
                key={plan.id}
                onClick={() => navigate('/doctor/treatment-plans')}
                className="group cursor-pointer p-2 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 group-hover:text-rose-700 transition-colors truncate">
                      {plan.patient_name}
                    </div>
                    <div className="text-2xs text-slate-500 truncate">
                      {plan.plan_name || plan.condition_diagnosis} • {completed}/{total} sessions
                    </div>
                  </div>
                  <span className="text-xs font-bold text-slate-700 tabular-nums shrink-0">
                    {progress}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                    data-testid={`plan-progress-bar-${plan.id}`}
                  />
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
