import type { PriorityLevel } from '../../api/types'
import { IconAlertTriangle } from '../icons'

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  NORMAL: 'Normal',
  PRIORITY: 'High',
  EMERGENCY: 'Emergency',
}

/**
 * Clinical triage semantics: Emergency → red, High/Priority → amber, Normal → slate.
 */
export function PriorityBadge({
  level,
  reason,
  showNormal = false,
}: {
  level: PriorityLevel | null | undefined
  reason?: string | null
  showNormal?: boolean
}) {
  if (!level) return null
  if (level === 'NORMAL' && !showNormal) return null

  if (level === 'NORMAL') {
    return (
      <span
        title={reason ?? 'Regular queue'}
        className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700"
      >
        Normal
      </span>
    )
  }

  const emergency = level === 'EMERGENCY'
  return (
    <span
      title={reason ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        emergency
          ? 'border border-red-200 bg-red-50 text-red-800'
          : 'border border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      {emergency && <IconAlertTriangle className="h-3 w-3" />}
      {PRIORITY_LABEL[level]}
    </span>
  )
}
