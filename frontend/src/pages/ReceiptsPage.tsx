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
      <div className="w-full space-y-4">
        <h1 className="sr-only">Receipts</h1>

        <ReceptionDeskTabs
          activeTab="receipts"
          isAdmin={isAdmin}
          actions={
            isAdmin ? (
              <Link
                to="/admin/billing"
                className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                <IconReceipt className="h-3.5 w-3.5 text-emerald-800" />
                Full ledger
              </Link>
            ) : undefined
          }
        />

        {/* Quick Tally Chips & Filter Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <button
            type="button"
            onClick={() => setModeFilter('all')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              modeFilter === 'all'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold text-slate-500">
              All Active
            </span>
            <span className="block text-base font-bold text-slate-900 font-mono tabular-nums mt-0.5">
              {formatPaise(activeSumPaise)}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {activeCount} {activeCount === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('CASH')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              modeFilter === 'CASH'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold text-emerald-800">
              Cash Drawer
            </span>
            <span className="block text-base font-bold text-emerald-950 font-mono tabular-nums mt-0.5">
              {formatPaise(cashSumPaise)}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {cashReceipts.length} {cashReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('UPI')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              modeFilter === 'UPI'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold text-sky-800">
              UPI / QR
            </span>
            <span className="block text-base font-bold text-sky-950 font-mono tabular-nums mt-0.5">
              {formatPaise(upiSumPaise)}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {upiReceipts.length} {upiReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('CARD')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              modeFilter === 'CARD'
                ? 'border-emerald-600 bg-emerald-50/80 ring-2 ring-emerald-500/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold text-purple-800">
              Card / POS
            </span>
            <span className="block text-base font-bold text-purple-950 font-mono tabular-nums mt-0.5">
              {formatPaise(cardSumPaise)}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {cardReceipts.length} {cardReceipts.length === 1 ? 'receipt' : 'receipts'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setModeFilter('REVERSED')}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              modeFilter === 'REVERSED'
                ? 'border-red-400 bg-red-50/80 ring-2 ring-red-400/20'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <span className="block text-xs font-semibold text-red-800">
              Reversals
            </span>
            <span className="block text-base font-bold text-red-950 font-mono tabular-nums mt-0.5">
              {formatPaise(reversedSumPaise)}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {reversedReceipts.length} {reversedReceipts.length === 1 ? 'slip' : 'slips'}
            </span>
          </button>
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
              <div className="relative">
                <input
                  type="text"
                  aria-label="Filter today's receipts by receipt number, URN or name"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by receipt #, URN or name..."
                  className="rounded-xl border border-slate-300 bg-white pl-8 pr-8 py-1.5 text-xs font-medium text-slate-900 focus:border-emerald-700 focus:outline-none min-h-[38px] w-64"
                />
                <IconSearch className="h-3.5 w-3.5 text-slate-500 absolute left-2.5 top-3 pointer-events-none" />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="absolute right-2 top-2.5 text-slate-500 hover:text-slate-700"
                  >
                    <IconX className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
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
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200">
                  <tr>
                    <th className="py-3 px-3">Receipt #</th>
                    <th className="py-3 px-3">Date &amp; Time (IST)</th>
                    <th className="py-3 px-3">Patient</th>
                    <th className="py-3 px-3">Service / Plan</th>
                    <th className="py-3 px-3 text-right">Amount</th>
                    <th className="py-3 px-3 text-center">Mode</th>
                    <th className="py-3 px-3">Cashier</th>
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
                      <td className="py-3 px-3 text-slate-600 font-medium">
                        {p.created_by_username || 'reception'}
                      </td>
                      <td className="py-3 px-3 text-center">
                        {p.is_reversed ? (
                          <span
                            title={p.reversal_reason || 'Reversed'}
                            className="rounded bg-red-100 px-2 py-0.5 text-xs font-bold text-red-800"
                          >
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
