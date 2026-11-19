import type { DoctorOut } from '../api/types'
import { istToday } from '../format'
import { IconCalendarTime } from './icons'

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
  dateError?: string | null
  retryError?: string | null
  onRetrySend?: () => Promise<void> | void
  isSendingFollowUp?: boolean
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
  dateError = null,
  retryError = null,
  onRetrySend,
  isSendingFollowUp = false,
}: FollowUpSectionProps) {
  const todayStr = istToday()

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
            className="px-3.5 py-1.5 border border-[#8E1C3D] text-[#8E1C3D] rounded-lg text-xs font-semibold hover:bg-[#8E1C3D]/5 flex items-center gap-1.5 transition-colors"
          >
            <IconCalendarTime size={15} aria-hidden="true" />
            Book Follow-up Appointment
          </button>
        )}
      </div>

      {retryError && onRetrySend && (
        <div
          role="alert"
          data-testid="followup-retry-banner"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950"
        >
          <div className="space-y-0.5">
            <p className="font-semibold">
              Consultation finalised, but the follow-up recommendation could not be sent to reception.
            </p>
            <p className="text-amber-900">{retryError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void onRetrySend()
            }}
            disabled={isSendingFollowUp}
            className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center rounded-lg bg-[#8E1C3D] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#721631] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSendingFollowUp ? 'Sending Follow-up...' : 'Retry Sending Follow-up Recommendation'}
          </button>
        </div>
      )}

      {!recommendedDate && !clinicalReason ? (
        <div className="p-4 bg-neutral-50 rounded-lg border border-neutral-200 text-xs text-neutral-600 space-y-1">
          <h4 className="font-semibold text-neutral-800">No Follow-up Scheduled</h4>
          <p>
            No follow-up review date has been recorded. Select a recommended follow-up date and doctor if a review visit is clinically indicated; recommendations flow to Reception upon finalisation.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="followup-date" className="block text-xs font-semibold text-neutral-700 mb-1">
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
            aria-invalid={dateError ? true : undefined}
            className={`w-full px-3 py-2 border rounded text-sm focus:ring-1 disabled:bg-neutral-100 ${
              dateError
                ? 'border-red-400 focus:border-red-600 focus:ring-red-600/20'
                : 'border-neutral-300 focus:ring-[#8E1C3D]'
            }`}
          />
          {dateError && (
            <p role="alert" data-testid="followup-date-error" className="mt-1 text-xs font-medium text-red-700">
              {dateError}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="followup-doctor" className="block text-xs font-semibold text-neutral-700 mb-1">
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
                {doc.name_en} {doc.qualification ? `(${doc.qualification})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="followup-clinical-reason" className="block text-xs font-semibold text-neutral-700 mb-1">
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
        <p className="text-xs text-neutral-500 mt-1">
          Follow-up recommendations flow to Reception upon finalisation. Internal clinical justification notes are doctor-only and omitted from reception booking queues.
        </p>
      </div>
    </div>
  )
}
