import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import type { PreviousDueOut } from '../../api/bill'
import {
  useAppointments,
  useCloseVisit,
  usePendingDues,
  useRecordPayment,
  useVisit,
  useVisitDues,
  useVisits,
} from '../../api/queries'
import type {
  PaymentMethod,
  PaymentOut,
  VisitConsultation,
  VisitDetail,
  VisitDueOut,
  VisitSummary,
} from '../../api/types'
import { formatIst, formatPaise, formatToken, istToday, paiseToRupees, rupeesToPaise } from '../../format'
import { IconArrowLeft, IconCheck, IconPrinter, IconRupee, IconUser } from '../icons'
import { InlineAlert } from '../InlineAlert'
import { PAYMENT_RECORDED_EVENT } from '../ReceiptHost'
import { BillPanel } from './BillPanel'

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD']

function isActiveConsultation(c: VisitConsultation): boolean {
  return c.consultation_status === 'WAITING' || c.consultation_status === 'IN_CONSULTATION'
}

/** Prints the receipt through the app-level ReceiptHost, the same path every payment takes. */
function announcePayment(payment: PaymentOut) {
  window.dispatchEvent(new CustomEvent(PAYMENT_RECORDED_EVENT, { detail: payment }))
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

function MethodPicker({
  value,
  onChange,
}: {
  value: PaymentMethod
  onChange: (method: PaymentMethod) => void
}) {
  return (
    <div>
      <span className="mb-1.5 block text-xs font-bold text-slate-700">
        Payment Mode *
      </span>
      <div className="grid grid-cols-3 gap-2">
        {PAYMENT_METHODS.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={value === mode}
            onClick={() => onChange(mode)}
            className={`rounded-xl border py-2.5 text-xs font-bold transition-all ${value === mode
                ? 'border-emerald-600 bg-[#124832] text-white shadow-xs'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
          >
            {mode}
          </button>
        ))}
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: VisitDetail['status'] }) {
  const style =
    status === 'OPEN'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'CLOSED'
        ? 'bg-slate-200 text-slate-700'
        : 'bg-red-100 text-red-800'
  const label = status === 'OPEN' ? 'Open' : status === 'CLOSED' ? 'Closed' : 'Cancelled'
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${style}`}>{label}</span>
}

function PaymentForm({
  visit,
  amount,
  amountPaise,
  onAmountChange,
  onPaid,
}: {
  visit: VisitDetail
  amount: string
  amountPaise: number
  onAmountChange: (value: string | null) => void
  onPaid: (payment: PaymentOut) => void
}) {
  const hasCompleted = visit.consultations.some((c) => c.consultation_status === 'COMPLETED')
  const canPay = visit.status === 'OPEN' && hasCompleted && visit.outstanding_paise > 0
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recordPayment = useRecordPayment()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const paise = rupeesToPaise(amount)
    if (paise === null) {
      setError('Enter the amount in rupees, for example 350 or 350.50.')
      return
    }
    if (paise > visit.outstanding_paise) {
      setError(`Only ${formatPaise(visit.outstanding_paise)} is due on this visit.`)
      return
    }
    try {
      const payment = await recordPayment.mutateAsync({
        patient_id: visit.patient_id,
        visit_id: visit.id,
        amount_paise: paise,
        payment_method: method,
        notes: remarks.trim() || `Visit ${visit.visit_date}`,
      })
      onAmountChange(null)
      setRemarks('')
      onPaid(payment)
      announcePayment(payment)
    } catch (err) {
      setError(errorText(err, 'Failed to record the payment.'))
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <IconRupee className="h-5 w-5 text-emerald-800" />
        <h3 className="text-sm font-bold text-slate-900">Take payment</h3>
      </div>

      {!canPay ? (
        <p className="text-xs text-slate-600">
          {visit.consultations.some(isActiveConsultation)
            ? 'Fees are collected after the consultation. The doctor has not completed it yet.'
            : 'Nothing is left to collect on this visit.'}
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-900">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="visit-payment-amount" className="mb-1 block text-xs font-bold text-slate-700">
              Amount (₹) *
            </label>
            <input
              id="visit-payment-amount"
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={(e) => onAmountChange(e.target.value)}
              aria-describedby="visit-payment-hint"
              className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base font-black text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[44px]"
            />
            <p id="visit-payment-hint" className="mt-1 text-xs text-slate-600">
              Up to {formatPaise(visit.outstanding_paise)} on this visit. Part payments are recorded as they come.
            </p>
          </div>

          <MethodPicker value={method} onChange={setMethod} />

          <div>
            <label htmlFor="visit-payment-remarks" className="mb-1 block text-xs font-bold text-slate-700">
              Remarks (optional)
            </label>
            <input
              id="visit-payment-remarks"
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={`Visit ${visit.visit_date}`}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={recordPayment.isPending}
            className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#124832] px-6 text-sm font-bold text-white shadow-xs hover:bg-[#0D3822] disabled:opacity-50"
          >
            {recordPayment.isPending
              ? 'Recording...'
              : `Collect ${formatPaise(amountPaise)} & Issue Receipt`}
          </button>
        </form>
      )}
    </section>
  )
}

function CloseForm({
  visit,
  onClosed,
}: {
  visit: VisitDetail
  onClosed: (closed: VisitDetail) => void
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const closeVisit = useCloseVisit()

  const hasCompleted = visit.consultations.some((c) => c.consultation_status === 'COMPLETED')
  const stillActive = visit.consultations.some(isActiveConsultation)
  const owes = visit.outstanding_paise > 0
  const blocker = stillActive
    ? 'A consultation is still waiting or in progress. The doctor must complete it first.'
    : !hasCompleted
      ? 'No consultation is completed yet.'
      : null
  const canSubmit = blocker === null && (!owes || reason.trim().length > 0)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!canSubmit) return
    try {
      const closed = await closeVisit.mutateAsync({
        id: visit.id,
        body: { version_id: visit.version_id, reason: owes ? reason.trim() : null },
      })
      onClosed(closed)
    } catch (err) {
      setError(errorText(err, 'Could not close the visit.'))
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <h3 className="text-sm font-bold text-slate-900">Close Visit / Patient Out</h3>
      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-900">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {owes && (
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label htmlFor="visit-close-reason" className="block text-xs font-bold text-amber-900">
                Reason for closing with {formatPaise(visit.outstanding_paise)} unpaid *
              </label>
              <span className="text-xs text-slate-500">
                {reason.length}/500
              </span>
            </div>
            <textarea
              id="visit-close-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="For example: patient will pay on the next visit"
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900"
            />
            <p className="mt-1 text-xs text-slate-600">
              The balance then stays listed under Pending Dues. Closing does not reopen the visit later.
            </p>
          </div>
        )}
        {blocker && <p className="text-xs font-semibold text-amber-800">{blocker}</p>}
        <button
          type="submit"
          disabled={!canSubmit || closeVisit.isPending}
          className="inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-6 text-sm font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
        >
          <IconCheck className="h-4 w-4" />
          {closeVisit.isPending ? 'Closing...' : 'Patient Out'}
        </button>
      </form>
    </section>
  )
}

function VisitDetailPanel({
  visit,
  canCollect,
  canClose,
  onReprint,
  onClosed,
}: {
  visit: VisitDetail
  canCollect: boolean
  canClose: boolean
  onReprint: (paymentId: number) => void
  onClosed: (closed: VisitDetail) => void
}) {
  const isOpen = visit.status === 'OPEN'
  const [lastPayment, setLastPayment] = useState<PaymentOut | null>(null)
  const [amountOverride, setAmountOverride] = useState<string | null>(null)
  const [collectingDue, setCollectingDue] = useState<PreviousDueOut | null>(null)

  const defaultRupees = visit.outstanding_paise > 0 ? paiseToRupees(visit.outstanding_paise) : ''
  const amount = amountOverride ?? defaultRupees
  const amountPaise = rupeesToPaise(amount) ?? 0

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
            <IconUser className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">{visit.patient_name}</h3>
            <p className="font-mono text-xs text-slate-600">
              {visit.patient_urn} &bull; Visit {visit.visit_date}
            </p>
          </div>
        </div>
        <StatusBadge status={visit.status} />
      </header>

      {/* Bill panel from GET /api/visits/{id}/bill with totals, previous dues and packages */}
      <BillPanel
        visitId={visit.id}
        payingNowPaise={amountPaise}
        canCollect={canCollect}
        onCollectDue={(due) => setCollectingDue(due)}
        onReprint={onReprint}
      />

      {/* Previous dues collection form if triggered from previous dues card */}
      {collectingDue && canCollect && (
        <DueCollectForm
          due={{
            visit_id: collectingDue.visit_id,
            patient_id: visit.patient_id,
            patient_urn: visit.patient_urn ?? '',
            patient_name: visit.patient_name ?? '',
            doctor_names: collectingDue.doctor_names,
            visit_date: collectingDue.visit_date,
            bill_total_paise: collectingDue.balance_paise,
            paid_paise: 0,
            balance_paise: collectingDue.balance_paise,
            close_reason: null,
          }}
          onCancel={() => setCollectingDue(null)}
          onCollected={(payment) => {
            setCollectingDue(null)
            setLastPayment(payment)
          }}
        />
      )}

      {isOpen && canCollect && (
        <>
          {lastPayment && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
              <p className="text-xs">
                Receipt <span className="font-mono font-bold">{lastPayment.receipt_number}</span> issued for{' '}
                <span className="font-mono font-bold">{formatPaise(lastPayment.amount_paise)}</span>.
              </p>
              <button
                type="button"
                onClick={() => onReprint(lastPayment.id)}
                className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg bg-emerald-800 px-3 text-xs font-semibold text-white hover:bg-emerald-900"
              >
                <IconPrinter className="h-4 w-4" />
                Print receipt slip
              </button>
            </div>
          )}
          <PaymentForm
            visit={visit}
            amount={amount}
            amountPaise={amountPaise}
            onAmountChange={setAmountOverride}
            onPaid={setLastPayment}
          />
        </>
      )}

      {isOpen && canClose && <CloseForm visit={visit} onClosed={onClosed} />}

      {!isOpen && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          {visit.status === 'CLOSED' && visit.closed_at
            ? `Closed ${formatIst(visit.closed_at)}.`
            : 'This visit was cancelled.'}
          {visit.close_reason && <> Reason: {visit.close_reason}</>}
          {visit.cancel_reason && <> Reason: {visit.cancel_reason}</>}
        </p>
      )}
    </div>
  )
}

