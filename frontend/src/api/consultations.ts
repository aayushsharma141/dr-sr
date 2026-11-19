import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { DoctorQueueResponse, UnfinishedEncounter } from './types'

/**
 * The signed-in doctor's waiting queue count for the sidebar's "My Queue" badge.
 * Shares the `['doctor-queue']` cache. 0 while loading, on error, or when disabled.
 */
export function useMyWaitingQueueCount(enabled: boolean): number {
  const { data } = useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => apiFetch<DoctorQueueResponse>('/doctor/queue'),
    enabled,
    refetchInterval: 10000,
  })
  return data?.waiting?.length ?? 0
}

/**
 * The signed-in doctor's consultation drafts, newest first, for the sidebar's
 * "Continue Consultation" link. It shares the `['unfinished-encounters']` cache with the
 * Unfinished Consultations card on My Queue. Empty while loading, on error, or when disabled
 * (the API answers 403 for anyone but a doctor).
 */
export function useMyUnfinishedConsultations(enabled: boolean): UnfinishedEncounter[] {
  const { data } = useQuery({
    queryKey: ['unfinished-encounters'],
    queryFn: () => apiFetch<UnfinishedEncounter[]>('/encounters/unfinished'),
    enabled,
  })
  if (!Array.isArray(data)) return []
  return [...data].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
}
