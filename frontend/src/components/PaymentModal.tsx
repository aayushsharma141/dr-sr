import React, { useState } from 'react'
import type { PaymentCreate, PaymentMethod, PaymentOut, TreatmentPlanOut } from '../api/types'
import { useRecordPayment } from '../api/queries'
import { Modal } from './Modal'
import { PAYMENT_RECORDED_EVENT } from './ReceiptHost'

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
      window.dispatchEvent(new CustomEvent(PAYMENT_RECORDED_EVENT, { detail: payment }))
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Record Payment"
      description={`${patientName} (${patientUrn})`}
      busy={recordPayment.isPending}
      className="max-w-md"
    >
      {treatmentPlan && (
        <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <div className="font-semibold">{treatmentPlan.plan_name}</div>
          <div className="mt-1 flex justify-between text-xs">
            <span>Package Agreed Price:</span>
            <span className="font-medium">₹{agreedPriceRupees?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="amount-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Amount (₹) *
          </label>
          <div className="relative mt-1">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-600">₹</span>
            <input
              id="amount-input"
              data-autofocus
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amountRupees}
              onChange={handleAmountChange}
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-8 pr-3 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <span id="payment-method-label" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Payment Method *
          </span>
          <div role="group" aria-labelledby="payment-method-label" className="mt-2 grid grid-cols-3 gap-2">
            {(['CASH', 'UPI', 'CARD'] as PaymentMethod[]).map((method) => (
              <button
                key={method}
                type="button"
                aria-pressed={paymentMethod === method}
                onClick={() => setPaymentMethod(method)}
                className={`rounded-lg border py-2 text-center text-xs font-bold transition ${
                  paymentMethod === method
                    ? 'border-blue-700 bg-blue-700 text-white'
                    : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                }`}
              >
                {method}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="notes-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-700">
            Transaction Notes / Ref
          </label>
          <input
            id="notes-input"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. UPI txn id, card last 4 digits"
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {errorMessage && (
          <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={recordPayment.isPending}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={recordPayment.isPending}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-800 disabled:opacity-50"
          >
            {recordPayment.isPending ? 'Processing...' : 'Collect & Issue Receipt'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
