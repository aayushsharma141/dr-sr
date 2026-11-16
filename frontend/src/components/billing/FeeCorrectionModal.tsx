import { useEffect, useState, type FormEvent } from 'react'
import { useFeeCorrection } from '../../api/bill'
import { ApiError } from '../../api/client'
import { formatPaise, paiseToRupees, rupeesToPaise } from '../../format'
import { ConflictBanner } from '../ConflictBanner'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'

export interface FeeCorrectionModalProps {
  open: boolean
  onClose: () => void
  visitId: number
  appointmentId: number
  currentAmountPaise: number
  onReload?: () => void
}

type AdjustmentKind = 'DISCOUNT' | 'WAIVER' | 'CORRECTION'

export function FeeCorrectionModal({
  open,
  onClose,
  visitId,
  appointmentId,
  currentAmountPaise,
  onReload,
}: FeeCorrectionModalProps) {
  const [kind, setKind] = useState<AdjustmentKind>('DISCOUNT')
  const [amountRupees, setAmountRupees] = useState('')
  const [reason, setReason] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [isConflict, setIsConflict] = useState(false)

  const feeCorrectionMutation = useFeeCorrection(visitId)

  useEffect(() => {
    if (open) {
      setKind('DISCOUNT')
      setAmountRupees('')
      setReason('')
      setErrorMsg(null)
      setIsConflict(false)
    }
  }, [open, appointmentId, currentAmountPaise])

  // When kind changes, adjust default amount
  const handleKindChange = (newKind: AdjustmentKind) => {
    setKind(newKind)
    if (newKind === 'WAIVER') {
      setAmountRupees('0.00')
    } else if (newKind === 'DISCOUNT') {
      if (amountRupees === '0.00') setAmountRupees('')
    }
  }

  // Calculate revised paise
  let newAmountPaise: number | null = null
  if (kind === 'WAIVER') {
    newAmountPaise = 0
  } else {
    newAmountPaise = rupeesToPaise(amountRupees)
  }

  const trimmedReason = reason.trim()
  const reasonValid = trimmedReason.length >= 3 && reason.length <= 500

  const missing: string[] = []
  if (kind === 'WAIVER') {
    // 0 is valid
  } else if (kind === 'DISCOUNT') {
    if (newAmountPaise == null || newAmountPaise < 0) {
      missing.push('valid reduced amount')
    } else if (newAmountPaise >= currentAmountPaise) {
      missing.push('amount lower than original fee')
    }
  } else if (kind === 'CORRECTION') {
    if (newAmountPaise == null || newAmountPaise < 0) {
      missing.push('valid revised amount')
    }
  }

  if (!reasonValid) {
    missing.push('reason (3–500 characters)')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setIsConflict(false)

    if (missing.length > 0 || newAmountPaise == null) return

    try {
      await feeCorrectionMutation.mutateAsync({
        appointmentId,
        payload: {
          kind,
          new_amount_paise: newAmountPaise,
          reason: trimmedReason,
        },
      })
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adjust consultation fee"
      variant="info"
      busy={feeCorrectionMutation.isPending}
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
            message="This consultation fee was modified by another user."
          />
        )}

        {errorMsg && (
          <InlineAlert tone="error">
            {errorMsg}
          </InlineAlert>
        )}

        {/* S6 copy: "Original ₹X → Revised ₹Y" */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fee Adjustment</p>
          <p className="text-base font-bold font-mono text-slate-900 mt-1">
            Original {formatPaise(currentAmountPaise)} → Revised {newAmountPaise != null ? formatPaise(newAmountPaise) : '—'}
          </p>
        </div>

        {/* Kind selector (segmented options) */}
        <div className="space-y-1.5">
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            Adjustment Type *
          </label>
          <div className="grid grid-cols-3 gap-2">
            {(['DISCOUNT', 'WAIVER', 'CORRECTION'] as const).map((k) => {
              const isSelected = kind === k
              const label = k === 'DISCOUNT' ? 'Discount' : k === 'WAIVER' ? 'Waive' : 'Correct'
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => handleKindChange(k)}
                  className={`min-h-11 rounded-lg border py-2 text-xs font-bold transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[#8E1C3D] bg-rose-50 text-[#8E1C3D]'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Amount input */}
        <div className="space-y-1">
          <label htmlFor="fee-adjust-amount" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
            {kind === 'WAIVER' ? 'New Amount (₹)' : kind === 'DISCOUNT' ? 'Discounted Amount (₹) *' : 'Corrected Amount (₹) *'}
          </label>
          <input
            id="fee-adjust-amount"
            type="text"
            inputMode="decimal"
            disabled={kind === 'WAIVER'}
            value={kind === 'WAIVER' ? '0.00' : amountRupees}
            onChange={(e) => setAmountRupees(e.target.value)}
            placeholder={kind === 'DISCOUNT' ? `Less than ${paiseToRupees(currentAmountPaise)}` : 'e.g. 500.00'}
            data-autofocus={kind !== 'WAIVER' ? true : undefined}
            className="w-full min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 font-mono disabled:bg-slate-100 disabled:text-slate-500 focus:border-[#8E1C3D] focus:outline-hidden focus:ring-2 focus:ring-[#8E1C3D]/15"
          />
        </div>

        {/* Reason field (3-500 characters with counter) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="fee-adjust-reason" className="block text-xs font-bold uppercase tracking-wider text-slate-700">
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
            id="fee-adjust-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason for fee adjustment (min 3 characters)"
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
              disabled={feeCorrectionMutation.isPending}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={feeCorrectionMutation.isPending || missing.length > 0}
              className="min-h-11 rounded-lg bg-[#8E1C3D] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer"
            >
              {feeCorrectionMutation.isPending ? 'Saving...' : 'Save fee adjustment'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
