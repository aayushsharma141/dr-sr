import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, apiFetch, setCsrfToken } from './client'
import type {
  ActionRequest,
  AreaOverview,
  Me,
  SetupAdminRequest,
  UserCreate,
  UserCreatedOut,
  UserOut,
  UserUpdate,
} from './types'

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

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: async (): Promise<UserOut[]> => {
      return await apiFetch<UserOut[]>('/users')
    },
  })
}

export function useUser(id: number | null) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: async (): Promise<UserOut> => {
      if (!id) throw new Error('User ID required')
      return await apiFetch<UserOut>(`/users/${id}`)
    },
    enabled: id !== null,
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: UserCreate): Promise<UserCreatedOut> => {
      return await apiFetch<UserCreatedOut>('/users', {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['overview', 'admin'] })
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: UserUpdate
    }): Promise<UserOut> => {
      return await apiFetch<UserOut>(`/users/${id}`, {
        method: 'PATCH',
        body: payload,
      })
    },
    onSuccess: (updatedUser) => {
      qc.setQueryData(['users', updatedUser.id], updatedUser)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: ActionRequest
    }): Promise<UserOut> => {
      return await apiFetch<UserOut>(`/users/${id}/deactivate`, {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (updatedUser) => {
      qc.setQueryData(['users', updatedUser.id], updatedUser)
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['overview', 'admin'] })
    },
  })
}

export function useReactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: ActionRequest
    }): Promise<UserOut> => {
      return await apiFetch<UserOut>(`/users/${id}/reactivate`, {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (updatedUser) => {
      qc.setQueryData(['users', updatedUser.id], updatedUser)
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['overview', 'admin'] })
    },
  })
}

export function useResetUserPassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: ActionRequest
    }): Promise<{ temporary_password: string }> => {
      return await apiFetch<{ temporary_password: string }>(
        `/users/${id}/reset-password`,
        {
          method: 'POST',
          body: payload,
        },
      )
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['users', vars.id] })
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useUnlockUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: ActionRequest
    }): Promise<UserOut> => {
      return await apiFetch<UserOut>(`/users/${id}/unlock`, {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (updatedUser) => {
      qc.setQueryData(['users', updatedUser.id], updatedUser)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
  })
}

export function useChangePassword() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (credentials: {
      current_password: string
      new_password: string
    }): Promise<{ csrf_token: string }> => {
      const res = await apiFetch<{ csrf_token: string }>(
        '/auth/change-password',
        {
          method: 'POST',
          body: credentials,
        },
      )
      setCsrfToken(res.csrf_token)
      return res
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useSetupAdmin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: SetupAdminRequest): Promise<UserOut> => {
      return await apiFetch<UserOut>('/setup/admin', {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['setup-status'] })
    },
  })
}

