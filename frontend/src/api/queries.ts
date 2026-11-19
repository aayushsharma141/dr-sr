import type {
  ActiveSessionOut,
  AuditLogListResponse,
  BackupArchiveInfo,
  BackupArchiveListResponse,
  BackupCreateRequest,
  BackupVerifyResponse,
  HospitalAssetOut,
  LoginHistoryEntry,
  PasswordPolicyOut,
  PrintTemplateOut,
  PrintTemplateUpdatePayload,
  RestoreRequest,
  RestoreResultOut,
  RevokeSessionOut,
  RevokeSessionRequest,
  RevokeUserSessionsOut,
  RolePermissionsOut,
  SecurityPolicyOut,
  SystemStatusOut,
} from './types'
import type {
  PaymentCreate,
  PaymentOut,
  PaymentReversalCreate,
  PendingDueOut,
  PatientLedgerResponse,
  RefundCreateRequest,
  RefundOut,
  TimelineItemOut,
  AddendumCreate,
  AddendumRead,
  Appointment,
  AppointmentCreate,
  OpdArrival,
  OpdArrivalCreate,
  OpdArrivalList,
  OpdArrivalRegister,
  OpdArrivalPriorityUpdate,
  AppointmentListResponse,
  AppointmentStatusUpdate,
  CheckInRequest,
  DoctorQueueResponse,
  WalkInCreate,
  NewPatientCheckIn,
  PriorityUpdate,
  ReassignRequest,
  AcknowledgeAlertRequest,
  RescheduleRequest,
  EncounterCreate,
  EncounterDiagnosisCreate,
  EncounterDiagnosisOut,
  EncounterDiagnosisUpdate,
  EncounterRead,
  EncounterSummary,
  EncounterUpdate,
  InvestigationOrderCreate,
  InvestigationOrderOut,
  InvestigationResultCreate,
  InvestigationResultOut,
  InvestigationStatusUpdate,
  UnfinishedEncounter,
  PrescriptionAmendRequest,
  PrescriptionCreate,
  PrescriptionOut,
  PrescriptionSummary,
  PrescriptionUpdate,
  VitalObservationInput,
  VitalObservationResponse,
  ClinicalTemplateRead,
  TemplateResponseInput,
  TemplateResponseRead,
  FollowUpBookRequest,
  FollowUpCloseRequest,
  FollowUpRecommendationCreate,
  DoctorFollowUpResponse,
  ReceptionFollowUpResponse,
  TreatmentPlanCreate,
  TreatmentPlanOut,
  TreatmentPlanUpdate,
  TreatmentSessionAddendumCreate,
  TreatmentSessionAddendumOut,
  TreatmentSessionCreate,
  TreatmentSessionOut,
  QuickPhraseCreate,
  QuickPhraseListResponse,
  QuickPhraseOut,
  QuickPhraseSection,
  QuickPhraseUpdate,
} from './types'
import type {
  AdminPatientDemographicCorrection,
  DuplicateCheckResponse,
  PatientAllergyCreate,
  PatientAllergyOut,
  PatientAllergyUpdate,
  PatientConditionCreate,
  PatientConditionOut,
  PatientConditionUpdate,
  PatientCreate,
  PatientDirectoryFilters,
  PatientDocumentOut,
  PatientDocumentUploadInput,
  PatientOut,
  PatientSummaryOut,
  PatientUpdate,
  PatientVisitHistoryResponse,
  VisitWorkspaceOut,
} from './types'
import type {
  ClinicSettingsOut,
  ClinicSettingsUpdate,
  DoctorCreate,
  DoctorOut,
  DepartmentOut,
  DepartmentCreate,
  DepartmentUpdate,
  DepartmentDoctorOut,
  DoctorDepartmentAssignment,
  DoctorDashboardSummary,
  DoctorMeSettingsUpdate,
  DoctorUpdate,
  FeeCreate,
  FeeOut,
  FeeUpdate,
} from './types'
import {
  QueryClient,
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ApiError, apiFetch, setCsrfToken } from './client'
import type {
  BackupRunOut,
  BackupSettingsOut,
  BackupSettingsUpdate,
  BillingConfigurationOut,
  SecurityPolicyUpdate,
} from './types'
import type {
  ActionRequest,
  BulkDeleteUsersOut,
  BulkDeleteUsersRequest,
  DeleteUserOut,
  DeleteUserRequest,
  AreaOverview,
  ManagementOverview,
  Me,
  SetupAdminRequest,
  UserCreate,
  UserCreatedOut,
  UserOut,
  UserUpdate,
} from './types'
import type {
  VisitCloseRequest,
  VisitDetail,
  VisitDueOut,
  VisitListResponse,
  VisitStatus,
} from './types'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 1000 * 60, // 1 minute
    },
  },
})

/**
 * Every audited admin mutation changes the admin overview (recent admin actions, counters,
 * alerts) and the audit trail, so both are refreshed after it succeeds.
 */
function invalidateAdminSummaries(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['overview', 'admin'] })
  qc.invalidateQueries({ queryKey: ['audit-logs'] })
}

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
    mutationFn: async (credentials: { username: string; password: string; takeover?: boolean }): Promise<Me> => {
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

export function useOverview<T extends AreaOverview = AreaOverview>(
  area: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['overview', area],
    queryFn: async ({ signal }): Promise<T> => {
      return await apiFetch<T>(`/${area}/overview`, { signal })
    },
    enabled: options?.enabled ?? true,
    retry: false,
    refetchInterval: options?.refetchInterval ?? false,
  })
}

export function useManagementOverview() {
  return useQuery({
    queryKey: ['admin', 'management-overview'],
    queryFn: async (): Promise<ManagementOverview> => {
      return await apiFetch<ManagementOverview>('/admin/management-overview')
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
      invalidateAdminSummaries(qc)
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
      invalidateAdminSummaries(qc)
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
      // A deactivated owner's sessions stop counting as active.
      qc.invalidateQueries({ queryKey: ['sessions'] })
      invalidateAdminSummaries(qc)
    },
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      payload,
    }: {
      id: number
      payload: DeleteUserRequest
    }): Promise<DeleteUserOut> => {
      return await apiFetch<DeleteUserOut>(`/users/${id}/delete`, {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (deleted) => {
      qc.removeQueries({ queryKey: ['users', deleted.id] })
      qc.invalidateQueries({ queryKey: ['users'] })
      invalidateAdminSummaries(qc)
    },
  })
}

export function useBulkDeleteUsers() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: BulkDeleteUsersRequest): Promise<BulkDeleteUsersOut> => {
      return await apiFetch<BulkDeleteUsersOut>('/users/bulk-delete', {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (out) => {
      for (const entry of out.results) {
        if (entry.deleted) qc.removeQueries({ queryKey: ['users', entry.id] })
      }
      qc.invalidateQueries({ queryKey: ['users'] })
      invalidateAdminSummaries(qc)
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
      qc.invalidateQueries({ queryKey: ['sessions'] })
      invalidateAdminSummaries(qc)
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
    }): Promise<UserCreatedOut> => {
      return await apiFetch<UserCreatedOut>(`/users/${id}/reset-password`, {
        method: 'POST',
        body: payload,
      })
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['users', vars.id] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['sessions'] })
      invalidateAdminSummaries(qc)
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
      invalidateAdminSummaries(qc)
    },
  })
}

/** GET /users/{id}/login-history: latest 50 security events for one user (user:read + audit:read). */
export function useLoginHistory(userId: number | null) {
  return useQuery({
    queryKey: ['users', userId, 'login-history'],
    queryFn: () => apiFetch<LoginHistoryEntry[]>(`/users/${userId}/login-history`),
    enabled: userId !== null && userId > 0,
  })
}

