import { useMemo } from 'react'
import { AppShell } from '../components/AppShell'
import { InlineAlert } from '../components/InlineAlert'
import { ReceptionDeskTabs } from '../components/billing/ReceptionDeskTabs'
import { useClinicSettings, useMe, useReceiptsToday } from '../api/queries'
import type { PaymentOut } from '../api/types'
import { formatIst, formatPaise } from '../format'
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconPrinter,
  IconRupee,
  IconStethoscope,
  IconX,
} from '../components/icons'

function categorizePayment(p: PaymentOut): 'OPD' | 'PHYSIO' | 'OTHER' {
  if (p.treatment_plan_id != null || (p.treatment_plan_name && p.treatment_plan_name.trim().length > 0)) {
    return 'PHYSIO'
  }
  const notesLower = (p.notes || '').toLowerCase()
  if (notesLower.includes('physio') || notesLower.includes('package') || notesLower.includes('therapy')) {
    return 'PHYSIO'
  }
  if (p.visit_id != null || p.appointment_id != null || notesLower.includes('opd') || notesLower.includes('consultation')) {
    return 'OPD'
  }
  return 'OTHER'
}

export function ReceptionReportsPage() {
  const { data: me } = useMe()
  const { data: settings } = useClinicSettings()
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

  const grossTotalPaise = activeTotalPaise + reversedTotalPaise

  // Mode breakdowns (Active collections)
  const cashReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'CASH'),
    [activeReceipts],
  )
  const cashTotalPaise = useMemo(
    () => cashReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [cashReceipts],
  )

  const upiReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'UPI'),
    [activeReceipts],
  )
  const upiTotalPaise = useMemo(
    () => upiReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [upiReceipts],
  )

  const cardReceipts = useMemo(
    () => activeReceipts.filter((p) => p.payment_method === 'CARD'),
    [activeReceipts],
  )
  const cardTotalPaise = useMemo(
    () => cardReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [cardReceipts],
  )

  // Service breakdowns
  const opdReceipts = useMemo(
    () => activeReceipts.filter((p) => categorizePayment(p) === 'OPD'),
    [activeReceipts],
  )
  const opdTotalPaise = useMemo(
    () => opdReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [opdReceipts],
  )

  const physioReceipts = useMemo(
    () => activeReceipts.filter((p) => categorizePayment(p) === 'PHYSIO'),
    [activeReceipts],
  )
  const physioTotalPaise = useMemo(
    () => physioReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [physioReceipts],
  )

  const otherReceipts = useMemo(
    () => activeReceipts.filter((p) => categorizePayment(p) === 'OTHER'),
    [activeReceipts],
  )
  const otherTotalPaise = useMemo(
    () => otherReceipts.reduce((sum, p) => sum + p.amount_paise, 0),
    [otherReceipts],
  )

  const clinicNameHi = settings?.name_hi || 'कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र'
  const clinicNameEn = settings?.name_en || 'Kalyan Hospital & Physiotherapy Centre'
  const todayDateStr = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const generatedTimeStr = new Date().toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        <h1 className="sr-only print:hidden">Reports</h1>

        <ReceptionDeskTabs
          activeTab="reports"
          actions={
            <button
              type="button"
              onClick={() => window.print()}
              disabled={activeCount === 0 && reversedCount === 0}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed shadow-2xs"
            >
              <IconPrinter className="h-4 w-4 text-emerald-800" />
              Print Closing Sheet
            </button>
          }
        />

        {isPending ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-600 shadow-2xs">
            Loading today&apos;s collection summary...
          </div>
        ) : isError ? (
          <InlineAlert tone="error">
            {error instanceof Error ? error.message : "Could not load today's collection summary."}
          </InlineAlert>
        ) : (todayReceipts ?? []).length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-2xs space-y-1">
            <p className="text-sm font-medium text-slate-700">No receipts issued today.</p>
            <p className="text-xs text-slate-600">
              Daily cashier reconciliation and service totals will populate once payments are collected.
            </p>
          </div>
        ) : (
          <>
            {/* SCREEN VIEW */}
            <div className="print:hidden space-y-5">
              {/* Primary Collection Overview Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Active Collections */}
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-5 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-tight text-emerald-800">
                      Collected Today (Active)
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                      <IconCheck className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-emerald-950 sm:text-3xl">
                    {formatPaise(activeTotalPaise)}
                  </div>
                  <p className="text-xs font-medium tabular-nums text-emerald-800">
                    {activeCount} {activeCount === 1 ? 'receipt' : 'receipts'}
                  </p>
                </div>

                {/* Reversed Receipts */}
                <div className="rounded-xl border border-red-200 bg-red-50/50 p-5 shadow-2xs space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold tracking-tight text-red-800">
                      Reversed Receipts
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-red-100 text-red-800">
                      <IconX className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-red-950 sm:text-3xl">
                    {formatPaise(reversedTotalPaise)}
                  </div>
                  <p className="text-xs font-medium tabular-nums text-red-800">
                    {reversedCount} {reversedCount === 1 ? 'reversed receipt' : 'reversed receipts'}
                  </p>
                </div>
              </div>

              {/* Section 1: Cashier Drawer Reconciliation */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h2 className="text-base font-semibold tracking-tight text-slate-900">
                      Cashier Drawer Reconciliation
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Verify physical currency against system receipts before shift handover.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {/* Cash in Drawer */}
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-emerald-900">
                        Physical Cash in Drawer
                      </span>
                      <span className="rounded-md bg-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-900">
                        CASH
                      </span>
                    </div>
                    <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-emerald-950">
                      {formatPaise(cashTotalPaise)}
                    </div>
                    <div className="text-xs font-medium tabular-nums text-emerald-800">
                      {cashReceipts.length} cash payments
                    </div>
                    <p className="border-t border-emerald-200/60 pt-2 text-xs text-slate-600">
                      Count cash notes in drawer to match this amount.
                    </p>
                  </div>

                  {/* UPI / Digital QR */}
                  <div className="rounded-xl border border-sky-300 bg-sky-50/60 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-sky-900">
                        UPI / QR Collections
                      </span>
                      <span className="rounded-md bg-sky-200 px-2 py-0.5 text-xs font-semibold text-sky-900">
                        UPI
                      </span>
                    </div>
                    <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-sky-950">
                      {formatPaise(upiTotalPaise)}
                    </div>
                    <div className="text-xs font-medium tabular-nums text-sky-800">
                      {upiReceipts.length} UPI transfers
                    </div>
                    <p className="border-t border-sky-200/60 pt-2 text-xs text-slate-600">
                      Cross-check with UPI soundbox &amp; bank merchant app.
                    </p>
                  </div>

                  {/* Card / POS */}
                  <div className="rounded-xl border border-purple-300 bg-purple-50/60 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-purple-900">
                        Card / POS Terminal
                      </span>
                      <span className="rounded-md bg-purple-200 px-2 py-0.5 text-xs font-semibold text-purple-900">
                        CARD
                      </span>
                    </div>
                    <div className="font-mono text-2xl font-bold tracking-tight tabular-nums text-purple-950">
                      {formatPaise(cardTotalPaise)}
                    </div>
                    <div className="text-xs font-medium tabular-nums text-purple-800">
                      {cardReceipts.length} card transactions
                    </div>
                    <p className="border-t border-purple-200/60 pt-2 text-xs text-slate-600">
                      Cross-check with EDC card swipe terminal batch total.
                    </p>
                  </div>
                </div>

                {/* Net Drawer Summary Bar */}
                <div className="flex flex-col justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3.5 sm:flex-row sm:items-center">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-slate-700">
                    <div>
                      <span className="block text-slate-600">Gross Collections:</span>
                      <span className="font-mono font-semibold tabular-nums text-slate-900">
                        Gross {formatPaise(grossTotalPaise)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-600">Less Reversals:</span>
                      <span className="font-mono font-semibold tabular-nums text-red-700">
                        Less {formatPaise(reversedTotalPaise)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-slate-600">Net Drawer Balance:</span>
                      <span className="font-mono text-sm font-bold tabular-nums text-emerald-950">
                        Net {formatPaise(activeTotalPaise)}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs font-medium text-slate-600">
                    Shift Cashier:{' '}
                    <span className="font-semibold text-slate-900">
                      {me?.full_name || 'Reception Staff'}
                    </span>
                  </div>
                </div>
              </section>

              {/* Section 2: Service Breakdown */}
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs space-y-4">
                <div className="border-b border-slate-100 pb-3">
                  <h2 className="text-base font-semibold tracking-tight text-slate-900">
                    Department &amp; Service Breakdown
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Distribution of today&apos;s active collections by service type.
                  </p>
                </div>

                <div className="grid grid-cols-1 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-slate-50/30 md:grid-cols-3 md:divide-x md:divide-y-0">
                  <div className="p-4">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <IconStethoscope className="h-4 w-4 text-emerald-800" />
                      OPD Consultations
                    </div>
                    <div className="font-mono text-xl font-bold tracking-tight tabular-nums text-slate-900">
                      Total {formatPaise(opdTotalPaise)}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-slate-600">
                      {opdReceipts.length} consultation visits
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <IconClock className="h-4 w-4 text-emerald-800" />
                      Physiotherapy &amp; Packages
                    </div>
                    <div className="font-mono text-xl font-bold tracking-tight tabular-nums text-slate-900">
                      Total {formatPaise(physioTotalPaise)}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-slate-600">
                      {physioReceipts.length} therapy sessions
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <IconRupee className="h-4 w-4 text-emerald-800" />
                      Other Charges &amp; Fees
                    </div>
                    <div className="font-mono text-xl font-bold tracking-tight tabular-nums text-slate-900">
                      Total {formatPaise(otherTotalPaise)}
                    </div>
                    <div className="mt-1 text-xs tabular-nums text-slate-600">
                      {otherReceipts.length} sundry services
                    </div>
                  </div>
                </div>
              </section>

              {/* Section 3: Reversals Audit Table (if any) */}
              {reversedCount > 0 && (
                <section className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-100 px-5 py-4">
                    <div>
                      <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight text-red-950">
                        <IconAlertTriangle className="h-4 w-4 text-red-700" />
                        <span className="tabular-nums">Reversals Audit Register ({reversedCount})</span>
                      </h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Admin-authorized cancellations reversed today.
                      </p>
                    </div>
                    <span className="font-mono text-sm font-semibold tabular-nums text-red-700">
                      Total Void: {formatPaise(reversedTotalPaise)}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-red-200 bg-red-50 text-xs font-semibold text-red-900">
                        <tr>
                          <th scope="col" className="whitespace-nowrap px-4 py-3">Receipt #</th>
                          <th scope="col" className="whitespace-nowrap px-4 py-3">Time</th>
                          <th scope="col" className="whitespace-nowrap px-4 py-3">Patient</th>
                          <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">Amount</th>
                          <th scope="col" className="whitespace-nowrap px-4 py-3">Reversed By</th>
                          <th scope="col" className="whitespace-nowrap px-4 py-3">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-red-100">
                        {reversedReceipts.map((p) => (
                          <tr key={p.id} className="transition-colors duration-150 hover:bg-red-50/40">
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold tabular-nums text-red-900">
                              {p.receipt_number}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-600">
                              {formatIst(p.created_at)}
                            </td>
                            <td className="max-w-[220px] px-4 py-3">
                              <div className="min-w-0 truncate font-semibold text-slate-900" title={p.patient_name}>
                                {p.patient_name}
                              </div>
                              <div className="mt-0.5 font-mono text-xs tabular-nums text-slate-600">
                                ({p.patient_urn})
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-sm font-semibold tabular-nums text-red-900">
                              Void {formatPaise(p.amount_paise)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-xs font-medium text-slate-700">
                              {p.reversed_by_username || 'admin'}
                            </td>
                            <td className="max-w-[260px] px-4 py-3">
                              <div
                                className="min-w-0 truncate text-xs italic text-slate-600"
                                title={p.reversal_reason || 'N/A'}
                              >
                                {p.reversal_reason || 'N/A'}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>

            {/* PRINT VIEW - DAILY CASHIER CLOSING & HANDOVER REPORT */}
            <div className="hidden print:block text-slate-900 font-sans p-2">
              {/* Hospital Header Banner */}
              <div className="text-center border-b-2 border-slate-800 pb-3 mb-4">
                <h1 className="text-lg font-bold uppercase tracking-wide text-slate-950">
                  {clinicNameHi}
                </h1>
                <h2 className="text-sm font-semibold tracking-wide text-slate-800">
                  {clinicNameEn}
                </h2>
                <div className="text-xs text-slate-600 mt-1 font-semibold uppercase tracking-widest">
                  Daily Cashier Reconciliation &amp; Shift Handover Summary
                </div>
              </div>

              {/* Meta strip */}
              <div className="grid grid-cols-3 gap-2 border border-slate-300 p-2.5 text-xs mb-4 rounded bg-slate-50">
                <div>
                  <span className="font-bold text-slate-700">Date (IST):</span>{' '}
                  <span className="font-mono font-bold">{todayDateStr}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700">Shift Cashier:</span>{' '}
                  <span className="font-bold">{me?.full_name || 'Reception Staff'}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-slate-700">Report Printed:</span>{' '}
                  <span className="font-mono">{generatedTimeStr}</span>
                </div>
              </div>

              {/* Table 1: Mode Collections */}
              <div className="mb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1 border-b border-slate-300 pb-0.5">
                  1. Payment Collection Breakdown by Mode
                </h3>
                <table className="w-full text-xs border border-slate-300">
                  <thead className="bg-slate-100 font-bold border-b border-slate-300">
                    <tr>
                      <th className="py-1 px-2 border-r border-slate-300">Payment Mode</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">Count</th>
                      <th className="py-1 px-2 text-right border-r border-slate-300">Gross Total</th>
                      <th className="py-1 px-2 text-right border-r border-slate-300">Reversals</th>
                      <th className="py-1 px-2 text-right">Net Drawer Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    <tr>
                      <td className="py-1 px-2 border-r border-slate-300 font-semibold">CASH (Physical Drawer)</td>
                      <td className="py-1 px-2 text-center border-r border-slate-300 font-mono">{cashReceipts.length}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono">Gross {formatPaise(cashTotalPaise)}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono text-slate-500">-</td>
                      <td className="py-1 px-2 text-right font-mono font-bold">Net {formatPaise(cashTotalPaise)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-2 border-r border-slate-300 font-semibold">UPI / QR (Digital Soundbox)</td>
                      <td className="py-1 px-2 text-center border-r border-slate-300 font-mono">{upiReceipts.length}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono">Gross {formatPaise(upiTotalPaise)}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono text-slate-500">-</td>
                      <td className="py-1 px-2 text-right font-mono font-bold">Net {formatPaise(upiTotalPaise)}</td>
                    </tr>
                    <tr>
                      <td className="py-1 px-2 border-r border-slate-300 font-semibold">CARD (POS Swipe Terminal)</td>
                      <td className="py-1 px-2 text-center border-r border-slate-300 font-mono">{cardReceipts.length}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono">Gross {formatPaise(cardTotalPaise)}</td>
                      <td className="py-1 px-2 text-right border-r border-slate-300 font-mono text-slate-500">-</td>
                      <td className="py-1 px-2 text-right font-mono font-bold">Net {formatPaise(cardTotalPaise)}</td>
                    </tr>
                    {reversedCount > 0 && (
                      <tr className="bg-red-50 text-red-900">
                        <td className="py-1 px-2 border-r border-slate-300 font-semibold">Reversed Receipts</td>
                        <td className="py-1 px-2 text-center border-r border-slate-300 font-mono">{reversedCount}</td>
                        <td className="py-1 px-2 text-right border-r border-slate-300 font-mono text-slate-500">-</td>
                        <td className="py-1 px-2 text-right border-r border-slate-300 font-mono">Less {formatPaise(reversedTotalPaise)}</td>
                        <td className="py-1 px-2 text-right font-mono text-red-700">Less {formatPaise(reversedTotalPaise)}</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-slate-100 font-bold border-t-2 border-slate-400">
                    <tr>
                      <td className="py-1.5 px-2 border-r border-slate-300">TOTAL COLLECTION</td>
                      <td className="py-1.5 px-2 text-center border-r border-slate-300 font-mono">{activeCount}</td>
                      <td className="py-1.5 px-2 text-right border-r border-slate-300 font-mono">Gross {formatPaise(grossTotalPaise)}</td>
                      <td className="py-1.5 px-2 text-right border-r border-slate-300 font-mono text-red-700">
                        {reversedCount > 0 ? `Less ${formatPaise(reversedTotalPaise)}` : '₹0.00'}
                      </td>
                      <td className="py-1.5 px-2 text-right font-mono text-sm">Net {formatPaise(activeTotalPaise)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Table 2: Service Distribution */}
              <div className="mb-4">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1 border-b border-slate-300 pb-0.5">
                  2. Department Service Distribution
                </h3>
                <div className="grid grid-cols-3 gap-2 border border-slate-300 p-2 text-xs">
                  <div>
                    <span className="font-semibold text-slate-700">OPD Consultation Fees:</span>
                    <div className="font-mono font-bold mt-0.5">{formatPaise(opdTotalPaise)} ({opdReceipts.length})</div>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Physiotherapy &amp; Packages:</span>
                    <div className="font-mono font-bold mt-0.5">{formatPaise(physioTotalPaise)} ({physioReceipts.length})</div>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-700">Other / Miscellaneous:</span>
                    <div className="font-mono font-bold mt-0.5">{formatPaise(otherTotalPaise)} ({otherReceipts.length})</div>
                  </div>
                </div>
              </div>

              {/* Physical Cash Denomination Tally (for cashier manual verification) */}
              <div className="mb-6">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-1 border-b border-slate-300 pb-0.5">
                  3. Physical Cash Denomination Verification (Drawer Count)
                </h3>
                <table className="w-full text-2xs border border-slate-300">
                  <thead className="bg-slate-100 font-bold border-b border-slate-300">
                    <tr>
                      <th className="py-1 px-2 border-r border-slate-300">Denomination</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹500</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹200</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹100</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹50</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹20</th>
                      <th className="py-1 px-2 text-center border-r border-slate-300">₹10 / Coins</th>
                      <th className="py-1 px-2 text-right">Physical Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-1 px-2 border-r border-slate-300 font-semibold">Note Count:</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 border-r border-slate-300 text-center text-slate-500">______</td>
                      <td className="py-1 px-2 text-right font-mono text-slate-600">₹ ________</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Signatures & Certification */}
              <div className="grid grid-cols-2 gap-8 pt-6 border-t-2 border-slate-800 text-xs">
                <div>
                  <div className="text-slate-500 mb-8">Cashier Declaration:</div>
                  <div className="border-t border-slate-400 pt-1 font-bold">
                    Shift Cashier Signature
                  </div>
                  <div className="text-2xs text-slate-500">Name: {me?.full_name || 'Reception Staff'}</div>
                </div>
                <div className="text-right">
                  <div className="text-slate-500 mb-8">Verified &amp; Received by:</div>
                  <div className="border-t border-slate-400 pt-1 font-bold">
                    Supervisor / Admin Signature
                  </div>
                  <div className="text-2xs text-slate-500">Kalyan Hospital Accounts</div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}

export default ReceptionReportsPage
