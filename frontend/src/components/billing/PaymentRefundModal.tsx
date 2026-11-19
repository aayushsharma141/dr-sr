import { useState, type FormEvent } from 'react'
import { useCreatePaymentRefund } from '../../api/queries'
import type { LedgerPaymentItemOut, PaymentMethod, RefundOut } from '../../api/types'
import { formatPaise, paiseToRupees, rupeesToPaise } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'

export interface PaymentRefundModalProps {
  open: boolean
  onClose: () => void
  patientId: number
  payment: LedgerPaymentItemOut | null
  onSuccess?: (refund: RefundOut) => void
}

const REFUND_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
]

const INPUT_CLASS =
  'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs transition-colors placeholder:text-slate-500 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

function RefundForm({
  patientId,
  payment,
  onClose,
  onSuccess,
  onPendingChange,
}: {
  patientId: number
  payment: LedgerPaymentItemOut
  onClose: () => void
  onSuccess?: (refund: RefundOut) => void
  onPendingChange: (pending: boolean) => void
}) {
  const refundMutation = useCreatePaymentRefund(patientId)
  const [amountRupees, setAmountRupees] = useState<string>(() =>
    paiseToRupees(payment.remaining_refundable_paise),
  )
  const [refundMethod, setRefundMethod] = useState<PaymentMethod>(payment.payment_method)
  const [reason, setReason] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const parsedPaise = rupeesToPaise(amountRupees)
  const exceedsRemaining =
    parsedPaise !== null && parsedPaise > payment.remaining_refundable_paise

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    const amountPaise = rupeesToPaise(amountRupees)
    if (amountPaise === null) {
      setErrorMessage('Enter a valid positive refund amount in rupees (up to 2 decimal places).')
      return
    }

    if (amountPaise > payment.remaining_refundable_paise) {
      setErrorMessage(
        `Refund amount ${formatPaise(amountPaise)} exceeds the remaining refundable amount of ${formatPaise(payment.remaining_refundable_paise)}.`,
      )
      return
    }

    const trimmedReason = reason.trim()
    if (trimmedReason.length < 5) {
      setErrorMessage('Refund reason must be at least 5 characters long.')
      return
    }

    onPendingChange(true)
    try {
      const created = await refundMutation.mutateAsync({
        paymentId: payment.id,
        body: {
          amount_paise: amountPaise,
          refund_method: refundMethod,
          reason: trimmedReason,
        },
      })
      onSuccess?.(created)
      onClose()
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Failed to issue refund. Check permissions and try again.')
      }
    } finally {
      onPendingChange(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
      <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-slate-800">
        <p className="font-bold text-amber-900">
          Immutable Admin Refund · Receipt {payment.receipt_number}
        </p>
        <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-amber-200/80 pt-2.5">
          <div>
            <dt className="text-slate-600">Original Paid</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-slate-900">
              {formatPaise(payment.amount_paise)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Already Refunded</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-amber-900">
              {formatPaise(payment.refunded_paise)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-600">Remaining Refundable</dt>
            <dd className="mt-0.5 font-mono text-sm font-bold tabular-nums text-emerald-800">
              {formatPaise(payment.remaining_refundable_paise)}
            </dd>
          </div>
        </dl>
      </div>

      {errorMessage && (
        <InlineAlert tone="error" onDismiss={() => setErrorMessage(null)}>
          {errorMessage}
        </InlineAlert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="refund-amount-rupees"
            className="block text-xs font-semibold text-slate-700"
          >
            Refund Amount (₹) <span className="text-red-700">*</span>
          </label>
          <input
            id="refund-amount-rupees"
            data-autofocus
            type="text"
            inputMode="decimal"
            required
            value={amountRupees}
            onChange={(e) => {
              setAmountRupees(e.target.value)
              setErrorMessage(null)
            }}
            placeholder="0.00"
            className={INPUT_CLASS}
          />
          <p className={`mt-1 text-xs ${exceedsRemaining ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
            Max refundable: {formatPaise(payment.remaining_refundable_paise)}
          </p>
        </div>

        <div>
          <label htmlFor="refund-method" className="block text-xs font-semibold text-slate-700">
            Refund Method <span className="text-red-700">*</span>
          </label>
          <select
            id="refund-method"
            value={refundMethod}
            onChange={(e) => {
              setRefundMethod(e.target.value as PaymentMethod)
              setErrorMessage(null)
            }}
            className={INPUT_CLASS}
          >
            {REFUND_METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="refund-reason" className="block text-xs font-semibold text-slate-700">
          Mandatory Refund Reason <span className="text-red-700">*</span>
        </label>
        <textarea
          id="refund-reason"
          rows={3}
          required
          minLength={5}
          maxLength={1000}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setErrorMessage(null)
          }}
          placeholder="Document the clinical or administrative reason for this refund (min 5 characters)..."
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-xs text-slate-600">
          Appended permanently to the patient ledger and audit log ({reason.trim().length}/5 min chars).
        </p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
        <button
          type="button"
          onClick={onClose}
          disabled={refundMutation.isPending}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={refundMutation.isPending || payment.remaining_refundable_paise <= 0}
          className="inline-flex min-h-11 items-center rounded-lg bg-[#5D0B26] px-4 text-sm font-semibold text-white shadow-xs hover:bg-[#7A1235] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
        >
          {refundMutation.isPending ? 'Issuing Refund…' : 'Confirm Refund'}
        </button>
      </div>
    </form>
  )
}

export function PaymentRefundModal({
  open,
  onClose,
  patientId,
  payment,
  onSuccess,
}: PaymentRefundModalProps) {
  const [busy, setBusy] = useState(false)

  return (
    <Modal
      open={open && payment !== null}
      onClose={onClose}
      variant="warning"
      dismiss="none"
      busy={busy}
      title="Issue Payment Refund"
      description={
        payment
          ? `Receipt: ${payment.receipt_number} · Patient: ${payment.patient_name}`
          : undefined
      }
      className="max-w-lg"
    >
      {payment && (
        <RefundForm
          key={`${payment.id}-${payment.remaining_refundable_paise}`}
          patientId={patientId}
          payment={payment}
          onClose={onClose}
          onSuccess={onSuccess}
          onPendingChange={setBusy}
        />
      )}
    </Modal>
  )
}