/** POST /users/{id}/revoke-sessions: ends every active session of a user (caller's current one is kept). */
export function useRevokeUserSessions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RevokeSessionRequest }) =>
      apiFetch<RevokeUserSessionsOut>(`/users/${id}/revoke-sessions`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['users', vars.id, 'login-history'] })
      invalidateAdminSummaries(qc)
    },
  })
}

// ---------------------------------------------------------------------------
// Admin modules 02 / 09: role catalogue, sessions, security policy
// ---------------------------------------------------------------------------

/** GET /roles/permissions: read-only catalogue derived from ROLE_PERMISSIONS. */
export function useRolePermissions() {
  return useQuery({
    queryKey: ['roles', 'permissions'],
    queryFn: () => apiFetch<RolePermissionsOut>('/roles/permissions'),
    staleTime: 1000 * 60 * 10,
  })
}

/** GET /sessions[?user_id]: active sessions, most recently active first. */
export function useActiveSessions(userId?: number | null, options?: { enabled?: boolean }) {
  const qs = userId ? `?user_id=${userId}` : ''
  return useQuery({
    queryKey: ['sessions', { userId: userId ?? null }],
    queryFn: () => apiFetch<ActiveSessionOut[]>(`/sessions${qs}`),
    enabled: options?.enabled ?? true,
  })
}

/** POST /sessions/{id}/revoke. 404 session_not_found, 409 cannot_revoke_current_session. */
export function useRevokeSession() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: RevokeSessionRequest }) =>
      apiFetch<RevokeSessionOut>(`/sessions/${id}/revoke`, {
        method: 'POST',
        body: payload,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['sessions'] })
      qc.invalidateQueries({ queryKey: ['users', data.user_id, 'login-history'] })
      invalidateAdminSummaries(qc)
    },
  })
}

/** GET /security/policy: effective, environment-sourced, read-only security policy. */
export function useSecurityPolicy() {
  return useQuery({
    queryKey: ['security', 'policy'],
    queryFn: () => apiFetch<SecurityPolicyOut>('/security/policy'),
  })
}

/** PATCH /security/policy: stores tighter values; takes effect on the next request. */
export function useUpdateSecurityPolicy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: SecurityPolicyUpdate) =>
      apiFetch<SecurityPolicyOut>('/security/policy', { method: 'PATCH', body: payload }),
    onSuccess: (data) => {
      queryClient.setQueryData(['security', 'policy'], data)
      queryClient.invalidateQueries({ queryKey: ['security', 'password-policy'] })
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}

/** GET /security/password-policy: available to every authenticated user, including forced change. */
export function usePasswordPolicy() {
  return useQuery({
    queryKey: ['security', 'password-policy'],
    queryFn: () => apiFetch<PasswordPolicyOut>('/security/password-policy'),
    staleTime: 1000 * 60 * 10,
  })
}

// ---------------------------------------------------------------------------
// Admin module 12: system health
// ---------------------------------------------------------------------------

/** GET /system/status: runtime, schema revision, database and storage status. */
export function useSystemStatus() {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: () => apiFetch<SystemStatusOut>('/system/status'),
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

/**
 * PATCH /settings. Changing receipt_sequence_cycle after receipts exist in the current cycle
 * fails with 409 receipt_cycle_change_requires_confirmation (extra fields:
 * ReceiptCycleConfirmationExtra) until it is resent with confirm_receipt_cycle_change: true
 * and a non-blank change_reason.
 */
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
      qc.invalidateQueries({ queryKey: ['clinic-settings'] })
      invalidateAdminSummaries(qc)
    },
  })
}

export function useDepartments(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiFetch<DepartmentOut[]>('/departments'),
    enabled: options?.enabled ?? true,
  })
}

