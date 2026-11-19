import { useEffect, useState } from 'react'
import { istToday } from '../../format'

export type ReceptionStatusKey =
  | 'BOOKED'
  | 'TO_ARRIVE'
  | 'CHECKED_IN'
  | 'WAITING'
  | 'IN_CABIN'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'RESCHEDULED'
  | 'CANCELLED'

const POSITIVE_INT_RE = /^[1-9]\d*$/

/** Strictly parses a positive integer query/route param; rejects 0, negatives, floats, leading zeros, and garbage. */
export function parsePositiveIntParam(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  if (!POSITIVE_INT_RE.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/** Whole minutes elapsed since canonical wait anchor (`check_in_at ?? status_updated_at ?? created_at`). */
export function getWaitingElapsedMinutes(
  appt: {
    check_in_at?: string | null
    status_updated_at?: string | null
    created_at?: string | null
  },
  nowMs: number = Date.now(),
): number {
  const anchor = appt.check_in_at ?? appt.status_updated_at ?? appt.created_at
  if (!anchor) return 0
  const parsed = Date.parse(anchor)
  if (!Number.isFinite(parsed) || !Number.isFinite(nowMs)) return 0
  return Math.max(0, Math.floor((nowMs - parsed) / 60_000))
}

/** Returns authoritative server date when present, otherwise today's IST date refreshed every 60s across midnight. */
export function useIstToday(serverDate?: string | null): string {
  const [localIstToday, setLocalIstToday] = useState<string>(() => istToday())

  useEffect(() => {
    const id = setInterval(() => {
      setLocalIstToday(istToday())
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  return serverDate || localIstToday
}

/** Delays propagation of rapidly changing values (e.g. search inputs) by `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number = 200): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}

const STATUS_META: Record<ReceptionStatusKey, { label: string; classes: string }> = {
  BOOKED: { label: 'Booked', classes: 'bg-slate-100 text-slate-700 border-slate-200' },
  TO_ARRIVE: { label: 'To arrive', classes: 'bg-amber-50 text-amber-800 border-amber-200' },
  CHECKED_IN: { label: 'Checked In', classes: 'bg-teal-50 text-teal-800 border-teal-200' },
  WAITING: { label: 'Waiting', classes: 'bg-amber-50 text-amber-800 border-amber-200' },
  IN_CABIN: { label: 'In Cabin', classes: 'bg-blue-50 text-blue-800 border-blue-200' },
  COMPLETED: { label: 'Completed', classes: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  NO_SHOW: { label: 'No-show', classes: 'bg-orange-50 text-orange-800 border-orange-200' },
  RESCHEDULED: { label: 'Rescheduled', classes: 'bg-purple-50 text-purple-800 border-purple-200' },
  CANCELLED: { label: 'Cancelled', classes: 'bg-red-50 text-red-800 border-red-200' },
}

export interface AppointmentStatusBadgeProps {
  status: ReceptionStatusKey
  label?: string
  className?: string
}

export function AppointmentStatusBadge({
  status,
  label,
  className,
}: AppointmentStatusBadgeProps) {
  const meta = STATUS_META[status]
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${meta.classes}${className ? ` ${className}` : ''}`}
    >
      {label ?? meta.label}
    </span>
  )
}
