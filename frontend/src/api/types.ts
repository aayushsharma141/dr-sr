/**
 * Typed domain contracts and API error codes for Kalyan Hospital Management System.
 * Matches backend schemas and permissions exactly.
 */

import type { BillPaymentOut } from './bill'

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
  | 'session_not_found'
  | 'cannot_revoke_current_session'
  | 'receipt_cycle_change_requires_confirmation'
  | 'invalid_archive_filename'
  | 'invalid_destination_dir'
  | 'invalid_backup_label'
  | 'backup_failed'
  | 'restore_failed'
  | 'backup_corrupted'
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

export interface DoctorTodayOut {
  doctor_id: number
  name: string
  /** All statuses for the IST business day. */
  appointments_today: number
  /** BOOKED + ARRIVED. */
  waiting: number
  in_consultation: number
  done: number
  arrived_waiting?: number
  pending_arrivals?: number
  department?: string
  next_token?: number | null
}

export interface HourlyCollectionPoint {
  hour: string
  amount_paise: number
  count: number
}

/**
 * Today's ledger activity (IST), reported without any netting rule:
 * gross covers payments CREATED today (including ones later reversed); reversals cover
 * payments REVERSED today, whatever day they were collected.
 */
export interface CollectionsTodayOut {
  payments_count: number
  gross_paise: number
  reversals_count: number
  reversed_paise: number
  /** Gross paise per payment method (CASH, UPI, CARD). */
  by_method: Record<string, number>
}

export interface RecentAdminActionOut {
  occurred_at: string
  actor_username: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  outcome: string
}

export interface LastBackupOut {
  filename: string
  created_at: string
  size_bytes: number
  label: string | null
  manifest_readable: boolean
}

export interface LastIntegrityCheckOut {
  occurred_at: string
  outcome: string
  is_healthy: boolean | null
}

export interface StorageFreeOut {
  data_free_bytes: number | null
  backup_free_bytes: number | null
}

/** Known alert codes. The backend field is a plain string, so other values must be tolerated. */
export type OverviewAlertCode =
  | 'no_backup_yet'
  | 'last_backup_failed'
  | 'accounts_locked'
  | 'integrity_issues'

export interface OverviewAlertOut {
  code: string
  /** 'warning' | 'error' today; typed as string to mirror the backend schema. */
  severity: string
  message: string
}

export interface AdminOverview {
  area: 'admin'
  name: string
  role: string
  user_counts: Record<string, RoleUserCounts>
  /** IST business date, YYYY-MM-DD. */
  business_date: string
  registrations_today: number
  /** Count per AppointmentStatus for today. */
  appointments_today: Record<string, number>
  /** Every active doctor, ordered by id. */
  doctors_today: DoctorTodayOut[]
  collections_today: CollectionsTodayOut
  /** Sum of balance_paise from /billing/pending-dues. */
  outstanding_dues_paise: number
  locked_accounts: number
  failed_logins_24h: number
  /** Max 10, ADMIN actors, newest first. */
  recent_admin_actions: RecentAdminActionOut[]
  last_backup: LastBackupOut | null
  last_backup_failure_at: string | null
  last_integrity_check: LastIntegrityCheckOut | null
  storage: StorageFreeOut
  alerts: OverviewAlertOut[]
}

/** A monthly figure next to the previous month's; change_pct is null when last month was 0. */
export interface MonthOverMonth {
  current: number
  previous: number
  change_pct: number | null
}

export interface CollectionTrendMonth {
  month: string
  collected_paise: number
}

/** Collected this month against appointments in a department; null id = not linked to one. */
export interface DepartmentCollection {
  department_id: number | null
  name: string
  collected_paise: number
  percentage: number
}

export interface PatientTrendMonth {
  month: string
  new_patients: number
}

/** Monthly figures, every one computed from records. The hospital records no expenses. */
export interface ManagementOverview {
  current_month_label: string
  previous_month_label: string
  collections_paise: MonthOverMonth
  reversed_this_month: number
  reversed_this_month_paise: number
  collection_trend: CollectionTrendMonth[]
  department_collections: DepartmentCollection[]
  new_patients: MonthOverMonth
  returning_patients_this_month: number
  patient_trend: PatientTrendMonth[]
}

export interface ReceptionOverview {
  area: 'reception'
  name: string
  role: string
  business_date?: string
  registrations_today?: number
  appointments_today?: Record<string, number>
  doctors_today?: DoctorTodayOut[]
  collections_today?: CollectionsTodayOut
  outstanding_dues_paise?: number
  hourly_collections?: HourlyCollectionPoint[]
  alerts?: OverviewAlertOut[]
}

export interface DoctorOverview {
  area: 'doctor'
  name: string
  role: string
  doctor_id: number
  department_id: number | null
  doctor_name_en: string
}

export interface DoctorDashboardTodayGlance {
  total: number
  completed: number
  in_progress: number
  pending: number
}

export interface DoctorDashboardSummary {
  doctor_id: number
  doctor_name_en: string
  specialty_name: string
  waiting_count: number
  in_consultation_count: number
  scheduled_count: number
  completed_count: number
  pending_drafts_count: number
  today_glance: DoctorDashboardTodayGlance
}

export type AreaOverview = AdminOverview | ReceptionOverview | DoctorOverview

export interface UserOut {
  id: number
  username: string
  full_name: string
  role: Role
  doctor_id: number | null
  is_active: boolean
  /** The administrator whose password authorises deleting user accounts. */
  is_super_admin: boolean
  must_change_password: boolean
  is_locked: boolean
  /** Non-null only while the lock is in effect. */
  locked_until: string | null
  last_login_at: string | null
  password_changed_at: string | null
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
  /** Optional justification (max 500 chars; blank becomes null) stored on the audit row. */
  reason?: string | null
}

export interface DeleteUserRequest extends ActionRequest {
  /** Password of the super admin account; never stored or logged. */
  super_admin_password: string
}

export interface BulkDeleteUsersRequest {
  items: { id: number; version_id: number }[]
  reason?: string | null
  /** Password of the super admin account; checked once for the whole batch, never stored. */
  super_admin_password: string
}