export function useCreateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DepartmentCreate) =>
      apiFetch<DepartmentOut>('/departments', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useUpdateDepartment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: DepartmentUpdate }) =>
      apiFetch<DepartmentOut>(`/departments/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  })
}

export function useDepartmentDoctors(departmentId: number | null) {
  return useQuery({
    queryKey: ['departments', departmentId, 'doctors'],
    queryFn: () => apiFetch<DepartmentDoctorOut[]>(`/departments/${departmentId}/doctors`),
    enabled: departmentId !== null,
  })
}

/** One choice at the check-in desk: a doctor in one of the departments they consult in. */
export interface ConsultingDoctorOption {
  doctor: DepartmentDoctorOut
  department: DepartmentOut
}

/** Every doctor of every active department, for the check-in desk's single doctor list. */
export function useConsultingDoctors() {
  const { data: departments, isPending: departmentsPending } = useDepartments()
  const active = (departments ?? []).filter((d) => d.is_active)
  const results = useQueries({
    queries: active.map((dept) => ({
      queryKey: ['departments', dept.id, 'doctors'],
      queryFn: () => apiFetch<DepartmentDoctorOut[]>(`/departments/${dept.id}/doctors`),
    })),
  })
  const options: ConsultingDoctorOption[] = active.flatMap((department, index) =>
    (results[index]?.data ?? []).map((doctor) => ({ doctor, department })),
  )
  return { options, isPending: departmentsPending || results.some((r) => r.isPending) }
}

export function useDoctorDepartments(doctorId: number | null) {
  return useQuery({
    queryKey: ['doctors', doctorId, 'departments'],
    queryFn: () => apiFetch<DepartmentOut[]>(`/doctors/${doctorId}/departments`),
    enabled: doctorId !== null,
  })
}

export function useAssignDoctorDepartments() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ doctorId, body }: { doctorId: number; body: DoctorDepartmentAssignment }) =>
      apiFetch<DepartmentOut[]>(`/doctors/${doctorId}/departments`, { method: 'PUT', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] })
      qc.invalidateQueries({ queryKey: ['doctors'] })
    },
  })
}

export function useDoctors(activeOnly: boolean = false, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['doctors', { activeOnly }],
    queryFn: () =>
      apiFetch<DoctorOut[]>(activeOnly ? '/doctors' : '/doctors?include_inactive=true'),
    enabled: options?.enabled ?? true,
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
      invalidateAdminSummaries(qc)
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
      invalidateAdminSummaries(qc)
    },
  })
}

export function useUpdateDoctorMeSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DoctorMeSettingsUpdate) =>
      apiFetch<DoctorOut>('/doctors/me/settings', {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

/**
 * GET /fees. activeOnly=false sends include_inactive=true (all fees, ordered by id);
 * activeOnly=true returns active fees only.
 */
export function useFees(activeOnly: boolean = false, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['fees', { activeOnly }],
    queryFn: () =>
      apiFetch<FeeOut[]>(activeOnly ? '/fees' : '/fees?include_inactive=true'),
    enabled: options?.enabled ?? true,
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
      invalidateAdminSummaries(qc)
    },
  })
}

/** PATCH /fees/{id}. body.version_id is required; a stale one gives 409 version_conflict. */
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
      invalidateAdminSummaries(qc)
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
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

export function useCheckDuplicate(name: string, mobile: string, enabled: boolean = true) {
  return useQuery({
    queryKey: ['check-duplicate', name, mobile],
    queryFn: ({ signal }) =>
      apiFetch<DuplicateCheckResponse>(
        `/patients/check-duplicate?name=${encodeURIComponent(name.trim())}&mobile=${encodeURIComponent(mobile.trim())}`,
        { signal },
      ),
    enabled: enabled && name.trim().length >= 2 && mobile.trim().length >= 10,
    staleTime: 5000,
  })
}

function buildPatientDirectorySearchParams(
  q: string,
  filters?: PatientDirectoryFilters,
  pagination?: { limit: number; offset: number },
): string {
  const parts: string[] = [`q=${encodeURIComponent(q)}`]
  if (filters?.status) parts.push(`status=${encodeURIComponent(filters.status)}`)
  if (filters?.gender === 'M' || filters?.gender === 'F' || filters?.gender === 'O') {
    parts.push(`gender=${encodeURIComponent(filters.gender)}`)
  }
  const district = filters?.district?.trim()
  if (district) parts.push(`district=${encodeURIComponent(district)}`)
  // Omit has_due_balance unless explicitly boolean so DOCTOR callers never trigger 403.
  if (typeof filters?.has_due_balance === 'boolean') {
    parts.push(`has_due_balance=${filters.has_due_balance ? 'true' : 'false'}`)
  }
  if (pagination) {
    if (filters?.sort_by) parts.push(`sort_by=${encodeURIComponent(filters.sort_by)}`)
    parts.push(`limit=${pagination.limit}`)
    parts.push(`offset=${pagination.offset}`)
  }
  return `?${parts.join('&')}`
}

export interface UsePatientsOptions extends PatientDirectoryFilters {
  enabled?: boolean
  filters?: PatientDirectoryFilters
}

export function usePatients(
  q: string = '',
  limit: number = 20,
  offset: number = 0,
  options?: UsePatientsOptions,
  filters?: PatientDirectoryFilters,
) {
  const resolvedFilters: PatientDirectoryFilters | undefined =
    filters ??
    options?.filters ??
    (options &&
    (options.status !== undefined ||
      options.gender !== undefined ||
      options.district !== undefined ||
      options.has_due_balance !== undefined ||
      options.sort_by !== undefined)
      ? {
          status: options.status,
          gender: options.gender,
          district: options.district,
          has_due_balance: options.has_due_balance,
          sort_by: options.sort_by,
        }
      : undefined)

  return useQuery({
    queryKey: [
      'patients',
      {
        q,
        limit,
        offset,
        status: resolvedFilters?.status,
        gender: resolvedFilters?.gender || undefined,
        district: resolvedFilters?.district?.trim() || undefined,
        has_due_balance:
          typeof resolvedFilters?.has_due_balance === 'boolean'
            ? resolvedFilters.has_due_balance
            : undefined,
        sort_by: resolvedFilters?.sort_by,
      },
    ],
    queryFn: ({ signal }) =>
      apiFetch<PatientOut[]>(
        `/patients${buildPatientDirectorySearchParams(q, resolvedFilters, { limit, offset })}`,
        { signal },
      ),
    enabled: options?.enabled ?? true,
  })
}

export function usePatientCount(
  q: string = '',
  filters?: PatientDirectoryFilters,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: [
      'patients',
      'count',
      {
        q,
        status: filters?.status,
        gender: filters?.gender || undefined,
        district: filters?.district?.trim() || undefined,
        has_due_balance:
          typeof filters?.has_due_balance === 'boolean'
            ? filters.has_due_balance
            : undefined,
      },
    ],
    queryFn: () =>
      apiFetch<{ total: number }>(
        `/patients/count${buildPatientDirectorySearchParams(q, filters)}`,
      ),
    enabled: options?.enabled ?? true,
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
      qc.invalidateQueries({ queryKey: ['patient-summary', data.id] })
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

// ---------------------------------------------------------------------------
// Milestone 1: Patient Workspace Summary, Visit History & Clinical Allergies
// ---------------------------------------------------------------------------

export function usePatientSummary(patientId: number | null) {
  return useQuery({
    queryKey: ['patient-summary', patientId],
    queryFn: () => apiFetch<PatientSummaryOut>(`/api/patients/${patientId}/summary`),
    enabled: patientId !== null && patientId > 0,
  })
}

export function usePatientVisits(
  patientId: number | null,
  params?: { limit?: number; offset?: number },
) {
  const searchParams = new URLSearchParams()
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''

  return useQuery({
    queryKey: ['patient-visits', patientId, params],
    queryFn: () =>
      apiFetch<PatientVisitHistoryResponse>(`/api/patients/${patientId}/visits${qs}`),
    enabled: patientId !== null && patientId > 0,
  })
}

/**
 * GET /api/patients/{patientId}/allergies (DOCTOR only, D-04).
 * Defaults enabled=false so Reception/Admin callers never trigger 403s; pass enabled=isDoctor.
 */
export function usePatientAllergies(patientId: number | null, enabled: boolean = false) {
  return useQuery({
    queryKey: ['patient-allergies', patientId],
    queryFn: () => apiFetch<PatientAllergyOut[]>(`/api/patients/${patientId}/allergies`),
    enabled: enabled && patientId !== null && patientId > 0,
  })
}

/** POST /api/patients/{patientId}/allergies (DOCTOR only, allergy:write). */
export function useCreatePatientAllergy(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PatientAllergyCreate) =>
      apiFetch<PatientAllergyOut>(`/api/patients/${patientId}/allergies`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-summary', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-allergies', patientId] })
    },
  })
}

/** PATCH /api/patients/{patientId}/allergies/{allergyId} (DOCTOR only, allergy:write, optimistic version_id). */
export function useUpdatePatientAllergy(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ allergyId, body }: { allergyId: number; body: PatientAllergyUpdate }) =>
      apiFetch<PatientAllergyOut>(`/api/patients/${patientId}/allergies/${allergyId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-summary', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-allergies', patientId] })
    },
  })
}


// ==============================================================================
export { useHealth, type HealthStatus } from './health'

// Appointments & Clinical Encounters (Phase 13)
// ==============================================================================

export interface UseAppointmentsParams {
  appointment_date?: string
  doctor_id?: number
  patient_id?: number
  status?: string
  status_bucket?: string
  limit?: number
  offset?: number
  sort_by?: 'token' | 'time'
  search?: string
}

export function useAppointments(
  params?: UseAppointmentsParams,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  const q = new URLSearchParams()
  if (params?.appointment_date) q.set('appointment_date', params.appointment_date)
  if (params?.doctor_id) q.set('doctor_id', String(params.doctor_id))
  if (params?.patient_id) q.set('patient_id', String(params.patient_id))
  if (params?.status) q.set('status', params.status)
  if (params?.status_bucket) q.set('status_bucket', params.status_bucket)
  if (params?.limit !== undefined) q.set('limit', String(params.limit))
  if (params?.offset !== undefined) q.set('offset', String(params.offset))
  if (params?.sort_by) q.set('sort_by', params.sort_by)
  const trimmedSearch = params?.search?.trim()
  if (trimmedSearch) q.set('search', trimmedSearch)
  const qs = q.toString() ? `?${q.toString()}` : ''

  return useQuery({
    queryKey: ['appointments', params],
    queryFn: ({ signal }) => apiFetch<AppointmentListResponse>(`/appointments${qs}`, { signal }),
    enabled: options?.enabled ?? true,
    // Reception and doctor screens share this list; poll so every workstation sees the same queue.
    refetchInterval: options?.refetchInterval ?? 10000,
  })
}

export interface UseOpdArrivalsOptions {
  enabled?: boolean
  doctor_id?: number
  limit?: number
  offset?: number
  refetchInterval?: number | false
}

export function useOpdArrivals(arrivalDate: string, options?: UseOpdArrivalsOptions) {
  const query = new URLSearchParams({ arrival_date: arrivalDate })
  if (options?.doctor_id) query.set('doctor_id', String(options.doctor_id))
  if (options?.limit !== undefined) query.set('limit', String(options.limit))
  if (options?.offset !== undefined) query.set('offset', String(options.offset))
  const filterKey =
    options?.doctor_id !== undefined ||
    options?.limit !== undefined ||
    options?.offset !== undefined
      ? {
          doctor_id: options.doctor_id,
          limit: options.limit,
          offset: options.offset,
        }
      : undefined
  return useQuery({
    queryKey: filterKey ? ['opd-arrivals', arrivalDate, filterKey] : ['opd-arrivals', arrivalDate],
    queryFn: ({ signal }) => apiFetch<OpdArrivalList>(`/opd-arrivals?${query}`, { signal }),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? 10000,
  })
}