function VisitQueueCard({
  visit,
  selected,
  onSelect,
}: {
  visit: VisitSummary
  selected: boolean
  onSelect: () => void
}) {
  const tokens =
    visit.token_numbers && visit.token_numbers.length > 0
      ? visit.token_numbers.map((t) => formatToken(t)).join(', ')
      : formatToken(null)

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`w-full cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors ${
        selected
          ? 'border-emerald-700 bg-emerald-50'
          : 'border-slate-200 bg-white hover:bg-slate-50'
      }`}
    >
      <div className="font-bold text-slate-900">{visit.patient_name}</div>
      <div className="font-mono text-slate-600">
        {visit.patient_urn} &bull; Token {tokens}
      </div>
      <div className="text-slate-600">{visit.doctors.join(', ')}</div>
      {visit.last_completed_at && (
        <div className="text-xs text-slate-500">
          Completed {formatIst(visit.last_completed_at)}
        </div>
      )}
      <div
        className={`mt-1 font-mono font-bold ${
          visit.outstanding_paise > 0 ? 'text-red-700' : 'text-emerald-800'
        }`}
      >
        {visit.outstanding_paise > 0 ? `${formatPaise(visit.outstanding_paise)} due` : 'Paid in full'}
      </div>
    </button>
  )
}