export interface BulkDeleteEntry {
  id: number
  username: string | null
  deleted: boolean
  /** Why an account was skipped (null when deleted). */
  code: string | null
  message: string | null
}

export interface BulkDeleteUsersOut {
  deleted_count: number
  skipped_count: number
  results: BulkDeleteEntry[]
}

export interface DeleteUserOut {
  id: number
  username: string
  deleted: boolean
}

export const ADMIN_REASON_MAX_LENGTH = 500

export type LoginHistoryOutcome = 'SUCCESS' | 'FAILURE' | 'DENIED'

export interface LoginHistoryEntry {
  id: number
  occurred_at: string
  action: string
  /** SUCCESS | FAILURE | DENIED (backend field is a plain string). */
  outcome: string
  actor_username: string | null
  ip_address: string | null
  user_agent: string | null
  reason: string | null
  /** Allow-listed scalar keys only (reason, failed_login_count, locked_until, session_id, ...). */
  details: Record<string, string | number | boolean | null>
}

// Admin module 02: read-only role & permission catalogue (GET /roles/permissions)
export interface RoleInfo {
  role: Role
  label: string
}

export interface PermissionInfo {
  key: string
  group: string
  label: string
}

export interface RolePermissionsOut {
  roles: RoleInfo[]
  permissions: PermissionInfo[]
  /** role -> sorted permission keys granted to it. */
  grants: Record<string, string[]>
}

// Admin module 09: sessions & security policy
export interface ActiveSessionOut {
  id: number
  user_id: number
  username: string
  full_name: string
  role: Role
  ip_address: string | null
  user_agent: string | null
  created_at: string
  last_seen_at: string
  idle_expires_at: string
  absolute_expires_at: string
  is_current: boolean
}

export interface RevokeSessionRequest {
  /** Optional justification (max 500 chars; blank becomes null). */
  reason?: string | null
}

export interface RevokeSessionOut {
  id: number
  user_id: number
  revoked_at: string
}

export interface RevokeUserSessionsOut {
  user_id: number
  revoked_count: number
  kept_current_session: boolean
}

export interface SecurityPolicyOut {
  session_idle_minutes: number
  session_absolute_hours: number
  lockout_threshold: number
  lockout_minutes: number
  throttle_max_failures: number
  throttle_window_minutes: number
  password_min_length: number
  password_max_length: number
  source: 'environment' | 'administrator'
  editable: true
  limits: Record<SecurityPolicyField, PolicyFieldLimits>
  version_id: number
  updated_at: string
}

export type SecurityPolicyField =
  | 'session_idle_minutes'
  | 'session_absolute_hours'
  | 'lockout_threshold'
  | 'lockout_minutes'
  | 'password_min_length'

export interface PolicyFieldLimits {
  baseline: number
  minimum: number
  maximum: number
}

export type SecurityPolicyUpdate = Record<SecurityPolicyField, number> & {
  version_id: number
  reason: string
}

export interface PasswordPolicyOut {
  min_length: number
  max_length: number
}

// Admin module 12: system health (GET /system/status)
export interface StorageVolumeOut {
  /** 'photos' | 'backups' */
  label: string
  path_label: string
  total_bytes: number | null
  free_bytes: number | null
}

export interface SystemStatusOut {
  app_version: string
  environment: string
  db_revision: string | null
  code_head_revision: string | null
  revision_matches: boolean
  postgres_version: string
  db_size_bytes: number
  db_connections: number
  server_time_utc: string
  server_time_ist: string
  process_started_at: string
  uptime_seconds: number
  storage: StorageVolumeOut[]
  frontend_served: boolean
  checks: ServiceCheckOut[]
}

export interface ServiceCheckOut {
  key: string
  label: string
  status: 'ok' | 'warning' | 'error' | 'not_configured'
  detail: string
}

export interface BackupSettingsOut {
  schedule_enabled: boolean
  frequency: 'DAILY' | 'WEEKLY'
  run_at: string
  weekly_day: number | null
  destination_dir: string | null
  retention_count: number | null
  version_id: number
  updated_at: string
  next_run_at: string | null
  overdue: boolean
  approved_destinations: string[]
}

export interface BackupSettingsUpdate {
  version_id: number
  schedule_enabled: boolean
  frequency: 'DAILY' | 'WEEKLY'
  run_at: string
  weekly_day: number | null
  destination_dir: string | null
  retention_count: number | null
  reason: string
}

export interface BackupRunOut {
  id: number
  trigger: 'MANUAL' | 'SCHEDULED'
  outcome: 'RUNNING' | 'SUCCESS' | 'FAILURE'
  started_at: string
  finished_at: string | null
  filename: string | null
  size_bytes: number | null
  copied_to: string | null
  pruned_count: number
  error_type: string | null
}

export interface BillingConfigurationOut {
  receipt_sequence_cycle: 'FINANCIAL_YEAR' | 'CALENDAR_YEAR'
  current_cycle_key: string
  receipts_issued_in_cycle: number
  next_receipt_number: string
  payment_methods: string[]
  reversal_roles: string[]
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
  trust_name_en: string
  trust_name_hi: string | null
  location_line: string
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
  token_reset_policy?: 'DAILY'
  version_id: number
  created_at: string
  updated_at: string
}

export interface ClinicSettingsUpdate {
  name_en: string
  name_hi: string
  trust_name_en?: string
  trust_name_hi?: string | null
  location_line?: string
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
  token_reset_policy?: 'DAILY'
  version_id: number
  /** Must be true when the cycle changes after receipts exist in the current cycle. */
  confirm_receipt_cycle_change?: boolean
  /** Required non-blank (max 500) when confirm_receipt_cycle_change is true; stored on the audit row. */
  change_reason?: string | null
}

/** Extra fields on the 409 receipt_cycle_change_requires_confirmation error envelope. */
export interface ReceiptCycleConfirmationExtra {
  current_cycle: string
  current_cycle_key: string
  requested_cycle: string
  receipts_issued: number
}