export function useOpdArrival(id: number) {
  return useQuery({
    queryKey: ['opd-arrival', id],
    queryFn: () => apiFetch<OpdArrival>(`/opd-arrivals/${id}`),
    enabled: id > 0,
  })
}

export function useCreateOpdArrival() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: OpdArrivalCreate & { idempotencyKey?: string }) =>
      apiFetch<OpdArrival>('/opd-arrivals', { method: 'POST', body, idempotencyKey }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['opd-arrivals'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

export function useRegisterOpdArrival() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: OpdArrivalRegister }) =>
      apiFetch<Appointment>(`/opd-arrivals/${id}/register`, { method: 'POST', body }),
    onSuccess: (appointment) => {
      qc.setQueryData(['appointment', appointment.id], appointment)
      qc.invalidateQueries({ queryKey: ['opd-arrivals'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient-summary'] })
      qc.invalidateQueries({ queryKey: ['patient-visits'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

export function useUpdateOpdArrivalPriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: OpdArrivalPriorityUpdate }) =>
      apiFetch<OpdArrival>(`/opd-arrivals/${id}/priority`, { method: 'PATCH', body }),
    onSuccess: (arrival) => {
      qc.setQueryData(['opd-arrival', arrival.id], arrival)
      qc.invalidateQueries({ queryKey: ['opd-arrivals'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

export function useCancelOpdArrival() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: { version_id: number; reason: string } }) =>
      apiFetch<OpdArrival>(`/opd-arrivals/${id}/cancel`, { method: 'POST', body }),
    onSuccess: (arrival) => {
      qc.setQueryData(['opd-arrival', arrival.id], arrival)
      qc.invalidateQueries({ queryKey: ['opd-arrivals'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
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
    mutationFn: ({ idempotencyKey, ...body }: AppointmentCreate & { idempotencyKey?: string }) =>
      apiFetch<Appointment>('/appointments', {
        method: 'POST',
        body,
        idempotencyKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Register a walk-in: a booking for today checked in at once, with its token (all or nothing). */
export function useWalkIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: WalkInCreate & { idempotencyKey?: string }) =>
      apiFetch<Appointment>('/appointments/walk-in', { method: 'POST', body, idempotencyKey }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['patient-summary'] })
      qc.invalidateQueries({ queryKey: ['patient-visits'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Move a booking to another day (a new linked booking) or change its expected time. */
export function useRescheduleAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RescheduleRequest }) =>
      apiFetch<Appointment>(`/appointments/${id}/reschedule`, { method: 'POST', body }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['appointment', vars.id] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Register a first-time patient and check them in, all or nothing (OD-22-03). */
export function useCheckInNewPatient() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ idempotencyKey, ...body }: NewPatientCheckIn & { idempotencyKey?: string }) =>
      apiFetch<Appointment>('/appointments/walk-in/new-patient', {
        method: 'POST',
        body,
        idempotencyKey,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['patients'] })
      qc.invalidateQueries({ queryKey: ['patient-summary'] })
      qc.invalidateQueries({ queryKey: ['patient-visits'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Doctor acknowledges an emergency alert on own consultation (OD-22-09). */
export function useAcknowledgeAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: AcknowledgeAlertRequest }) =>
      apiFetch<Appointment>(`/appointments/${id}/acknowledge-alert`, { method: 'POST', body }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

/** Move a waiting patient to another doctor on the same visit (QUE-10). Reception only. */
export function useReassignAppointment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ReassignRequest }) =>
      apiFetch<Appointment>(`/appointments/${id}/reassign`, { method: 'POST', body }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Mark a checked-in patient Normal, Priority or Emergency (OD-22-06). */
export function useUpdatePriority() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PriorityUpdate }) =>
      apiFetch<Appointment>(`/appointments/${id}/priority`, { method: 'PATCH', body }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** Check a booked patient in on arrival: opens or joins the visit and issues the token. */
export function useCheckIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      body,
      idempotencyKey,
    }: {
      id: number
      body: CheckInRequest
      idempotencyKey?: string
    }) =>
      apiFetch<Appointment>(`/appointments/${id}/check-in`, {
        method: 'POST',
        body,
        idempotencyKey,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['appointment', data.id], data)
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['patient-summary'] })
      qc.invalidateQueries({ queryKey: ['patient-visits'] })
      qc.invalidateQueries({ queryKey: ['timeline'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
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
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

export function useDoctorQueue(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['doctor-queue'],
    queryFn: () => apiFetch<DoctorQueueResponse>('/doctor/queue'),
    refetchInterval: 10000, // Poll every 10s for real-time queue refresh
    enabled: options?.enabled ?? true,
  })
}

export function useDoctorDashboardSummary() {
  return useQuery({
    queryKey: ['doctor-dashboard-summary'],
    queryFn: () => apiFetch<DoctorDashboardSummary>('/doctor/dashboard/summary'),
    placeholderData: keepPreviousData,
    refetchInterval: 10000,
    retry: 1,
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

export function useUnfinishedEncounters(enabled = true) {
  return useQuery({
    queryKey: ['unfinished-encounters'],
    queryFn: () => apiFetch<UnfinishedEncounter[]>('/encounters/unfinished'),
    enabled,
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
      // The workspace opens this record next; seeding the cache avoids a second load.
      qc.setQueryData(['encounter', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-encounters', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['unfinished-encounters'] })
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
    mutationFn: (
      param:
        | number
        | {
            id: number
            body?: {
              symptoms?: string
              diagnosis?: string
              clinical_notes?: string | null
              version_id?: number
            }
          }
    ) => {
      const id = typeof param === 'number' ? param : param.id
      const body = typeof param === 'number' ? undefined : param.body
      return apiFetch<EncounterRead>(`/encounters/${id}/finalise`, {
        method: 'POST',
        // apiFetch encodes the body as JSON itself; encoding here too sent a JSON string (422).
        body,
      })
    },
    onSuccess: (data) => {
      qc.setQueryData(['encounter', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-encounters', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['unfinished-encounters'] })
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

// Phase 19: Universal Consultation Workspace Hooks
// The save hooks take the encounter id with each call, not when the hook is created: a new
// consultation gets its id during the first save, and later saves in that same call must use it.
export function useSaveEncounterDraft() {
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
      qc.invalidateQueries({ queryKey: ['unfinished-encounters'] })
    },
  })
}

export function usePatientPriorEncounter(patientId: number, excludeEncounterId?: number) {
  return useQuery({
    queryKey: ['patient-prior-encounter', patientId, excludeEncounterId],
    queryFn: async (): Promise<(EncounterRead & { vitals?: VitalObservationResponse | null }) | null> => {
      const summaries = await apiFetch<EncounterSummary[]>(`/patients/${patientId}/encounters`)
      const prior = summaries.find((s) => !excludeEncounterId || s.id !== excludeEncounterId)
      if (!prior) return null
      const full = await apiFetch<EncounterRead>(`/encounters/${prior.id}`)
      let vitals: VitalObservationResponse | null = null
      try {
        vitals = await apiFetch<VitalObservationResponse>(`/encounters/${prior.id}/vitals`)
      } catch {
        vitals = null
      }
      return { ...full, vitals }
    },
    enabled: patientId > 0,
  })
}

export function useEncounterVitals(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-vitals', encounterId],
    queryFn: () => apiFetch<VitalObservationResponse>(`/encounters/${encounterId}/vitals`),
    enabled: encounterId > 0,
    retry: false,
  })
}

export function useSaveVitals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ encounterId, body }: { encounterId: number; body: VitalObservationInput }) =>
      apiFetch<VitalObservationResponse>(`/encounters/${encounterId}/vitals`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (data, { encounterId }) => {
      qc.setQueryData(['encounter-vitals', encounterId], data)
    },
  })
}

export function useDepartmentTemplate(departmentId: number | null | undefined) {
  return useQuery({
    queryKey: ['department-template', departmentId],
    queryFn: () => apiFetch<ClinicalTemplateRead>(`/templates/by-department/${departmentId}`),
    enabled: !!departmentId && departmentId > 0,
  })
}

export function useEncounterTemplateResponse(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-template-response', encounterId],
    queryFn: () => apiFetch<TemplateResponseRead>(`/encounters/${encounterId}/template-response`),
    enabled: encounterId > 0,
    retry: false,
  })
}

export function useSaveEncounterTemplateResponse() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ encounterId, body }: { encounterId: number; body: TemplateResponseInput }) =>
      apiFetch<TemplateResponseRead>(`/encounters/${encounterId}/template-response`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (data, { encounterId }) => {
      qc.setQueryData(['encounter-template-response', encounterId], data)
    },
  })
}

export function useEncounterPrescription(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-prescription', encounterId],
    queryFn: () => apiFetch<PrescriptionOut | null>(`/encounters/${encounterId}/prescription`),
    enabled: encounterId > 0,
  })
}

export function useAuthorisePrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<PrescriptionOut>(`/prescriptions/${id}/authorise`, {
        method: 'POST',
      }),
    onSuccess: (data) => {
      qc.setQueryData(['prescription', data.id], data)
      if (data.encounter_id) {
        qc.invalidateQueries({ queryKey: ['encounter-prescription', data.encounter_id] })
      }
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', data.patient_id] })
    },
  })
}

