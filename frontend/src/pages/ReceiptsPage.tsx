import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { ReceiptDialog } from '../components/ReceiptDialog'
import { ReceptionDeskTabs } from '../components/billing/ReceptionDeskTabs'
import { useMe, useReceiptsToday } from '../api/queries'
import type { PaymentOut } from '../api/types'
import { formatIst, formatPaise } from '../format'
import { IconPrinter, IconReceipt, IconSearch, IconX } from '../components/icons'

type ModeFilter = 'all' | 'CASH' | 'UPI' | 'CARD' | 'REVERSED'

export function ReceiptsPage() {
  const { data: me } = useMe()
  const { data: todayReceipts, isPending, isError } = useReceiptsToday()

  const permissions = me?.permissions ?? []
  const isAdmin = me?.role === 'ADMIN' || permissions.includes('payment:reverse')

  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all')
  const [reprintPayment, setReprintPayment] = useState<PaymentOut | null>(null)

  // Sort newest first
  const sortedReceipts = useMemo(() => {
    if (!todayReceipts) return []
    return [...todayReceipts].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )
  }, [todayReceipts])

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

  // Mode tallies
  const cashReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'CASH'),
    [activeReceipts],
  )
  const cashSumPaise = useMemo(
    () => cashReceipts.reduce((acc, p) => acc + p.amount_paise, 0),
    [cashReceipts],
  )

  const upiReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'UPI'),
    [activeReceipts],
  )
  const upiSumPaise = useMemo(
    () => upiReceipts.reduce((acc, p) => acc + p.amount_paise, 0),
    [upiReceipts],
  )

  const cardReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'CARD'),
    [activeReceipts],
  )
  const cardSumPaise = useMemo(
    () => cardReceipts.reduce((acc, p) => acc + p.amount_paise, 0),
    [cardReceipts],
  )

  const reversedReceipts = useMemo(
    () => sortedReceipts.filter((p) => p.is_reversed),
    [sortedReceipts],
  )
  const reversedSumPaise = useMemo(
    () => reversedReceipts.reduce((acc, p) => acc + p.amount_paise, 0),
    [reversedReceipts],
  )

  const filteredReceipts = useMemo(() => {
    let rows = sortedReceipts

    // Filter by payment method / reversal status
    if (modeFilter === 'CASH') {
      rows = rows.filter((p) => !p.is_reversed && p.payment_method === 'CASH')
    } else if (modeFilter === 'UPI') {
      rows = rows.filter((p) => !p.is_reversed && p.payment_method === 'UPI')
    } else if (modeFilter === 'CARD') {
      rows = rows.filter((p) => !p.is_reversed && p.payment_method === 'CARD')
    } else if (modeFilter === 'REVERSED') {
      rows = rows.filter((p) => p.is_reversed)
    }

    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (p) =>
        p.receipt_number.toLowerCase().includes(q) ||
        p.patient_urn.toLowerCase().includes(q) ||
        p.patient_name.toLowerCase().includes(q),
    )
  }, [sortedReceipts, modeFilter, search])

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        <h1 className="sr-only">Receipts</h1>

        <ReceptionDeskTabs
          activeTab="receipts"
          isAdmin={isAdmin}
          actions={
            isAdmin ? (
              <Link
                to="/admin/billing"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 shadow-2xs"
              >
                <IconReceipt className="h-4 w-4 text-emerald-800" />
                Full ledger
              </Link>
            ) : undefined
          }
        />

        {/* Quick Tally Chips & Filter Bar */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <button
            type="button"
            onClick={() => setModeFilter('all')}
            className={`rounded-xl border p-3.5 text-left transition-colors duration-150 cursor-pointer shadow-2xs ${
              modeFilter === 'all'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold tracking-tight text-slate-600">
              All Active
            </span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-tight tabular-nums text-slate-900">
              {formatPaise(activeSumPaise)}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-600">
              {activeCount} {activeCount === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('CASH')}
            className={`rounded-xl border p-3.5 text-left transition-colors duration-150 cursor-pointer shadow-2xs ${
              modeFilter === 'CASH'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold tracking-tight text-emerald-800">
              Cash Drawer
            </span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-tight tabular-nums text-emerald-950">
              {formatPaise(cashSumPaise)}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-600">
              {cashReceipts.length} {cashReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('UPI')}
            className={`rounded-xl border p-3.5 text-left transition-colors duration-150 cursor-pointer shadow-2xs ${
              modeFilter === 'UPI'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold tracking-tight text-sky-800">
              UPI / QR
            </span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-tight tabular-nums text-sky-950">
              {formatPaise(upiSumPaise)}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-600">
              {upiReceipts.length} {upiReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('CARD')}
            className={`rounded-xl border p-3.5 text-left transition-colors duration-150 cursor-pointer shadow-2xs ${
              modeFilter === 'CARD'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold tracking-tight text-purple-800">
              Card / POS
            </span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-tight tabular-nums text-purple-950">
              {formatPaise(cardSumPaise)}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-600">
              {cardReceipts.length} {cardReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('REVERSED')}
            className={`rounded-xl border p-3.5 text-left transition-colors duration-150 cursor-pointer shadow-2xs ${
              modeFilter === 'REVERSED'
                ? 'border-red-400 bg-red-50/80 ring-2 ring-red-400/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold tracking-tight text-red-800">
              Reversals
            </span>
            <span className="mt-1 block font-mono text-lg font-bold tracking-tight tabular-nums text-red-950">
              {formatPaise(reversedSumPaise)}
            </span>
            <span className="mt-0.5 block text-xs tabular-nums text-slate-600">
              {reversedReceipts.length} {reversedReceipts.length === 1 ? 'slip' : 'slips'}
            </span>
          </button>
        </div>

        {/* Receipts Panel */}
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div className="flex flex-col justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">
                Today&apos;s Receipts
              </h2>
              <p className="mt-0.5 text-xs font-medium tabular-nums text-slate-600">
                {activeCount} receipts · {formatPaise(activeSumPaise)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <div className="relative w-full sm:w-72">
                <input
                  type="text"
                  aria-label="Filter today's receipts by receipt number, URN or name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by receipt #, URN or name..."
                  className="min-h-[38px] w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-9 text-sm text-slate-900 placeholder:text-slate-400 transition-colors duration-150 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/15"
                />
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                {search && (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => setSearch('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-slate-500 transition-colors duration-150 hover:text-slate-700 cursor-pointer"
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {isPending ? (
            <div className="px-6 py-10 text-center text-sm text-slate-600">
              Loading today&apos;s receipts...
            </div>
          ) : isError ? (
            <div className="px-6 py-10 text-center text-sm font-medium text-red-700">
              Could not load today&apos;s receipts.
            </div>
          ) : sortedReceipts.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-1">
              <p className="text-sm font-medium text-slate-700">No receipts issued today.</p>
              <p className="text-xs text-slate-600">
                Payments collected at reception billing will appear here automatically.
              </p>
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="px-6 py-10 text-center space-y-1">
              <p className="text-sm font-medium text-slate-700">No receipts match this filter.</p>
              <p className="text-xs text-slate-600">
                Try clearing the search query or selecting All Active receipts.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Receipt #</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Date &amp; Time (IST)</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Patient</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Service / Plan</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-center">Mode</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3">Cashier</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-center">Status</th>
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReceipts.map((p) => {
                    const serviceLabel = p.treatment_plan_name || p.notes || 'OPD Consultation'
                    return (
                      <tr key={p.id} className="transition-colors duration-150 hover:bg-slate-50/80">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold tabular-nums text-slate-900">
                          {p.receipt_number}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600">
                          {formatIst(p.created_at)}
                        </td>
                        <td className="max-w-[210px] px-4 py-3">
                          <div className="min-w-0 truncate font-semibold text-slate-900" title={p.patient_name}>
                            {p.patient_name}
                          </div>
                          <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
                            {p.patient_urn}
                          </div>
                        </td>
                        <td className="max-w-[220px] px-4 py-3">
                          <div className="min-w-0 truncate text-slate-700" title={serviceLabel}>
                            {serviceLabel}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-emerald-900">
                          {formatPaise(p.amount_paise)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">
                          <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {p.payment_method}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                          {p.created_by_username || 'reception'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-center">
                          {p.is_reversed ? (
                            <span
                              title={p.reversal_reason || 'Reversed'}
                              className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800"
                            >
                              Reversed
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setReprintPayment(p)}
                            className="inline-flex min-h-[34px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 cursor-pointer shadow-2xs"
                          >
                            <IconPrinter className="h-3.5 w-3.5 text-slate-500" />
                            Reprint
                          </button>
                        </td>
                      </tr>
                    )
                  })}
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
