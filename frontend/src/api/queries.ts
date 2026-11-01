import type {
  AddendumCreate,
  AddendumRead,
  Appointment,
  AppointmentCreate,
  AppointmentListResponse,
  AppointmentStatusUpdate,
  DoctorQueueResponse,
  EncounterCreate,
  EncounterRead,
  EncounterSummary,
  EncounterUpdate,
} from './types'
import type {
  DuplicateCheckResponse,
  PatientCreate,
  PatientOut,
  PatientUpdate,
} from './types'
import type {
  ClinicSettingsOut,
  ClinicSettingsUpdate,
  DoctorCreate,
  DoctorOut,
  DoctorUpdate,
  FeeCreate,
  FeeOut,
  FeeUpdate,
} from './types'
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


export function useClinicSettings() {
  return useQuery({
    queryKey: ['clinic-settings'],
    queryFn: () => apiFetch<ClinicSettingsOut>('/settings'),
  })
}

export function useUpdateClinicSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: ClinicSettingsUpdate) =>
      apiFetch<ClinicSettingsOut>('/settings', {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['clinic-settings'], data)
    },
  })
}

export function useDoctors(activeOnly: boolean = false) {
  return useQuery({
    queryKey: ['doctors', { activeOnly }],
    queryFn: () =>
      apiFetch<DoctorOut[]>(activeOnly ? '/doctors' : '/doctors?include_inactive=true'),
  })
}

export function useCreateDoctor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DoctorCreate) =>
      apiFetch<DoctorOut>('/doctors', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
    },
  })
}

export function useUpdateDoctor() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DoctorUpdate }) =>
      apiFetch<DoctorOut>(`/doctors/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
    },
  })
}

export function useFees(activeOnly: boolean = false) {
  return useQuery({
    queryKey: ['fees', { activeOnly }],
    queryFn: () =>
      apiFetch<FeeOut[]>(activeOnly ? '/fees' : '/fees?include_inactive=true'),
  })
}

export function useCreateFee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeeCreate) =>
      apiFetch<FeeOut>('/fees', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fees'] })
    },
  })
}

export function useUpdateFee() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: FeeUpdate }) =>
      apiFetch<FeeOut>(`/fees/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fees'] })
    },
  })
}

export function useRegisterPatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PatientCreate) =>
      apiFetch<PatientOut>('/patients', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}

export function useCheckDuplicate(name: string, mobile: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['check-duplicate', name, mobile],
    queryFn: () =>
      apiFetch<DuplicateCheckResponse>(
        `/patients/check-duplicate?name=${encodeURIComponent(name.trim())}&mobile=${encodeURIComponent(mobile.trim())}`,
      ),
    enabled: enabled && name.trim().length >= 2 && mobile.trim().length >= 10,
    staleTime: 5000,
  })
}

export function usePatients(q: string = '', limit: number = 20, offset: number = 0) {
  return useQuery({
    queryKey: ['patients', { q, limit, offset }],
    queryFn: () =>
      apiFetch<PatientOut[]>(
        `/patients?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
      ),
  })
}

export function usePatient(id: number | null) {
  return useQuery({
    queryKey: ['patient', id],
    queryFn: () => apiFetch<PatientOut>(`/patients/${id}`),
    enabled: id !== null && id > 0,
  })
}

export function useUpdatePatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PatientUpdate }) =>
      apiFetch<PatientOut>(`/patients/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['patient', data.id], data)
      qc.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}

export function useUploadPatientPhoto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      return apiFetch<{ photo_path: string }>(`/patients/${id}/photo`, {
        method: 'POST',
        body: formData,
      })
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['patient', variables.id] })
      qc.invalidateQueries({ queryKey: ['patients'] })
    },
  })
}


// ==============================================================================
// Appointments & Clinical Encounters (Phase 13)
// ==============================================================================

export function useAppointments(params?: {
  appointment_date?: string
  doctor_id?: number
  patient_id?: number
  status?: string
}) {
  const q = new URLSearchParams()
  if (params?.appointment_date) q.set('appointment_date', params.appointment_date)
  if (params?.doctor_id) q.set('doctor_id', String(params.doctor_id))
  if (params?.patient_id) q.set('patient_id', String(params.patient_id))
  if (params?.status) q.set('status', params.status)
  const qs = q.toString() ? `?${q.toString()}` : ''

  return useQuery({
    queryKey: ['appointments', params],
    queryFn: () => apiFetch<AppointmentListResponse>(`/appointments${qs}`),
  })
}

export function useAppointment(id: number) {
  return useQuery({
    queryKey: ['appointment', id],
    queryFn: () => apiFetch<Appointment>(`/appointments/${id}`),
    enabled: id > 0,
  })
}

export function useBookAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: AppointmentCreate) =>
      apiFetch<Appointment>('/appointments', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

export function useUpdateAppointmentStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AppointmentStatusUpdate }) =>
      apiFetch<Appointment>(`/appointments/${id}/status`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

export function useDoctorQueue() {
  return useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => apiFetch<DoctorQueueResponse>('/doctor/queue'),
    refetchInterval: 10000, // Poll every 10s for real-time queue refresh
  })
}

export function usePatientEncounters(patientId: number) {
  return useQuery({
    queryKey: ['patient-encounters', patientId],
    queryFn: () => apiFetch<EncounterSummary[]>(`/patients/${patientId}/encounters`),
    enabled: patientId > 0,
  })
}

export function useEncounter(id: number) {
  return useQuery({
    queryKey: ['encounter', id],
    queryFn: () => apiFetch<EncounterRead>(`/encounters/${id}`),
    enabled: id > 0,
  })
}

export function useCreateEncounter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: EncounterCreate) =>
      apiFetch<EncounterRead>('/encounters', {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['patient-encounters', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export function useUpdateEncounter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: EncounterUpdate }) =>
      apiFetch<EncounterRead>(`/encounters/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['encounter', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-encounters', data.patient_id] })
    },
  })
}

export function useFinaliseEncounter() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<EncounterRead>(`/encounters/${id}/finalise`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      qc.setQueryData(['encounter', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-encounters', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}

export function useAddAddendum() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AddendumCreate }) =>
      apiFetch<AddendumRead>(`/encounters/${id}/addenda`, {
        method: 'POST',
        body,
      }),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['encounter', variables.id] })
    },
  })
}