export function useCancelPrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiFetch<PrescriptionOut>(`/prescriptions/${id}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: (data) => {
      qc.setQueryData(['prescription', data.id], data)
      if (data.encounter_id) {
        qc.invalidateQueries({ queryKey: ['encounter-prescription', data.encounter_id] })
      }
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', data.patient_id] })
    },
  })
}

export function useUpdatePrescription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: PrescriptionUpdate }) =>
      apiFetch<PrescriptionOut>(`/prescriptions/${id}`, {
        method: 'PUT',
        body,
      }),
    onSuccess: (data) => {
      qc.setQueryData(['prescription', data.id], data)
      if (data.encounter_id) {
        qc.invalidateQueries({ queryKey: ['encounter-prescription', data.encounter_id] })
      }
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', data.patient_id] })
    },
  })
}

export function useEncounterFollowUp(encounterId: number) {
  return useQuery({
    queryKey: ['encounter-follow-up', encounterId],
    queryFn: () => apiFetch<DoctorFollowUpResponse>(`/encounters/${encounterId}/follow-up`),
    enabled: encounterId > 0,
    retry: false,
  })
}

/** The server keeps one follow-up per encounter and has no update call, so this is sent once. */
export function useCreateFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ encounterId, body }: { encounterId: number; body: FollowUpRecommendationCreate }) =>
      apiFetch<DoctorFollowUpResponse>(`/encounters/${encounterId}/follow-up`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data, { encounterId }) => {
      qc.setQueryData(['encounter-follow-up', encounterId], data)
      qc.invalidateQueries({ queryKey: ['reception-follow-ups'] })
    },
  })
}

export function useReceptionFollowUps(
  params?: { status?: string; date_from?: string; date_to?: string; overdue?: boolean },
  enabled = true,
) {
  const searchParams = new URLSearchParams()
  if (params?.status) searchParams.set('status', params.status)
  if (params?.date_from) searchParams.set('date_from', params.date_from)
  if (params?.date_to) searchParams.set('date_to', params.date_to)
  if (params?.overdue !== undefined) searchParams.set('overdue', String(params.overdue))
  const query = searchParams.toString()

  return useQuery({
    queryKey: ['reception-follow-ups', params],
    queryFn: () =>
      apiFetch<ReceptionFollowUpResponse[]>(
        `/reception/follow-ups${query ? `?${query}` : ''}`,
      ),
    enabled,
  })
}

export function useBookFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: FollowUpBookRequest }) =>
      apiFetch<ReceptionFollowUpResponse>(`/follow-ups/${id}/book`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reception-follow-ups'] })
      qc.invalidateQueries({ queryKey: ['appointments'] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

export function useCloseFollowUp() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: FollowUpCloseRequest }) =>
      apiFetch<ReceptionFollowUpResponse>(`/follow-ups/${id}/close`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reception-follow-ups'] })
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
      if (data.encounter_id) {
        qc.setQueryData(['encounter-prescription', data.encounter_id], data)
        qc.invalidateQueries({ queryKey: ['encounter-prescription', data.encounter_id] })
      }
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['doctor-queue'] })
    },
  })
}

export type TreatmentPlanRosterStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ALL'

export function useTreatmentPlans(
  status: TreatmentPlanRosterStatus = 'ACTIVE',
  enabled = true,
) {
  return useQuery({
    queryKey: ['treatment-plans', status],
    queryFn: () =>
      apiFetch<TreatmentPlanOut[]>(
        `/treatment-plans?status=${encodeURIComponent(status)}`,
      ),
    enabled,
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
      qc.setQueryData(['treatment-plan', data.id], data)
      qc.invalidateQueries({ queryKey: ['patient-treatment-plans', data.patient_id] })
      qc.invalidateQueries({ queryKey: ['treatment-plans'] })
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
      qc.invalidateQueries({ queryKey: ['treatment-plans'] })
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
      qc.invalidateQueries({ queryKey: ['treatment-plans'] })
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

export function usePendingDues(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['billing', 'pending-dues'],
    queryFn: () => apiFetch<PendingDueOut[]>('/api/billing/pending-dues'),
    enabled: options?.enabled ?? true,
  })
}

export function useRecordPayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: PaymentCreate) =>
      apiFetch<PaymentOut>('/api/payments', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['patient-payments', variables.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-ledger', variables.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-summary', variables.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-visits', variables.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plan'] })
      queryClient.invalidateQueries({ queryKey: ['patient-treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['timeline', variables.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      queryClient.invalidateQueries({ queryKey: ['visit-bill'] })
      queryClient.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useReversePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: PaymentReversalCreate }) =>
      apiFetch<PaymentOut>('/api/payments/' + id + '/reverse', {
        method: 'POST',
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payments'] })
      queryClient.invalidateQueries({ queryKey: ['patient-payments', data.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-ledger', data.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-summary', data.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['patient-visits', data.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['billing'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['treatment-plan'] })
      queryClient.invalidateQueries({ queryKey: ['patient-treatment-plans'] })
      queryClient.invalidateQueries({ queryKey: ['timeline'] })
      queryClient.invalidateQueries({ queryKey: ['visits'] })
      queryClient.invalidateQueries({ queryKey: ['visit-bill'] })
      queryClient.invalidateQueries({ queryKey: ['receipts'] })
      queryClient.invalidateQueries({ queryKey: ['pending-dues'] })
      queryClient.invalidateQueries({ queryKey: ['overview'] })
      invalidateAdminSummaries(queryClient)
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
export function useAuditLogs(
  params?: {
    actor_username?: string
    action?: string
    entity_type?: string
    entity_id?: string
    outcome?: string
    date_from?: string
    date_to?: string
    page?: number
    page_size?: number
  },
  options?: { enabled?: boolean }
) {
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
    enabled: options?.enabled ?? true,
  })
}

/** GET /audit-logs/actions: sorted catalogue of audit action names (for the action filter). */
export function useAuditActions() {
  return useQuery({
    queryKey: ['audit-logs', 'actions'],
    queryFn: () => apiFetch<string[]>('/api/audit-logs/actions'),
    staleTime: 1000 * 60 * 10,
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
        body: payload,
        timeoutMs: 300_000,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['operations', 'backups'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      invalidateAdminSummaries(queryClient)
    },
    onError: () => {
      // A failed backup writes a BACKUP_FAILED audit row and changes the overview alerts.
      invalidateAdminSummaries(queryClient)
    },
  })
}

/**
 * POST /operations/backups/{filename}/verify: re-hashes one archive against its manifest.
 * Read-only on the server (not audited), so nothing is invalidated. 422 invalid_archive_filename.
 */
export function useBackupSettings() {
  return useQuery({
    queryKey: ['operations', 'backup-settings'],
    queryFn: () => apiFetch<BackupSettingsOut>('/api/operations/backup-settings'),
  })
}

export function useUpdateBackupSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: BackupSettingsUpdate) =>
      apiFetch<BackupSettingsOut>('/api/operations/backup-settings', {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['operations', 'backup-settings'], data)
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] })
    },
  })
}

export function useBackupRuns() {
  return useQuery({
    queryKey: ['operations', 'backup-runs'],
    queryFn: () => apiFetch<BackupRunOut[]>('/api/operations/backup-runs'),
  })
}

export function useBillingConfiguration() {
  return useQuery({
    queryKey: ['billing', 'configuration'],
    queryFn: () => apiFetch<BillingConfigurationOut>('/api/billing/configuration'),
  })
}

export interface LedgerFilter {
  q: string
  status: 'all' | 'active' | 'reversed'
}

/** Full ledger search: Admin only (payment:reverse). Reception must not call it (403). */
export function useLedger(filter: LedgerFilter, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['billing', 'ledger', filter],
    queryFn: () => {
      const params = new URLSearchParams({ status: filter.status })
      if (filter.q) params.set('q', filter.q)
      return apiFetch<PaymentOut[]>(`/api/billing/ledger?${params.toString()}`)
    },
    enabled: options.enabled ?? true,
  })
}

export interface VisitListFilter {
  readyForCheckout?: boolean
  visitDate?: string
  status?: VisitStatus
  limit?: number
}

/** GET /visits: reception and admin read. Ready for checkout = open, a completed consultation, none active. */
export function useVisits(
  filter: VisitListFilter = {},
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: ['visits', 'list', filter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(filter.limit ?? 100) })
      if (filter.readyForCheckout) params.set('ready_for_checkout', 'true')
      if (filter.visitDate) params.set('visit_date', filter.visitDate)
      if (filter.status) params.set('status', filter.status)
      return apiFetch<VisitListResponse>(`/api/visits?${params.toString()}`)
    },
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  })
}

/** GET /visits/{id}: the visit with its consultations, payments and the balance still due. */
export function useVisit(
  id: number | null | undefined,
  options?: {
    enabled?: boolean
    refetchInterval?: number | false | ((query: { state: { data?: VisitDetail } }) => number | false)
  },
) {
  return useQuery({
    queryKey: ['visits', 'detail', id],
    queryFn: () => apiFetch<VisitDetail>(`/api/visits/${id}`),
    enabled: Boolean(id && id > 0) && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval ?? false,
  })
}

/** POST /visits/{id}/close ("Patient Out"). A reason is required while money is still due. */
export function useCloseVisit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: VisitCloseRequest }) =>
      apiFetch<VisitDetail>(`/api/visits/${id}/close`, { method: 'POST', body }),
    onSuccess: (data) => {
      queryClient.setQueryData(['visits', 'detail', data.id], data)
      queryClient.invalidateQueries({ queryKey: ['visits', 'list'] })
      queryClient.invalidateQueries({ queryKey: ['billing', 'visit-dues'] })
      queryClient.invalidateQueries({ queryKey: ['timeline', data.patient_id] })
      queryClient.invalidateQueries({ queryKey: ['visit-bill'] })
      queryClient.invalidateQueries({ queryKey: ['overview', 'reception'] })
    },
  })
}

/** GET /billing/visit-dues: fees still owed on visits closed with a balance. */
export function useVisitDues(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['billing', 'visit-dues'],
    queryFn: () => apiFetch<VisitDueOut[]>('/api/billing/visit-dues'),
    enabled: options?.enabled ?? true,
  })
}

/** GET /billing/receipts/today: today's receipts (IST), the only ledger reception sees. */
export function useReceiptsToday(enabled = true) {
  return useQuery({
    queryKey: ['billing', 'receipts-today'],
    queryFn: () => apiFetch<PaymentOut[]>('/api/billing/receipts/today'),
    enabled,
  })
}

export function useVerifyBackup() {
  return useMutation({
    mutationFn: (filename: string) =>
      apiFetch<BackupVerifyResponse>(
        `/api/operations/backups/${encodeURIComponent(filename)}/verify`,
        { method: 'POST' },
      ),
  })
}

/**
 * POST /operations/restore. Requires confirmation_phrase 'RESTORE' and a 10-500 character
 * reason; the pre-restore snapshot is always taken. A failed restore is audited as well.
 */
export function useRestoreBackup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: RestoreRequest) =>
      apiFetch<RestoreResultOut>('/api/operations/restore', {
        method: 'POST',
        body: payload,
        timeoutMs: 300_000,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries()
    },
    onError: () => {
      // 400 backup_corrupted / 500 restore_failed commit a BACKUP_RESTORE_FAILED audit row.
      invalidateAdminSummaries(queryClient)
    },
  })
}

export function useHospitalAssets(params?: { asset_type?: string; is_active?: boolean }) {
  return useQuery({
    queryKey: ['admin', 'assets', params],
    queryFn: () => {
      const query = new URLSearchParams()
      if (params?.asset_type) query.set('asset_type', params.asset_type)
      if (params?.is_active !== undefined) query.set('is_active', String(params.is_active))
      const qs = query.toString() ? `?${query.toString()}` : ''
      return apiFetch<HospitalAssetOut[]>(`/api/admin/assets${qs}`)
    },
  })
}

export function useUploadAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (formData: FormData) =>
      apiFetch<HospitalAssetOut>('/api/admin/assets', {
        method: 'POST',
        body: formData,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'assets'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['branding'] })
      queryClient.invalidateQueries({ queryKey: ['clinic-settings'] })
    },
  })
}

export function useDeactivateAsset() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (assetId: number) =>
      apiFetch<HospitalAssetOut>(`/api/admin/assets/${assetId}/deactivate`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'assets'] })
      queryClient.invalidateQueries({ queryKey: ['assets'] })
      queryClient.invalidateQueries({ queryKey: ['branding'] })
      queryClient.invalidateQueries({ queryKey: ['clinic-settings'] })
    },
  })
}

export function usePrintTemplates() {
  return useQuery({
    queryKey: ['admin', 'templates'],
    queryFn: () => apiFetch<PrintTemplateOut[]>('/api/admin/templates'),
  })
}

export function usePrintTemplate(docType: string) {
  return useQuery({
    queryKey: ['admin', 'templates', docType],
    queryFn: () => apiFetch<PrintTemplateOut>(`/api/admin/templates/${docType}`),
    enabled: !!docType,
  })
}

export function useUpdatePrintTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      docType,
      payload,
    }: {
      docType: string
      payload: PrintTemplateUpdatePayload
    }) =>
      // apiFetch sets the JSON content type and encodes the body itself.
      apiFetch<PrintTemplateOut>(`/api/admin/templates/${docType}`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'templates'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'templates', variables.docType] })
      queryClient.invalidateQueries({ queryKey: ['print-templates'] })
    },
  })
}

export function useAdminSearchPatients(q: string) {
  return useQuery({
    queryKey: ['admin', 'patients', 'search', q],
    queryFn: () => apiFetch<PatientOut[]>(`/admin/patients/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 1,
  })
}

