import React from 'react'
import type { ClinicSettingsOut, PaymentOut } from '../api/types'
import { LetterheadContactLine, LetterheadHeaderNote } from './PrintLetterhead'

interface ReceiptPrintProps {
  payment: PaymentOut
  isReprint?: boolean
  /** Clinic header from settings. When absent, the standard clinic text is used. */
  settings?: ClinicSettingsOut | null
}

// Standard clinic text, used only when settings are not loaded or a field is empty.
const FALLBACK = {
  nameHi: 'कल्याण हॉस्पिटल एवं फिजियोथेरेपी केंद्र',
  nameEn: 'Kalyan Hospital & Physiotherapy Centre',
  address: 'Station Road, Ara, Bhojpur, Bihar - 802301',
  footerHi: 'धन्यवाद! आपके शीघ्र स्वास्थ्य लाभ की कामना करते हैं।',
}

/**
 * Payment receipt for an A4 sheet (approved paper, 2026-11-02). It is printed through
 * ReceiptDialog, which puts it on the named `receipt` page from print.css.
 * Layout: header, meta, patient, transaction, amount, footer.
 * No theme-dependent classes: a receipt must not change with the OS theme.
 */
export const ReceiptPrint: React.FC<ReceiptPrintProps> = ({ payment, isReprint = false, settings }) => {
  const amountRupees = (payment.amount_paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const formattedDate = new Date(payment.created_at).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  const nameHi = settings?.name_hi || FALLBACK.nameHi
  const nameEn = settings?.name_en || FALLBACK.nameEn
  const addressLines = [settings?.address_1, settings?.address_2].filter((a): a is string => !!a)
  const footerHi = settings?.print_footer_hi || FALLBACK.footerHi

  return (
    <div className="receipt-container relative mx-auto w-[150mm] max-w-full bg-white p-6 text-slate-900 print:w-full print:max-w-none print:p-0">
      {/* Solid DUPLICATE mark on reprint: a bordered stamp, not an opacity watermark, so it prints legibly */}
      {isReprint && (
        <div
          data-testid="duplicate-stamp"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="rotate-[-25deg] border-4 border-red-700 bg-white px-6 py-2 text-3xl font-black uppercase tracking-widest text-red-700">
            DUPLICATE
          </div>
        </div>
      )}

      {/* Header: clinic name, address and phone come from settings */}
      <div className="border-b border-slate-300 pb-3 text-center">
        <h1 lang="hi" className="text-base font-bold text-slate-900">
          {nameHi}
        </h1>
        <h2 className="text-sm font-semibold text-slate-800">{nameEn}</h2>
        {addressLines.length > 0 ? (
          addressLines.map((line) => (
            <p key={line} lang="hi" className="mt-1 text-[11px] text-slate-700">
              {line}
            </p>
          ))
        ) : (
          <p className="mt-1 text-[11px] text-slate-700">{FALLBACK.address}</p>
        )}
        <LetterheadContactLine settings={settings} />
        <LetterheadHeaderNote settings={settings} />
        <div className="mt-2 inline-block rounded bg-slate-100 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-900">
          {payment.is_reversed ? 'REVERSED PAYMENT RECEIPT' : 'PAYMENT RECEIPT'}
          {isReprint && ' (DUPLICATE COPY)'}
        </div>
      </div>

      {/* Meta */}
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-700">Receipt No:</span>
          <span className="font-mono font-bold text-slate-900">{payment.receipt_number}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-700">Date &amp; Time:</span>
          <span className="font-medium text-slate-900">{formattedDate}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-700">Cashier:</span>
          <span className="font-medium text-slate-900">@{payment.created_by_username}</span>
        </div>
      </div>

      {/* Patient details */}
      <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-2.5 text-xs">
        <div className="flex justify-between">
          <span className="text-slate-700">Patient URN:</span>
          <span className="font-mono font-semibold text-slate-900">
            {payment.patient_urn || (payment as { patient?: { urn?: string } }).patient?.urn}
          </span>
        </div>
        <div className="mt-1 flex justify-between">
          <span className="text-slate-700">Patient Name:</span>
          <span className="font-bold text-slate-900">
            {payment.patient_name || (payment as { patient?: { full_name?: string } }).patient?.full_name}
          </span>
        </div>
        {(payment.patient_mobile || (payment as { patient?: { mobile?: string } }).patient?.mobile) && (
          <div className="mt-1 flex justify-between">
            <span className="text-slate-700">Mobile:</span>
            <span className="font-mono font-medium text-slate-900">
              {payment.patient_mobile || (payment as { patient?: { mobile?: string } }).patient?.mobile}
            </span>
          </div>
        )}
        {(payment.patient_address || (payment as { patient?: { address?: string } }).patient?.address) && (
          <div className="mt-1 flex justify-between">
            <span className="text-slate-700">Address:</span>
            <span className="max-w-[70%] text-right text-slate-900 break-words">
              {payment.patient_address || (payment as { patient?: { address?: string } }).patient?.address}
            </span>
          </div>
        )}
        {payment.treatment_plan_name && (
          <div className="mt-1 flex justify-between">
            <span className="text-slate-700">Package:</span>
            <span className="font-medium text-slate-900">{payment.treatment_plan_name}</span>
          </div>
        )}
      </div>

      {/* Transaction */}
      <div className="mt-3 border-t border-slate-300 pt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-slate-700">Payment Mode:</span>
          <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-900">
            {payment.payment_method}
          </span>
        </div>
        {payment.notes && (
          <div className="mt-1 flex justify-between text-xs">
            <span className="text-slate-700">Notes:</span>
            <span className="text-slate-800">{payment.notes}</span>
          </div>
        )}

        <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-slate-400 pt-2">
          <span className="text-sm font-bold text-slate-900">Amount Paid:</span>
          <span className="text-lg font-black text-slate-900">₹{amountRupees}</span>
        </div>
      </div>

      {/* Reversal notice */}
      {payment.is_reversed && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-900">
          <div className="font-bold">TRANSACTION REVERSED</div>
          <div className="mt-0.5">Reason: {payment.reversal_reason}</div>
          {payment.reversed_by_username && (
            <div className="mt-0.5">Authorized by @{payment.reversed_by_username}</div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-6 border-t border-slate-300 pt-3 text-center text-[11px] text-slate-700">
        <p>This is a computer generated receipt. Signature not required.</p>
        <p lang="hi" className="mt-0.5">
          {footerHi}
        </p>
      </div>
    </div>
  )
}
