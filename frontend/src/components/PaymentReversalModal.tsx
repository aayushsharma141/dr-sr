import React, { useState } from 'react'
import type { PaymentOut } from '../api/types'
import { useReversePayment } from '../api/queries'

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

  if (!isOpen || !payment) return null

  const amountRupees = (payment.amount_paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reversal-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b pb-3 dark:border-slate-800">
          <div>
            <h2 id="reversal-modal-title" className="text-lg font-bold text-red-600 dark:text-red-400">
              Reverse Payment Transaction
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Receipt: {payment.receipt_number} · Patient: {payment.patient_name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="my-4 rounded-lg bg-red-50 p-3 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          <p className="font-bold">⚠️ Warning: Irreversible Action</p>
          <p className="mt-1">
            Reversing this payment of <span className="font-bold">₹{amountRupees}</span> will
            restore the patient's pending balance. All reversals are permanently logged in the
            immutable audit trail.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reversal-reason" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Mandatory Reversal Justification *
            </label>
            <textarea
              id="reversal-reason"
              rows={3}
              required
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setErrorMessage(null)
              }}
              placeholder="Provide a clear clinical or administrative justification (min 5 characters)..."
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={reversePayment.isPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={reversePayment.isPending}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-red-700 disabled:opacity-50"
            >
              {reversePayment.isPending ? 'Reversing...' : 'Confirm Reversal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