export function useCorrectPatientDemographics() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: AdminPatientDemographicCorrection }) =>
      apiFetch<PatientOut>(`/admin/patients/${id}/demographics`, {
        method: 'PATCH',
        body: payload,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'patients', 'search'] })
      queryClient.invalidateQueries({ queryKey: ['patient', data.id] })
      queryClient.invalidateQueries({ queryKey: ['patients'] })
      queryClient.invalidateQueries({ queryKey: ['patient-summary', data.id] })
    },
  })
}

// ---------------------------------------------------------------------------
// Milestone 2: Conditions, Encounter Diagnoses, Investigations & Rx Versioning
// ---------------------------------------------------------------------------

/**
 * GET /api/patients/{patientId}/conditions (DOCTOR only, D-04).
 * Defaults enabled=false so Reception/Admin callers never trigger 403s; pass enabled=isDoctor.
 */
export function usePatientConditions(patientId: number | null, enabled: boolean = false) {
  return useQuery({
    queryKey: ['patient-conditions', patientId],
    queryFn: () => apiFetch<PatientConditionOut[]>(`/api/patients/${patientId}/conditions`),
    enabled: enabled && patientId !== null && patientId > 0,
  })
}

/** POST /api/patients/{patientId}/conditions (DOCTOR only). */
export function useCreatePatientCondition(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: PatientConditionCreate) =>
      apiFetch<PatientConditionOut>(`/api/patients/${patientId}/conditions`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-conditions', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', patientId] })
    },
  })
}