function DirectPaymentButton({
  onClick,
  fullWidth = false,
}: {
  onClick: () => void
  fullWidth?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-9 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 ${
        fullWidth ? 'w-full' : ''
      }`}
    >
      Direct payment (no visit)
    </button>
  )
}

export interface VisitCheckoutProps {
  /** payment:create (Reception). */
  canCollect: boolean
  /** visit:write (Reception). */
  canClose: boolean
  /** Visit opened from a dashboard link, if any. */
  initialVisitId: number | null
  onReprint: (paymentId: number) => void
  /** Opens standalone non-visit billing mode when reception has payment:create. */
  onDirectPayment?: () => void
  /** True while an ?appointment_id= deep link is still resolving its visit_id. */
  resolvingInitialVisit?: boolean
}

/** Checkout at the desk: adaptive 3-state queue, charges, payments and Patient Out. */
export function VisitCheckout({
  canCollect,
  canClose,
  initialVisitId,
  onReprint,
  onDirectPayment,
  resolvingInitialVisit = false,
}: VisitCheckoutProps) {
  // undefined = nothing picked yet, so the dashboard's visit is shown; null = cleared after a close or back.
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const rawSelectedId = picked === undefined ? initialVisitId : picked
  const validSelectedId =
    typeof rawSelectedId === 'number' && Number.isFinite(rawSelectedId) && rawSelectedId > 0
      ? rawSelectedId
      : null

  const {
    data: ready,
    isPending: readyPending,
    isError: readyError,
    error: readyErr,
  } = useVisits({ readyForCheckout: true })
  const { data: visit, isPending: visitPending } = useVisit(validSelectedId)

  const readyVisits = ready?.visits ?? []
  const isEmptyState =
    !resolvingInitialVisit &&
    !readyPending &&
    !readyError &&
    readyVisits.length === 0 &&
    validSelectedId == null

  const today = istToday()
  const {
    data: todayApptsData,
    isPending: apptsPending,
    isError: apptsError,
  } = useAppointments(
    { appointment_date: today },
    { enabled: isEmptyState, refetchInterval: false },
  )
  const completedTodayCount =
    apptsPending || apptsError || !todayApptsData
      ? '—'
      : todayApptsData.appointments.filter(
          (a) =>
            a.status !== 'CANCELLED' &&
            a.consultation_status !== 'CANCELLED' &&
            (a.status === 'DONE' || a.status === 'COMPLETED' || a.consultation_status === 'COMPLETED'),
        ).length

  const {
    data: pendingDues,
    isPending: pendingDuesPending,
    isError: pendingDuesError,
  } = usePendingDues()
  const {
    data: visitDues,
    isPending: visitDuesPending,
    isError: visitDuesError,
  } = useVisitDues()
  const duesPending = pendingDuesPending || visitDuesPending
  const duesError = pendingDuesError || visitDuesError
  const pendingDuesCount = (pendingDues?.length ?? 0) + (visitDues?.length ?? 0)
  const pendingDuesTotalPaise = Math.max(
    0,
    (pendingDues ?? []).reduce((acc, d) => acc + d.balance_paise, 0) +
      (visitDues ?? []).reduce((acc, d) => acc + d.balance_paise, 0),
  )

  const showDirectPayment = canCollect && Boolean(onDirectPayment)
  const noticeBanner = notice ? (
    <div
      role="status"
      className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900"
    >
      {notice}
    </div>
  ) : null

  // Loading state: compact single-column card while resolving deep link or initial queue
  if ((resolvingInitialVisit || readyPending) && validSelectedId == null) {
    return (
      <section className="max-w-2xl space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        {noticeBanner}
        <p className="py-4 text-center text-xs text-slate-600">Loading visits...</p>
      </section>
    )
  }

  // Queue fetch error state: never misreport a network/server error as an empty queue
  if (readyError && validSelectedId == null) {
    return (
      <section className="max-w-2xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        {noticeBanner}
        <InlineAlert tone="error">
          {errorText(readyErr, 'Could not load visits awaiting checkout. Try refreshing.')}
        </InlineAlert>
        {showDirectPayment && onDirectPayment && (
          <div>
            <DirectPaymentButton onClick={onDirectPayment} />
          </div>
        )}
      </section>
    )
  }

  // State 1 — Empty: compact summary card with daily completed count, pending dues, and quick actions
  if (isEmptyState) {
    return (
      <section
        data-testid="checkout-empty-state"
        className="max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs"
      >
        {noticeBanner}
        <div>
          <h2 className="text-base font-bold text-slate-900">No visits awaiting checkout</h2>
          <p className="mt-1 text-xs text-slate-600">
            Patients appear here when their doctor completes a consultation.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-xs font-semibold text-slate-600">Completed consultations today</div>
            <div className="mt-1 font-mono text-xl font-black text-slate-900">
              {completedTodayCount}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-xs font-semibold text-slate-600">Pending dues</div>
            <div className="mt-1 font-mono text-xl font-black text-slate-900">
              {duesPending || duesError ? '—' : pendingDuesCount}
            </div>
            {!duesPending && !duesError && (
              <div
                className={`mt-0.5 font-mono text-xs font-semibold ${
                  pendingDuesTotalPaise > 0 ? 'text-amber-800' : 'text-slate-600'
                }`}
              >
                {formatPaise(pendingDuesTotalPaise)} outstanding
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Link
            to="/reception/billing?tab=dues"
            className="inline-flex min-h-9 items-center justify-center rounded-lg bg-[#124832] px-4 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#0D3822]"
          >
            View Pending Dues →
          </Link>
          {showDirectPayment && onDirectPayment && (
            <DirectPaymentButton onClick={onDirectPayment} />
          )}
        </div>
      </section>
    )
  }

  // State 2 — Visits Ready, None Selected: focused single-column queue card
  if (readyVisits.length > 0 && validSelectedId == null) {
    return (
      <section
        data-testid="checkout-queue-unselected"
        className="max-w-3xl space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
      >
        {noticeBanner}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Ready for checkout ({readyVisits.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Select a patient to review charges, collect payment, and close the visit.
            </p>
          </div>
          {showDirectPayment && onDirectPayment && (
            <DirectPaymentButton onClick={onDirectPayment} />
          )}
        </div>

        <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {readyVisits.map((v) => (
            <li key={v.id}>
              <VisitQueueCard
                visit={v}
                selected={false}
                onSelect={() => {
                  setNotice(null)
                  setPicked(v.id)
                }}
              />
            </li>
          ))}
        </ul>
      </section>
    )
  }

  // State 3 — Visit Selected: expanded 2-column checkout workspace
  return (
    <div
      data-testid="checkout-split-workspace"
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12"
    >
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Ready for checkout</h2>
          <p className="text-xs text-slate-500">
            The doctor has completed the consultation. Collect, then close the visit.
          </p>
        </div>
        {readyPending ? (
          <p className="p-4 text-center text-xs text-slate-500">Loading visits...</p>
        ) : readyError ? (
          <InlineAlert tone="error" className="text-xs">
            {errorText(readyErr, 'Could not load visits awaiting checkout.')}
          </InlineAlert>
        ) : readyVisits.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-600">
            No other visits awaiting checkout.
          </p>
        ) : (
          <ul className="space-y-2">
            {readyVisits.map((v) => (
              <li key={v.id}>
                <VisitQueueCard
                  visit={v}
                  selected={v.id === validSelectedId}
                  onSelect={() => {
                    setNotice(null)
                    setPicked(v.id)
                  }}
                />
              </li>
            ))}
          </ul>
        )}
        {showDirectPayment && onDirectPayment && (
          <div className="border-t border-slate-100 pt-3">
            <DirectPaymentButton onClick={onDirectPayment} fullWidth />
          </div>
        )}
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        {noticeBanner}
        <div>
          <button
            type="button"
            onClick={() => {
              setNotice(null)
              setPicked(null)
            }}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            <IconArrowLeft className="h-3.5 w-3.5 text-slate-600" />
            Back to queue
          </button>
        </div>
        {visitPending ? (
          <p className="p-8 text-center text-xs text-slate-500">Loading visit...</p>
        ) : !visit ? (
          <p className="p-8 text-center text-xs text-red-700">This visit could not be loaded.</p>
        ) : (
          <VisitDetailPanel
            key={visit.id}
            visit={visit}
            canCollect={canCollect}
            canClose={canClose}
            onReprint={onReprint}
            onClosed={(closed) => {
              setNotice(
                closed.outstanding_paise > 0
                  ? `${closed.patient_name}'s visit is closed. ${formatPaise(closed.outstanding_paise)} stays under Pending Dues.`
                  : `${closed.patient_name}'s visit is closed.`,
              )
              setPicked(null)
            }}
          />
        )}
      </section>
    </div>
  )
}

