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

// ==========================================
// Phase 14: Prescriptions & Treatment Types
// ==========================================

export interface PrescriptionItemCreate {
  item_order: number
  medicine_name: string
  dosage: string
  frequency: string
  duration_days: number
  instructions?: string | null
}

export interface PrescriptionItemOut {
  id: number
  prescription_id: number
  item_order: number
  medicine_name: string
  dosage: string
  frequency: string
  duration_days: number
  instructions: string | null
}

export interface PrescriptionCreate {
  patient_id: number
  encounter_id?: number | null
  diagnosis: string
  dietary_advice?: string | null
  general_advice?: string | null
  follow_up_date?: string | null
  items: PrescriptionItemCreate[]
}

export interface PrescriptionOut {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_id: number
  doctor_name: string
  encounter_id: number | null
  diagnosis: string
  dietary_advice: string | null
  general_advice: string | null
  follow_up_date: string | null
  version_id: number
  created_at: string
  updated_at: string
  items: PrescriptionItemOut[]
}

export interface PrescriptionSummary {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_id: number
  doctor_name: string
  encounter_id: number | null
  diagnosis: string
  items_count: number
  follow_up_date: string | null
  created_at: string
}

export type TreatmentPlanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED'

export interface TreatmentPlanCreate {
  patient_id: number
  encounter_id?: number | null
  plan_name: string
  condition_diagnosis: string
  referred_by?: string | null
  total_sessions: number
  agreed_price_paise: number
}

export interface TreatmentPlanUpdate {
  version_id: number
  plan_name?: string
  condition_diagnosis?: string
  referred_by?: string
  total_sessions?: number
  status?: TreatmentPlanStatus
  cancellation_reason?: string
}

export interface TreatmentPlanOut {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_id: number
  doctor_name: string
  encounter_id: number | null
  plan_name: string
  condition_diagnosis: string
  referred_by: string | null
  total_sessions: number
  completed_sessions: number
  agreed_price_paise: number
  status: string
  cancellation_reason: string | null
  version_id: number
  created_at: string
  updated_at: string
}

export interface TreatmentSessionAddendumCreate {
  note: string
}

export interface TreatmentSessionAddendumOut {
  id: number
  session_id: number
  author_user_id: number
  author_name: string
  note: string
  created_at: string
}

export interface TreatmentSessionCreate {
  session_date?: string | null
  vas_score: number
  modalities?: string[]
  clinical_notes: string
}

export interface TreatmentSessionOut {
  id: number
  treatment_plan_id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_id: number
  doctor_name: string
  session_number: number
  session_date: string
  vas_score: number
  modalities: string[]
  clinical_notes: string
  is_finalised: boolean
  created_by_user_id: number
  created_by_username: string
  created_at: string
  addenda: TreatmentSessionAddendumOut[]
}


// Phase 15: Billing, Receipts, and Reversals Contracts
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD'

export interface PaymentCreate {
  patient_id: number
  treatment_plan_id?: number | null
  appointment_id?: number | null
  amount_paise: number
  payment_method: PaymentMethod
  notes?: string | null
}

export interface PaymentReversalCreate {
  reversal_reason: string
}

export interface PaymentOut {
  id: number
  receipt_number: string
  patient_id: number
  patient_urn: string
  patient_name: string
  treatment_plan_id: number | null
  treatment_plan_name: string | null
  appointment_id: number | null
  amount_paise: number
  payment_method: PaymentMethod
  notes: string | null
  is_reversed: boolean
  reversal_reason: string | null
  reversed_by_username: string | null
  reversed_at: string | null
  created_by_username: string
  created_at: string
}

export interface PendingDueOut {
  treatment_plan_id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  plan_name: string
  condition_diagnosis: string | null
  agreed_price_paise: number
  paid_paise: number
  balance_paise: number
  total_sessions: number
  completed_sessions: number
}

export interface TimelineItemOut {
  id: string
  event_type: 'APPOINTMENT' | 'ENCOUNTER' | 'PRESCRIPTION' | 'TREATMENT_PLAN' | 'TREATMENT_SESSION' | 'PAYMENT'
  event_date: string
  title: string
  subtitle?: string | null
  summary?: string | null
  badge?: string | null
  badge_variant?: 'default' | 'secondary' | 'destructive' | 'outline' | null
  metadata: Record<string, unknown>
}

// Phase 16: Audit Viewer, Backup/Restore & Integrity Contracts
export interface AuditLogOut {
  id: number
  occurred_at: string
  actor_user_id: string | null
  actor_username: string
  actor_role: Role
  action: string
  outcome: string
  entity_type: string
  entity_id: string | null
  before_data: Record<string, unknown> | null
  after_data: Record<string, unknown> | null
  reason: string | null
  request_id: string | null
  ip: string | null
  user_agent: string | null
}

export interface AuditLogListResponse {
  items: AuditLogOut[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface BackupArchiveInfo {
  filename: string
  filepath: string
  size_bytes: number
  created_at: string
  label?: string | null
  is_valid: boolean
  manifest?: Record<string, unknown> | null
}

export interface BackupArchiveListResponse {
  backups: BackupArchiveInfo[]
  total_count: number
  backup_dir: string
}

export interface BackupCreateRequest {
  label?: string | null
  destination_dir?: string | null
}

export interface RestoreRequest {
  archive_filename: string
  create_prerestore_snapshot?: boolean
  confirmation_phrase: 'RESTORE-DATABASE-OVERWRITE'
  justification: string
}

export interface RestoreResultOut {
  status: string
  archive_restored: string
  prerestore_snapshot?: string | null
  database_restored: boolean
  photos_restored_count: number
  manifest?: Record<string, unknown> | null
}

export interface IntegrityCheckItemOut {
  name: string
  passed: boolean
  details: string
  discrepancies: Record<string, unknown>[]
}

export interface IntegrityReportOut {
  generated_at: string
  is_healthy: boolean
  total_checks: number
  passed_checks: number
  failed_checks: number
  checks: IntegrityCheckItemOut[]
}
