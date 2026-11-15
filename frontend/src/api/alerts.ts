import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { DoctorQueueItem, DoctorQueueResponse } from './types'

/** An emergency alert the doctor has not acknowledged yet (OD-22-09). */
export function isOpenEmergency(item: DoctorQueueItem): boolean {
  return (
    item.priority_level === 'EMERGENCY' &&
    !!item.emergency_alerted_at &&
    !item.alert_acknowledged_at
  )
}

/**
 * Open emergency alerts on the signed-in doctor's own active consultations, oldest first.
 * Polls every 5 seconds (design section 9). The server returns only this doctor's consultations.
 */
export function useDoctorAlerts(enabled: boolean) {
  return useQuery({
    queryKey: ['doctor-alerts'],
    queryFn: async () => {
      const queue = await apiFetch<DoctorQueueResponse>('/doctor/queue')
      return [...queue.in_consultation, ...queue.waiting]
        .filter(isOpenEmergency)
        .sort((a, b) =>
          (a.emergency_alerted_at ?? '').localeCompare(b.emergency_alerted_at ?? ''),
        )
    },
    enabled,
    refetchInterval: 5000,
  })
}
