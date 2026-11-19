import { useState } from 'react'
import { Link } from 'react-router'
import { usePatientLedger } from '../../api/queries'
import type {
  LedgerEntryOut,
  LedgerPaymentItemOut,
  PaymentOut,
  RefundOut,
  Role,
} from '../../api/types'
import { formatIst, formatPaise } from '../../format'
import { TableSkeleton } from '../AdminSkeleton'
import { InlineAlert } from '../InlineAlert'
import { toast } from '../ToastHost'
import { PaymentReversalModal } from '../PaymentReversalModal'
import { ReceiptDialog } from '../ReceiptDialog'
import { BillPanel } from '../billing/BillPanel'
import { PaymentRefundModal } from '../billing/PaymentRefundModal'
import {
  IconChevronDown,
  IconChevronRight,
  IconPrinter,
  IconRefresh,
} from '../icons'

export interface PatientBillingLedgerTabProps {
  patientId: number
  role: Role
  permissions: string[]
}

const LEDGER_PAGE_LIMIT = 50

const IST_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatVisitDateIst(visitDate: string): string {
  const trimmed = visitDate.trim()
  if (!trimmed) return '—'
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return IST_DATE_FORMATTER.format(parsed)
}

function formatSafePaise(paise: number): string {
  return paise < 0 ? `-${formatPaise(Math.abs(paise))}` : formatPaise(paise)
}

function visitStatusBadgeClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'OPEN':
      return 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
    case 'CLOSED':
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
    case 'CANCELLED':
      return 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

function paymentBadgeConfig(payment: LedgerPaymentItemOut): {
  label: string
  className: string
} {
  if (payment.is_reversed) {
    return {
      label: 'Reversed',
      className: 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200',
    }
  }
  if (payment.refunded_paise > 0 && payment.remaining_refundable_paise === 0) {
    return {
      label: 'Refunded',
      className: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200',
    }
  }
  if (payment.refunded_paise > 0 && payment.remaining_refundable_paise > 0) {
    return {
      label: 'Partially Refunded',
      className: 'bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200',
    }
  }
  return {
    label: 'Paid',
    className: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
  }
}

const ENTRY_TYPE_LABELS: Record<string, string> = {
  CHARGE: 'Charge',
  CHARGE_ADJUSTMENT: 'Charge Adjustment',
  CHARGE_VOID: 'Charge Void',
  PACKAGE_CHARGE: 'Package Charge',
  PACKAGE_ADJUSTMENT: 'Package Adjustment',
  LEGACY_CHARGE: 'Legacy Charge',
  PAYMENT: 'Payment',
  PAYMENT_REVERSAL: 'Payment Reversal',
  REFUND: 'Refund',
}

function formatEntryType(entryType: string): string {
  return ENTRY_TYPE_LABELS[entryType] ?? entryType.replace(/_/g, ' ')
}

