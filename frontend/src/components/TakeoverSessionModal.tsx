import React from 'react'
import { Modal } from './Modal'

export interface ActiveSessionInfo {
  ip?: string | null
  user_agent?: string | null
  last_seen_at?: string | null
}

export interface TakeoverSessionModalProps {
  open: boolean
  activeSession?: ActiveSessionInfo | null
  isSubmitting?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function formatTimestamp(isoString?: string | null): string {
  if (!isoString) return 'Unknown'
  try {
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return isoString
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return isoString
  }
}

export function TakeoverSessionModal({
  open,
  activeSession,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: TakeoverSessionModalProps) {
  const ipText = activeSession?.ip || 'Unknown IP'
  const browserText = activeSession?.user_agent || 'Unknown Browser'
  const timeText = formatTimestamp(activeSession?.last_seen_at)

  const workstationLabel = `${ipText} / ${browserText}`

  return (
    <Modal
      open={open}
      onClose={onCancel}
      variant="destructive"
      dismiss={isSubmitting ? 'none' : 'closerequest'}
      busy={isSubmitting}
      className="max-w-lg"
      title={
        <div className="flex items-center gap-2 text-rose-900">
          <svg
            className="w-5 h-5 text-[#8E1C3D] shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>Active Session Detected Elsewhere</span>
        </div>
      }
    >
      <div className="space-y-4 pt-2">
        <p className="text-sm text-neutral-700 leading-relaxed">
          This account is currently active on another computer. Only one active workstation login is allowed per account.
        </p>

        {/* Workstation metadata card */}
        <div
          data-testid="workstation-details-card"
          className="rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 text-xs space-y-2"
        >
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold text-neutral-600">Workstation IP:</span>
            <span className="font-mono font-medium text-neutral-900 text-right">
              {ipText}
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold text-neutral-600">Browser / Device:</span>
            <span className="text-neutral-900 text-right break-all">
              {browserText}
            </span>
          </div>
          <div className="flex justify-between items-start gap-2">
            <span className="font-semibold text-neutral-600">Last Activity:</span>
            <span className="text-neutral-900 text-right">
              {timeText}
            </span>
          </div>
        </div>

        {/* Explanatory copy contract (D-19-26, DWS-10) */}
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-xs text-amber-950 leading-relaxed">
          <p>
            Signing in will immediately terminate the active session on workstation{' '}
            <strong className="font-semibold">{workstationLabel}</strong>. Click 'Take Over Session &amp; Sign In' to confirm or 'Cancel Sign-In Attempt' to stay logged out.
          </p>
        </div>

        {/* Actions */}
        <div className="pt-2 flex flex-col-reverse sm:flex-row justify-end gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="border border-slate-300 text-slate-700 hover:bg-slate-50 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancel Sign-In Attempt
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSubmitting}
            className="bg-[#8E1C3D] hover:bg-[#731631] text-white font-semibold px-4 py-2 rounded text-sm transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {isSubmitting ? (
              <>
                <span
                  className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin"
                  aria-hidden="true"
                />
                <span>Terminating remote session and signing in...</span>
              </>
            ) : (
              'Take Over Session & Sign In'
            )}
          </button>
        </div>
      </div>
    </Modal>
  )
}
