import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'

export interface HealthStatus {
  status: string
  db: string
  setup_required: boolean
}

export function useHealth(refetchInterval: number = 15000) {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthStatus>('/health'),
    refetchInterval,
    retry: 1,
    refetchOnWindowFocus: true,
  })
}