export interface DepartmentOut {
  id: number
  /** Stable machine code, e.g. PHYSIOTHERAPY; picks the consultation template. */
  code: string
  name_en: string
  name_hi: string | null
  description: string | null
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  version_id: number
}

export interface DepartmentCreate {
  name_en: string
  name_hi?: string | null
  description?: string | null
}

export interface DepartmentUpdate extends DepartmentCreate {
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  version_id: number
}

export interface DoctorDepartmentAssignment {
  department_ids: number[]
  version_id: number
}

export interface DepartmentDoctorOut {
  id: number
  name_en: string
  name_hi: string | null
  qualification: string | null
  cabin_code?: string | null
  default_fee_paise: number
}

export interface DoctorOut {
  id: number
  name_en: string
  name_hi: string | null
  qualification: string | null
  registration_number: string | null
  cabin_code?: string | null
  default_fee_paise: number
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  version_id: number
  created_at: string
  updated_at: string
}

export interface DoctorCreate {
  name_en: string
  name_hi?: string | null
  qualification?: string | null
  registration_number?: string | null
  cabin_code?: string | null
  default_fee_paise?: number
}

export interface DoctorUpdate {
  name_en: string
  name_hi?: string | null
  qualification?: string | null
  registration_number?: string | null
  cabin_code?: string | null
  default_fee_paise: number
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  version_id: number
}

export interface DoctorMeSettingsUpdate {
  default_fee_paise: number
  version_id: number
}

export interface FeeOut {
  id: number
  name: string
  fee_paise: number
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  version_id: number
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
  /** Required: the fee's current version_id (a stale value gives 409 version_conflict). */
  version_id: number
}


export interface PatientOut {
  id: number
  urn: string
  legacy_urn?: string | null
  full_name: string
  guardian_name: string
  gender: 'M' | 'F' | 'O'
  dob: string | null
  age_years: number
  /** Birthday-aware age derived from dob (IST today) with age_years fallback; always returned by backend. */
  computed_age_years?: number
  mobile: string
  address: string
  district: string
  state: string
  emergency_contact: string | null
  alternate_mobile?: string | null
  email?: string | null
  blood_group?: string | null
  pin_code?: string | null
  guardian_relationship?: string | null
  medical_history_notes?: string | null
  allergies: string
  notes: string | null
  photo_path: string | null
  is_active: boolean
  merged_into_id?: number | null
  merged_into_urn?: string | null
  merged_at?: string | null
  merge_reason?: string | null
  is_archived?: boolean
  archived_at?: string | null
  archive_reason?: string | null
  visit_count?: number | null
  last_visit_date?: string | null
  outstanding_paise?: number | null
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
  alternate_mobile?: string | null
  email?: string | null
  blood_group?: string | null
  pin_code?: string | null
  guardian_relationship?: string | null
  medical_history_notes?: string | null
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
  alternate_mobile?: string | null
  email?: string | null
  blood_group?: string | null
  pin_code?: string | null
  guardian_relationship?: string | null
  medical_history_notes?: string | null
  allergies?: string
  notes?: string | null
  is_active?: boolean
}

// ==============================================================================
// Patient Workspace & Structured Clinical Allergies (Milestone 1)
// ==============================================================================

export type AllergyCategory = 'DRUG' | 'FOOD' | 'ENVIRONMENTAL' | 'OTHER'
export type AllergySeverity = 'MILD' | 'MODERATE' | 'SEVERE' | 'LIFE_THREATENING'
export type AllergyStatus = 'ACTIVE' | 'INACTIVE' | 'RESOLVED'

/** Safety-alert-only allergy projection (RECEPTION & DOCTOR; strictly null for ADMIN). */
export interface AllergySafetyAlertOut {
  has_allergies: boolean
  count: number
  highest_severity: AllergySeverity | null
  alert_labels: string[]
}

/** Full structured clinical allergy record (DOCTOR only under D-04). */
export interface PatientAllergyOut {
  id: number
  patient_id: number
  substance: string
  category: AllergyCategory
  severity: AllergySeverity
  reaction: string | null
  clinical_notes: string | null
  status: AllergyStatus
  doctor_id: number | null
  recorded_by_user_id: number | null
  recorded_by_username: string | null
  created_at: string
  updated_at: string
  version_id: number
}

export interface PatientAllergyCreate {
  substance: string
  category?: AllergyCategory
  severity?: AllergySeverity
  reaction?: string | null
  clinical_notes?: string | null
  status?: AllergyStatus
}

export interface PatientAllergyUpdate {
  version_id: number
  substance?: string | null
  category?: AllergyCategory | null
  severity?: AllergySeverity | null
  reaction?: string | null
  clinical_notes?: string | null
  status?: AllergyStatus | null
}

export interface LatestVisitBrief {
  visit_id: number
  visit_code: string
  visit_date: string
  status: string
  token_numbers: number[]
  doctors: string[]
  departments: string[]
  consultation_count: number
  completed_consultations: number
}

export interface LatestEncounterBrief {
  encounter_id: number
  encounter_code: string
  encounter_date: string
  doctor_name: string
  department_name: string | null
  is_finalised: boolean
  diagnosis_summary: string | null
}

/** Role-redacted Patient Workspace KPI summary (GET /api/patients/{id}/summary). */
export interface PatientSummaryOut {
  patient_id: number
  urn: string
  total_visits: number
  active_treatment_plans: number
  latest_visit: LatestVisitBrief | null
  /** Populated for RECEPTION & DOCTOR; strictly null for ADMIN. */
  allergy_alert: AllergySafetyAlertOut | null
  /** Full clinical records strictly for DOCTOR; null for RECEPTION & ADMIN. */
  active_allergies: PatientAllergyOut[] | null
  /** Clinical KPIs: DOCTOR only (null for ADMIN & RECEPTION under D-04). */
  prescriptions_count: number | null
  active_conditions_count: number | null
  latest_encounter: LatestEncounterBrief | null
  /** Financial KPIs: ADMIN & RECEPTION only (null for DOCTOR per AGENTS.md #7). */
  total_billed_paise: number | null
  total_paid_paise: number | null
  total_refunded_paise: number | null
  outstanding_paise: number | null
}

