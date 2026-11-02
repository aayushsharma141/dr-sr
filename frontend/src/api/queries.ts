import type {
  AuditLogListResponse,
  BackupArchiveInfo,
  BackupArchiveListResponse,
  BackupCreateRequest,
  IntegrityReportOut,
  RestoreRequest,
  RestoreResultOut,
} from './types'
import type {
  PaymentCreate,
  PaymentOut,
  PaymentReversalCreate,
  PendingDueOut,
  TimelineItemOut,
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
  PrescriptionCreate,
  PrescriptionOut,
  PrescriptionSummary,
  TreatmentPlanCreate,
  TreatmentPlanOut,
  TreatmentPlanUpdate,
  TreatmentSessionAddendumCreate,
  TreatmentSessionAddendumOut,
  TreatmentSessionCreate,
  TreatmentSessionOut,
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

export function usePatients(
  q: string = '',
  limit: number = 20,
  offset: number = 0,
  options: { activeOnly?: boolean; enabled?: boolean } = {},
) {
  const params = new URLSearchParams({
    q,
    limit: String(limit),
    offset: String(offset),
  })
  if (options.activeOnly) params.set('active_only', 'true')

  return useQuery({
    queryKey: ['patients', { q, limit, offset, activeOnly: options.activeOnly ?? false }],
    queryFn: () => apiFetch<PatientOut[]>(`/patients?${params.toString()}`),
    enabled: options.enabled ?? true,
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
  date_from?: string
  date_to?: string
  doctor_id?: number
  patient_id?: number
  status?: string
  booking_mode?: 'WALK_IN' | 'SCHEDULED'
  has_token?: boolean
}) {
  const q = new URLSearchParams()
  if (params?.appointment_date) q.set('appointment_date', params.appointment_date)
  if (params?.date_from) q.set('date_from', params.date_from)
  if (params?.date_to) q.set('date_to', params.date_to)
  if (params?.doctor_id) q.set('doctor_id', String(params.doctor_id))
  if (params?.patient_id) q.set('patient_id', String(params.patient_id))
  if (params?.status) q.set('status', params.status)
  if (params?.booking_mode) q.set('booking_mode', params.booking_mode)
  if (params?.has_token !== undefined) q.set('has_token', String(params.has_token))
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

// ==========================================
// Phase 14: Prescriptions & Treatment Hooks
// ==========================================

export function usePatientPrescriptions(patientId: number) {
  return useQuery({
    queryKey: ['patient-prescriptions', patientId],
    queryFn: () => apiFetch<PrescriptionSummary[]>(`/patients/${patientId}/prescriptions`),
    enabled: patientId > 0,
  })
}

export function usePrescriptionFollowUps(
  params?: { date_from?: string; date_to?: string },
  enabled = true,
) {
  const searchParams = new URLSearchParams()
  if (params?.date_from) searchParams.set('date_from', params.date_from)
  if (params?.date_to) searchParams.set('date_to', params.date_to)
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['prescription-follow-ups', params],
    queryFn: () =>
      apiFetch<PrescriptionSummary[]>(
        `/prescriptions/follow-ups${query ? `?${query}` : ''}`,
      ),
    enabled,
  })
}

export function usePrescription(id: number) {
  return useQuery({
    queryKey: ['prescription', id],
    queryFn: () => apiFetch<PrescriptionOut>(`/prescriptions/${id}`),
    enabled: id > 0,
  })
}

export function useCreatePrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PrescriptionCreate) =>
      apiFetch<PrescriptionOut>('/prescriptions', {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

export function usePatientTreatmentPlans(patientId: number) {
  return useQuery({
    queryKey: ['patient-treatment-plans', patientId],
    queryFn: () => apiFetch<TreatmentPlanOut[]>(`/patients/${patientId}/treatment-plans`),
    enabled: patientId > 0,
  })
}

export function useTreatmentPlan(id: number) {
  return useQuery({
    queryKey: ['treatment-plan', id],
    queryFn: () => apiFetch<TreatmentPlanOut>(`/treatment-plans/${id}`),
    enabled: id > 0,
  })
}

export function useCreateTreatmentPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: TreatmentPlanCreate) =>
      apiFetch<TreatmentPlanOut>('/treatment-plans', {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['patient-treatment-plans', data.patient_id] })
    },
  })
}