export function PatientBillingLedgerTab({
  patientId,
  role,
  permissions,
}: PatientBillingLedgerTabProps) {
  const canViewLedger =
    (role === 'ADMIN' || role === 'RECEPTION') && permissions.includes('payment:read')
  const canReverse = role === 'ADMIN' && permissions.includes('payment:reverse')
  const canRefund = role === 'ADMIN' && permissions.includes('payment:refund')
  const isReception = role === 'RECEPTION'

  const [pageState, setPageState] = useState<{ patientId: number; offset: number }>({
    patientId,
    offset: 0,
  })
  const offset = pageState.patientId === patientId ? pageState.offset : 0

  const [expandedVisits, setExpandedVisits] = useState<Record<string, boolean>>({})
  const [reprintPayment, setReprintPayment] = useState<PaymentOut | null>(null)
  const [reversePayment, setReversePayment] = useState<LedgerPaymentItemOut | null>(null)
  const [refundPayment, setRefundPayment] = useState<LedgerPaymentItemOut | null>(null)

  const { data: ledger, isPending, isError, error, refetch, isFetching } = usePatientLedger(
    patientId,
    { limit: LEDGER_PAGE_LIMIT, offset, order: 'desc' },
    canViewLedger,
  )

  if (!canViewLedger) return null

  const visits = ledger?.visits ?? []
  const payments = ledger?.payments ?? []
  const refunds = ledger?.refunds ?? []
  const entries: LedgerEntryOut[] = ledger?.entries ?? []
  const totalEntries = ledger?.total_entries ?? 0
  const limit = ledger?.limit ?? LEDGER_PAGE_LIMIT

  const hasPrev = offset > 0
  const hasNext = offset + limit < totalEntries
  const rangeStart = totalEntries === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + entries.length, totalEntries)

  const isVisitExpanded = (visitId: number): boolean =>
    Boolean(expandedVisits[`${patientId}:${visitId}`])

  const toggleVisit = (visitId: number) => {
    const key = `${patientId}:${visitId}`
    setExpandedVisits((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const handleReprintById = (paymentId: number) => {
    const found = payments.find((p) => p.id === paymentId)
    if (found) setReprintPayment(found)
  }

  const handlePrevPage = () => {
    setPageState({ patientId, offset: Math.max(0, offset - LEDGER_PAGE_LIMIT) })
  }

  const handleNextPage = () => {
    if (offset + LEDGER_PAGE_LIMIT < totalEntries) {
      setPageState({ patientId, offset: offset + LEDGER_PAGE_LIMIT })
    }
  }

  const handleRefundSuccess = (refund: RefundOut) => {
    toast.success(
      `Refund ${refund.refund_number} issued for ${formatSafePaise(refund.amount_paise)} (${refund.refund_method}).`,
    )
  }

  const handleReverseSuccess = (updated: PaymentOut) => {
    toast.success(`Payment ${updated.receipt_number} was reversed and logged in the ledger.`)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-slate-900">Billing &amp; Financial Ledger</h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Consolidated visit bills, payment receipts, refunds, and immutable append-only ledger
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh billing and ledger"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
        >
          <IconRefresh size={16} stroke={1.8} aria-hidden="true" />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isPending ? (
        <TableSkeleton label="Loading patient billing and ledger..." rows={5} columns={6} />
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load patient ledger{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Retry loading patient ledger"
              className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : !ledger ? null : (
        <>
          {/* 1. 4-Tile KPI Summary Bar */}
          <section
            aria-label="Financial summary"
            className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold text-slate-600">Total Billed</p>
              <p
                data-testid="kpi-total-billed"
                className="mt-1 font-mono text-lg font-bold tabular-nums text-slate-900"
              >
                {formatSafePaise(ledger.total_billed_paise)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-emerald-50/40 p-4">
              <p className="text-xs font-semibold text-slate-600">Total Paid</p>
              <p
                data-testid="kpi-total-paid"
                className="mt-1 font-mono text-lg font-bold tabular-nums text-emerald-800"
              >
                {formatSafePaise(ledger.total_paid_paise)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-amber-50/40 p-4">
              <p className="text-xs font-semibold text-slate-600">Refunded</p>
              <p
                data-testid="kpi-total-refunded"
                className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                  ledger.total_refunded_paise > 0 ? 'text-amber-900' : 'text-slate-900'
                }`}
              >
                {formatSafePaise(ledger.total_refunded_paise)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-xs font-semibold text-slate-600">Outstanding Balance</p>
              <p
                data-testid="kpi-outstanding-balance"
                className={`mt-1 font-mono text-lg font-bold tabular-nums ${
                  ledger.outstanding_paise > 0 ? 'text-red-800' : 'text-emerald-800'
                }`}
              >
                {formatSafePaise(ledger.outstanding_paise)}
              </p>
            </div>
          </section>

          {/* 2. Visit Bills Section */}
          <section aria-labelledby="patient-visit-bills-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="patient-visit-bills-heading" className="text-sm font-bold text-slate-900">
                Visit Bills ({visits.length})
              </h3>
              <p className="text-xs text-slate-600">
                Expand any visit to inspect itemized charges and bill adjustments
              </p>
            </div>

            {visits.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-600">
                No visit bills recorded for this patient yet.
              </div>
            ) : (
              <div className="space-y-3">
                {visits.map((visit) => {
                  const expanded = isVisitExpanded(visit.visit_id)
                  const panelId = `visit-bill-panel-${visit.visit_id}`
                  return (
                    <article
                      key={visit.visit_id}
                      aria-label={`Visit bill ${visit.visit_code}`}
                      className="rounded-xl border border-slate-200 bg-white shadow-2xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold text-slate-900 ring-1 ring-inset ring-slate-200">
                              {visit.visit_code}
                            </span>
                            <span className="text-xs font-medium text-slate-700">
                              {formatVisitDateIst(visit.visit_date)}
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${visitStatusBadgeClass(visit.status)}`}
                            >
                              {visit.status}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-slate-700">
                            <span>
                              Billed:{' '}
                              <strong className="font-mono text-slate-900">
                                {formatSafePaise(visit.bill_total_paise)}
                              </strong>
                            </span>
                            <span>
                              Paid:{' '}
                              <strong className="font-mono text-emerald-800">
                                {formatSafePaise(visit.paid_paise)}
                              </strong>
                            </span>
                            {visit.refunded_paise > 0 && (
                              <span>
                                Refunded:{' '}
                                <strong className="font-mono text-amber-900">
                                  {formatSafePaise(visit.refunded_paise)}
                                </strong>
                              </span>
                            )}
                            <span>
                              Due:{' '}
                              <strong
                                className={`font-mono ${
                                  visit.due_paise > 0 ? 'text-red-800' : 'text-emerald-800'
                                }`}
                              >
                                {formatSafePaise(visit.due_paise)}
                              </strong>
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {isReception && (
                            <Link
                              to={`/reception/billing?visit_id=${visit.visit_id}`}
                              aria-label={`Open Reception Checkout for ${visit.visit_code}`}
                              className="inline-flex min-h-10 items-center rounded-lg bg-[#5D0B26] px-3 text-xs font-semibold text-white hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                            >
                              Reception Checkout &rarr;
                            </Link>
                          )}
                          <Link
                            to={`/patients/${patientId}/visits/${visit.visit_id}`}
                            aria-label={`Open Visit Workspace for ${visit.visit_code}`}
                            className="inline-flex min-h-10 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-[#8E1C3D] hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                          >
                            Visit Workspace
                          </Link>
                          <button
                            type="button"
                            onClick={() => toggleVisit(visit.visit_id)}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                          >
                            {expanded ? (
                              <IconChevronDown size={16} stroke={1.8} aria-hidden="true" />
                            ) : (
                              <IconChevronRight size={16} stroke={1.8} aria-hidden="true" />
                            )}
                            {expanded ? 'Hide Bill' : 'View Bill'}
                          </button>
                        </div>
                      </div>

                      {expanded && (
                        <div
                          id={panelId}
                          className="border-t border-slate-200 bg-slate-50/70 p-4"
                        >
                          <BillPanel
                            visitId={visit.visit_id}
                            onReprint={handleReprintById}
                          />
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {/* 3. Payments & Receipts Section */}
          <section aria-labelledby="patient-payments-receipts-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2
                id="patient-payments-receipts-heading"
                className="text-sm font-bold text-slate-900"
              >
                Payments &amp; receipts
              </h2>
              <p className="text-xs text-slate-600">
                {payments.length} {payments.length === 1 ? 'receipt' : 'receipts'} recorded
              </p>
            </div>

            {payments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-600">
                No payments recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto md:rounded-xl md:border md:border-slate-200 md:bg-white md:shadow-2xs">
                <table className="block w-full text-left text-sm text-slate-800 md:table">
                  <thead className="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 md:table-header-group">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        Receipt #
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Date (IST)
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Method
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Amount
                      </th>
                      <th scope="col" className="px-4 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100">
                    {payments.map((payment) => {
                      const badge = paymentBadgeConfig(payment)
                      const reverseDisabled = payment.is_reversed || payment.refunded_paise > 0
                      const refundDisabled =
                        payment.is_reversed || payment.remaining_refundable_paise <= 0
                      const reverseTitle = payment.is_reversed
                        ? 'Payment is already reversed'
                        : payment.refunded_paise > 0
                          ? 'Cannot reverse a payment that has already been refunded'
                          : `Reverse payment ${payment.receipt_number}`
                      const refundTitle = payment.is_reversed
                        ? 'Cannot refund a reversed payment'
                        : payment.remaining_refundable_paise <= 0
                          ? 'Payment has been fully refunded'
                          : `Issue refund for ${payment.receipt_number}`

                      return (
                        <tr
                          key={payment.id}
                          className="block rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:hover:bg-slate-50/70"
                        >
                          <td className="flex items-start justify-between gap-2 py-1 md:table-cell md:px-4 md:py-3">
                            <span className="text-xs font-semibold text-slate-600 md:hidden">
                              Receipt #
                            </span>
                            <div className="text-right md:text-left">
                              <span className="font-mono text-xs font-bold text-slate-900">
                                {payment.receipt_number}
                              </span>
                              {payment.refunded_paise > 0 && (
                                <p className="mt-0.5 text-xs text-amber-900 tabular-nums">
                                  Refunded {formatSafePaise(payment.refunded_paise)} · Remaining{' '}
                                  {formatSafePaise(payment.remaining_refundable_paise)}
                                </p>
                              )}
                              {payment.is_reversed && payment.reversal_reason && (
                                <p className="mt-0.5 text-xs text-red-800">
                                  Reason: {payment.reversal_reason}
                                </p>
                              )}
                            </div>
                          </td>

                          <td className="flex items-center justify-between gap-2 py-1 text-xs text-slate-700 md:table-cell md:whitespace-nowrap md:px-4 md:py-3">
                            <span className="font-semibold text-slate-600 md:hidden">
                              Date (IST)
                            </span>
                            <span>{formatIst(payment.created_at)}</span>
                          </td>

                          <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:px-4 md:py-3">
                            <span className="text-xs font-semibold text-slate-600 md:hidden">
                              Method
                            </span>
                            <span className="inline-flex items-center rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                              {payment.payment_method}
                            </span>
                          </td>

                          <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3 md:text-right">
                            <span className="text-xs font-semibold text-slate-600 md:hidden">
                              Amount
                            </span>
                            <span className="font-mono text-sm font-bold tabular-nums text-slate-900">
                              {formatSafePaise(payment.amount_paise)}
                            </span>
                          </td>

                          <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3">
                            <span className="text-xs font-semibold text-slate-600 md:hidden">
                              Status
                            </span>
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>

                          <td className="mt-2 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-2.5 md:mt-0 md:table-cell md:whitespace-nowrap md:border-0 md:px-4 md:py-3 md:pt-3 md:text-right">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setReprintPayment(payment)}
                                aria-label={`Print Receipt ${payment.receipt_number}`}
                                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                              >
                                <IconPrinter size={14} stroke={1.8} aria-hidden="true" />
                                Print Receipt
                              </button>

                              {canReverse && (
                                <button
                                  type="button"
                                  disabled={reverseDisabled}
                                  title={reverseTitle}
                                  aria-label={`Reverse payment ${payment.receipt_number}`}
                                  onClick={() => setReversePayment(payment)}
                                  className="inline-flex min-h-9 items-center rounded-lg border border-red-200 bg-white px-2.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 cursor-pointer"
                                >
                                  Reverse
                                </button>
                              )}

                              {canRefund && (
                                <button
                                  type="button"
                                  disabled={refundDisabled}
                                  title={refundTitle}
                                  aria-label={`Refund payment ${payment.receipt_number}`}
                                  onClick={() => setRefundPayment(payment)}
                                  className="inline-flex min-h-9 items-center rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                                >
                                  Refund
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Issued Refunds Summary */}
            {refunds.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-amber-900">
                  Issued Refunds ({refunds.length})
                </h3>
                <ul className="divide-y divide-amber-200/70 text-xs text-slate-800">
                  {refunds.map((refund) => (
                    <li
                      key={refund.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                    >
                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-slate-900">
                            {refund.refund_number}
                          </span>
                          {refund.payment_receipt_number && (
                            <span className="text-slate-600">
                              against {refund.payment_receipt_number}
                            </span>
                          )}
                          <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-700 ring-1 ring-inset ring-amber-200">
                            {refund.refund_method}
                          </span>
                        </div>
                        <p className="text-slate-700">
                          {refund.reason} · by {refund.refunded_by_username} ·{' '}
                          {formatIst(refund.created_at)}
                        </p>
                      </div>
                      <span className="font-mono font-bold tabular-nums text-amber-900">
                        {formatSafePaise(refund.amount_paise)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {/* 4. Immutable Ledger Journal Section */}
          <section aria-labelledby="patient-ledger-journal-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3
                  id="patient-ledger-journal-heading"
                  className="text-sm font-bold text-slate-900"
                >
                  Immutable Ledger Journal
                </h3>
                <p className="mt-0.5 text-xs text-slate-600">
                  {totalEntries > 0
                    ? `Showing ${rangeStart}–${rangeEnd} of ${totalEntries} chronological ledger ${totalEntries === 1 ? 'entry' : 'entries'}`
                    : 'Append-only record of every charge, adjustment, payment, reversal, and refund'}
                </p>
              </div>
            </div>

            {entries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-6 text-center text-sm text-slate-600">
                No financial ledger entries recorded yet.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto md:rounded-xl md:border md:border-slate-200 md:bg-white md:shadow-2xs">
                  <table className="block w-full text-left text-sm text-slate-800 md:table">
                    <thead className="hidden border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 md:table-header-group">
                      <tr>
                        <th scope="col" className="px-4 py-3">
                          Date &amp; Time (IST)
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Entry Type
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Description
                        </th>
                        <th scope="col" className="px-4 py-3">
                          Direction
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Amount
                        </th>
                        <th scope="col" className="px-4 py-3 text-right">
                          Running Balance
                        </th>
                      </tr>
                    </thead>
                    <tbody className="block space-y-3 md:table-row-group md:space-y-0 md:divide-y md:divide-slate-100">
                      {entries.map((entry) => {
                        const isDebit = entry.direction === 'DEBIT'
                        return (
                          <tr
                            key={entry.id}
                            className="block rounded-xl border border-slate-200 bg-white p-4 shadow-2xs md:table-row md:rounded-none md:border-0 md:bg-transparent md:p-0 md:shadow-none md:hover:bg-slate-50/70"
                          >
                            <td className="flex items-center justify-between gap-2 py-1 text-xs text-slate-700 md:table-cell md:whitespace-nowrap md:px-4 md:py-3">
                              <span className="font-semibold text-slate-600 md:hidden">
                                Date &amp; Time (IST)
                              </span>
                              <span>{formatIst(entry.occurred_at)}</span>
                            </td>

                            <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3">
                              <span className="text-xs font-semibold text-slate-600 md:hidden">
                                Entry Type
                              </span>
                              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800">
                                {formatEntryType(entry.entry_type)}
                              </span>
                            </td>

                            <td className="flex items-start justify-between gap-2 py-1 md:table-cell md:px-4 md:py-3">
                              <span className="text-xs font-semibold text-slate-600 md:hidden">
                                Description
                              </span>
                              <div className="text-right md:text-left">
                                <p className="text-xs font-medium text-slate-900">
                                  {entry.description}
                                </p>
                                {entry.actor_username && (
                                  <p className="mt-0.5 text-xs text-slate-600">
                                    by {entry.actor_username}
                                  </p>
                                )}
                              </div>
                            </td>

                            <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3">
                              <span className="text-xs font-semibold text-slate-600 md:hidden">
                                Direction
                              </span>
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                  isDebit
                                    ? 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200'
                                    : 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
                                }`}
                              >
                                {entry.direction}
                              </span>
                            </td>

                            <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3 md:text-right">
                              <span className="text-xs font-semibold text-slate-600 md:hidden">
                                Amount
                              </span>
                              <span
                                className={`font-mono text-xs font-bold tabular-nums ${
                                  isDebit ? 'text-red-800' : 'text-emerald-800'
                                }`}
                              >
                                {isDebit ? '+' : '-'}
                                {formatSafePaise(entry.amount_paise)}
                              </span>
                            </td>

                            <td className="flex items-center justify-between gap-2 py-1 md:table-cell md:whitespace-nowrap md:px-4 md:py-3 md:text-right">
                              <span className="text-xs font-semibold text-slate-600 md:hidden">
                                Running Balance
                              </span>
                              <span className="font-mono text-xs font-bold tabular-nums text-slate-900">
                                {formatSafePaise(entry.running_balance_paise)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {(totalEntries > limit || offset > 0) && (
                  <nav
                    aria-label="Ledger journal pagination"
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                  >
                    <p className="text-xs text-slate-600 tabular-nums">
                      Showing {rangeStart}–{rangeEnd} of {totalEntries} entries
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handlePrevPage}
                        disabled={!hasPrev || isFetching}
                        aria-label="Previous ledger page"
                        className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                      >
                        &larr; Previous
                      </button>
                      <button
                        type="button"
                        onClick={handleNextPage}
                        disabled={!hasNext || isFetching}
                        aria-label="Next ledger page"
                        className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                      >
                        Next &rarr;
                      </button>
                    </div>
                  </nav>
                )}
              </>
            )}
          </section>
        </>
      )}

      {/* Receipt Reprint Dialog */}
      {reprintPayment && (
        <ReceiptDialog
          payment={reprintPayment}
          isReprint
          onClose={() => setReprintPayment(null)}
        />
      )}

      {/* Admin Payment Reversal Modal */}
      {canReverse && (
        <PaymentReversalModal
          isOpen={reversePayment !== null}
          onClose={() => setReversePayment(null)}
          payment={reversePayment}
          onSuccess={handleReverseSuccess}
        />
      )}

      {/* Admin Payment Refund Modal */}
      {canRefund && (
        <PaymentRefundModal
          open={refundPayment !== null}
          onClose={() => setRefundPayment(null)}
          patientId={patientId}
          payment={refundPayment}
          onSuccess={handleRefundSuccess}
        />
      )}
    </div>
  )
}