export interface EncounterLinkBrief {
  encounter_id: number
  encounter_code: string
  is_finalised: boolean
  doctor_name: string
}

export interface PatientVisitHistoryItem {
  visit_id: number
  visit_code: string
  visit_date: string
  status: string
  token_numbers: number[]
  doctors: string[]
  departments: string[]
  consultation_count: number
  completed_consultations: number
  /** DOCTOR only (null for ADMIN & RECEPTION under D-04). */
  encounter_links: EncounterLinkBrief[] | null
  /** ADMIN & RECEPTION only (null for DOCTOR per AGENTS.md #7). */
  bill_total_paise: number | null
  paid_paise: number | null
  due_paise: number | null
  payment_status: string | null
}

export interface PatientVisitHistoryResponse {
  items: PatientVisitHistoryItem[]
  total: number
  limit: number
  offset: number
}

export interface DuplicateCheckResponse {
  has_duplicate: boolean
  matching_patient: PatientOut | null
}

export interface AdminPatientDemographicCorrection {
  reason: string
  version_id: number
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
  | 'RESCHEDULED'
  | 'TO_ARRIVE'
  | 'REGISTERED'
  | 'CHECKED_IN'
  | 'WAITING'
  | 'COMPLETED'

/** Where the doctor's side of a checked-in appointment stands (RF-10). Empty until check-in. */
export type ConsultationStatus = 'WAITING' | 'IN_CONSULTATION' | 'COMPLETED' | 'CANCELLED'

/** How an appointment was made. Empty when it was not recorded. */
export type AppointmentSource = 'PHONE' | 'WALK_IN'

/** Visit type of one consultation (OD-22-05). Recorded only; it never sets the fee. */
export type VisitKind = 'NEW' | 'FOLLOW_UP'

/** Queue classification set by reception (OD-22-06). It never changes the token. */
export type PriorityLevel = 'NORMAL' | 'PRIORITY' | 'EMERGENCY'

/** Who referred the patient for this visit (OD-22-16). */
export type ReferralSource = 'SELF' | 'DOCTOR' | 'PERSONAL' | 'ORGANIZATION' | 'OTHER'

/** What reception confirms at the check-in desk (phase 22). */
export interface CheckInDetails {
  referral_source: ReferralSource
  /** Required for DOCTOR, PERSONAL and ORGANIZATION. */
  referrer_name?: string | null
  visit_kind?: VisitKind | null
  priority_level?: PriorityLevel
  /** Required for PRIORITY and EMERGENCY. */
  priority_reason?: string | null
}

export interface Appointment {
  id: number
  /** Department (specialty) chosen at booking; null for appointments booked before it existed. */
  department_id?: number | null
  department_name?: string | null
  patient_id: number
  patient_urn: string
  patient_name: string
  patient_mobile: string
  patient_age?: number | null
  doctor_id: number
  doctor_name_en: string
  doctor_name_hi: string | null
  appointment_date: string
  /** Issued at check-in, so empty while the booking has not been checked in (RF-12). */
  token_number: number | null
  status: AppointmentStatus
  status_updated_at: string
  check_in_at?: string | null
  cancellation_reason: string | null
  notes: string | null
  source?: AppointmentSource | null
  /** HH:MM:SS time the patient said they would come; display only. */
  expected_time?: string | null
  visit_id?: number | null
  consultation_status?: ConsultationStatus | null
  rescheduled_from_id?: number | null
  visit_kind?: VisitKind | null
  priority_level?: PriorityLevel
  priority_reason?: string | null
  priority_updated_at?: string | null
  emergency_alerted_at?: string | null
  alert_acknowledged_at?: string | null
  /** The visit's Referred By; sent on check-in responses only. */
  referral_source?: ReferralSource | null
  referrer_name?: string | null
  version_id: number
  created_at: string
  updated_at: string
}

export interface AppointmentCreate {
  patient_id: number
  department_id: number
  doctor_id: number
  appointment_date: string
  notes?: string | null
  source?: AppointmentSource | null
  /** HH:MM or HH:MM:SS */
  expected_time?: string | null
  override_reason?: string | null
  issue_token?: boolean
  priority_level?: PriorityLevel
  priority_reason?: string | null
}

export interface OpdArrival {
  id: number
  full_name: string
  age_years: number
  mobile: string
  doctor_id: number
  doctor_name_en: string
  department_id: number
  department_name: string
  appointment_date: string
  token_number: number
  priority_level: PriorityLevel
  priority_reason?: string | null
  cancellation_reason?: string | null
  status: 'TO_ARRIVE' | 'REGISTERED' | 'CANCELLED'
  version_id: number
  created_at: string
  patient_id?: number | null
  appointment_id?: number | null
}

export interface OpdArrivalList {
  total: number
  arrivals: OpdArrival[]
  limit?: number | null
  offset?: number
}

export interface OpdArrivalCreate {
  full_name: string
  age_years: number
  mobile: string
  doctor_id: number
  department_id: number
  priority_level: PriorityLevel
  priority_reason?: string | null
}

export interface OpdArrivalRegister {
  version_id: number
  patient: PatientCreate
}

export interface OpdArrivalPriorityUpdate {
  version_id: number
  priority_level: PriorityLevel
  reason: string
}

/** A walk-in: booked for today and checked in at once, with its token. */
export interface WalkInCreate extends CheckInDetails {
  patient_id: number
  department_id: number
  doctor_id: number
  notes?: string | null
  override_reason?: string | null
}

export interface CheckInRequest extends CheckInDetails {
  version_id: number
  patient_id?: number
}

/** Register a first-time patient and check them in, in one transaction (OD-22-03). */
export interface NewPatientCheckIn extends CheckInDetails {
  patient: PatientCreate
  department_id: number
  doctor_id: number
  notes?: string | null
  to_arrive?: boolean
}

/** Move a booking to another date, or change its expected time (RF-12). */
export interface RescheduleRequest {
  version_id: number
  appointment_date: string
  expected_time?: string | null
  reason?: string | null
}

export interface PriorityUpdate {
  priority_level: PriorityLevel
  priority_reason?: string | null
  version_id: number
}

/** Move a waiting patient to another doctor on the same visit (QUE-10, design §5). */
export interface ReassignRequest {
  version_id: number
  new_doctor_id: number
  /** Required when the new doctor is not in the current department (owner decision Q19). */
  new_department_id?: number | null
  reason: string
}

/** Doctor acknowledges an emergency alert on own consultation (OD-22-09). */
export interface AcknowledgeAlertRequest {
  version_id: number
}

export interface AppointmentStatusUpdate {
  status: AppointmentStatus
  version_id: number
  cancellation_reason?: string | null
}

export interface AppointmentBucketCounts {
  active: number
  to_arrive: number
  checked_in: number
  completed: number
  no_show: number
  cancelled: number
  rescheduled?: number
  all: number
}

export interface AppointmentListResponse {
  total: number
  appointments: Appointment[]
  limit?: number | null
  offset?: number
  bucket_counts?: AppointmentBucketCounts | null
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
  token_number: number | null
  status: AppointmentStatus
  consultation_status?: ConsultationStatus | null
  status_updated_at: string
  notes: string | null
  visit_kind?: VisitKind | null
  priority_level?: PriorityLevel
  priority_reason?: string | null
  emergency_alerted_at?: string | null
  alert_acknowledged_at?: string | null
  check_in_at?: string | null
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
  /** Optional linked visit ID for walk-in encounters. */
  visit_id?: number | null
  /** Omit to let the server take it from the appointment or the doctor's only department. */
  department_id?: number | null
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
  encounter_code?: string
  patient_id: number
  patient_urn: string
  patient_name: string
  patient_mobile?: string | null
  patient_address?: string | null
  doctor_id: number
  doctor_name: string
  appointment_id: number | null
  visit_id?: number | null
  department_id?: number | null
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

export interface UnfinishedEncounter {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  department_id?: number | null
  department_name?: string
  started_at: string
  is_finalised: boolean
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
  strength?: string | null
  form?: string | null
  route?: string | null
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
  strength?: string | null
  form?: string | null
  route?: string | null
}

export interface PrescriptionCreate {
  patient_id: number
  encounter_id?: number | null
  appointment_id?: number | null
  status?: string
  diagnosis?: string | null
  dietary_advice?: string | null
  general_advice?: string | null
  follow_up_date?: string | null
  items: PrescriptionItemCreate[]
}

export interface PrescriptionUpdate {
  diagnosis?: string | null
  dietary_advice?: string | null
  general_advice?: string | null
  follow_up_date?: string | null
  items?: PrescriptionItemCreate[]
  version_id?: number | null
}

export type PrescriptionStatus = 'DRAFT' | 'AUTHORISED' | 'SUPERSEDED' | 'CANCELLED'

export interface PrescriptionCancelRequest {
  reason: string
}

export interface PrescriptionAmendRequest {
  amendment_reason: string
  diagnosis?: string | null
  dietary_advice?: string | null
  general_advice?: string | null
  follow_up_date?: string | null
  items: PrescriptionItemCreate[]
  authorise_immediately?: boolean
}

export interface PrescriptionOut {
  id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  patient_mobile?: string | null
  patient_address?: string | null
  doctor_id: number
  doctor_name: string
  encounter_id: number | null
  status: PrescriptionStatus
  revision_number?: number
  supersedes_prescription_id?: number | null
  amendment_reason?: string | null
  authorised_at?: string | null
  cancelled_at?: string | null
  cancellation_reason?: string | null
  cancelled_by_user_id?: number | null
  is_printable: boolean
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
  status: PrescriptionStatus
  revision_number?: number
  supersedes_prescription_id?: number | null
  amendment_reason?: string | null
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
  visit_id?: number | null
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
  patient_mobile?: string | null
  patient_address?: string | null
  treatment_plan_id: number | null
  treatment_plan_name: string | null
  appointment_id: number | null
  visit_id?: number | null
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

// RF-23: visits (checkout) and dues of closed visits. Matches schemas/visits.py and billing.py.
export type VisitStatus = 'OPEN' | 'CLOSED' | 'CANCELLED'

export interface VisitConsultation {
  appointment_id: number
  doctor_id: number
  doctor_name_en: string
  token_number: number | null
  appointment_status: string
  consultation_status: ConsultationStatus | null
  appointment_date: string
  fee_paise: number
  paid_paise: number
  balance_paise: number
  /** True once the doctor completed it; fees are collected only after that. */
  collectable: boolean
}

export interface VisitPayment {
  id: number
  visit_id?: number | null
  appointment_id: number | null
  receipt_number: string
  amount_paise: number
  payment_method: PaymentMethod
  is_reversed: boolean
  created_at: string
  created_by_username: string
}

export interface VisitRead {
  id: number
  visit_code?: string
  patient_id: number
  patient_urn: string
  patient_name: string
  visit_date: string
  status: VisitStatus
  opened_by_user_id: number
  opened_at: string
  closed_by_user_id: number | null
  closed_at: string | null
  close_reason: string | null
  cancelled_by_user_id: number | null
  cancelled_at: string | null
  cancel_reason: string | null
  version_id: number
}

export interface VisitSummary extends VisitRead {
  doctors: string[]
  completed_consultations: number
  active_consultations: number
  outstanding_paise: number
  token_numbers: number[]
  last_completed_at: string | null
}

export interface VisitDetail extends VisitRead {
  consultations: VisitConsultation[]
  payments: VisitPayment[]
  total_paid_paise: number
  outstanding_paise: number
}

export interface VisitListResponse {
  total: number
  visits: VisitSummary[]
}

export interface VisitCloseRequest {
  version_id: number
  reason?: string | null
}

export interface VisitDueOut {
  visit_id: number
  patient_id: number
  patient_urn: string
  patient_name: string
  doctor_names: string[]
  visit_date: string
  bill_total_paise: number
  paid_paise: number
  balance_paise: number
  close_reason: string | null
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
  /** Letters, digits, '_' and '-' only, max 50 (see BACKUP_LABEL_PATTERN). */
  label?: string | null
  /** Absolute path to an EXISTING directory on the server, max 1024. */
  destination_dir?: string | null
}

export const BACKUP_LABEL_PATTERN = /^[A-Za-z0-9_-]{0,50}$/

export interface BackupVerifyResponse {
  filename: string
  valid: boolean
  details: string
}

export const RESTORE_CONFIRMATION_PHRASE = 'RESTORE'
export const RESTORE_REASON_MIN_LENGTH = 10
export const RESTORE_REASON_MAX_LENGTH = 500

export interface RestoreRequest {
  /** Bare filename inside the configured backup directory. */
  archive_filename: string
  /** Must be exactly RESTORE_CONFIRMATION_PHRASE. */
  confirmation_phrase: string
  /** 10-500 characters after trimming; stored on the audit row. */
  reason: string
  /** Deprecated: the pre-restore snapshot is always taken; only true is accepted. */
  create_prerestore_snapshot?: true
}

export interface RestoreResultOut {
  status: string
  archive_restored: string
  prerestore_snapshot?: string | null
  database_restored: boolean
  photos_restored_count: number
  manifest?: Record<string, unknown> | null
}

/** ERROR: a record is wrong or points at something missing. WARNING: review, may be expected.
 * CLEANUP: harmless clutter, such as a stored file no record uses. */
export type IntegritySeverity = 'ERROR' | 'WARNING' | 'CLEANUP'

export interface IntegrityCheckItemOut {
  /** Stable check identifier, e.g. 'asset_files'. */
  code: string
  name: string
  passed: boolean
  /** Worst severity among the findings. */
  severity: IntegritySeverity
  details: string
  /** Each finding carries its own `issue` code and `severity`. */
  discrepancies: Record<string, unknown>[]
}

/** One stored run of the integrity check. */
export interface IntegrityReportOut {
  id: number | null
  generated_at: string
  run_by_username: string | null
  duration_ms: number
  is_healthy: boolean
  total_checks: number
  passed_checks: number
  /** Checks whose worst finding is an ERROR. */
  failed_checks: number
  warning_checks: number
  cleanup_checks: number
  checks: IntegrityCheckItemOut[]
}

export interface IntegrityRunSummaryOut {
  id: number
  generated_at: string
  run_by_username: string | null
  is_healthy: boolean
  total_checks: number
  passed_checks: number
  failed_checks: number
  warning_checks: number
  cleanup_checks: number
}

export interface IntegrityHistoryOut {
  runs: IntegrityRunSummaryOut[]
}

// Phase 19: Universal Consultation Workspace Contracts
export interface VitalObservationInput {
  height_cm?: number | null
  weight_kg?: number | null
  systolic_bp?: number | null
  diastolic_bp?: number | null
  pulse_bpm?: number | null
  temperature_f?: number | null
  respiratory_rate?: number | null
  spo2_percent?: number | null
}

export interface VitalObservationResponse {
  id: number
  encounter_id: number
  patient_id: number
  height_cm: number | null
  weight_kg: number | null
  bmi: number | null
  systolic_bp: number | null
  diastolic_bp: number | null
  pulse_bpm: number | null
  temperature_f: number | null
  respiratory_rate: number | null
  spo2_percent: number | null
  created_at: string
  updated_at: string
}

export interface ClinicalTemplateVersionRead {
  id: number
  template_id: number
  version_number: number
  schema_json: Record<string, any>
  is_active: boolean
  approved_by: string
  approved_at: string
  created_at: string
}

export interface ClinicalTemplateRead {
  id: number
  department_id: number
  code: string
  name_en: string
  name_hi?: string | null
  is_active: boolean
  created_at: string
  active_version?: ClinicalTemplateVersionRead | null
}

export interface TemplateResponseInput {
  template_version_id: number
  response_data: Record<string, any>
}

export interface TemplateResponseRead {
  id: number
  encounter_id: number
  template_version_id: number
  response_data: Record<string, any>
  created_at: string
  updated_at: string
}

export type FollowUpStatus = 'PENDING' | 'BOOKED' | 'CLOSED'

export interface FollowUpRecommendationCreate {
  recommended_date: string
  recommended_doctor_id?: number | null
  clinical_reason?: string | null
}

export interface FollowUpCloseRequest {
  reason: string
}

export interface FollowUpBookRequest {
  appointment_date?: string | null
  notes?: string | null
  department_id?: number | null
  override_reason?: string | null
}

export interface DoctorFollowUpResponse {
  id: number
  encounter_id: number
  patient_id: number
  patient_name: string
  patient_urn: string
  doctor_id: number
  doctor_name: string
  recommended_doctor_id: number
  recommended_doctor_name: string
  recommended_date: string
  clinical_reason?: string | null
  status: string
  booked_appointment_id?: number | null
  closed_reason?: string | null
  closed_by_user_id?: number | null
  closed_at?: string | null
  version_id: number
  created_at: string
  updated_at: string
}

export interface ReceptionFollowUpResponse {
  id: number
  encounter_id: number
  patient_id: number
  patient_name: string
  patient_urn: string
  patient_mobile?: string | null
  recommended_doctor_id: number
  recommended_doctor_name: string
  recommended_date: string
  status: FollowUpStatus
  booked_appointment_id?: number | null
  created_at: string
}

export type AssetType = 'LOGO' | 'PHOTO' | 'REGISTRATION_DOC'

export interface HospitalAssetOut {
  id: number
  asset_type: AssetType
  filename: string
  original_filename: string
  mime_type: string
  file_size_bytes: number
  is_active: boolean
  version: number
  uploaded_by_user_id: number
  uploaded_by_name: string | null
  created_at: string
}

export type PrintDocumentType =
  | 'prescription'
  | 'receipt'
  | 'registration_card'
  | 'consultation_summary'

export interface PrintTemplateOut {
  id: number
  document_type: PrintDocumentType
  header_en: string | null
  header_hi: string | null
  footer_en: string | null
  footer_hi: string | null
  version: number
  updated_at: string
}

export interface PrintTemplateUpdatePayload {
  header_en?: string | null
  header_hi?: string | null
  footer_en?: string | null
  footer_hi?: string | null
  version: number
}

// Phase 20 Data Governance: Export Centre
export interface ExportScope {
  start_date?: string | null
  end_date?: string | null
  department_id?: number | null
  search_query?: string | null
}

export interface PatientExportRequest {
  reason: string
  format: 'csv' | 'xlsx'
  scope: ExportScope
  fields: string[]
}

// ==============================================================================
// Milestone 2: Longitudinal Conditions, Encounter Diagnoses & Investigations
// ==============================================================================

export type ConditionStatus = 'ACTIVE' | 'RESOLVED' | 'INACTIVE'

export interface PatientConditionCreate {
  condition_name: string
  icd10_code?: string | null
  status?: ConditionStatus
  onset_date?: string | null
  resolved_date?: string | null
  notes?: string | null
}

export interface PatientConditionUpdate {
  version_id: number
  condition_name?: string | null
  icd10_code?: string | null
  status?: ConditionStatus | null
  onset_date?: string | null
  resolved_date?: string | null
  notes?: string | null
}

export interface PatientConditionOut {
  id: number
  patient_id: number
  doctor_id: number
  doctor_name: string | null
  condition_name: string
  icd10_code: string | null
  status: ConditionStatus
  onset_date: string | null
  resolved_date: string | null
  notes: string | null
  created_at: string
  updated_at: string
  version_id: number
}

export type DiagnosisType = 'PRIMARY' | 'SECONDARY' | 'PROVISIONAL'
export type DiagnosisStatus = 'ACTIVE' | 'RESOLVED' | 'INACTIVE'

export interface EncounterDiagnosisCreate {
  diagnosis_name: string
  icd10_code?: string | null
  diagnosis_type?: DiagnosisType
  status?: DiagnosisStatus
  onset_date?: string | null
  notes?: string | null
  patient_condition_id?: number | null
  promote_to_condition?: boolean
}

export interface EncounterDiagnosisUpdate {
  diagnosis_name?: string | null
  icd10_code?: string | null
  diagnosis_type?: DiagnosisType | null
  status?: DiagnosisStatus | null
  onset_date?: string | null
  notes?: string | null
  patient_condition_id?: number | null
}

export interface EncounterDiagnosisOut {
  id: number
  encounter_id: number
  encounter_code: string | null
  patient_id: number
  doctor_id: number
  doctor_name: string | null
  diagnosis_name: string
  icd10_code: string | null
  diagnosis_type: DiagnosisType
  status: DiagnosisStatus
  onset_date: string | null
  notes: string | null
  patient_condition_id: number | null
  created_at: string
  updated_at: string
}

export type InvestigationCategory = 'LAB' | 'IMAGING' | 'PATHOLOGY' | 'DIAGNOSTIC' | 'OTHER'
export type InvestigationPriority = 'ROUTINE' | 'URGENT'
export type InvestigationStatus = 'ORDERED' | 'SAMPLE_COLLECTED' | 'COMPLETED' | 'CANCELLED'

export interface InvestigationOrderCreate {
  category: InvestigationCategory
  test_name: string
  instructions?: string | null
  priority?: InvestigationPriority
}

export interface InvestigationStatusUpdate {
  status: InvestigationStatus
  cancelled_reason?: string | null
  version_id: number
}

export interface InvestigationResultCreate {
  summary_text: string
  result_value?: string | null
  unit?: string | null
  reference_range?: string | null
  is_abnormal?: boolean
  reported_at?: string | null
  document_id?: number | null
}

export interface InvestigationResultOut {
  id: number
  order_id: number
  patient_id: number
  document_id?: number | null
  document_title?: string | null
  summary_text: string
  result_value: string | null
  unit: string | null
  reference_range: string | null
  is_abnormal: boolean
  reported_at: string
  recorded_by_user_id: number
  recorded_by_username: string | null
  created_at: string
}

export interface InvestigationOrderOut {
  id: number
  encounter_id: number
  encounter_code: string
  patient_id: number
  doctor_id: number
  doctor_name: string
  category: InvestigationCategory
  test_name: string
  instructions: string | null
  priority: InvestigationPriority
  status: InvestigationStatus
  cancelled_reason: string | null
  ordered_at: string
  updated_at: string
  version_id: number
  results: InvestigationResultOut[]
}

// ==============================================================================
// Milestone 3: Append-Only Patient Financial Ledger & Admin Refunds
// ==============================================================================

export type LedgerEntryType =
  | 'CHARGE'
  | 'CHARGE_ADJUSTMENT'
  | 'CHARGE_VOID'
  | 'PACKAGE_CHARGE'
  | 'PACKAGE_ADJUSTMENT'
  | 'LEGACY_CHARGE'
  | 'PAYMENT'
  | 'PAYMENT_REVERSAL'
  | 'REFUND'

export type LedgerDirection = 'DEBIT' | 'CREDIT'

export type LedgerReferenceType =
  | 'BILL_ITEM'
  | 'BILL_ITEM_ADJUSTMENT'
  | 'TREATMENT_PLAN'
  | 'APPOINTMENT'
  | 'PAYMENT'
  | 'REFUND'

export interface RefundCreateRequest {
  amount_paise: number
  refund_method: PaymentMethod
  reason: string
}

export interface RefundOut {
  id: number
  refund_number: string
  payment_id: number
  payment_receipt_number: string | null
  patient_id: number
  visit_id: number | null
  amount_paise: number
  refund_method: string
  reason: string
  refunded_by_user_id: number
  refunded_by_username: string
  created_at: string
}

export interface LedgerEntryOut {
  id: number
  patient_id: number
  visit_id: number | null
  entry_type: LedgerEntryType | string
  direction: LedgerDirection
  amount_paise: number
  signed_amount_paise: number
  running_balance_paise: number
  reference_type: LedgerReferenceType | string
  reference_id: number
  description: string
  actor_user_id: number | null
  actor_username: string | null
  occurred_at: string
  created_at: string
}

export interface LedgerPaymentItemOut extends PaymentOut {
  refunded_paise: number
  remaining_refundable_paise: number
}

export interface LedgerVisitBillOut {
  visit_id: number
  visit_code: string
  visit_date: string
  status: string
  bill_total_paise: number
  paid_paise: number
  refunded_paise: number
  due_paise: number
}

export interface PatientLedgerResponse {
  patient_id: number
  patient_urn: string
  total_billed_paise: number
  total_paid_paise: number
  total_refunded_paise: number
  outstanding_paise: number
  ledger_balance_paise: number
  entries: LedgerEntryOut[]
  total_entries: number
  limit: number
  offset: number
  payments: LedgerPaymentItemOut[]
  refunds: RefundOut[]
  visits: LedgerVisitBillOut[]
}

// ==============================================================================
// Milestone 4: Patient Documents, Directory Filters & Unified Visit Workspace
// ==============================================================================

export type DocumentCategory =
  | 'LAB_REPORT'
  | 'IMAGING'
  | 'PRESCRIPTION_SCAN'
  | 'REFERRAL'
  | 'ID_PROOF'
  | 'INSURANCE'
  | 'DISCHARGE_SUMMARY'
  | 'OTHER'

export interface PatientDocumentOut {
  id: number
  patient_id: number
  visit_id: number | null
  visit_code: string | null
  encounter_id: number | null
  encounter_code: string | null
  title: string
  category: DocumentCategory | string
  is_clinical: boolean
  original_filename: string
  mime_type: string
  file_size_bytes: number
  sha256_hex: string
  notes: string | null
  uploaded_by_user_id: number
  uploaded_by_username: string | null
  doctor_id: number | null
  is_archived: boolean
  archived_at: string | null
  archived_by_user_id: number | null
  created_at: string
}

export interface PatientDocumentUploadInput {
  file: File
  title: string
  category: DocumentCategory
  is_clinical?: boolean
  visit_id?: number | null
  encounter_id?: number | null
  notes?: string | null
}

export type PatientDirectoryStatus = 'active' | 'archived' | 'all'
export type PatientDirectorySort = 'recent' | 'name' | 'urn'

export interface PatientDirectoryFilters {
  status?: PatientDirectoryStatus
  gender?: 'M' | 'F' | 'O' | '' | null
  district?: string | null
  has_due_balance?: boolean | null
  sort_by?: PatientDirectorySort
}

export interface VisitWorkspacePatientStrip {
  patient_id: number
  urn: string
  full_name: string
  computed_age_years: number
  gender: 'M' | 'F' | 'O' | string
  mobile: string
  is_active: boolean
  is_archived: boolean
  merged_into_id: number | null
  merged_into_urn: string | null
  /** Populated for DOCTOR and RECEPTION; strictly null for ADMIN (D-04). */
  allergy_alert: AllergySafetyAlertOut | null
}

export interface VisitWorkspaceVisitMeta {
  visit_id: number
  visit_code: string
  visit_date: string
  status: VisitStatus | string
  referral_source: ReferralSource | string | null
  referrer_name: string | null
  token_numbers: number[]
}

export interface WorkspaceTemplateSummaryOut {
  template_code: string
  template_name_en: string
  template_version_id: number
  version_number: number
  response_data: Record<string, unknown>
  updated_at: string
}

export interface WorkspaceClinicalChargeOut {
  id: number
  category: string
  source: string
  status: string
  description: string
  unit: string | null
  quantity: string | number
  rate_paise: number
  amount_paise: number
  treatment_plan_id: number | null
}

export interface VisitWorkspaceConsultationOut {
  appointment_id: number | null
  token_number: number | null
  doctor_id: number
  doctor_name: string
  department_name: string | null
  consultation_status: ConsultationStatus | string | null
  visit_kind: VisitKind | string | null
  priority_level: PriorityLevel | string | null

