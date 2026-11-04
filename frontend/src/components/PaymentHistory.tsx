import { useState } from 'react'
import type { PaymentOut } from '../api/types'
import { useMe, usePatientPayments } from '../api/queries'
import { ReceiptDialog } from './ReceiptDialog'

interface PaymentHistoryProps {
  patientId: number
}

const CAN_REPRINT_ROLES = ['ADMIN', 'RECEPTION']

/**
 * Payments and receipts for one patient, with Reprint (DUPLICATE COPY).
 * Visible to Admin and Reception only; a Doctor sees no card.
 */
export function PaymentHistory({ patientId }: PaymentHistoryProps) {
  const { data: me } = useMe()
  const { data, isPending, isError } = usePatientPayments(patientId)
  const [reprint, setReprint] = useState<PaymentOut | null>(null)

  if (!me || !CAN_REPRINT_ROLES.includes(me.role)) return null

  // Guard: a malformed response must not crash the page.
  const payments: PaymentOut[] = Array.isArray(data) ? data : []

  return (
    <section aria-labelledby="payment-history-title" className="rounded-lg border border-neutral-200 bg-white p-5 shadow-xs">
      <h2 id="payment-history-title" className="text-base font-semibold text-neutral-900">
        Payments &amp; receipts
      </h2>

      {isPending && <p className="mt-3 text-sm text-neutral-600" role="status">Loading payments...</p>}
      {isError && (
        <p className="mt-3 text-sm text-red-900" role="alert">
          Could not load payments for this patient.
        </p>
      )}
      {!isPending && !isError && payments.length === 0 && (
        <p className="mt-3 text-sm text-neutral-600">No payments recorded yet.</p>
      )}

      {payments.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm text-neutral-800">
            <thead>
              <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-700">
                <th scope="col" className="py-2 pr-3">Receipt</th>
                <th scope="col" className="py-2 pr-3">Date</th>
                <th scope="col" className="py-2 pr-3">Amount</th>
                <th scope="col" className="py-2 pr-3">Mode</th>
                <th scope="col" className="py-2 pr-3">Status</th>
                <th scope="col" className="py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-mono">{p.receipt_number}</td>
                  <td className="py-2 pr-3">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="py-2 pr-3">₹{(p.amount_paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                  <td className="py-2 pr-3">{p.payment_method}</td>
                  <td className="py-2 pr-3">{p.is_reversed ? 'Reversed' : 'Paid'}</td>
                  <td className="py-2 text-right">
                    {!p.is_reversed && (
                      <button
                        type="button"
                        aria-label={`Reprint receipt ${p.receipt_number}`}
                        onClick={() => setReprint(p)}
                        className="rounded border border-neutral-300 px-2.5 py-1 text-xs font-medium text-neutral-800 hover:bg-neutral-50 cursor-pointer"
                      >
                        Reprint
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reprint && (
        <ReceiptDialog payment={reprint} isReprint onClose={() => setReprint(null)} />
      )}
    </section>
  )
}
