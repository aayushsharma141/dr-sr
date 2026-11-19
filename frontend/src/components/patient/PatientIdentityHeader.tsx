import { useState } from 'react'
import { Link } from 'react-router'
import type {
  AllergySeverity,
  PatientAllergyOut,
  PatientOut,
  PatientSummaryOut,
  Role,
} from '../../api/types'
import { formatPaise } from '../../format'
import {
  IconAlertTriangle,
  IconCalendar,
  IconPhone,
  IconPrinter,
  IconShieldCheck,
  IconTicket,
  IconUserEdit,
} from '../icons'
import { hasReportedAllergies } from '../UnsavedChangesGuard'

export interface PatientIdentityHeaderProps {
  patient: PatientOut
  summary?: PatientSummaryOut | null
  summaryLoading?: boolean
  summaryError?: boolean
  role: Role
  permissions: string[]
  onOpenTab?: (tab: string) => void
}

const GENDER_LABEL: Record<PatientOut['gender'], string> = {
  M: 'Male',
  F: 'Female',
  O: 'Other',
}

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  MILD: 'Mild',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
  LIFE_THREATENING: 'Life-threatening',
}

const SEVERITY_BADGE_CLASS: Record<AllergySeverity, string> = {
  MILD: 'bg-amber-100 text-amber-900 border border-amber-300',
  MODERATE: 'bg-amber-200 text-amber-950 border border-amber-400',
  SEVERE: 'bg-rose-100 text-rose-900 border border-rose-300',
  LIFE_THREATENING: 'bg-rose-800 text-white border border-rose-900',
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
}

