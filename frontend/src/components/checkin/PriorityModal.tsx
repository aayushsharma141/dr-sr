import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useUpdateOpdArrivalPriority, useUpdatePriority } from '../../api/queries'
import type { Appointment, OpdArrival, PriorityLevel } from '../../api/types'
import { formatToken } from '../../format'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'

export interface PriorityModalProps {
  open: boolean
  appointment: Appointment
  pendingArrival?: OpdArrival
  cabinCode?: string | null
  onClose: () => void
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/** Shared modal for changing priority on an appointment or pending OPD arrival. */
export function PriorityModal({
  open,
  appointment,
  pendingArrival,
  cabinCode,
  onClose,
}: PriorityModalProps) {
  const update = useUpdatePriority()
  const updateArrival = useUpdateOpdArrivalPriority()

  const initialLevel: PriorityLevel =
    pendingArrival?.priority_level ?? appointment.priority_level ?? 'NORMAL'
  const initialReason = pendingArrival?.priority_reason ?? appointment.priority_reason ?? ''

  const inFlightRef = useRef(false)
  const [level, setLevel] = useState<PriorityLevel>(initialLevel)
  const [reason, setReason] = useState(initialReason)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLevel(initialLevel)
    setReason(initialReason)
    setError(null)
  }, [open, appointment.id, pendingArrival?.id, initialLevel, initialReason])

  const patientName = pendingArrival?.full_name ?? appointment.patient_name
  const tokenDisplay =
    appointment.token_number != null ? formatToken(appointment.token_number, cabinCode) : '--'
  const isPending = update.isPending || updateArrival.isPending
  const reasonTooShort = reason.trim().length < 3
  const showShortReasonAlert = !error && reason.length > 0 && reasonTooShort
  const reasonHint =
    level === 'NORMAL'
      ? 'Enter a reason of at least 3 characters to save priority.'
      : 'Enter a reason of at least 3 characters to set Priority or Emergency.'

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current || isPending) return
    setError(null)
    if (reason.trim().length < 3) {
      setError('Enter a reason of at least 3 characters when changing priority.')
      return
    }
    inFlightRef.current = true
    try {
      if (pendingArrival) {
        await updateArrival.mutateAsync({
          id: pendingArrival.id,
          body: {
            priority_level: level,
            reason: reason.trim(),
            version_id: pendingArrival.version_id,
          },
        })
      } else {
        await update.mutateAsync({
          id: appointment.id,
          body: {
            priority_level: level,
            priority_reason: reason.trim(),
            version_id: appointment.version_id,
          },
        })
      }
      toast.success(`Priority updated to ${level} for ${patientName}.`)
      onClose()
    } catch (err) {
      setError(errorText(err, 'Could not change the priority.'))
    } finally {
      inFlightRef.current = false
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      variant="info"
      title="Change priority"
      description={`${patientName} (${tokenDisplay})`}
      busy={isPending}
      className="max-w-sm"
    >
      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label
            htmlFor="priority-level-select"
            className="mb-1 block text-xs font-semibold text-slate-700"
          >
            Priority *
          </label>
          <select
            id="priority-level-select"
            data-autofocus
            disabled={isPending}
            value={level}
            onChange={(e) => {
              setLevel(e.target.value as PriorityLevel)
              setError(null)
            }}
            className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
          >
            <option value="NORMAL">Normal (Regular queue)</option>
            <option value="PRIORITY">High (Needs preferential attention)</option>
            <option value="EMERGENCY">Emergency (Immediate clinical attention)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="priority-reason-input"
            className="mb-1 block text-xs font-semibold text-slate-700"
          >
            Reason *
          </label>
          <textarea
            id="priority-reason-input"
            disabled={isPending}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
            required
            rows={2}
            aria-describedby={reasonTooShort && !error ? 'priority-reason-hint' : undefined}
            placeholder="Enter reason for updating priority..."
            className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-60"
          />
          {reasonTooShort && !error && (
            <p
              id="priority-reason-hint"
              role={showShortReasonAlert ? 'alert' : undefined}
              className={
                showShortReasonAlert
                  ? 'mt-1 text-xs font-medium text-amber-800'
                  : 'mt-1 text-xs text-slate-600'
              }
            >
              {reasonHint}
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-xs font-semibold text-red-700">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isPending}
            onClick={onClose}
            className="min-h-9 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isPending || reasonTooShort}
            className="min-h-9 rounded-lg bg-[#8E1C3D] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#5D0B26] disabled:opacity-50 transition-colors shadow-2xs"
          >
            {isPending ? 'Saving…' : 'Save priority'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
