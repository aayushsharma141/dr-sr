import type { PaymentOut } from '../api/types'
import { useClinicSettings } from '../api/queries'
import { Modal } from './Modal'
import { ReceiptPrint } from './ReceiptPrint'

interface ReceiptDialogProps {
  payment: PaymentOut
  isReprint?: boolean
  onClose: () => void
}

/**
 * Receipt preview and print, in the shared dialog. Printing uses the `receipt` named page
 * (A4, print.css) and hides the app page behind it. The preview is the print source: there
 * is one copy of the receipt in the DOM.
 */
export function ReceiptDialog({ payment, isReprint = false, onClose }: ReceiptDialogProps) {
  const { data: settings } = useClinicSettings()

  return (
    <Modal
      open
      print="receipt"
      title={isReprint ? 'Payment receipt (DUPLICATE COPY)' : 'Payment receipt'}
      onClose={onClose}
      className="max-w-[210mm]"
    >
      <div className="mb-4 flex justify-end gap-3 print:hidden">
        <button
          type="button"
          data-autofocus
          onClick={() => window.print()}
          className="cursor-pointer rounded-lg bg-red-800 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-900"
        >
          Print receipt (A4)
        </button>
      </div>
      <ReceiptPrint payment={payment} isReprint={isReprint} settings={settings ?? null} />
    </Modal>
  )
}
