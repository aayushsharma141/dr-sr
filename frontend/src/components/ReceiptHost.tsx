import { useEffect, useState } from 'react'
import type { PaymentOut } from '../api/types'
import { ReceiptDialog } from './ReceiptDialog'

/** Fired by PaymentModal after a payment is saved. detail: PaymentOut. */
export const PAYMENT_RECORDED_EVENT = 'kalyan:payment-recorded'

/**
 * Opens the receipt for every payment recorded anywhere in the app, so each page that
 * takes payments gets the receipt without its own wiring. Mounted once, at the app root.
 */
export function ReceiptHost() {
  const [payment, setPayment] = useState<PaymentOut | null>(null)

  useEffect(() => {
    const onRecorded = (event: Event) => {
      const detail = (event as CustomEvent<PaymentOut>).detail
      if (detail) setPayment(detail)
    }
    window.addEventListener(PAYMENT_RECORDED_EVENT, onRecorded)
    return () => window.removeEventListener(PAYMENT_RECORDED_EVENT, onRecorded)
  }, [])

  if (!payment) return null
  return <ReceiptDialog payment={payment} onClose={() => setPayment(null)} />
}
