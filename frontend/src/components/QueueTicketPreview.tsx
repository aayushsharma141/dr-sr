import React from 'react'
import { IconClock, IconUser, IconUsers } from './icons'

export interface QueueTicketPreviewProps {
  departmentName?: string
  doctorName?: string
  tokenPrefix?: string
  tokenNumber?: number | string | null
  patientName?: string
  patientUrn?: string
  dateTime?: string
  waitingCount?: number
  nextToken?: string | number
  hasNextToken?: boolean
  /** Shown in place of the token number while none has been allocated yet. */
  emptyLabel?: string
  /** Cabin code from the doctor's record (e.g. 'A', 'B-2'). */
  cabinCode?: string
  className?: string
}

export const QueueTicketPreview: React.FC<QueueTicketPreviewProps> = ({
  departmentName = 'General OPD',
  doctorName = 'Consulting Clinician',
  tokenPrefix = 'P',
  tokenNumber = 14,
  patientName = 'Select a patient',
  patientUrn = 'KH-YYYY-XXXX',
  dateTime,
  waitingCount = 0,
  nextToken,
  emptyLabel = 'Not issued',
  cabinCode,
  className = '',
}) => {
  const formattedDate =
    dateTime ||
    new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })

  // A token is real only once a number or a real token string is supplied; the em dash and
  // blanks mean "no token yet" and get the empty state instead of a bare dash at 5xl.
  const hasToken =
    tokenNumber !== null &&
    tokenNumber !== undefined &&
    tokenNumber !== '' &&
    tokenNumber !== '—'

  // A next token is real only when explicitly supplied; otherwise we show the empty state.
  const hasNextToken =
    nextToken != null && nextToken !== '' && nextToken !== undefined

  // Format token like P-014 or #14
  const displayToken =
    tokenNumber != null
      ? typeof tokenNumber === 'number'
        ? `${tokenPrefix}-${String(tokenNumber).padStart(3, '0')}`
        : tokenNumber
      : `${tokenPrefix}-001`

  // Use emptyLabel when no nextToken is supplied, matching the token-badge empty state.
  const displayNextToken =
    hasNextToken
      ? typeof nextToken === 'number'
        ? `${tokenPrefix}-${String(nextToken).padStart(3, '0')}`
        : nextToken
      : emptyLabel

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Authentic Notched Queue Ticket Card */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
        {/* Ticket Left & Right Inward Notch Cutouts */}
        <div
          aria-hidden="true"
          className="absolute -left-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-slate-200 bg-slate-50"
        />
        <div
          aria-hidden="true"
          className="absolute -right-3 top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-slate-200 bg-slate-50"
        />

        {/* Hospital Header */}
        <div className="border-b border-dashed border-slate-200 pb-3 text-center">
          <h4 className="text-base font-bold tracking-tight text-slate-900">
            Kalyan Hospital
          </h4>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#8E1C3D]">
            {departmentName}
          </p>
        </div>

        {/* Big Monotonic Token Badge */}
        <div className="py-5 text-center">
          <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">
            Token No.
          </span>
          {hasToken ? (
            <span
              data-testid="token-preview-number"
              className="mt-1 block font-mono text-5xl font-black tracking-tight text-[#5D0B26]"
            >
              {displayToken}
            </span>
          ) : (
            <span
              data-testid="token-preview-number"
              className="mt-2 inline-flex items-center gap-2 rounded-lg border border-dashed border-[#C39A35] bg-[#FBF5F7] px-3.5 py-2 text-xs font-bold uppercase tracking-widest text-[#8E1C3D]"
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#C39A35]" />
              {emptyLabel}
            </span>
          )}
        </div>

        {/* Patient & Timestamp Details */}
        <div className="space-y-2 border-t border-dashed border-slate-200 pt-3 text-xs text-slate-600">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-medium text-slate-500">
              <IconUser className="h-3.5 w-3.5 text-slate-500" />
              Patient
            </span>
            <span className="max-w-[160px] truncate font-semibold text-slate-900">
              {patientName}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-slate-500">URN</span>
            <span className="font-mono font-bold text-slate-800">{patientUrn}</span>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="inline-flex items-center gap-1.5 text-slate-500">
              <IconClock className="h-3.5 w-3.5 text-slate-500" />
              Time
            </span>
            <span className="text-xs text-slate-700">{formattedDate}</span>
          </div>
        </div>
      </div>

      {/* Live Doctor Queue Status Box */}
      <div className="rounded-xl border border-[#E4C8D1] bg-[#FBF5F7] p-3.5 text-xs text-slate-700">
        <div className="flex items-center gap-2 font-bold text-[#5D0B26]">
          <IconUsers className="h-4 w-4 text-[#8E1C3D]" />
          <span>Current Queue ({doctorName})</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between font-medium text-slate-600">
          <span>Waiting in Hall: <strong className="font-bold text-[#5D0B26]">{waitingCount}</strong></span>
          <span aria-hidden="true" className="text-[#C39A35]">|</span>
          {hasNextToken ? (
            <span>Next Token: <strong className="font-mono font-bold text-[#5D0B26]">{displayNextToken}</strong></span>
          ) : (
            <span>Next Token: <strong className="font-mono font-bold text-[#5D0B26]">{emptyLabel}</strong></span>
          )}
        </div>
        {cabinCode && (
          <div className="mt-1.5 text-right text-slate-500">
            <span className="font-semibold text-[#5D0B26]">Cabin: </span>
            <span className="text-[#8E1C3D] font-mono">{cabinCode}</span>
          </div>
        )}
      </div>
    </div>
  )
}
