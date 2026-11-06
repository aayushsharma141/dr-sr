import React from 'react'
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
  const queryResult = useUnfinishedEncounters()

  const drafts = propEncounters !== undefined ? propEncounters : (queryResult.data || [])
  const isLoading = propLoading !== undefined ? propLoading : queryResult.isLoading

  const handleResume = (id: number) => {
    if (onNavigate) {
      onNavigate(id)
    } else {
      navigate(`/doctor/encounters/${id}`)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-amber-200 shadow-xs overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 bg-amber-50/70 border-b border-amber-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
          <h2 className="text-lg font-bold text-neutral-900">
            Unfinished Consultations
          </h2>
          <span
            data-testid="unfinished-draft-count"
            className="bg-amber-100 text-amber-900 text-xs font-bold px-2 py-0.5 rounded-full"
          >
            {drafts.length}
          </span>
        </div>
        <span className="text-xs text-amber-800 font-medium hidden sm:inline">
          In-progress consultation drafts
        </span>
      </div>

      {/* Body / Table / Empty state */}
      {isLoading ? (
        <div className="p-8 text-center text-sm text-neutral-500">
          Loading unfinished drafts...
        </div>
      ) : drafts.length === 0 ? (
        <div className="p-8 text-center" data-testid="unfinished-empty-state">
          <div className="mx-auto w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center text-amber-600 mb-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="font-semibold text-neutral-900 text-base">
            No Unfinished Consultations
          </h3>
          <p className="text-sm text-neutral-600 mt-1 max-w-md mx-auto">
            All active clinical encounters have been finalised. Select a patient from today's queue to begin a new consultation.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-50/50 text-xs font-semibold text-neutral-600">
                <th className="px-6 py-3">Patient Name</th>
                <th className="px-4 py-3">URN</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-6 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {drafts.map((draft) => (
                <tr key={draft.id} className="hover:bg-amber-50/20 transition-colors">
                  <td className="px-6 py-4 font-medium text-neutral-900">
                    {draft.patient_name}
                  </td>
                  <td className="px-4 py-4">
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-semibold border border-neutral-200">
                      {draft.patient_urn}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">
                      {draft.department_name || (draft.department_id === 2 ? 'OPHTHALMOLOGY' : 'PHYSIOTHERAPY')}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-xs text-neutral-600">
                    {formatRelativeTime(draft.started_at)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => handleResume(draft.id)}
                      className="bg-[#8E1C3D] hover:bg-[#731631] text-white px-3 py-1.5 rounded text-xs sm:text-sm font-semibold transition-colors shadow-xs"
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
