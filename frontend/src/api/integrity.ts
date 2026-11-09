import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './client'
import type { IntegrityHistoryOut, IntegrityReportOut } from './types'

/** The latest stored integrity run, or null if none has run. Reading runs nothing. */
export function useLatestIntegrityRun(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['operations', 'integrity'],
    queryFn: () => apiFetch<IntegrityReportOut | null>('/api/operations/integrity'),
    enabled: options?.enabled ?? true,
  })
}

export function useIntegrityHistory(limit = 10) {
  return useQuery({
    queryKey: ['operations', 'integrity', 'history', limit],
    queryFn: () => apiFetch<IntegrityHistoryOut>(`/api/operations/integrity/history?limit=${limit}`),
  })
}

/** Runs every check, stores the result and records one audit entry. */
export function useRunIntegrityCheck() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => apiFetch<IntegrityReportOut>('/api/operations/integrity/run', { method: 'POST' }),
    onSuccess: (report) => {
      qc.setQueryData(['operations', 'integrity'], report)
      qc.invalidateQueries({ queryKey: ['operations', 'integrity', 'history'] })
      // The run is audited, so the admin overview and Audit Trail change too.
      qc.invalidateQueries({ queryKey: ['overview', 'admin'] })
      qc.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}
