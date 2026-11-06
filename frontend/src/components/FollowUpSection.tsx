import React from 'react'
import type { DoctorOut } from '../api/types'

export interface FollowUpSectionProps {
  recommendedDate: string
  recommendedDoctorId: number | null
  clinicalReason: string
  doctors: DoctorOut[]
  onDateChange: (val: string) => void
  onDoctorChange: (id: number | null) => void
  onReasonChange: (val: string) => void
  onBookNow?: () => void
  onBlur?: () => void
  readOnly?: boolean
}

export function FollowUpSection({
  recommendedDate,
  recommendedDoctorId,
  clinicalReason,
  doctors,
  onDateChange,
  onDoctorChange,
  onReasonChange,
  onBookNow,
  onBlur,
  readOnly = false,
}: FollowUpSectionProps) {
  const todayStr = new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 pb-2">
        <h3 className="text-base font-semibold text-neutral-900">
          Follow-up Recommendation
        </h3>
        {onBookNow && recommendedDate && (
          <button
            type="button"
            onClick={onBookNow}
            className="px-3.5 py-1.5 border border-[#8E1C3D] text-[#8E1C3D] rounded text-xs font-semibold hover:bg-[#8E1C3D]/5 flex items-center gap-1.5 transition-colors"
          >
            <span>📅</span>
            Book Follow-up Appointment
          </button>
        )}
      </div>

      {!recommendedDate && !clinicalReason ? (
        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 text-xs text-neutral-600 space-y-1">
          <h4 className="font-semibold text-neutral-800">No Follow-up Scheduled</h4>
          <p>
            No follow-up review date has been recorded. Select a recommended follow-up date and doctor if a review visit is clinically indicated.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="followup-date" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
            Recommended Review Date
          </label>
          <input
            id="followup-date"
            type="date"
            min={todayStr}
            value={recommendedDate}
            disabled={readOnly}
            onChange={(e) => onDateChange(e.target.value)}
            onBlur={onBlur}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          />
        </div>

        <div>
          <label htmlFor="followup-doctor" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
            Recommended Doctor
          </label>
          <select
            id="followup-doctor"
            value={recommendedDoctorId ?? ''}
            disabled={readOnly}
            onChange={(e) => {
              const val = e.target.value ? Number(e.target.value) : null
              onDoctorChange(val)
            }}
            onBlur={onBlur}
            className="w-full px-3 py-2 border border-neutral-300 rounded text-sm focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
          >
            <option value="">Select doctor...</option>
            {doctors.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.name_en} ({doc.department?.name_en || 'General'})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="followup-clinical-reason" className="block text-xs font-semibold text-neutral-700 uppercase tracking-wider mb-1">
          Clinical Justification Notes (Doctor Only)
        </label>
        <textarea
          id="followup-clinical-reason"
          rows={3}
          value={clinicalReason}
          disabled={readOnly}
          onChange={(e) => onReasonChange(e.target.value)}
          onBlur={onBlur}
          placeholder="Internal medical rationale for follow-up review (strictly hidden from reception)..."
          className="w-full px-3 py-2 border border-neutral-300 rounded text-xs focus:ring-1 focus:ring-[#8E1C3D] disabled:bg-neutral-100"
        />
        <p className="text-[11px] text-neutral-500 mt-1">
          Note: This rationale is internal to doctors and is omitted from reception booking queues.
        </p>
      </div>
    </div>
  )
}
