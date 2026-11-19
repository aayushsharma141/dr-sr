import { useNavigate } from 'react-router'

interface QuickActionsProps {
  onOpenSearch?: () => void
  onOpenFollowUp?: () => void
  onOpenReports?: () => void
}

export function QuickActions({
  onOpenSearch,
  onOpenFollowUp,
  onOpenReports,
}: QuickActionsProps) {
  const navigate = useNavigate()

  return (
    <div
      data-testid="quick-actions-card"
      className="bg-white rounded-xl border border-slate-200/80 shadow-2xs p-5 flex flex-col justify-between"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-7 h-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-slate-900">Quick Actions</h2>
      </div>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* 1. Patient Search */}
        <button
          type="button"
          onClick={() => {
            if (onOpenSearch) onOpenSearch()
            else navigate('/reception/patients')
          }}
          data-testid="quick-action-patient-search"
          className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/60 hover:bg-blue-100/60 text-blue-900 flex items-center gap-2.5 transition-all text-left cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>
          <span className="text-xs font-bold leading-tight">Patient Search</span>
        </button>

        {/* 2. Create Follow-up */}
        <button
          type="button"
          onClick={() => {
            if (onOpenFollowUp) onOpenFollowUp()
            else navigate('/doctor/follow-ups')
          }}
          data-testid="quick-action-create-followup"
          className="p-3.5 rounded-xl border border-pink-100 bg-pink-50/60 hover:bg-pink-100/60 text-pink-900 flex items-center gap-2.5 transition-all text-left cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-pink-100 text-pink-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <span className="text-xs font-bold leading-tight">Create Follow-up</span>
        </button>

        {/* 3. Treatment Plan */}
        <button
          type="button"
          onClick={() => navigate('/doctor/treatment-plans')}
          data-testid="quick-action-treatment-plan"
          className="p-3.5 rounded-xl border border-emerald-100 bg-emerald-50/60 hover:bg-emerald-100/60 text-emerald-900 flex items-center gap-2.5 transition-all text-left cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
              />
            </svg>
          </div>
          <span className="text-xs font-bold leading-tight">Treatment Plan</span>
        </button>

        {/* 4. Reports */}
        <button
          type="button"
          onClick={() => {
            if (onOpenReports) onOpenReports()
            else navigate('/reception/reports')
          }}
          data-testid="quick-action-reports"
          className="p-3.5 rounded-xl border border-purple-100 bg-purple-50/60 hover:bg-purple-100/60 text-purple-900 flex items-center gap-2.5 transition-all text-left cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
          </div>
          <span className="text-xs font-bold leading-tight">Reports</span>
        </button>
      </div>
    </div>
  )
}
