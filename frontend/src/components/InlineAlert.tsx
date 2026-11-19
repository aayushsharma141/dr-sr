import type { ReactNode } from 'react'

export type InlineAlertTone = 'error' | 'warning' | 'success' | 'info'

interface InlineAlertProps {
  tone: InlineAlertTone
  children: ReactNode
  onDismiss?: () => void
  action?: ReactNode
  id?: string
  className?: string
}

const TONE_CLASSES: Record<InlineAlertTone, string> = {
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-900',
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  info: 'bg-sky-50 border-sky-200 text-sky-900',
}

/**
 * Persistent, screen-reader-announced message. Errors use role="alert"
 * (assertive); success and info use role="status" (polite). It stays on
 * screen until dismissed or replaced by the caller, and never blocks input.
 */
export function InlineAlert({ tone, children, onDismiss, action, id, className = '' }: InlineAlertProps) {
  const role = tone === 'error' ? 'alert' : 'status'
  return (
    <div
      id={id}
      role={role}
      className={`flex items-start justify-between gap-3 p-4 border rounded-xl text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      <div>{children}</div>
      {action}
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