  /** Clinical bundle: DOCTOR only (strictly null for ADMIN and RECEPTION under D-04). */
  encounter_id: number | null
  encounter_code: string | null
  is_finalised: boolean | null
  vitals: VitalObservationResponse | null
  symptoms: string | null
  clinical_notes: string | null
  diagnosis: string | null
  template_response_summary: WorkspaceTemplateSummaryOut | null
  diagnoses: EncounterDiagnosisOut[] | null
  investigations: InvestigationOrderOut[] | null
  prescriptions: PrescriptionOut[] | null
  treatment_plans: TreatmentPlanOut[] | null
  follow_up: DoctorFollowUpResponse | null
  addenda: AddendumRead[] | null
  /** Q13: own consultation fee + own doctor-authored lines only (empty for other doctors' rows). */
  clinical_charges: WorkspaceClinicalChargeOut[] | null
}

export interface VisitWorkspaceFinancialSummaryOut {
  bill_total_paise: number
  paid_paise: number
  refunded_paise: number
  due_paise: number
  payment_status: string
  payments: BillPaymentOut[]
  refunds: RefundOut[]
}

export interface VisitWorkspaceOut {
  patient: VisitWorkspacePatientStrip
  visit: VisitWorkspaceVisitMeta
  consultations: VisitWorkspaceConsultationOut[]
  /** ADMIN & RECEPTION only; strictly null for DOCTOR per AGENTS.md #7. */
  financial_summary: VisitWorkspaceFinancialSummaryOut | null
}

// ==============================================================================
// Phase 3: Persistent Clinical Quick Phrases
// ==============================================================================

export type QuickPhraseScope = 'PERSONAL' | 'HOSPITAL_DEFAULT'
export type QuickPhraseSection = 'COMPLAINTS' | 'EXAMINATION' | 'DIAGNOSIS' | 'ADVICE'

export interface QuickPhraseCreate {
  phrase_text: string
  section?: QuickPhraseSection
  department_id?: number | null
  sort_order?: number
}

export interface QuickPhraseUpdate {
  phrase_text?: string | null
  section?: QuickPhraseSection | null
  sort_order?: number | null
}

export interface QuickPhraseOut {
  id: number
  scope: QuickPhraseScope | string
  doctor_id: number | null
  department_id: number | null
  department_code: string | null
  section: QuickPhraseSection | string
  phrase_text: string
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface QuickPhraseListResponse {
  defaults: QuickPhraseOut[]
  personal: QuickPhraseOut[]
}






