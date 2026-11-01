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


export interface ClinicSettingsOut {
  id: number
  name_en: string
  name_hi: string
  address_1: string
  address_2: string | null
  phone: string
  email: string | null
  receipt_sequence_cycle: 'FINANCIAL_YEAR' | 'CALENDAR_YEAR'
  print_header_en: string | null
  print_header_hi: string | null
  print_footer_en: string | null
  print_footer_hi: string | null
  consultation_validity_days: number
  version_id: number
  created_at: string
  updated_at: string
}

export interface ClinicSettingsUpdate {
  name_en: string
  name_hi: string
  address_1: string
  address_2?: string | null
  phone: string
  email?: string | null
  receipt_sequence_cycle: 'FINANCIAL_YEAR' | 'CALENDAR_YEAR'
  print_header_en?: string | null
  print_header_hi?: string | null
  print_footer_en?: string | null
  print_footer_hi?: string | null
  consultation_validity_days: number
  version_id: number
}

export interface DoctorOut {
  id: number
  name_en: string
  name_hi: string | null
  qualification: string | null
  registration_number: string | null
  default_fee_paise: number
  is_active: boolean
  version_id: number
  created_at: string
  updated_at: string
}

export interface DoctorCreate {
  name_en: string
  name_hi?: string | null
  qualification?: string | null
  registration_number?: string | null
  default_fee_paise?: number
}

export interface DoctorUpdate {
  name_en: string
  name_hi?: string | null
  qualification?: string | null
  registration_number?: string | null
  default_fee_paise: number
  is_active: boolean
  version_id: number
}

export interface FeeOut {
  id: number
  name: string
  fee_paise: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface FeeCreate {
  name: string
  fee_paise: number
}

export interface FeeUpdate {
  name: string
  fee_paise: number
  is_active?: boolean
}


export interface PatientOut {
  id: number
  urn: string
  full_name: string
  guardian_name: string
  gender: 'M' | 'F' | 'O'
  dob: string | null
  age_years: number
  mobile: string
  address: string
  district: string
  state: string
  emergency_contact: string | null
  allergies: string
  notes: string | null
  photo_path: string | null
  is_active: boolean
  version_id: number
  created_at: string
  updated_at: string
}

export interface PatientCreate {
  full_name: string
  guardian_name: string
  gender: 'M' | 'F' | 'O'
  dob?: string | null
  age_years: number
  mobile: string
  address: string
  district: string
  state: string
  emergency_contact?: string | null
  allergies: string
  notes?: string | null
}

export interface PatientUpdate {
  version_id: number
  full_name?: string
  guardian_name?: string
  gender?: 'M' | 'F' | 'O'
  dob?: string | null
  age_years?: number
  mobile?: string
  address?: string
  district?: string
  state?: string
  emergency_contact?: string | null
  allergies?: string
  notes?: string | null
  is_active?: boolean
}

export interface DuplicateCheckResponse {
  has_duplicate: boolean
  matching_patient: PatientOut | null
}

// ==============================================================================
// Appointments & Encounters (Phase 13)
// ==============================================================================

export type AppointmentStatus =
  | 'BOOKED'
  | 'ARRIVED'
  | 'IN_CONSULTATION'
  | 'DONE'
  | 'CANCELLED'
  | 'NO_SHOW'

export interface Appointment {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  patient_mobile: string
  doctor_id: number
  doctor_name_en: string
  doctor_name_hi: string | null
  appointment_date: string
  token_number: number
  status: AppointmentStatus
  status_updated_at: string
  cancellation_reason: string | null
  notes: string | null
  version_id: number
  created_at: string
  updated_at: string
}

export interface AppointmentCreate {
  patient_id: number
  doctor_id: number
  appointment_date: string
  notes?: string | null
}

export interface AppointmentStatusUpdate {
  status: AppointmentStatus
  version_id: number
  cancellation_reason?: string | null
}

export interface AppointmentListResponse {
  total: number
  appointments: Appointment[]
}

export interface DoctorQueueItem {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  patient_gender: string
  patient_age: number
  patient_mobile: string
  patient_allergies: string
  token_number: number
  status: AppointmentStatus
  status_updated_at: string
  notes: string | null
  version_id: number
}

export interface DoctorQueueResponse {
  doctor_id: number
  doctor_name: string
  queue_date: string
  in_consultation: DoctorQueueItem[]
  waiting: DoctorQueueItem[]
  booked: DoctorQueueItem[]
  completed: DoctorQueueItem[]
  total_active: number
}

export interface EncounterCreate {
  patient_id: number
  appointment_id?: number | null
  symptoms: string
  clinical_notes: string
  diagnosis: string
}

export interface EncounterUpdate {
  version_id: number
  symptoms?: string
  clinical_notes?: string
  diagnosis?: string
}

export interface AddendumCreate {
  addendum_text: string
}

export interface AddendumRead {
  id: number
  encounter_id: number
  doctor_id: number
  doctor_name: string
  addendum_text: string
  created_at: string
}

export interface EncounterRead {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_id: number
  doctor_name: string
  appointment_id: number | null
  encounter_date: string
  symptoms: string
  clinical_notes: string
  diagnosis: string
  is_finalised: boolean
  finalised_at: string | null
  version_id: number
  created_at: string
  updated_at: string
  addenda: AddendumRead[]
}

export interface EncounterSummary {
  id: number
  patient_id: number
  doctor_id: number
  doctor_name: string
  encounter_date: string
  diagnosis: string
  is_finalised: boolean
  finalised_at: string | null
  addenda_count: number
}