/** Fees still owed on visits closed with a balance. Collected at the desk like any other payment. */
export function VisitDuesSection({ canCollect }: { canCollect: boolean }) {
  const { data: dues, isPending } = useVisitDues()
  const [collecting, setCollecting] = useState<VisitDueOut | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const total = (dues ?? []).reduce((acc, d) => acc + d.balance_paise, 0)

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
      <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-base font-bold text-slate-900">Visit balances</h2>
          <p className="text-xs text-slate-500">
            Fees left unpaid when a visit was closed. A payment here never reopens the closed visit.
          </p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2">
          <span className="block text-xs font-bold text-amber-800">Total outstanding</span>
          <span className="font-mono text-base font-black text-amber-950">{formatPaise(total)}</span>
        </div>
      </div>

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
          {notice}
        </div>
      )}

      {collecting && canCollect && (
        <DueCollectForm
          due={collecting}
          onCancel={() => setCollecting(null)}
          onCollected={(payment) => {
            setCollecting(null)
            setNotice(`Receipt ${payment.receipt_number} issued for ${payment.patient_name}.`)
          }}
        />
      )}

      {isPending ? (
        <p className="p-6 text-center text-xs text-slate-500">Loading visit balances...</p>
      ) : !dues || dues.length === 0 ? (
        <p className="p-6 text-center text-xs text-slate-500">No closed visit has a balance.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-600">
              <tr>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Visit</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2 text-right">Bill total</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Closed with reason</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {dues.map((d) => (
                <tr key={d.visit_id}>
                  <td className="px-3 py-2">
                    <div className="font-bold text-slate-900">{d.patient_name}</div>
                    <div className="font-mono text-slate-500">{d.patient_urn}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700">{d.visit_date}</td>
                  <td className="px-3 py-2 text-slate-700">{d.doctor_names.join(', ')}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatPaise(d.bill_total_paise)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-800">{formatPaise(d.paid_paise)}</td>
                  <td className="px-3 py-2 text-right font-mono font-black text-red-700">{formatPaise(d.balance_paise)}</td>
                  <td className="px-3 py-2 text-slate-600">{d.close_reason ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {canCollect && (
                      <button
                        type="button"
                        onClick={() => setCollecting(d)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-lg bg-emerald-800 px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-900"
                      >
                        <IconRupee className="h-3.5 w-3.5" />
                        Collect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function DueCollectForm({
  due,
  onCancel,
  onCollected,
}: {
  due: VisitDueOut
  onCancel: () => void
  onCollected: (payment: PaymentOut) => void
}) {
  const [amountOverride, setAmountOverride] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [error, setError] = useState<string | null>(null)
  const recordPayment = useRecordPayment()
  const amount = amountOverride ?? paiseToRupees(due.balance_paise)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    const paise = rupeesToPaise(amount)
    if (paise === null) {
      setError('Enter the amount in rupees, for example 350 or 350.50.')
      return
    }
    if (paise > due.balance_paise) {
      setError(`Only ${formatPaise(due.balance_paise)} is owed on this visit.`)
      return
    }
    try {
      const payment = await recordPayment.mutateAsync({
        patient_id: due.patient_id,
        visit_id: due.visit_id,
        amount_paise: paise,
        payment_method: method,
        notes: `Balance from visit ${due.visit_date}`,
      })
      announcePayment(payment)
      onCollected(payment)
    } catch (err) {
      setError(errorText(err, 'Failed to record the payment.'))
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold text-emerald-950">
          {due.patient_name} ({due.patient_urn}) - balance {formatPaise(due.balance_paise)}
        </p>
        <button type="button" onClick={onCancel} className="text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
      </div>
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-xs font-semibold text-red-900">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="due-collect-amount" className="mb-1 block text-xs font-bold text-slate-700">
            Amount (₹) *
          </label>
          <input
            id="due-collect-amount"
            type="number"
            step="0.01"
            min="1"
            value={amount}
            onChange={(e) => setAmountOverride(e.target.value)}
            className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base font-black text-slate-900 min-h-[44px]"
          />
        </div>
        <MethodPicker value={method} onChange={setMethod} />
      </div>
      <button
        type="submit"
        disabled={recordPayment.isPending}
        className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#124832] px-6 text-sm font-bold text-white hover:bg-[#0D3822] disabled:opacity-50"
      >
        {recordPayment.isPending ? 'Recording...' : `Collect ${formatPaise(rupeesToPaise(amount) ?? 0)} & Issue Receipt`}
      </button>
    </form>
  )
}
