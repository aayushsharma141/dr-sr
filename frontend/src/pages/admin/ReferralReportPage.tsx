import { useId, useMemo, useState } from 'react'
import { AppShell } from '../../components/AppShell'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { InlineAlert } from '../../components/InlineAlert'
import { useMe } from '../../api/queries'
import {
  formatReferralSource,
  REFERRAL_SOURCE_FILTER_OPTIONS,
  shouldShowReferrerName,
  useReferralReport,
} from '../../api/reports'
import { ApiError } from '../../api/client'
import { istToday } from '../../format'

export function ReferralReportPage() {
  const { data: me } = useMe()

  const today = useMemo(() => istToday(), [])
  const defaultDateFrom = useMemo(() => `${today.slice(0, 7)}-01`, [today])

  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(today)
  const [source, setSource] = useState('')
  const [referrer, setReferrer] = useState('')

  const fromId = useId()
  const toId = useId()
  const sourceId = useId()
  const referrerId = useId()

  const isInvalidDateRange = Boolean(dateFrom && dateTo && dateFrom > dateTo)

  const { data, isLoading, isError, error } = useReferralReport(
    {
      date_from: dateFrom,
      date_to: dateTo,
      source: source || null,
      referrer: referrer || null,
    },
    { enabled: !isInvalidDateRange },
  )

  const errorMessage = isError
    ? error instanceof ApiError
      ? error.message
      : (error as Error)?.message || 'Failed to load referral report. Please try again.'
    : null

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <AdminPageHeader
          title="Referral Report"
          description="Visits by referral source and referrer for a date range"
        />

        {/* Filter Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 shadow-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <div>
              <label
                htmlFor={fromId}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                From Date
              </label>
              <input
                id={fromId}
                type="date"
                aria-label="From date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
            </div>

            <div>
              <label
                htmlFor={toId}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                To Date
              </label>
              <input
                id={toId}
                type="date"
                aria-label="To date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
            </div>

            <div>
              <label
                htmlFor={sourceId}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                Referral Source
              </label>
              <select
                id={sourceId}
                aria-label="Referral source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              >
                {REFERRAL_SOURCE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor={referrerId}
                className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700"
              >
                Referrer Search
              </label>
              <input
                id={referrerId}
                type="text"
                aria-label="Referrer name"
                placeholder="Filter by referrer..."
                value={referrer}
                onChange={(e) => setReferrer(e.target.value)}
                className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              />
            </div>
          </div>
        </div>

        {/* Validation Error */}
        {isInvalidDateRange && (
          <InlineAlert tone="error">From date must not be after To date.</InlineAlert>
        )}

        {/* Server Fetch Error */}
        {errorMessage && <InlineAlert tone="error">{errorMessage}</InlineAlert>}

        {/* Report Content */}
        {!isInvalidDateRange && !errorMessage && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-xs overflow-hidden">
            {isLoading && (
              <div className="p-8 text-center text-sm text-slate-600">
                Loading referral report...
              </div>
            )}

            {!isLoading && data && data.rows.length === 0 && (
              <div className="p-8 text-center" data-testid="empty-referral-report">
                <p className="text-sm font-medium text-slate-600">
                  No visits in this date range.
                </p>
              </div>
            )}

            {!isLoading && data && data.rows.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-900" aria-label="Referral report">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700">
                    <tr>
                      <th scope="col" className="py-3 px-4">
                        Source
                      </th>
                      <th scope="col" className="py-3 px-4">
                        Referrer
                      </th>
                      <th scope="col" className="py-3 px-4 text-right">
                        Visit Count
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.rows.map((row, idx) => (
                      <tr key={`${row.source}-${row.referrer_name ?? ''}-${idx}`} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {formatReferralSource(row.source)}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          {shouldShowReferrerName(row.source)
                            ? row.referrer_name || '—'
                            : '—'}
                        </td>
                        <td className="py-3 px-4 text-right font-medium tabular-nums text-slate-900">
                          {row.visit_count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50/75">
                    <tr>
                      <td colSpan={2} className="py-3 px-4 font-bold text-slate-900">
                        Total
                      </td>
                      <td className="py-3 px-4 text-right font-bold tabular-nums text-slate-900">
                        {data.total_visits}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  )
}
