import React from 'react'
import type { PaymentOut } from '../api/types'

interface ReceiptPrintProps {
  payment: PaymentOut
  isReprint?: boolean
  onPrintComplete?: () => void
}

export const ReceiptPrint: React.FC<ReceiptPrintProps> = ({
  payment,
  isReprint = false,
  onPrintComplete,
}) => {
  const amountRupees = (payment.amount_paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const formattedDate = new Date(payment.created_at).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <div className="receipt-container relative mx-auto my-6 max-w-sm rounded-lg border border-slate-300 bg-white p-6 shadow-sm print:m-0 print:max-w-none print:border-none print:p-0 print:shadow-none dark:border-slate-700 dark:bg-slate-900">
      {/* Prominent Duplicate Watermark on reprint */}
      {isReprint && (
        <div
          data-testid="duplicate-stamp"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="rotate-[-25deg] rounded border-4 border-red-500/30 px-6 py-2 text-3xl font-black uppercase tracking-widest text-red-500/30">
            DUPLICATE
          </div>
        </div>
      )}

      {/* Header */}
      <div className="border-b pb-3 text-center dark:border-slate-800">
        <h1 className="text-base font-bold text-slate-900 dark:text-white">
          कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र
        </h1>
        <h2 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          Kalyan Hospital & Physiotherapy Centre
        </h2>
        <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          Station Road, Ara, Bhojpur, Bihar - 802301
        </p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Phone: +91 94310 00000 · Emergency: 24x7
        </p>
        <div className="mt-2 inline-block rounded bg-slate-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          {payment.is_reversed ? 'REVERSED PAYMENT RECEIPT' : 'PAYMENT RECEIPT'}
          {isReprint && ' (DUPLICATE COPY)'}
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Receipt No:</span>
          <span className="font-mono font-bold text-slate-900 dark:text-white">
            {payment.receipt_number}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Date & Time:</span>
          <span className="font-medium text-slate-900 dark:text-white">{formattedDate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Cashier:</span>
          <span className="font-medium text-slate-900 dark:text-white">@{payment.created_by_username}</span>
        </div>
      </div>

      {/* Patient details */}
      <div className="mt-3 rounded border border-slate-200 bg-slate-50/50 p-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/40">
        <div className="flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Patient URN:</span>
          <span className="font-mono font-semibold text-slate-900 dark:text-white">
            {payment.patient_urn}
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-slate-500 dark:text-slate-400">Patient Name:</span>
          <span className="font-bold text-slate-900 dark:text-white">{payment.patient_name}</span>
        </div>
        {payment.treatment_plan_name && (
          <div className="mt-1 flex justify-between">
            <span className="text-slate-500 dark:text-slate-400">Package:</span>
            <span className="font-medium text-slate-900 dark:text-white">
              {payment.treatment_plan_name}
            </span>
          </div>
        )}
      </div>

      {/* Transaction Details */}
      <div className="mt-3 border-t pt-3 dark:border-slate-800">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">Payment Mode:</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            {payment.payment_method}
          </span>
        </div>
        {payment.notes && (
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400">Notes:</span>
            <span className="text-slate-700 dark:text-slate-300">{payment.notes}</span>
          </div>
        )}

        <div className="mt-3 flex items-baseline justify-between border-t border-dashed pt-2 dark:border-slate-700">
          <span className="text-sm font-bold text-slate-900 dark:text-white">Amount Paid:</span>
          <span className="text-lg font-black text-slate-900 dark:text-white">₹{amountRupees}</span>
        </div>
      </div>

      {/* Reversal notice */}
      {payment.is_reversed && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <div className="font-bold">TRANSACTION REVERSED</div>
          <div className="mt-0.5">Reason: {payment.reversal_reason}</div>
          {payment.reversed_by_username && (
            <div className="mt-0.5 text-[10px]">
              Authorized by @{payment.reversed_by_username}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 border-t pt-3 text-center text-[10px] text-slate-400 dark:border-slate-800">
        <p>This is a computer generated receipt. Signature not required.</p>
        <p className="mt-0.5">धन्यवाद! आपके शीघ्र स्वास्थ्य लाभ की कामना करते हैं।</p>
      </div>

      {/* Action button in screen mode */}
      <div className="mt-4 flex justify-center print:hidden">
        <button
          type="button"
          onClick={() => {
            window.print()
            if (onPrintComplete) onPrintComplete()
          }}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-bold text-white shadow hover:bg-blue-700"
        >
          Print Receipt (Thermal / A5)
        </button>
      </div>
    </div>
  )
}