export function useUpdateTreatmentPlan() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TreatmentPlanUpdate }) =>
      apiFetch<TreatmentPlanOut>(`/treatment-plans/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['treatment-plan', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-treatment-plans', data.patient_id] })
    },
  })
}

export function useTreatmentSessions(planId: number) {
  return useQuery({
    queryKey: ['treatment-sessions', planId],
    queryFn: () => apiFetch<TreatmentSessionOut[]>(`/treatment-plans/${planId}/sessions`),
    enabled: planId > 0,
  })
}

export function useLogTreatmentSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ planId, body }: { planId: number; body: TreatmentSessionCreate }) =>
      apiFetch<TreatmentSessionOut>(`/treatment-plans/${planId}/sessions`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['treatment-sessions', data.treatment_plan_id] })
      qc.invalidateQueries({ queryKey: ['treatment-plan', data.treatment_plan_id] })
      qc.invalidateQueries({ queryKey: ['patient-treatment-plans', data.patient_id] })
    },
  })
}

export function useAddSessionAddendum() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TreatmentSessionAddendumCreate }) =>
      apiFetch<TreatmentSessionAddendumOut>(`/treatment-sessions/${id}/addenda`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['treatment-sessions'] })
    },
  })
}


// ---------------------------------------------------------------------------
// Phase 15: Payments, Receipts, Dues & Patient Timeline
// ---------------------------------------------------------------------------

export function usePatientPayments(patientId: number | null | undefined) {
  return useQuery({
    queryKey: ['payments', 'patient', patientId],
    queryFn: () =>
      apiFetch<PaymentOut[]>('/api/patients/' + patientId + '/payments'),
    enabled: typeof patientId === 'number' && patientId > 0,
  })
}

export function usePayment(id: number | null | undefined) {
  return useQuery({
    queryKey: ['payments', id],
    queryFn: () => apiFetch<PaymentOut>('/api/payments/' + id),
    enabled: typeof id === 'number' && id > 0,
  })
}

export function usePendingDues() {
  return useQuery({
    queryKey: ['billing', 'pending-dues'],
    queryFn: () => apiFetch<PendingDueOut[]>('/api/billing/pending-dues'),
  })
}

export function useRecordPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: PaymentCreate) =>
      apiFetch<PaymentOut>('/api/payments', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['billing', 'pending-dues'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['timeline', variables.patient_id] })
    },
  })
}

export function useReversePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PaymentReversalCreate }) =>
      apiFetch<PaymentOut>('/api/payments/' + id + '/reverse', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['billing', 'pending-dues'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['timeline'] })
    },
  })
}

export function usePatientTimeline(patientId: number | null | undefined) {
  return useQuery({
    queryKey: ['timeline', patientId],
    queryFn: () =>
      apiFetch<TimelineItemOut[]>('/api/patients/' + patientId + '/timeline'),
    enabled: typeof patientId === 'number' && patientId > 0,
  })
}

// Phase 16: Audit Viewer, Backup/Restore & Integrity Queries & Mutations
export function useAuditLogs(params?: {
  actor_username?: string
  action?: string
  entity_type?: string
  entity_id?: string
  outcome?: string
  date_from?: string
  date_to?: string
  page?: number
  page_size?: number
}) {
  const searchParams = new URLSearchParams()
  if (params?.actor_username) searchParams.set('actor_username', params.actor_username)
  if (params?.action) searchParams.set('action', params.action)
  if (params?.entity_type) searchParams.set('entity_type', params.entity_type)
  if (params?.entity_id) searchParams.set('entity_id', params.entity_id)
  if (params?.outcome) searchParams.set('outcome', params.outcome)
  if (params?.date_from) searchParams.set('date_from', params.date_from)
  if (params?.date_to) searchParams.set('date_to', params.date_to)
  if (params?.page) searchParams.set('page', params.page.toString())
  if (params?.page_size) searchParams.set('page_size', params.page_size.toString())

  const queryString = searchParams.toString()
  const endpoint = queryString ? `/api/audit-logs?${queryString}` : '/api/audit-logs'

  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => apiFetch<AuditLogListResponse>(endpoint),
  })
}

export function useBackups() {
  return useQuery({
    queryKey: ['operations', 'backups'],
    queryFn: () => apiFetch<BackupArchiveListResponse>('/api/operations/backups'),
  })
}

export function useCreateBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BackupCreateRequest) =>
      apiFetch<BackupArchiveInfo>('/api/operations/backups', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', 'backups'] })
    },
  })
}

export function useRestoreBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: RestoreRequest) =>
      apiFetch<RestoreResultOut>('/api/operations/restore', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries()
    },
  })
}

export function useIntegrityCheck() {
  return useQuery({
    queryKey: ['operations', 'integrity'],
    queryFn: () => apiFetch<IntegrityReportOut>('/api/operations/integrity'),
  })
}
