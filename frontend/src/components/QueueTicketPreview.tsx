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

  // Format token like P-014 or #14
  const displayToken =
    tokenNumber != null
      ? typeof tokenNumber === 'number'
        ? `${tokenPrefix}-${String(tokenNumber).padStart(3, '0')}`
        : tokenNumber
      : `${tokenPrefix}-001`

  const displayNextToken =
    nextToken != null
      ? typeof nextToken === 'number'
        ? `${tokenPrefix}-${String(nextToken).padStart(3, '0')}`
        : nextToken
      : displayToken

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
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
            {departmentName}
          </p>
        </div>

        {/* Big Monotonic Token Badge */}
        <div className="py-5 text-center">
          <span className="block text-xs font-bold uppercase tracking-widest text-slate-500">
            Token No.
          </span>
          <span
            data-testid="token-preview-number"
            className="mt-1 block font-mono text-5xl font-black tracking-tight text-emerald-800"
          >
            {displayToken}
          </span>
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
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 text-xs text-emerald-950">
        <div className="flex items-center gap-2 font-bold text-emerald-900">
          <IconUsers className="h-4 w-4 text-emerald-700" />
          <span>Current Queue ({doctorName})</span>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-emerald-800 font-medium">
          <span>Waiting in Hall: <strong className="font-bold text-emerald-950">{waitingCount}</strong></span>
          <span className="text-emerald-300">|</span>
          <span>Next Token: <strong className="font-mono font-bold text-emerald-950">{displayNextToken}</strong></span>
        </div>
      </div>
    </div>
  )
}
