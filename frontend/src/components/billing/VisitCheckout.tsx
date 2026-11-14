import { useState, type FormEvent } from 'react'
import {
  useCloseVisit,
  useRecordPayment,
  useVisit,
  useVisitDues,
  useVisits,
} from '../../api/queries'
import type {
  ConsultationStatus,
  PaymentMethod,
  PaymentOut,
  VisitConsultation,
  VisitDetail,
  VisitDueOut,
  VisitPayment,
} from '../../api/types'
import { formatIst, formatPaise, paiseToRupees, rupeesToPaise } from '../../format'
import { IconCheck, IconPrinter, IconRupee, IconStethoscope, IconUser } from '../icons'
import { PAYMENT_RECORDED_EVENT } from '../ReceiptHost'

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'UPI', 'CARD']

const CONSULTATION_LABEL: Record<ConsultationStatus, string> = {
  WAITING: 'Waiting',
  IN_CONSULTATION: 'With doctor',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

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
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-700">
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

function ConsultationTable({ consultations }: { consultations: VisitConsultation[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-600">
          <tr>
            <th className="px-3 py-2">Doctor</th>
            <th className="px-3 py-2">Token</th>
            <th className="px-3 py-2">Consultation</th>
            <th className="px-3 py-2 text-right">Fee</th>
            <th className="px-3 py-2 text-right">Paid</th>
            <th className="px-3 py-2 text-right">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-medium">
          {consultations.map((c) => (
            <tr key={c.appointment_id}>
              <td className="px-3 py-2 font-bold text-slate-900">{c.doctor_name_en}</td>
              <td className="px-3 py-2 font-mono text-slate-700">
                {c.token_number == null ? '—' : `#${c.token_number}`}
              </td>
              <td className="px-3 py-2 text-slate-700">
                {c.consultation_status ? CONSULTATION_LABEL[c.consultation_status] : '—'}
                {isActiveConsultation(c) && (
                  <span className="block text-xs text-amber-700">Fee after the doctor completes it</span>
                )}
              </td>
              <td className="px-3 py-2 text-right font-mono">{formatPaise(c.fee_paise)}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-800">
                {formatPaise(c.paid_paise)}
              </td>
              <td className="px-3 py-2 text-right font-mono font-black text-red-700">
                {formatPaise(c.balance_paise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentsTable({
  payments,
  onReprint,
}: {
  payments: VisitPayment[]
  onReprint: (paymentId: number) => void
}) {
  if (payments.length === 0) {
    return <p className="text-xs text-slate-500">No payments recorded on this visit yet.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-600">
          <tr>
            <th className="px-3 py-2">Receipt #</th>
            <th className="px-3 py-2">Time (IST)</th>
            <th className="px-3 py-2 text-center">Mode</th>
            <th className="px-3 py-2 text-right">Amount</th>
            <th className="px-3 py-2 text-center">Status</th>
            <th className="px-3 py-2 text-right">Receipt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-medium">
          {payments.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 font-mono font-bold text-slate-900">{p.receipt_number}</td>
              <td className="px-3 py-2 text-slate-600">{formatIst(p.created_at)}</td>
              <td className="px-3 py-2 text-center">
                <span className="rounded bg-slate-100 px-2 py-0.5 font-bold text-slate-700">
                  {p.payment_method}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono font-bold text-emerald-900">
                {formatPaise(p.amount_paise)}
              </td>
              <td className="px-3 py-2 text-center">
                {p.is_reversed ? (
                  <span className="rounded bg-red-100 px-2 py-0.5 font-bold text-red-800">Reversed</span>
                ) : (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800">Active</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => onReprint(p.id)}
                  className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
                >
                  <IconPrinter className="h-3.5 w-3.5 text-slate-500" />
                  Print
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentForm({
  visit,
  onPaid,
}: {
  visit: VisitDetail
  onPaid: (payment: PaymentOut) => void
}) {
  const payable = visit.consultations.filter((c) => c.collectable && c.balance_paise > 0)
  const [picked, setPicked] = useState<number | null>(null)
  const selected = payable.find((c) => c.appointment_id === picked) ?? payable[0] ?? null
  // The amount follows the balance of the chosen consultation until reception types over it.
  const [amountOverride, setAmountOverride] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [remarks, setRemarks] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recordPayment = useRecordPayment()

  const amount =
    amountOverride ?? (selected ? paiseToRupees(selected.balance_paise) : '')
  const amountPaise = rupeesToPaise(amount) ?? 0

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!selected) return
    const paise = rupeesToPaise(amount)
    if (paise === null) {
      setError('Enter the amount in rupees, for example 350 or 350.50.')
      return
    }
    if (paise > selected.balance_paise) {
      setError(`Only ${formatPaise(selected.balance_paise)} is due on this consultation.`)
      return
    }
    try {
      const payment = await recordPayment.mutateAsync({
        patient_id: visit.patient_id,
        appointment_id: selected.appointment_id,
        amount_paise: paise,
        payment_method: method,
        notes: remarks.trim() || `Consultation - ${selected.doctor_name_en}`,
      })
      setAmountOverride(null)
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

      {payable.length === 0 ? (
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
          {payable.length > 1 && (
            <div>
              <label htmlFor="visit-payment-consultation" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                Consultation
              </label>
              <select
                id="visit-payment-consultation"
                value={selected?.appointment_id ?? ''}
                onChange={(e) => {
                  setPicked(Number(e.target.value))
                  setAmountOverride(null)
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
              >
                {payable.map((c) => (
                  <option key={c.appointment_id} value={c.appointment_id}>
                    {c.doctor_name_en} - due {formatPaise(c.balance_paise)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label htmlFor="visit-payment-amount" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
              Amount (₹) *
            </label>
            <input
              id="visit-payment-amount"
              type="number"
              step="0.01"
              min="1"
              value={amount}
              onChange={(e) => setAmountOverride(e.target.value)}
              aria-describedby="visit-payment-hint"
              className="w-full max-w-xs rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-base font-black text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[44px]"
            />
            <p id="visit-payment-hint" className="mt-1 text-xs text-slate-600">
              Up to {selected ? formatPaise(selected.balance_paise) : '₹0.00'} on this consultation. Part payments are recorded as they come.
            </p>
          </div>

          <MethodPicker value={method} onChange={setMethod} />

          <div>
            <label htmlFor="visit-payment-remarks" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
              Remarks (optional)
            </label>
            <input
              id="visit-payment-remarks"
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="UPI reference, counter, or note"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900"
            />
          </div>

          <button
            type="submit"
            disabled={recordPayment.isPending || !selected}
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
      <h3 className="text-sm font-bold text-slate-900">Close visit (Patient Out)</h3>
      {error && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-xs font-semibold text-red-900">
          {error}
        </div>
      )}
      <form onSubmit={submit} className="space-y-3">
        {owes && (
          <div>
            <label htmlFor="visit-close-reason" className="mb-1 block text-xs font-bold uppercase tracking-wider text-amber-900">
              Reason for closing with {formatPaise(visit.outstanding_paise)} unpaid *
            </label>
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
          {closeVisit.isPending ? 'Closing...' : 'Close Visit / Patient Out'}
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

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <IconStethoscope className="h-4 w-4 text-emerald-800" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Charges</h4>
        </div>
        <ConsultationTable consultations={visit.consultations} />
        <div className="flex flex-wrap justify-end gap-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs">
          <span>
            Total paid{' '}
            <strong className="font-mono text-emerald-800">{formatPaise(visit.total_paid_paise)}</strong>
          </span>
          <span>
            Outstanding{' '}
            <strong className="font-mono text-red-700">{formatPaise(visit.outstanding_paise)}</strong>
          </span>
        </div>
      </div>

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
          <PaymentForm visit={visit} onPaid={setLastPayment} />
        </>
      )}

      <div className="space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">Payments on this visit</h4>
        <PaymentsTable payments={visit.payments} onReprint={onReprint} />
      </div>

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

export interface VisitCheckoutProps {
  /** payment:create (Reception). */
  canCollect: boolean
  /** visit:write (Reception). */
  canClose: boolean
  /** Visit opened from a dashboard link, if any. */
  initialVisitId: number | null
  onReprint: (paymentId: number) => void
}

/** Checkout at the desk: visits waiting for payment, their charges, payments and Patient Out. */
export function VisitCheckout({ canCollect, canClose, initialVisitId, onReprint }: VisitCheckoutProps) {
  // undefined = nothing picked yet, so the dashboard's visit is shown; null = cleared after a close.
  const [picked, setPicked] = useState<number | null | undefined>(undefined)
  const [notice, setNotice] = useState<string | null>(null)
  const selectedId = picked === undefined ? initialVisitId : picked

  const { data: ready, isPending: readyPending } = useVisits({ readyForCheckout: true })
  const { data: visit, isPending: visitPending } = useVisit(selectedId)

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Ready for checkout</h2>
          <p className="text-xs text-slate-500">The doctor has completed the consultation. Collect, then close the visit.</p>
        </div>
        {readyPending ? (
          <p className="p-4 text-center text-xs text-slate-500">Loading visits...</p>
        ) : !ready || ready.visits.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
            No visit is waiting for checkout.
          </p>
        ) : (
          <ul className="space-y-2">
            {ready.visits.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={v.id === selectedId}
                  onClick={() => {
                    setNotice(null)
                    setPicked(v.id)
                  }}
                  className={`w-full cursor-pointer rounded-xl border p-3 text-left text-xs transition-colors ${v.id === selectedId
                      ? 'border-emerald-700 bg-emerald-50'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                >
                  <div className="font-bold text-slate-900">{v.patient_name}</div>
                  <div className="font-mono text-slate-600">{v.patient_urn} &bull; {v.visit_date}</div>
                  <div className="text-slate-600">{v.doctors.join(', ')}</div>
                  <div className="mt-1 font-mono font-bold text-red-700">
                    {v.outstanding_paise > 0 ? `${formatPaise(v.outstanding_paise)} due` : 'Paid in full'}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-8">
        {notice && (
          <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900">
            {notice}
          </div>
        )}
        {selectedId == null ? (
          <p className="p-8 text-center text-xs text-slate-500">
            Select a visit to see its charges, take payment, or close it.
          </p>
        ) : visitPending ? (
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
          <span className="block text-xs font-bold uppercase tracking-wider text-amber-800">Total outstanding</span>
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
            <thead className="border-b border-slate-200 bg-slate-50 font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-3 py-2">Patient</th>
                <th className="px-3 py-2">Visit</th>
                <th className="px-3 py-2">Doctor</th>
                <th className="px-3 py-2 text-right">Fee</th>
                <th className="px-3 py-2 text-right">Paid</th>
                <th className="px-3 py-2 text-right">Balance</th>
                <th className="px-3 py-2">Closed with reason</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {dues.map((d) => (
                <tr key={d.appointment_id}>
                  <td className="px-3 py-2">
                    <div className="font-bold text-slate-900">{d.patient_name}</div>
                    <div className="font-mono text-slate-500">{d.patient_urn}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-700">{d.visit_date}</td>
                  <td className="px-3 py-2 text-slate-700">{d.doctor_name_en}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatPaise(d.fee_paise)}</td>
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
        appointment_id: due.appointment_id,
        amount_paise: paise,
        payment_method: method,
        notes: `Balance from visit ${due.visit_date} - ${due.doctor_name_en}`,
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
          <label htmlFor="due-collect-amount" className="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
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
