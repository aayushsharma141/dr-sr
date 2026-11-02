import React, { useState } from 'react'
import type { PaymentCreate, PaymentMethod, PaymentOut, TreatmentPlanOut } from '../api/types'
import { useRecordPayment } from '../api/queries'

interface PaymentModalProps {
  isOpen: boolean
  onClose: () => void
  patientId: number
  patientName: string
  patientUrn: string
  treatmentPlan?: TreatmentPlanOut | null
  appointmentId?: number | null
  defaultAmountPaise?: number
  onSuccess?: (payment: PaymentOut) => void
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  patientId,
  patientName,
  patientUrn,
  treatmentPlan,
  appointmentId,
  defaultAmountPaise,
  onSuccess,
}) => {
  const initialRupees = defaultAmountPaise ? (defaultAmountPaise / 100).toString() : ''
  const [amountRupees, setAmountRupees] = useState<string>(initialRupees)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [notes, setNotes] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const recordPayment = useRecordPayment()

  if (!isOpen) return null

  // Calculate remaining balance if this is a treatment package instalment
  const agreedPriceRupees = treatmentPlan ? treatmentPlan.agreed_price_paise / 100 : null

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAmountRupees(e.target.value)
    setErrorMessage(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMessage(null)

    const parsedRupees = parseFloat(amountRupees)
    if (isNaN(parsedRupees) || parsedRupees <= 0) {
      setErrorMessage('Please enter a valid payment amount greater than zero.')
      return
    }

    const amountPaise = Math.round(parsedRupees * 100)

    const payload: PaymentCreate = {
      patient_id: patientId,
      treatment_plan_id: treatmentPlan?.id ?? null,
      appointment_id: appointmentId ?? null,
      amount_paise: amountPaise,
      payment_method: paymentMethod,
      notes: notes.trim() || null,
    }

    try {
      const payment = await recordPayment.mutateAsync(payload)
      if (onSuccess) {
        onSuccess(payment)
      }
      onClose()
    } catch (err: unknown) {
      if (err instanceof Error) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage('Failed to record payment. Please check your network and try again.')
      }
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b pb-3 dark:border-slate-800">
          <div>
            <h2 id="payment-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Record Payment
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {patientName} ({patientUrn})
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

        {treatmentPlan && (
          <div className="my-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            <div className="font-semibold">{treatmentPlan.plan_name}</div>
            <div className="mt-1 flex justify-between text-xs">
              <span>Package Agreed Price:</span>
              <span className="font-medium">₹{agreedPriceRupees?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="amount-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Amount (₹) *
            </label>
            <div className="relative mt-1">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">₹</span>
              <input
                id="amount-input"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountRupees}
                onChange={handleAmountChange}
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Payment Method *
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['CASH', 'UPI', 'CARD'] as PaymentMethod[]).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-lg border py-2 text-center text-xs font-bold transition ${
                    paymentMethod === method
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="notes-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Transaction Notes / Ref
            </label>
            <input
              id="notes-input"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. UPI txn id, card last 4 digits"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          {errorMessage && (
            <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {errorMessage}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={recordPayment.isPending}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={recordPayment.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700 disabled:opacity-50"
            >
              {recordPayment.isPending ? 'Processing...' : 'Collect & Issue Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
