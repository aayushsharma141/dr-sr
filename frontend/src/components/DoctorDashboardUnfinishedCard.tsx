import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { useUnfinishedEncounters } from '../api/queries'
import type { UnfinishedEncounter } from '../api/types'

export function formatRelativeTime(dateString: string): string {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    if (isNaN(diffMs) || diffMs < 0) return 'Just now'
    const diffSec = Math.floor(diffMs / 1000)
    if (diffSec < 60) return 'Just now'
    const diffMin = Math.floor(diffSec / 60)
    if (diffMin < 60) return `${diffMin}m ago`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  } catch {
    return dateString
  }
}

interface DoctorDashboardUnfinishedCardProps {
  encounters?: UnfinishedEncounter[]
  isLoading?: boolean
  onNavigate?: (id: number) => void
}

export function DoctorDashboardUnfinishedCard({
  encounters: propEncounters,
  isLoading: propLoading,
  onNavigate,
}: DoctorDashboardUnfinishedCardProps) {
  const navigate = useNavigate()
  const queryResult = useUnfinishedEncounters(propEncounters === undefined)

  const [hasFetchError, setHasFetchError] = useState(false)
  useEffect(() => {
    if (queryResult.isError) setHasFetchError(true)
    else if (queryResult.isSuccess) setHasFetchError(false)
  }, [queryResult.isError, queryResult.isSuccess])

  const drafts = propEncounters !== undefined ? propEncounters : (queryResult.data || [])
  const isError = propEncounters === undefined && (queryResult.isError || (hasFetchError && !queryResult.isSuccess))
  const isLoading = propLoading !== undefined ? propLoading : (queryResult.isLoading && !isError)

  const handleResume = (id: number) => {
    if (onNavigate) {
      onNavigate(id)
    } else {
      navigate(`/doctor/encounters/${id}`)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              isError
                ? 'bg-red-600'
                : drafts.length > 0
                ? 'bg-amber-500 animate-pulse'
                : 'bg-emerald-600'
            }`}
          />
          <h2 className="text-base font-bold text-slate-900">
            Unfinished Consultations
          </h2>
          <span
            data-testid="unfinished-draft-count"
            className={`tabular-nums text-xs font-bold px-2 py-0.5 rounded-full border ${
              isError
                ? 'bg-red-50 text-red-800 border-red-200'
                : drafts.length > 0
                ? 'bg-amber-50 text-amber-900 border-amber-200'
                : 'bg-slate-100 text-slate-700 border-slate-200'
            }`}
          >
            {isError ? '—' : drafts.length}
          </span>
        </div>
        <span className="text-xs text-amber-800 font-medium hidden sm:inline">
          In-progress consultation drafts
        </span>
      </div>

      {/* Body / Table / Error / Empty state */}
      {isLoading ? (
        <div className="p-8 text-center text-sm text-slate-600">
          Loading unfinished drafts...
        </div>
      ) : isError ? (
        <div
          role="alert"
          data-testid="unfinished-consultations-error"
          className="p-6 bg-red-50 text-red-900 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div>
            <p className="text-sm font-semibold text-red-900">
              Could not load unfinished consultations
            </p>
            <p className="text-xs text-red-800 mt-0.5">
              {queryResult.error instanceof Error
                ? queryResult.error.message
                : 'Please retry to check for open consultation drafts.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void queryResult.refetch()}
            disabled={queryResult.isFetching}
            className="shrink-0 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {queryResult.isFetching ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      ) : drafts.length === 0 ? (
        <div className="p-8 text-center" data-testid="unfinished-empty-state">
          <div className="mx-auto w-10 h-10 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-800 mb-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-semibold text-slate-900 text-base">
            No Unfinished Consultations
          </h3>
          <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
            All active clinical encounters have been finalised. Select a patient from today's queue to begin a new consultation.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-5 py-3">Patient Name</th>
                <th className="px-4 py-3">URN</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-5 py-3.5 font-medium text-slate-900">
                    {draft.patient_name}
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="font-mono text-xs px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold border border-slate-200">
                      {draft.patient_urn}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                      {draft.department_name || (draft.department_id === 2 ? 'OPHTHALMOLOGY' : 'PHYSIOTHERAPY')}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-slate-600 tabular-nums">
                    {formatRelativeTime(draft.started_at)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      onClick={() => handleResume(draft.id)}
                      className="bg-brand-700 hover:bg-brand-800 text-white px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors shadow-2xs"
                    >
                      Resume Consultation Draft
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