/** PATCH /api/patients/{patientId}/conditions/{conditionId} (DOCTOR only, optimistic version_id). */
export function useUpdatePatientCondition(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      conditionId,
      body,
    }: {
      conditionId: number
      body: PatientConditionUpdate
    }) =>
      apiFetch<PatientConditionOut>(`/api/patients/${patientId}/conditions/${conditionId}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-conditions', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', patientId] })
    },
  })
}

/** GET /api/encounters/{encounterId}/diagnoses (DOCTOR only). */
export function useEncounterDiagnoses(encounterId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['encounter-diagnoses', encounterId],
    queryFn: () => apiFetch<EncounterDiagnosisOut[]>(`/api/encounters/${encounterId}/diagnoses`),
    enabled: enabled && encounterId !== null && encounterId > 0,
  })
}

/** POST /api/encounters/{encounterId}/diagnoses (DOCTOR only; supports promote_to_condition). */
export function useCreateEncounterDiagnosis(encounterId: number, patientId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: EncounterDiagnosisCreate) =>
      apiFetch<EncounterDiagnosisOut>(`/api/encounters/${encounterId}/diagnoses`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['encounter-diagnoses', encounterId] })
      const targetPatientId = patientId ?? data.patient_id
      qc.invalidateQueries({ queryKey: ['patient-conditions', targetPatientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', targetPatientId] })
    },
  })
}

/** PATCH /api/encounters/{encounterId}/diagnoses/{diagnosisId} (DOCTOR only, unfinalised only). */
export function useUpdateEncounterDiagnosis(encounterId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      diagnosisId,
      body,
    }: {
      diagnosisId: number
      body: EncounterDiagnosisUpdate
    }) =>
      apiFetch<EncounterDiagnosisOut>(
        `/api/encounters/${encounterId}/diagnoses/${diagnosisId}`,
        {
          method: 'PATCH',
          body,
        },
      ),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['encounter-diagnoses', encounterId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', data.patient_id] })
    },
  })
}

/** DELETE /api/encounters/{encounterId}/diagnoses/{diagnosisId} (DOCTOR only, unfinalised only). */
export function useDeleteEncounterDiagnosis(encounterId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (diagnosisId: number) =>
      apiFetch<void>(`/api/encounters/${encounterId}/diagnoses/${diagnosisId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounter-diagnoses', encounterId] })
    },
  })
}

/**
 * GET /api/patients/{patientId}/investigations (DOCTOR only, D-04).
 * Defaults enabled=false so Reception/Admin callers never trigger 403s; pass enabled=isDoctor.
 */
export function usePatientInvestigations(patientId: number | null, enabled: boolean = false) {
  return useQuery({
    queryKey: ['patient-investigations', patientId],
    queryFn: () =>
      apiFetch<InvestigationOrderOut[]>(`/api/patients/${patientId}/investigations`),
    enabled: enabled && patientId !== null && patientId > 0,
  })
}

/** GET /api/encounters/{encounterId}/investigations (DOCTOR only). */
export function useEncounterInvestigations(encounterId: number | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['encounter-investigations', encounterId],
    queryFn: () =>
      apiFetch<InvestigationOrderOut[]>(`/api/encounters/${encounterId}/investigations`),
    enabled: enabled && encounterId !== null && encounterId > 0,
  })
}

/** POST /api/encounters/{encounterId}/investigations (DOCTOR only). */
export function useCreateInvestigationOrder(encounterId: number, patientId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: InvestigationOrderCreate) =>
      apiFetch<InvestigationOrderOut>(`/api/encounters/${encounterId}/investigations`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['encounter-investigations', encounterId] })
      const targetPatientId = patientId ?? data.patient_id
      qc.invalidateQueries({ queryKey: ['patient-investigations', targetPatientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', targetPatientId] })
    },
  })
}

/** PATCH /api/investigations/{orderId}/status (DOCTOR only, optimistic version_id). */
export function useUpdateInvestigationStatus(patientId?: number, encounterId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: number; body: InvestigationStatusUpdate }) =>
      apiFetch<InvestigationOrderOut>(`/api/investigations/${orderId}/status`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: (data) => {
      const targetPatientId = patientId ?? data.patient_id
      const targetEncounterId = encounterId ?? data.encounter_id
      qc.invalidateQueries({ queryKey: ['patient-investigations', targetPatientId] })
      qc.invalidateQueries({ queryKey: ['encounter-investigations', targetEncounterId] })
    },
  })
}

/** POST /api/investigations/{orderId}/results (DOCTOR only, append-only result). */
export function useRecordInvestigationResult(patientId?: number, encounterId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ orderId, body }: { orderId: number; body: InvestigationResultCreate }) =>
      apiFetch<InvestigationResultOut>(`/api/investigations/${orderId}/results`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data) => {
      const targetPatientId = patientId ?? data.patient_id
      qc.invalidateQueries({ queryKey: ['patient-investigations', targetPatientId] })
      if (encounterId !== undefined) {
        qc.invalidateQueries({ queryKey: ['encounter-investigations', encounterId] })
      } else {
        qc.invalidateQueries({ queryKey: ['encounter-investigations'] })
      }
    },
  })
}

