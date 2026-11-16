import { useMemo } from 'react'
import { AppShell } from '../components/AppShell'
import { InlineAlert } from '../components/InlineAlert'
import { useMe, useReceiptsToday } from '../api/queries'
import { formatPaise } from '../format'
import { IconCheck, IconReportMedical, IconX } from '../components/icons'

export function ReceptionReportsPage() {
  const { data: me } = useMe()
  const { data: todayReceipts, isPending, isError, error } = useReceiptsToday()

  const activeReceipts = useMemo(
    () => (todayReceipts ?? []).filter((p) => !p.is_reversed),
    [todayReceipts],
  )
  const activeCount = activeReceipts.length
  const activeTotalPaise = useMemo(
    () => activeReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [activeReceipts],
  )

  const reversedReceipts = useMemo(
    () => (todayReceipts ?? []).filter((p) => p.is_reversed),
    [todayReceipts],
  )
  const reversedCount = reversedReceipts.length
  const reversedTotalPaise = useMemo(
    () => reversedReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [reversedReceipts],
  )

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        {/* Top Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs shrink-0">
              <IconReportMedical className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Reports</h1>
              <p className="text-xs text-slate-500">
                Today&apos;s collection summary (IST). Earlier days and full audit reports are with Admin.
              </p>
            </div>
          </div>
        </div>

        {isPending ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            Loading today&apos;s collection summary...
          </div>
        ) : isError ? (
          <InlineAlert tone="error">
            {error instanceof Error ? error.message : "Could not load today's collection summary."}
          </InlineAlert>
        ) : (todayReceipts ?? []).length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-500">
            No receipts issued today.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Active Collections */}
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                  Collected Today (Active)
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                  <IconCheck className="h-4 w-4" />
                </span>
              </div>
              <div className="font-mono text-3xl font-black text-emerald-950 tabular-nums">
                {formatPaise(activeTotalPaise)}
              </div>
              <p className="text-xs font-semibold text-emerald-800">
                {activeCount} {activeCount === 1 ? 'receipt' : 'receipts'}
              </p>
            </div>

            {/* Reversed Receipts */}
            <div className="rounded-2xl border border-red-200 bg-red-50/50 p-5 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-red-800">
                  Reversed Receipts
                </span>
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-800">
                  <IconX className="h-4 w-4" />
                </span>
              </div>
              <div className="font-mono text-3xl font-black text-red-950 tabular-nums">
                {formatPaise(reversedTotalPaise)}
              </div>
              <p className="text-xs font-semibold text-red-800">
                {reversedCount} {reversedCount === 1 ? 'reversed receipt' : 'reversed receipts'}
              </p>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

export default ReceptionReportsPage
