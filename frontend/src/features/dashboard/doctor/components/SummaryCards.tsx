import type { DoctorDashboardSummary } from '../dashboard-service'

interface SummaryCardsProps {
  summary?: DoctorDashboardSummary
  isLoading?: boolean
  activeTab?: 'all' | 'waiting' | 'in_consultation' | 'scheduled'
  onSelectTab?: (tab: 'all' | 'waiting' | 'in_consultation' | 'scheduled') => void
  onFocusSchedule?: () => void
  onFocusDrafts?: () => void
}

export function SummaryCards({
  summary,
  isLoading,
  activeTab,
  onSelectTab,
  onFocusSchedule,
  onFocusDrafts,
}: SummaryCardsProps) {
  const waiting = summary?.waiting_count ?? 0
  const inConsult = summary?.in_consultation_count ?? 0
  const scheduled = summary?.scheduled_count ?? 0
  const completed = summary?.completed_count ?? 0
  const drafts = summary?.pending_drafts_count ?? 0

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5 mb-5">
      {/* 1. Waiting */}
      <button
        type="button"
        onClick={() => onSelectTab?.('waiting')}
        data-testid="card-waiting"
        className={`bg-white rounded-xl p-4 border text-left transition-all hover:shadow-md cursor-pointer ${
          activeTab === 'waiting'
            ? 'border-pink-500 ring-2 ring-pink-100 shadow-xs'
            : 'border-slate-200/80 shadow-2xs hover:border-pink-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-50 text-pink-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              Waiting
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {isLoading ? (
                <span className="inline-block w-8 h-6 bg-slate-100 animate-pulse rounded" />
              ) : (
                waiting
              )}
            </div>
          </div>
        </div>
      </button>

      {/* 2. In Consultation */}
      <button
        type="button"
        onClick={() => onSelectTab?.('in_consultation')}
        data-testid="card-in-consultation"
        className={`bg-white rounded-xl p-4 border text-left transition-all hover:shadow-md cursor-pointer ${
          activeTab === 'in_consultation'
            ? 'border-blue-500 ring-2 ring-blue-100 shadow-xs'
            : 'border-slate-200/80 shadow-2xs hover:border-blue-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              In Consultation
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {isLoading ? (
                <span className="inline-block w-8 h-6 bg-slate-100 animate-pulse rounded" />
              ) : (
                inConsult
              )}
            </div>
          </div>
        </div>
      </button>

      {/* 3. Scheduled Today */}
      <button
        type="button"
        onClick={() => {
          onFocusSchedule?.()
          onSelectTab?.('scheduled')
        }}
        data-testid="card-scheduled"
        className={`bg-white rounded-xl p-4 border text-left transition-all hover:shadow-md cursor-pointer ${
          activeTab === 'scheduled'
            ? 'border-purple-500 ring-2 ring-purple-100 shadow-xs'
            : 'border-slate-200/80 shadow-2xs hover:border-purple-300'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              Scheduled Today
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {isLoading ? (
                <span className="inline-block w-8 h-6 bg-slate-100 animate-pulse rounded" />
              ) : (
                scheduled
              )}
            </div>
          </div>
        </div>
      </button>

      {/* 4. Completed Today */}
      <button
        type="button"
        onClick={() => onSelectTab?.('all')}
        data-testid="card-completed"
        className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-2xs text-left transition-all hover:shadow-md hover:border-emerald-300 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              Completed Today
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {isLoading ? (
                <span className="inline-block w-8 h-6 bg-slate-100 animate-pulse rounded" />
              ) : (
                completed
              )}
            </div>
          </div>
        </div>
      </button>

      {/* 5. Pending Drafts */}
      <button
        type="button"
        onClick={() => onFocusDrafts?.()}
        data-testid="card-pending-drafts"
        className="bg-white rounded-xl p-4 border border-slate-200/80 shadow-2xs text-left transition-all hover:shadow-md hover:border-amber-300 cursor-pointer"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </div>
          <div>
            <div className="text-2xs font-semibold text-slate-500 uppercase tracking-wider">
              Pending Drafts
            </div>
            <div className="text-2xl font-bold text-slate-900 tabular-nums">
              {isLoading ? (
                <span className="inline-block w-8 h-6 bg-slate-100 animate-pulse rounded" />
              ) : (
                drafts
              )}
            </div>
          </div>
        </div>
      </button>
    </div>
  )
}