function formatIsoDate(value: string | null | undefined): string | null {
  if (!value) return null
  const datePart = value.includes('T') ? value : `${value}T00:00:00+05:30`
  const parsed = new Date(datePart)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function isHighSeverity(severity: AllergySeverity | null | undefined): boolean {
  return severity === 'SEVERE' || severity === 'LIFE_THREATENING'
}

function highestAllergySeverity(allergies: PatientAllergyOut[]): AllergySeverity | null {
  const rank: Record<AllergySeverity, number> = {
    MILD: 1,
    MODERATE: 2,
    SEVERE: 3,
    LIFE_THREATENING: 4,
  }
  let top: AllergySeverity | null = null
  for (const item of allergies) {
    if (!top || rank[item.severity] > rank[top]) {
      top = item.severity
    }
  }
  return top
}

export function PatientIdentityHeader({
  patient,
  summary,
  summaryLoading = false,
  summaryError = false,
  role,
  permissions,
  onOpenTab,
}: PatientIdentityHeaderProps) {
  const photoKey = `${patient.id}:${patient.photo_path ?? ''}`
  const [failedPhotoKey, setFailedPhotoKey] = useState<string | null>(null)
  const showPhoto = Boolean(patient.photo_path) && failedPhotoKey !== photoKey

  const isMerged = Boolean(patient.merged_into_id)
  const isArchived = Boolean(patient.is_archived)
  const isReadOnly = isMerged || isArchived

  const ageYears = patient.computed_age_years ?? patient.age_years
  const dobLabel = formatIsoDate(patient.dob)

  const hasPermission = (key: string) => permissions.length === 0 || permissions.includes(key)
  const canEditPatient = role === 'RECEPTION' && !isReadOnly && hasPermission('patient:update')
  const canBookCheckIn = role === 'RECEPTION' && !isReadOnly && hasPermission('appointment:write')
  const canCorrectDemographics = role === 'ADMIN' && hasPermission('patient:correct')

  const doctorAllergies = role === 'DOCTOR' ? (summary?.active_allergies ?? []) : []
  const receptionAlert = role === 'RECEPTION' ? (summary?.allergy_alert ?? null) : null
  const doctorTopSeverity =
    highestAllergySeverity(doctorAllergies) ?? summary?.allergy_alert?.highest_severity ?? null
  const hasDoctorActiveAllergy =
    role === 'DOCTOR' && (doctorAllergies.length > 0 || Boolean(summary?.allergy_alert?.has_allergies))
  const hasReceptionActiveAllergy = role === 'RECEPTION' && Boolean(receptionAlert?.has_allergies)
  const hasLegacyAllergy = hasReportedAllergies(patient.allergies)
  const allergySummaryReady = Boolean(summary) && !summaryError && !summaryLoading
  const allergySummaryUnavailable =
    (role === 'DOCTOR' || role === 'RECEPTION') && !summaryLoading && (summaryError || !summary)
  const showDoctorLegacyAllergyPill =
    role === 'DOCTOR' && allergySummaryReady && !hasDoctorActiveAllergy && hasLegacyAllergy
  const showDoctorNoAllergyPill =
    role === 'DOCTOR' && allergySummaryReady && !hasDoctorActiveAllergy && !hasLegacyAllergy
  const showReceptionNoAllergyPill =
    role === 'RECEPTION' && allergySummaryReady && !hasReceptionActiveAllergy

  const kpiCellClass =
    'flex min-w-[92px] flex-col justify-center rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-1.5 text-left transition-colors'
  const kpiInteractiveClass =
    'hover:border-brand-300 hover:bg-brand-50/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer'

  return (
    <header
      aria-label="Patient identity summary"
      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs"
    >
      {/* Compact Unified Identity, Inline KPIs & Actions Strip */}
      <div className="flex flex-col gap-3.5 bg-white px-4 py-3.5 sm:px-5 xl:flex-row xl:items-center xl:justify-between">
        {/* Left: Avatar + Identity + Inline Metadata */}
        <div className="flex min-w-0 items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-brand-200 bg-brand-50 text-base font-bold text-brand-800 shadow-2xs sm:h-14 sm:w-14 sm:text-lg">
            {showPhoto ? (
              <img
                src={`/api/patients/${patient.id}/photo`}
                alt={patient.full_name}
                className="h-full w-full object-cover"
                onError={() => setFailedPhotoKey(photoKey)}
              />
            ) : (
              <span aria-hidden="true">{getInitials(patient.full_name)}</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                {patient.full_name}
              </h1>
              <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono tabular-nums text-xs font-bold tracking-wider text-slate-800">
                {patient.urn}
              </span>

              {isMerged && patient.merged_into_id ? (
                <Link
                  to={`/reception/patients/${patient.merged_into_id}`}
                  className="inline-flex min-h-6 items-center rounded-full border border-amber-300 bg-amber-100 px-2 text-xs font-semibold text-amber-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
                >
                  Merged into {patient.merged_into_urn ?? `Patient #${patient.merged_into_id}`}
                </Link>
              ) : isArchived ? (
                <span className="inline-flex min-h-6 items-center rounded-full border border-slate-300 bg-slate-200 px-2 text-xs font-semibold text-slate-800">
                  Archived
                </span>
              ) : patient.is_active ? (
                <span className="inline-flex min-h-6 items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-800">
                  Active
                </span>
              ) : (
                <span className="inline-flex min-h-6 items-center rounded-full border border-slate-300 bg-slate-100 px-2 text-xs font-semibold text-slate-700">
                  Inactive
                </span>
              )}

              {patient.blood_group && (
                <span className="inline-flex min-h-6 items-center rounded-full border border-rose-200 bg-rose-50 px-2 text-xs font-bold text-rose-900">
                  Blood: {patient.blood_group}
                </span>
              )}

              {/* Inline allergy status pills: never show green "No known allergies" when summary fails or legacy allergy exists */}
              {allergySummaryUnavailable && (
                <span
                  role="status"
                  data-testid="allergy-status-unavailable"
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 text-xs font-semibold text-amber-900"
                >
                  <IconAlertTriangle size={14} stroke={1.8} aria-hidden="true" />
                  <span>Allergy status unavailable</span>
                </span>
              )}

              {showDoctorLegacyAllergyPill && (
                <span
                  role="alert"
                  data-testid="legacy-allergy-pill"
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 text-xs font-semibold text-amber-950"
                >
                  <IconAlertTriangle size={14} stroke={1.8} aria-hidden="true" />
                  <span>Allergy note: {patient.allergies}</span>
                </span>
              )}

              {showDoctorNoAllergyPill && (
                <span className="inline-flex min-h-6 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-900">
                  <IconShieldCheck size={14} stroke={1.8} aria-hidden="true" />
                  <span>No known allergies</span>
                </span>
              )}

              {showReceptionNoAllergyPill && (
                <span className="inline-flex min-h-6 items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-700">
                  <IconShieldCheck size={14} stroke={1.8} aria-hidden="true" />
                  <span>No allergy alerts</span>
                </span>
              )}
            </div>

            {/* Compact Demographics Line */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-700 sm:text-sm">
              <span className="inline-flex items-center gap-1 font-medium tabular-nums text-slate-900">
                <IconCalendar size={15} stroke={1.8} className="text-brand-700" aria-hidden="true" />
                <span>
                  {ageYears} yrs
                  {dobLabel ? ` · DOB ${dobLabel}` : ''}
                </span>
              </span>

              <span className="text-slate-600">{GENDER_LABEL[patient.gender]}</span>

              <span className="inline-flex items-center gap-1 font-mono tabular-nums font-medium text-slate-900">
                <IconPhone size={15} stroke={1.8} className="text-brand-700" aria-hidden="true" />
                <span>{patient.mobile}</span>
              </span>

              <span className="text-slate-700">
                Care of:{' '}
                <span className="font-semibold text-slate-900">{patient.guardian_name}</span>
                {patient.guardian_relationship ? (
                  <span className="text-slate-600"> ({patient.guardian_relationship})</span>
                ) : null}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Compact KPI Metric Pills + Quick Actions */}
        <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between xl:justify-end xl:shrink-0">
          {/* Compact Inline KPI Metrics */}
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-stretch">
            {onOpenTab ? (
              <button
                type="button"
                onClick={() => onOpenTab('visits')}
                className={`${kpiCellClass} ${kpiInteractiveClass}`}
              >
                <span className="block text-xs font-medium text-slate-600">Total Visits</span>
                <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                  {summaryLoading && !summary ? '—' : (summary?.total_visits ?? 0)}
                </span>
              </button>
            ) : (
              <div className={kpiCellClass}>
                <span className="block text-xs font-medium text-slate-600">Total Visits</span>
                <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                  {summaryLoading && !summary ? '—' : (summary?.total_visits ?? 0)}
                </span>
              </div>
            )}

            {onOpenTab ? (
              <button
                type="button"
                onClick={() => onOpenTab('therapy')}
                className={`${kpiCellClass} ${kpiInteractiveClass}`}
              >
                <span className="block text-xs font-medium text-slate-600">Active Plans</span>
                <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                  {summaryLoading && !summary ? '—' : (summary?.active_treatment_plans ?? 0)}
                </span>
              </button>
            ) : (
              <div className={kpiCellClass}>
                <span className="block text-xs font-medium text-slate-600">Active Plans</span>
                <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                  {summaryLoading && !summary ? '—' : (summary?.active_treatment_plans ?? 0)}
                </span>
              </div>
            )}

            {role === 'DOCTOR' ? (
              onOpenTab ? (
                <button
                  type="button"
                  onClick={() => onOpenTab('prescriptions')}
                  className={`${kpiCellClass} ${kpiInteractiveClass}`}
                >
                  <span className="block text-xs font-medium text-slate-600">Prescriptions</span>
                  <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                    {summaryLoading && !summary ? '—' : (summary?.prescriptions_count ?? 0)}
                  </span>
                </button>
              ) : (
                <div className={kpiCellClass}>
                  <span className="block text-xs font-medium text-slate-600">Prescriptions</span>
                  <span className="block font-mono tabular-nums text-base font-bold leading-tight text-slate-900">
                    {summaryLoading && !summary ? '—' : (summary?.prescriptions_count ?? 0)}
                  </span>
                </div>
              )
            ) : onOpenTab ? (
              <button
                type="button"
                onClick={() => onOpenTab('billing')}
                className={`${kpiCellClass} ${kpiInteractiveClass}`}
              >
                <span className="block text-xs font-medium text-slate-600">Outstanding Balance</span>
                <span
                  className={`block font-mono tabular-nums text-base font-bold leading-tight ${
                    (summary?.outstanding_paise ?? 0) > 0 ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  {summaryLoading && !summary
                    ? '—'
                    : formatPaise(summary?.outstanding_paise ?? 0)}
                </span>
              </button>
            ) : (
              <div className={kpiCellClass}>
                <span className="block text-xs font-medium text-slate-600">Outstanding Balance</span>
                <span
                  className={`block font-mono tabular-nums text-base font-bold leading-tight ${
                    (summary?.outstanding_paise ?? 0) > 0 ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  {summaryLoading && !summary
                    ? '—'
                    : formatPaise(summary?.outstanding_paise ?? 0)}
                </span>
              </div>
            )}
          </div>

          {/* Role-Gated Quick Actions */}
          <div className="flex flex-wrap items-center gap-2 xl:border-l xl:border-slate-200 xl:pl-3">
            {canEditPatient && (
              <Link
                to={`/reception/patients/${patient.id}/edit`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
              >
                <IconUserEdit size={17} stroke={1.8} aria-hidden="true" />
                Edit Patient
              </Link>
            )}

            {canBookCheckIn && (
              <Link
                to={`/reception/appointments?patient_id=${patient.id}`}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
              >
                <IconTicket size={17} stroke={1.8} aria-hidden="true" />
                Book / Check-in
              </Link>
            )}

            {canCorrectDemographics && (
              <Link
                to="/admin/patients/correct"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
              >
                <IconShieldCheck size={17} stroke={1.8} aria-hidden="true" />
                Correct Demographics
              </Link>
            )}

            <Link
              to={`/reception/patients/${patient.id}/print`}
              className={
                canBookCheckIn
                  ? 'inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors'
                  : 'inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-3 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors'
              }
            >
              <IconPrinter size={17} stroke={1.8} aria-hidden="true" />
              Print Card
            </Link>
          </div>
        </div>
      </div>

      {/* Prominent Active Allergy Alert Banner — ONLY rendered when allergies actually exist (OMITTED for ADMIN) */}
      {hasDoctorActiveAllergy && (
        <div className="border-t border-slate-200 px-4 py-2.5 sm:px-5">
          {doctorAllergies.length > 0 ? (
            <div
              role="region"
              aria-label="Active clinical allergies"
              className={`rounded-lg border px-3.5 py-2 ${
                isHighSeverity(doctorTopSeverity)
                  ? 'border-rose-300 bg-rose-50 text-rose-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold">
                  <IconAlertTriangle size={17} stroke={1.8} aria-hidden="true" />
                  <span>Active Clinical Allergies ({doctorAllergies.length})</span>
                </div>
                {onOpenTab && (
                  <button
                    type="button"
                    onClick={() => onOpenTab('overview')}
                    className="text-xs font-semibold underline underline-offset-2 hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer"
                  >
                    View &amp; manage in Overview
                  </button>
                )}
              </div>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {doctorAllergies.map((allergy) => (
                  <li
                    key={allergy.id}
                    className="inline-flex flex-wrap items-center gap-1.5 rounded-md border border-current/20 bg-white/80 px-2 py-0.5 text-xs text-slate-900"
                  >
                    <span className="font-bold">{allergy.substance}</span>
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE_CLASS[allergy.severity]}`}
                    >
                      {SEVERITY_LABEL[allergy.severity]}
                    </span>
                    {allergy.reaction ? (
                      <span className="text-slate-700">— {allergy.reaction}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : summary?.allergy_alert?.has_allergies ? (
            <div
              role="region"
              aria-label="Active clinical allergies"
              className={`rounded-lg border px-3.5 py-2 ${
                isHighSeverity(summary.allergy_alert.highest_severity)
                  ? 'border-rose-300 bg-rose-50 text-rose-900'
                  : 'border-amber-300 bg-amber-50 text-amber-900'
              }`}
            >
              <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                <IconAlertTriangle size={17} stroke={1.8} aria-hidden="true" />
                <span>Allergy Alert ({summary.allergy_alert.count})</span>
                {summary.allergy_alert.alert_labels.map((label) => (
                  <span
                    key={label}
                    className="rounded-md border border-current/20 bg-white/80 px-2 py-0.5 font-semibold text-slate-900"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {hasReceptionActiveAllergy && receptionAlert && (
        <div className="border-t border-slate-200 px-4 py-2.5 sm:px-5">
          <div
            role="region"
            aria-label="Allergy safety alert"
            className={`flex flex-wrap items-center gap-2 rounded-lg border px-3.5 py-2 text-xs ${
              isHighSeverity(receptionAlert.highest_severity)
                ? 'border-rose-300 bg-rose-50 text-rose-900'
                : 'border-amber-300 bg-amber-50 text-amber-900'
            }`}
          >
            <IconAlertTriangle size={17} stroke={1.8} aria-hidden="true" />
            <span className="font-bold">Allergy Safety Alert ({receptionAlert.count})</span>
            {receptionAlert.highest_severity && (
              <span
                className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE_CLASS[receptionAlert.highest_severity]}`}
              >
                {SEVERITY_LABEL[receptionAlert.highest_severity]}
              </span>
            )}
            {receptionAlert.alert_labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {receptionAlert.alert_labels.map((label) => (
                  <span
                    key={label}
                    className="rounded-md border border-current/20 bg-white/80 px-2 py-0.5 font-semibold text-slate-900"
                  >
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  )
}
