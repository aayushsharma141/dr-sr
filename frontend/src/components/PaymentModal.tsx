import React, { useState } from 'react'
import type { PaymentCreate, PaymentMethod, PaymentOut, PendingDueOut, TreatmentPlanOut } from '../api/types'
import { apiFetch } from '../api/client'
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
  /** Remaining balance on the linked treatment package, when known. Caps the amount locally. */
  maxAmountPaise?: number
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
  maxAmountPaise,
  onSuccess,
}) => {
  const initialRupees = defaultAmountPaise ? (defaultAmountPaise / 100).toString() : ''
  const [amountRupees, setAmountRupees] = useState<string>(initialRupees)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH')
  const [notes, setNotes] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [checkingBalance, setCheckingBalance] = useState(false)
  // Starts from the balance the page loaded; replaced by the fresh figure read just before submit.
  const [remainingBalancePaise, setRemainingBalancePaise] = useState<number | null>(maxAmountPaise ?? null)

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

    // Re-read the package balance before submitting: another workstation may have collected part of it
    // since this dialog opened. If the refresh fails, fall back to the balance passed in and let the
    // server remain the authority.
    let remainingPaise = maxAmountPaise ?? null
    if (treatmentPlan && maxAmountPaise != null) {
      setCheckingBalance(true)
      try {
        // Direct read so the check never uses a cached ledger; the server stays authoritative.
        const dues = await apiFetch<PendingDueOut[]>('/billing/pending-dues')
        remainingPaise = dues.find((d) => d.treatment_plan_id === treatmentPlan.id)?.balance_paise ?? 0
      } catch {
        remainingPaise = maxAmountPaise
      } finally {
        setCheckingBalance(false)
      }
    }

    // The server enforces this too; catching it here avoids a round trip and a confusing rejection.
    const remainingRupees = remainingPaise != null ? remainingPaise / 100 : null
    if (remainingPaise != null) {
      // Show the figure the rejection was based on, not the stale one the dialog opened with.
      setRemainingBalancePaise(remainingPaise)
    }
    if (remainingRupees !== null && parsedRupees > remainingRupees) {
      // Put the correct figure in the field so reception does not have to retype it.
      if (remainingRupees > 0) {
        setAmountRupees(remainingRupees.toString())
      }
      setErrorMessage(
        `Amount cannot exceed the remaining package balance of ₹${remainingRupees.toLocaleString('en-IN', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}.`,
      )
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
      busy={recordPayment.isPending || checkingBalance}
      className="max-w-md"
    >
      {treatmentPlan && (
        <div className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">
          <div className="font-semibold">{treatmentPlan.plan_name}</div>
          <div className="mt-1 flex justify-between text-xs">
            <span>Package Agreed Price:</span>
            <span className="font-medium">₹{agreedPriceRupees?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          {remainingBalancePaise !== null && (
            <div className="mt-1 flex justify-between text-xs">
              <span>Remaining Balance:</span>
              <span className="font-semibold" data-testid="remaining-balance">
                ₹
                {(remainingBalancePaise / 100).toLocaleString('en-IN', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          )}
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
            disabled={recordPayment.isPending || checkingBalance}
            className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-800 disabled:opacity-50"
          >
            {checkingBalance
              ? 'Checking balance...'
              : recordPayment.isPending
                ? 'Processing...'
                : 'Collect & Issue Receipt'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
