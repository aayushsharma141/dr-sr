import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, apiFetch, setCsrfToken } from './client'
import type { AreaOverview, Me } from './types'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 1000 * 60, // 1 minute
    },
  },
})

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me> => {
      try {
        const me = await apiFetch<Me>('/auth/me')
        setCsrfToken(me.csrf_token)
        return me
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setCsrfToken(null)
        }
        throw err
      }
    },
    retry: false,
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (credentials: { username: string; password: string }): Promise<Me> => {
      const res = await apiFetch<Me>('/auth/login', {
        method: 'POST',
        body: credentials,
      })
      setCsrfToken(res.csrf_token)
      qc.setQueryData(['me'], res)
      return res
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<void> => {
      try {
        await apiFetch('/auth/logout', { method: 'POST' })
      } finally {
        setCsrfToken(null)
        qc.removeQueries({ queryKey: ['me'] })
        qc.clear()
      }
    },
  })
}

export interface SetupStatus {
  setup_required: boolean
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: async (): Promise<SetupStatus> => {
      try {
        return await apiFetch<SetupStatus>('/setup/status')
      } catch (err) {
        if (err instanceof ApiError && err.status === 410) {
          return { setup_required: false }
        }
        throw err
      }
    },
    retry: false,
  })
}

export function useOverview<T extends AreaOverview = AreaOverview>(area: string) {
  return useQuery({
    queryKey: ['overview', area],
    queryFn: async (): Promise<T> => {
      return await apiFetch<T>(`/${area}/overview`)
    },
    retry: false,
  })
}
