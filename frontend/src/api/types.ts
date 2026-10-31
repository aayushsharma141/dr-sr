/**
 * Typed domain contracts and API error codes for Kalyan Hospital Management System.
 * Matches backend schemas and permissions exactly.
 */

export type Role = 'ADMIN' | 'RECEPTION' | 'DOCTOR'

export type ApiErrorCode =
  | 'not_authenticated'
  | 'session_expired'
  | 'invalid_credentials'
  | 'too_many_attempts'
  | 'password_change_required'
  | 'forbidden'
  | 'csrf_failed'
  | 'not_found'
  | 'version_conflict'
  | 'username_taken'
  | 'last_admin'
  | 'self_action_forbidden'
  | 'role_change_not_allowed'
  | 'state_unchanged'
  | 'password_policy'
  | 'current_password_invalid'
  | 'validation_error'
  | 'setup_closed'
  | 'setup_code_invalid'
  | 'error'

export interface Me {
  id: number
  username: string
  full_name: string
  role: Role
  doctor_id: number | null
  permissions: string[]
  must_change_password: boolean
  csrf_token: string
  version_id: number
}

export interface RoleUserCounts {
  active: number
  inactive: number
}

export interface AdminOverview {
  area: 'admin'
  name: string
  role: string
  user_counts: Record<string, RoleUserCounts>
}

export interface ReceptionOverview {
  area: 'reception'
  name: string
  role: string
}

export interface DoctorOverview {
  area: 'doctor'
  name: string
  role: string
  doctor_id: number
  doctor_name_en: string
}

export type AreaOverview = AdminOverview | ReceptionOverview | DoctorOverview

export interface UserOut {
  id: number
  username: string
  full_name: string
  role: Role
  doctor_id: number | null
  is_active: boolean
  must_change_password: boolean
  is_locked: boolean
  last_login_at: string | null
  created_at: string
  version_id: number
}

export interface UserCreatedOut extends UserOut {
  temporary_password: string
}

export interface UserCreate {
  username: string
  full_name: string
  role: Role
  doctor_name_en?: string | null
}

export interface UserUpdate {
  version_id: number
  full_name?: string
  role?: Role
}

export interface ActionRequest {
  version_id: number
}

export interface SetupStatusResponse {
  setup_required: boolean
}

export interface SetupAdminRequest {
  setup_code: string
  username: string
  full_name: string
  password: string
}