/** POST /api/prescriptions/{prescriptionId}/amend (DOCTOR only, creates versioned revision). */
export function useAmendPrescription(patientId?: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      prescriptionId,
      body,
    }: {
      prescriptionId: number
      body: PrescriptionAmendRequest
    }) =>
      apiFetch<PrescriptionOut>(`/api/prescriptions/${prescriptionId}/amend`, {
        method: 'POST',
        body,
      }),
    onSuccess: (data, variables) => {
      qc.setQueryData(['prescription', data.id], data)
      qc.invalidateQueries({ queryKey: ['prescription', variables.prescriptionId] })
      const targetPatientId = patientId ?? data.patient_id
      qc.invalidateQueries({ queryKey: ['patient-prescriptions', targetPatientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', targetPatientId] })
      qc.invalidateQueries({ queryKey: ['timeline', targetPatientId] })
      if (data.encounter_id) {
        qc.invalidateQueries({ queryKey: ['encounter-prescription', data.encounter_id] })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Milestone 3: Append-Only Patient Financial Ledger & Admin Refunds
// ---------------------------------------------------------------------------

/** GET /api/patients/{patientId}/ledger (ADMIN + RECEPTION with payment:read). */
export function usePatientLedger(
  patientId: number | null,
  params?: { limit?: number; offset?: number; order?: 'desc' | 'asc' },
  enabled: boolean = true,
) {
  const searchParams = new URLSearchParams()
  if (params?.limit !== undefined) searchParams.set('limit', String(params.limit))
  if (params?.offset !== undefined) searchParams.set('offset', String(params.offset))
  if (params?.order !== undefined) searchParams.set('order', params.order)
  const qs = searchParams.toString() ? `?${searchParams.toString()}` : ''

  return useQuery({
    queryKey: ['patient-ledger', patientId, params],
    queryFn: () =>
      apiFetch<PatientLedgerResponse>(`/api/patients/${patientId}/ledger${qs}`),
    enabled: enabled && patientId !== null && patientId > 0,
  })
}

/** POST /api/payments/{paymentId}/refunds (ADMIN only, payment:refund, D-06). */
export function useCreatePaymentRefund(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ paymentId, body }: { paymentId: number; body: RefundCreateRequest }) =>
      apiFetch<RefundOut>(`/api/payments/${paymentId}/refunds`, {
        method: 'POST',
        body,
      }),
    onSuccess: (refund) => {
      qc.invalidateQueries({ queryKey: ['patient-ledger', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-summary', patientId] })
      qc.invalidateQueries({ queryKey: ['patient-payments', patientId] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['patient-visits', patientId] })
      qc.invalidateQueries({ queryKey: ['visits'] })
      qc.invalidateQueries({ queryKey: ['visit-bill'] })
      if (refund.visit_id != null) {
        qc.invalidateQueries({ queryKey: ['visit-bill', refund.visit_id] })
      }
      qc.invalidateQueries({ queryKey: ['billing'] })
      qc.invalidateQueries({ queryKey: ['timeline', patientId] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

// ---------------------------------------------------------------------------
// Milestone 4: Patient Documents & Unified Visit Workspace
// ---------------------------------------------------------------------------

/** GET /api/patients/{patientId}/documents?include_archived=... (DOCUMENT_READ). */
export function usePatientDocuments(
  patientId: number | null,
  includeArchived: boolean = false,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ['patient-documents', patientId, { includeArchived }],
    queryFn: () =>
      apiFetch<PatientDocumentOut[]>(
        `/api/patients/${patientId}/documents?include_archived=${includeArchived ? 'true' : 'false'}`,
      ),
    enabled: enabled && patientId !== null && patientId > 0,
  })
}

/** POST /api/patients/{patientId}/documents (multipart FormData with CSRF via apiFetch). */
export function useUploadPatientDocument(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PatientDocumentUploadInput) => {
      const formData = new FormData()
      formData.append('file', input.file)
      formData.append('title', input.title)
      formData.append('category', input.category)
      formData.append('is_clinical', String(Boolean(input.is_clinical)))
      if (input.visit_id != null) {
        formData.append('visit_id', String(input.visit_id))
      }
      if (input.encounter_id != null) {
        formData.append('encounter_id', String(input.encounter_id))
      }
      if (input.notes != null && input.notes.trim() !== '') {
        formData.append('notes', input.notes)
      }
      return apiFetch<PatientDocumentOut>(`/api/patients/${patientId}/documents`, {
        method: 'POST',
        body: formData,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-documents', patientId] })
    },
  })
}

/** POST /api/documents/{documentId}/archive (soft-archive; retains bytes on disk). */
export function useArchivePatientDocument(patientId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (documentId: number) =>
      apiFetch<PatientDocumentOut>(`/api/documents/${documentId}/archive`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient-documents', patientId] })
    },
  })
}

function parseContentDispositionFilename(header: string | null, fallback: string): string {
  if (!header) return fallback
  const starMatch = /filename\*\s*=\s*(?:UTF-8'')?([^;\s]+)/i.exec(header)
  if (starMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(starMatch[1].replace(/^["']|["']$/g, ''))
      if (decoded.trim()) return decoded.trim()
    } catch {
      // fall through to standard filename= parsing
    }
  }
  const quotedMatch = /filename\s*=\s*"([^"]+)"/i.exec(header)
  if (quotedMatch?.[1]?.trim()) return quotedMatch[1].trim()
  const bareMatch = /filename\s*=\s*([^;\s]+)/i.exec(header)
  if (bareMatch?.[1]?.trim()) return bareMatch[1].trim()
  return fallback
}

/**
 * Authenticated binary fetch for GET /api/documents/{documentId}/download.
 * Returns an Object URL suitable for image modal preview or new-tab PDF open;
 * callers must call URL.revokeObjectURL(url) on close/unmount.
 */
export async function downloadPatientDocumentBlob(
  documentId: number,
): Promise<{ blob: Blob; url: string; filename: string; contentType: string }> {
  const res = await fetch(`/api/documents/${documentId}/download`, {
    credentials: 'same-origin',
  })

  if (!res.ok) {
    let errData: Record<string, unknown> = {}
    try {
      const text = await res.text()
      if (text) {
        const parsed: unknown = JSON.parse(text)
        if (typeof parsed === 'object' && parsed !== null) {
          errData = parsed as Record<string, unknown>
        }
      }
    } catch {
      errData = {}
    }
    const code = typeof errData.code === 'string' ? errData.code : 'error'
    const message =
      typeof errData.message === 'string'
        ? errData.message
        : res.statusText || 'Failed to download document'
    throw new ApiError(res.status, code, message, errData)
  }

  const blob = await res.blob()
  const contentType = res.headers.get('Content-Type') || blob.type || 'application/octet-stream'
  const filename = parseContentDispositionFilename(
    res.headers.get('Content-Disposition'),
    `document-${documentId}`,
  )
  const url = URL.createObjectURL(blob)
  return { blob, url, filename, contentType }
}

/** GET /api/patients/{patientId}/visits/{visitId}/workspace (role-redacted unified visit view). */
export function useVisitWorkspace(
  patientId: number | null,
  visitId: number | null,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ['visit-workspace', patientId, visitId],
    queryFn: () =>
      apiFetch<VisitWorkspaceOut>(
        `/api/patients/${patientId}/visits/${visitId}/workspace`,
      ),
    enabled:
      (options?.enabled ?? true) &&
      patientId !== null &&
      patientId > 0 &&
      visitId !== null &&
      visitId > 0,
  })
}

// ---------------------------------------------------------------------------
// Phase 3: Persistent Clinical Quick Phrases (DOCTOR-scoped)
// ---------------------------------------------------------------------------

/** GET /api/quick-phrases?section=...&department_id=... (returns { defaults, personal }). */
export function useQuickPhrases(
  departmentId: number | null,
  section: QuickPhraseSection = 'COMPLAINTS',
  enabled: boolean = true,
) {
  const normalizedDeptId = departmentId != null && departmentId > 0 ? departmentId : null
  return useQuery({
    queryKey: ['quick-phrases', normalizedDeptId, section],
    queryFn: () => {
      const params = new URLSearchParams({ section })
      if (normalizedDeptId !== null) {
        params.set('department_id', String(normalizedDeptId))
      }
      return apiFetch<QuickPhraseListResponse>(`/quick-phrases?${params.toString()}`)
    },
    enabled,
  })
}

/** POST /api/quick-phrases: create a doctor-owned personal quick phrase. */
export function useCreateQuickPhrase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: QuickPhraseCreate) =>
      apiFetch<QuickPhraseOut>('/quick-phrases', {
        method: 'POST',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-phrases'] })
    },
  })
}

/** PATCH /api/quick-phrases/{id}: update own personal quick phrase. */
export function useUpdateQuickPhrase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: QuickPhraseUpdate }) =>
      apiFetch<QuickPhraseOut>(`/quick-phrases/${id}`, {
        method: 'PATCH',
        body,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-phrases'] })
    },
  })
}

/** DELETE /api/quick-phrases/{id}: soft-delete own personal quick phrase. */
export function useDeleteQuickPhrase() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<void>(`/quick-phrases/${id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quick-phrases'] })
    },
  })
}





