import { useEffect, useState, type FormEvent } from 'react'
import {
  useAdminCorrectBillLine,
  useAdminVoidBillLine,
  useCorrectBillLine,
  useVoidBillLine,
  type BillLineOut,
} from '../../api/bill'
import { ApiError } from '../../api/client'
import { formatPaise, paiseToRupees, rupeesToPaise } from '../../format'
import { ConflictBanner } from '../ConflictBanner'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'

export interface BillLineActionModalProps {
  open: boolean
  onClose: () => void
  visitId: number
  line: BillLineOut | null
  mode: 'void' | 'correct'
  isAdmin?: boolean
  onReload?: () => void
}

export function BillLineActionModal({
  open,
  onClose,
  visitId,
  line,
  mode,
  isAdmin = false,
  onReload,
}: BillLineActionModalProps) {
  const [reason, setReason] = useState('')
  const [quantity, setQuantity] = useState('')
  const [rateRupees, setRateRupees] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isConflict, setIsConflict] = useState(false)

  const voidMutation = useVoidBillLine(visitId)
  const correctMutation = useCorrectBillLine(visitId)
  const adminVoidMutation = useAdminVoidBillLine(visitId)
  const adminCorrectMutation = useAdminCorrectBillLine(visitId)

  const isPending =
    voidMutation.isPending ||
    correctMutation.isPending ||
    adminVoidMutation.isPending ||
    adminCorrectMutation.isPending

  useEffect(() => {
    if (open && line) {
      setReason('')
      setQuantity(String(line.quantity))
      setRateRupees(paiseToRupees(line.rate_paise))
      setErrorMsg(null)
      setIsConflict(false)
    }
  }, [open, line, mode])

  if (!line) return null

  const parsedRatePaise = rupeesToPaise(rateRupees)
  const numQty = Number(quantity.trim())
  const validQty = !isNaN(numQty) && numQty > 0 && /^\d+(\.\d{1,2})?$/.test(quantity.trim())
  const previewPaise = validQty && parsedRatePaise != null ? Math.round(numQty * parsedRatePaise) : null

  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= 3 && reason.length <= 500

  const missing: string[] = []
  if (mode === 'correct') {
    if (!quantity.trim() || !validQty) missing.push('valid quantity')
    if (!rateRupees.trim() || parsedRatePaise == null) missing.push('valid rate')
  }
  if (!reasonValid) {
    missing.push('reason (3–500 characters)')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setIsConflict(false)

    if (missing.length > 0) return

    try {
      if (mode === 'void') {
        if (isAdmin) {
          await adminVoidMutation.mutateAsync({ lineId: line.id, reason: trimmedReason })
        } else {
          await voidMutation.mutateAsync({ lineId: line.id, reason: trimmedReason })
        }
      } else {
        const payload = {
          quantity: quantity.trim(),
          rate_paise: parsedRatePaise!,
          reason: trimmedReason,
        }
        if (isAdmin) {
          await adminCorrectMutation.mutateAsync({ lineId: line.id, payload })
        } else {
          await correctMutation.mutateAsync({ lineId: line.id, payload })
        }
      }
      onClose()
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 409) {
        setIsConflict(true)
      } else if (err instanceof Error) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('Network error: Could not reach the server.')
      }
    }
  }

  const title = mode === 'void' ? 'Void bill line' : 'Change quantity'

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      variant={mode === 'void' ? 'destructive' : 'info'}
      busy={isPending}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-4">
        {isConflict && (
          <ConflictBanner
            onReload={() => {
              setIsConflict(false)
              if (onReload) onReload()
              onClose()
            }}
            actionLabel="Reload latest"
            message="This bill line was modified or voided by another user."
          />
        )}

        {errorMsg && (
          <InlineAlert tone="error">
            {errorMsg}
          </InlineAlert>
        )}

        {/* Line details card */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
          <div className="flex items-center justify-between font-bold text-slate-900">
            <span>{line.description}</span>
            <span className="font-mono tabular-nums">{formatPaise(line.amount_paise)}</span>
          </div>
          <p className="text-slate-600 font-mono">
            Current: {line.quantity} × {formatPaise(line.rate_paise)}
          </p>
        </div>

        {/* Correction inputs */}
        {mode === 'correct' && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="action-line-qty" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                New Quantity *
              </label>
              <input
                id="action-line-qty"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                data-autofocus
                className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="action-line-rate" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
                Rate (₹) *
              </label>
              <input
                id="action-line-rate"
                type="text"
                inputMode="decimal"
                value={rateRupees}
                onChange={(e) => setRateRupees(e.target.value)}
                className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
              />
            </div>
          </div>
        )}

        {mode === 'correct' && previewPaise != null && parsedRatePaise != null && (
          <div className="rounded-lg bg-slate-50 p-2 text-center font-mono text-xs font-bold tabular-nums text-slate-800">
            Revised: {quantity.trim()} × {formatPaise(parsedRatePaise)} = {formatPaise(previewPaise)}
          </div>
        )}

        {/* Reason field (required, 3-500 characters) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="action-line-reason" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
              Reason *
            </label>
            <span
              className={`text-xs tabular-nums ${
                reason.length > 500 ? 'text-red-700 font-bold' : 'text-slate-500'
              }`}
            >
              {reason.length} / 500
            </span>
          </div>
          <textarea
            id="action-line-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              mode === 'void'
                ? 'Reason for voiding this line (min 3 characters)'
                : 'Reason for changing quantity (min 3 characters)'
            }
            data-autofocus={mode === 'void' ? true : undefined}
            className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
          />
        </div>

        {/* Actions footer */}
        <div className="space-y-2 border-t border-slate-100 pt-3">
          {missing.length > 0 && (
            <p className="text-xs text-slate-500">Still needed: {missing.join(', ')}.</p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || missing.length > 0}
              className={`min-h-11 rounded-lg px-5 py-2 text-xs font-bold text-white shadow-xs focus-visible:outline focus-visible:outline-2 disabled:opacity-50 cursor-pointer ${
                mode === 'void'
                  ? 'bg-[#C81E1E] hover:bg-red-800 focus-visible:outline-red-700'
                  : 'bg-[#8E1C3D] hover:bg-[#5D0B26] focus-visible:outline-[#8E1C3D]'
              }`}
            >
              {isPending
                ? 'Saving...'
                : mode === 'void'
                  ? 'Void line'
                  : 'Save change'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
