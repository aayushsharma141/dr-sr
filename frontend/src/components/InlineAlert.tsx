import type { ReactNode } from 'react'

export type InlineAlertTone = 'error' | 'success' | 'info'

interface InlineAlertProps {
  tone: InlineAlertTone
  children: ReactNode
  onDismiss?: () => void
  id?: string
  className?: string
}

const TONE_CLASSES: Record<InlineAlertTone, string> = {
  error: 'bg-red-50 border-red-300 text-red-900',
  success: 'bg-emerald-50 border-emerald-300 text-emerald-900',
  info: 'bg-blue-50 border-blue-300 text-blue-900',
}

/**
 * Persistent, screen-reader-announced message. Errors use role="alert"
 * (assertive); success and info use role="status" (polite). It stays on
 * screen until dismissed or replaced by the caller, and never blocks input.
 */
export function InlineAlert({ tone, children, onDismiss, id, className = '' }: InlineAlertProps) {
  const role = tone === 'error' ? 'alert' : 'status'
  return (
    <div
      id={id}
      role={role}
      className={`flex items-start justify-between gap-3 p-4 border rounded-lg text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <div>{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="shrink-0 font-bold cursor-pointer hover:underline"
        >
          ✕
        </button>
      )}
    </div>
  )
}
