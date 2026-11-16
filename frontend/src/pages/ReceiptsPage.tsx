import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ReceiptDialog } from '../components/ReceiptDialog'
import { useMe, useReceiptsToday } from '../api/queries'
import type { PaymentOut } from '../api/types'
import { formatIst, formatPaise } from '../format'
import { IconPrinter, IconReceipt } from '../components/icons'

export function ReceiptsPage() {
  const { data: me } = useMe()
  const { data: todayReceipts, isPending, isError } = useReceiptsToday()

  const permissions = me?.permissions ?? []
  const isAdmin = me?.role === 'ADMIN' || permissions.includes('payment:reverse')

  const [search, setSearch] = useState('')
  const [reprintPayment, setReprintPayment] = useState<PaymentOut | null>(null)

  // Sort newest first
  const sortedReceipts = useMemo(() => {
    if (!todayReceipts) return []
    return [...todayReceipts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [todayReceipts])

  const filteredReceipts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return sortedReceipts
    return sortedReceipts.filter(
      (p) =>
        p.receipt_number.toLowerCase().includes(q) ||
        p.patient_urn.toLowerCase().includes(q) ||
        p.patient_name.toLowerCase().includes(q),
    )
  }, [sortedReceipts, search])

  // Non-reversed count and sum
  const activeReceipts = useMemo(
    () => sortedReceipts.filter((p) => !p.is_reversed),
    [sortedReceipts],
  )
  const activeCount = activeReceipts.length
  const activeSumPaise = useMemo(
    () => activeReceipts.reduce((acc, p) => acc + p.amount_paise, 0),
    [activeReceipts],
  )

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        {/* Top Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs shrink-0">
              <IconReceipt className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Receipts</h1>
              <p className="text-xs text-slate-500">
                Today&apos;s receipts (IST). Earlier days are with Admin.
              </p>
            </div>
          </div>

          {isAdmin && (
            <div className="flex items-center gap-2.5">
              <Link
                to="/admin/billing"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <IconReceipt className="h-4 w-4 text-emerald-800" />
                Full ledger
              </Link>
            </div>
          )}
        </div>

        {/* Receipts Panel */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">Today&apos;s Receipts</h2>
              <p className="text-xs text-slate-600 font-medium pt-0.5">
                {activeCount} receipts · {formatPaise(activeSumPaise)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                aria-label="Filter today's receipts by receipt number, URN or name"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by receipt #, URN or name..."
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none min-h-[38px]"
              />
            </div>
          </div>

          {isPending ? (
            <div className="p-8 text-center text-xs text-slate-500">
              Loading today&apos;s receipts...
            </div>
          ) : isError ? (
            <div className="p-8 text-center text-xs text-red-700">
              Could not load today&apos;s receipts.
            </div>
          ) : sortedReceipts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No receipts issued today.
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No receipts match this filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                  <tr>
                    <th className="py-3 px-3">Receipt #</th>
                    <th className="py-3 px-3">Date &amp; Time (IST)</th>
                    <th className="py-3 px-3">Patient</th>
                    <th className="py-3 px-3">Service / Plan</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3 text-center">Mode</th>
                    <th className="py-3 px-3 text-center">Status</th>
                    <th className="py-3 px-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {filteredReceipts.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-3 font-mono font-bold text-slate-900">
                        {p.receipt_number}
                      </td>
                      <td className="py-3 px-3 text-slate-600">{formatIst(p.created_at)}</td>
                      <td className="py-3 px-3">
                        <div className="font-bold text-slate-900">{p.patient_name}</div>
                        <div className="font-mono text-xs text-slate-500">{p.patient_urn}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-700">
                        {p.treatment_plan_name || p.notes || 'OPD Consultation'}
                      </td>
                      <td className="py-3 px-3 text-right font-mono font-bold tabular-nums text-emerald-900">
                        {formatPaise(p.amount_paise)}
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">
                          {p.payment_method}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-center">
                        {p.is_reversed ? (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800">
                            Reversed
                          </span>
                        ) : (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => setReprintPayment(p)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer shadow-2xs"
                        >
                          <IconPrinter className="h-3.5 w-3.5 text-slate-500" />
                          Reprint
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Modal for reprinting a receipt */}
        {reprintPayment && (
          <ReceiptDialog
            payment={reprintPayment}
            isReprint={true}
            onClose={() => setReprintPayment(null)}
          />
        )}
      </div>
    </AppShell>
  )
}

export default ReceiptsPage
