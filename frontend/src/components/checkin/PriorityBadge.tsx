import type { PriorityLevel } from '../../api/types'
import { IconAlertTriangle } from '../icons'

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  NORMAL: 'Normal',
  PRIORITY: 'High',
  EMERGENCY: 'Emergency',
}

/**
 * Red for Emergency, amber for High, neutral for Normal.
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
        className="inline-flex items-center rounded-full border border-zinc-700 bg-zinc-800/80 px-2.5 py-0.5 text-xs font-semibold text-zinc-200"
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
          ? 'border border-red-700/80 bg-red-950/60 text-red-300'
          : 'border border-amber-600/80 bg-amber-950/50 text-amber-300'
      }`}
    >
      {emergency && <IconAlertTriangle className="h-3 w-3" />}
      {PRIORITY_LABEL[level]}
    </span>
  )
}
