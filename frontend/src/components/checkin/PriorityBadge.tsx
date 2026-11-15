import type { PriorityLevel } from '../../api/types'
import { IconAlertTriangle } from '../icons'

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  NORMAL: 'Normal',
  PRIORITY: 'Priority',
  EMERGENCY: 'Emergency',
}

/**
 * Red for Emergency, amber for Priority, nothing for Normal (OD-22-06). No blinking: the doctor
 * is alerted separately, so the badge only has to be easy to spot in a list.
 */
export function PriorityBadge({
  level,
  reason,
}: {
  level: PriorityLevel | null | undefined
  reason?: string | null
}) {
  if (!level || level === 'NORMAL') return null
  const emergency = level === 'EMERGENCY'
  return (
    <span
      title={reason ?? undefined}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
        emergency ? 'bg-red-600 text-white' : 'bg-amber-100 text-amber-900 ring-1 ring-amber-300'
      }`}
    >
      {emergency && <IconAlertTriangle className="h-3 w-3" />}
      {PRIORITY_LABEL[level]}
    </span>
  )
}
