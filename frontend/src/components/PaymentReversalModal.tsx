import React, { useState } from 'react'
import type { PaymentOut } from '../api/types'
import { useReversePayment } from '../api/queries'
import { Modal } from './Modal'

interface PaymentReversalModalProps {
  isOpen: boolean
  onClose: () => void
  payment: PaymentOut | null
  onSuccess?: (payment: PaymentOut) => void
}

export const PaymentReversalModal: React.FC<PaymentReversalModalProps> = ({
  isOpen,
  onClose,
  payment,
  onSuccess,
}) => {
  const [reason, setReason] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reversePayment = useReversePayment()

  const amountRupees = payment
    ? (payment.amount_paise / 100).toLocaleString('en-IN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : ''

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!payment) return
    setErrorMessage(null)

    const trimmed = reason.trim()
    if (trimmed.length < 5) {
      setErrorMessage('Reversal reason must be at least 5 characters long.')
      return
    }

    try {
      const updated = await reversePayment.mutateAsync({
        id: payment.id,
        payload: { reversal_reason: trimmed },
      })
      if (onSuccess) onSuccess(updated)
      onClose()
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Failed to reverse payment. Check permissions and try again.')
      }
    }
  }

  return (
    <Modal
      open={isOpen && payment !== null}
      onClose={onClose}
      variant="destructive"
      dismiss="none"
      title="Reverse Payment Transaction"
      description={payment ? `Receipt: ${payment.receipt_number} · Patient: ${payment.patient_name}` : undefined}
      busy={reversePayment.isPending}
      className="max-w-md"
    >
      <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
        <p className="font-bold">Warning: irreversible action</p>
        <p className="mt-1">
          Reversing this payment of <span className="font-bold">₹{amountRupees}</span> will restore the
          patient's pending balance. All reversals are permanently logged in the audit trail.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="reversal-reason" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Mandatory Reversal Justification *
          </label>
          <textarea
            id="reversal-reason"
            data-autofocus
            rows={3}
            required
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setErrorMessage(null)
            }}
            placeholder="Provide a clear clinical or administrative justification (min 5 characters)..."
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600"
          />
        </div>

        {errorMessage && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={reversePayment.isPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={reversePayment.isPending}
            className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white shadow hover:bg-red-900 disabled:opacity-50"
          >
            {reversePayment.isPending ? 'Reversing...' : 'Confirm Reversal'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
