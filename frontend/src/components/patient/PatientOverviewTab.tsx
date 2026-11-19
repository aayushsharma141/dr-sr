import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { ApiError, isVersionConflict } from '../../api/client'
import {
  useCreatePatientAllergy,
  useCreatePatientCondition,
  usePatientAllergies,
  usePatientConditions,
  useUpdatePatientAllergy,
  useUpdatePatientCondition,
} from '../../api/queries'
import type {
  AllergyCategory,
  AllergySeverity,
  AllergyStatus,
  ConditionStatus,
  PatientAllergyOut,
  PatientConditionOut,
  PatientOut,
  PatientSummaryOut,
  Role,
} from '../../api/types'
import { formatIst } from '../../format'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconChevronRight,
  IconNotes,
  IconPhone,
  IconPlus,
  IconRefresh,
  IconShieldCheck,
  IconStethoscope,
  IconUser,
} from '../icons'

export interface PatientOverviewTabProps {
  patient: PatientOut
  summary?: PatientSummaryOut | null
  role: Role
  permissions: string[]
  currentDoctorId?: number | null
  onOpenTab?: (tab: string) => void
  conditionsSlot?: ReactNode
}

const GENDER_LABEL: Record<PatientOut['gender'], string> = {
  M: 'Male',
  F: 'Female',
  O: 'Other',
}

const CATEGORY_OPTIONS: { value: AllergyCategory; label: string }[] = [
  { value: 'DRUG', label: 'Drug / Medication' },
  { value: 'FOOD', label: 'Food' },
  { value: 'ENVIRONMENTAL', label: 'Environmental' },
  { value: 'OTHER', label: 'Other' },
]

const SEVERITY_OPTIONS: { value: AllergySeverity; label: string }[] = [
  { value: 'MILD', label: 'Mild' },
  { value: 'MODERATE', label: 'Moderate' },
  { value: 'SEVERE', label: 'Severe' },
  { value: 'LIFE_THREATENING', label: 'Life-threatening' },
]

const STATUS_OPTIONS: { value: AllergyStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'RESOLVED', label: 'Resolved' },
]

const CATEGORY_LABEL: Record<AllergyCategory, string> = {
  DRUG: 'Drug',
  FOOD: 'Food',
  ENVIRONMENTAL: 'Environmental',
  OTHER: 'Other',
}

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  MILD: 'Mild',
  MODERATE: 'Moderate',
  SEVERE: 'Severe',
  LIFE_THREATENING: 'Life-threatening',
}

const SEVERITY_BADGE_CLASS: Record<AllergySeverity, string> = {
  MILD: 'bg-amber-50 text-amber-900 border border-amber-200',
  MODERATE: 'bg-amber-100 text-amber-950 border border-amber-300',
  SEVERE: 'bg-rose-100 text-rose-900 border border-rose-300',
  LIFE_THREATENING: 'bg-rose-800 text-white border border-rose-900',
}

const ALLERGY_STATUS_CLASS: Record<AllergyStatus, string> = {
  ACTIVE: 'bg-rose-50 text-rose-900 border border-rose-200',
  INACTIVE: 'bg-slate-100 text-slate-700 border border-slate-200',
  RESOLVED: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
}

const CONDITION_STATUS_OPTIONS: { value: ConditionStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'RESOLVED', label: 'Resolved' },
]

const CONDITION_STATUS_CLASS: Record<ConditionStatus, string> = {
  ACTIVE: 'bg-amber-50 text-amber-900 border border-amber-200',
  INACTIVE: 'bg-slate-100 text-slate-700 border border-slate-200',
  RESOLVED: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
}

const INPUT_CLASS =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-500 hover:border-slate-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/15'

const LABEL_CLASS = 'mb-1.5 block text-xs font-semibold text-slate-700'

function formatIsoDate(value: string | null | undefined): string {
  if (!value) return 'Not recorded'
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

function visitStatusBadgeClass(status: string): string {
  if (status === 'OPEN') return 'bg-emerald-50 text-emerald-800 border border-emerald-200'
  if (status === 'CANCELLED') return 'bg-rose-50 text-rose-800 border border-rose-200'
  return 'bg-slate-100 text-slate-800 border border-slate-200'
}

interface AllergyFormState {
  substance: string
  category: AllergyCategory
  severity: AllergySeverity
  status: AllergyStatus
  reaction: string
  clinicalNotes: string
}

const EMPTY_FORM: AllergyFormState = {
  substance: '',
  category: 'DRUG',
  severity: 'MODERATE',
  status: 'ACTIVE',
  reaction: '',
  clinicalNotes: '',
}

interface ConditionFormState {
  conditionName: string
  icd10Code: string
  status: ConditionStatus
  onsetDate: string
  resolvedDate: string
  notes: string
}

const EMPTY_CONDITION_FORM: ConditionFormState = {
  conditionName: '',
  icd10Code: '',
  status: 'ACTIVE',
  onsetDate: '',
  resolvedDate: '',
  notes: '',
}

export function PatientOverviewTab({
  patient,
  summary,
  role,
  permissions,
  currentDoctorId = null,
  onOpenTab,
  conditionsSlot,
}: PatientOverviewTabProps) {
  const isDoctor = role === 'DOCTOR'
  const canWriteAllergy =
    isDoctor &&
    permissions.includes('allergy:write') &&
    patient.is_active &&
    !patient.is_archived &&
    !patient.merged_into_id

  const canWriteConditions =
    isDoctor &&
    permissions.includes('encounter:write') &&
    patient.is_active &&
    !patient.is_archived &&
    !patient.merged_into_id

  // Enabled strictly for DOCTOR so Reception/Admin never fire 403 requests.
  const allergiesQuery = usePatientAllergies(patient.id, isDoctor)
  const createAllergy = useCreatePatientAllergy(patient.id)
  const updateAllergy = useUpdatePatientAllergy(patient.id)

  const conditionsQuery = usePatientConditions(patient.id, isDoctor)
  const createCondition = useCreatePatientCondition(patient.id)
  const updateCondition = useUpdatePatientCondition(patient.id)

  const [modalOpen, setModalOpen] = useState(false)
  const [editingAllergy, setEditingAllergy] = useState<PatientAllergyOut | null>(null)
  const [form, setForm] = useState<AllergyFormState>(EMPTY_FORM)
  const [allergyError, setAllergyError] = useState<string | null>(null)
  const [hasConflict, setHasConflict] = useState(false)
  const [resolvingId, setResolvingId] = useState<number | null>(null)

  const [conditionModalOpen, setConditionModalOpen] = useState(false)
  const [editingCondition, setEditingCondition] = useState<PatientConditionOut | null>(null)
  const [conditionForm, setConditionForm] = useState<ConditionFormState>(EMPTY_CONDITION_FORM)
  const [conditionError, setConditionError] = useState<string | null>(null)
  const [conditionConflict, setConditionConflict] = useState(false)
  const [updatingConditionId, setUpdatingConditionId] = useState<number | null>(null)

  const openAddModal = () => {
    setEditingAllergy(null)
    setForm(EMPTY_FORM)
    setAllergyError(null)
    setHasConflict(false)
    setModalOpen(true)
  }

  const openEditModal = (allergy: PatientAllergyOut) => {
    setEditingAllergy(allergy)
    setForm({
      substance: allergy.substance,
      category: allergy.category,
      severity: allergy.severity,
      status: allergy.status,
      reaction: allergy.reaction ?? '',
      clinicalNotes: allergy.clinical_notes ?? '',
    })
    setAllergyError(null)
    setHasConflict(false)
    setModalOpen(true)
  }

  const closeModal = () => {
    if (createAllergy.isPending || updateAllergy.isPending) return
    setModalOpen(false)
    setEditingAllergy(null)
    setAllergyError(null)
    setHasConflict(false)
  }

  const handleAllergySubmit = async (e: FormEvent) => {
    e.preventDefault()
    const substance = form.substance.trim()
    if (!substance) {
      setAllergyError('Substance name is required.')
      return
    }
    setAllergyError(null)
    setHasConflict(false)

    try {
      if (editingAllergy) {
        await updateAllergy.mutateAsync({
          allergyId: editingAllergy.id,
          body: {
            version_id: editingAllergy.version_id,
            substance,
            category: form.category,
            severity: form.severity,
            status: form.status,
            reaction: form.reaction.trim() || null,
            clinical_notes: form.clinicalNotes.trim() || null,
          },
        })
        toast.success(`Updated allergy record for ${substance}.`)
      } else {
        await createAllergy.mutateAsync({
          substance,
          category: form.category,
          severity: form.severity,
          status: form.status,
          reaction: form.reaction.trim() || null,
          clinical_notes: form.clinicalNotes.trim() || null,
        })
        toast.success(`Recorded clinical allergy for ${substance}.`)
      }
      setModalOpen(false)
      setEditingAllergy(null)
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        setHasConflict(true)
        setAllergyError(
          'This allergy record was updated by another user. Reload the latest records and try again.',
        )
      } else {
        setAllergyError(err instanceof Error ? err.message : 'Unable to save allergy record.')
      }
    }
  }

  const handleQuickResolve = async (allergy: PatientAllergyOut) => {
    setResolvingId(allergy.id)
    try {
      await updateAllergy.mutateAsync({
        allergyId: allergy.id,
        body: {
          version_id: allergy.version_id,
          status: 'RESOLVED',
        },
      })
      toast.success(`Marked ${allergy.substance} as resolved.`)
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        toast.error(
          `The record for ${allergy.substance} changed elsewhere. Reload allergies to get the latest version.`,
          {
            action: {
              label: 'Reload latest',
              onClick: () => {
                void allergiesQuery.refetch()
              },
            },
          },
        )
      } else {
        toast.error(err instanceof Error ? err.message : 'Unable to resolve allergy record.')
      }
    } finally {
      setResolvingId(null)
    }
  }

  const openAddConditionModal = () => {
    setEditingCondition(null)
    setConditionForm(EMPTY_CONDITION_FORM)
    setConditionError(null)
    setConditionConflict(false)
    setConditionModalOpen(true)
  }

  const openEditConditionModal = (condition: PatientConditionOut) => {
    setEditingCondition(condition)
    setConditionForm({
      conditionName: condition.condition_name,
      icd10Code: condition.icd10_code ?? '',
      status: condition.status,
      onsetDate: condition.onset_date ?? '',
      resolvedDate: condition.resolved_date ?? '',
      notes: condition.notes ?? '',
    })
    setConditionError(null)
    setConditionConflict(false)
    setConditionModalOpen(true)
  }

  const closeConditionModal = () => {
    if (createCondition.isPending || updateCondition.isPending) return
    setConditionModalOpen(false)
    setEditingCondition(null)
    setConditionError(null)
    setConditionConflict(false)
  }

  const handleConditionSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const conditionName = conditionForm.conditionName.trim()
    if (conditionName.length < 2) {
      setConditionError('Condition name must be at least 2 characters.')
      return
    }
    setConditionError(null)
    setConditionConflict(false)

    try {
      if (editingCondition) {
        await updateCondition.mutateAsync({
          conditionId: editingCondition.id,
          body: {
            version_id: editingCondition.version_id,
            condition_name: conditionName,
            icd10_code: conditionForm.icd10Code.trim() || null,
            status: conditionForm.status,
            onset_date: conditionForm.onsetDate.trim() || null,
            resolved_date: conditionForm.resolvedDate.trim() || null,
            notes: conditionForm.notes.trim() || null,
          },
        })
        toast.success(`Updated problem list entry for ${conditionName}.`)
      } else {
        await createCondition.mutateAsync({
          condition_name: conditionName,
          icd10_code: conditionForm.icd10Code.trim() || null,
          status: conditionForm.status,
          onset_date: conditionForm.onsetDate.trim() || null,
          resolved_date: conditionForm.resolvedDate.trim() || null,
          notes: conditionForm.notes.trim() || null,
        })
        toast.success(`Added ${conditionName} to the longitudinal problem list.`)
      }
      setConditionModalOpen(false)
      setEditingCondition(null)
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        setConditionConflict(true)
        setConditionError(
          'This condition was updated by another user. Reload the latest problem list and try again.',
        )
      } else {
        setConditionError(err instanceof Error ? err.message : 'Unable to save condition.')
      }
    }
  }

  const handleConditionStatusChange = async (
    condition: PatientConditionOut,
    nextStatus: ConditionStatus,
  ) => {
    if (nextStatus === condition.status) return
    setUpdatingConditionId(condition.id)
    try {
      await updateCondition.mutateAsync({
        conditionId: condition.id,
        body: {
          version_id: condition.version_id,
          status: nextStatus,
        },
      })
      toast.success(`Updated ${condition.condition_name} status to ${nextStatus}.`)
    } catch (err) {
      if (isVersionConflict(err) || (err instanceof ApiError && err.status === 409)) {
        toast.error(
          `The record for ${condition.condition_name} changed elsewhere. Reload conditions to get the latest version.`,
          {
            action: {
              label: 'Reload latest',
              onClick: () => {
                void conditionsQuery.refetch()
              },
            },
          },
        )
      } else {
        toast.error(
          err instanceof Error ? err.message : 'Unable to update condition status.',
        )
      }
    } finally {
      setUpdatingConditionId(null)
    }
  }

  const computedAge = patient.computed_age_years ?? patient.age_years
  const latestVisit = summary?.latest_visit ?? null
  const latestEncounter = isDoctor ? (summary?.latest_encounter ?? null) : null
  const receptionAlert = role === 'RECEPTION' ? (summary?.allergy_alert ?? null) : null
  const allergies = Array.isArray(allergiesQuery.data) ? allergiesQuery.data : []
  const activeAllergyCount = allergies.filter((a) => a.status === 'ACTIVE').length
  const conditions = Array.isArray(conditionsQuery.data) ? conditionsQuery.data : []
  const activeConditionCount = conditions.filter((c) => c.status === 'ACTIVE').length

  return (
    <div className="space-y-4">
      {/* Latest Visit & Latest Encounter (DOCTOR) Snapshot Row */}
      <div className={`grid grid-cols-1 gap-4 ${isDoctor ? 'lg:grid-cols-2' : ''}`}>
        {/* Latest Visit Card — sleek horizontal layout when full-width (non-Doctor), compact card when 2-col (Doctor) */}
        <section
          aria-label="Latest visit snapshot"
          className={`rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-2xs sm:px-5 ${
            isDoctor
              ? 'flex flex-col justify-between gap-3'
              : 'flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'
          }`}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                <IconCalendar size={17} stroke={1.8} className="text-brand-700" aria-hidden="true" />
                Latest Visit
              </h2>
              {latestVisit && (
                <>
                  <span className="rounded bg-slate-100 px-2 py-0.5 font-mono tabular-nums text-xs font-bold text-slate-900">
                    {latestVisit.visit_code}
                  </span>
                  <span className="tabular-nums text-xs font-medium text-slate-700 sm:text-sm">
                    {formatIsoDate(latestVisit.visit_date)}
                  </span>
                  {latestVisit.token_numbers.length > 0 && (
                    <span className="rounded border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono tabular-nums text-xs font-semibold text-brand-800">
                      Token {latestVisit.token_numbers.map((t) => `#${t}`).join(', ')}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${visitStatusBadgeClass(latestVisit.status)}`}
                  >
                    {latestVisit.status}
                  </span>
                </>
              )}
            </div>

            {latestVisit ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700 sm:text-sm">
                {latestVisit.doctors.length > 0 && (
                  <span>
                    <span className="font-semibold text-slate-900">Doctor(s):</span>{' '}
                    {latestVisit.doctors.join(', ')}
                  </span>
                )}
                {latestVisit.departments.length > 0 && (
                  <span className="text-slate-600">
                    Department(s): {latestVisit.departments.join(', ')}
                  </span>
                )}
                <span className="tabular-nums text-slate-600">
                  Consultations: {latestVisit.completed_consultations} of{' '}
                  {latestVisit.consultation_count} completed
                </span>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No visits recorded for this patient yet.</p>
            )}
          </div>

          <div
            className={`flex flex-wrap items-center gap-2 ${
              isDoctor ? 'border-t border-slate-100 pt-3' : 'lg:shrink-0'
            }`}
          >
            {latestVisit && (
              <Link
                to={`/patients/${patient.id}/visits/${latestVisit.visit_id}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-700 px-3.5 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
              >
                Open Visit Workspace &rarr;
              </Link>
            )}
            {onOpenTab && (
              <button
                type="button"
                onClick={() => onOpenTab('visits')}
                className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer transition-colors"
              >
                All Visits
                <IconChevronRight size={16} stroke={1.8} aria-hidden="true" />
              </button>
            )}
          </div>
        </section>

        {/* Latest Encounter Card (DOCTOR ONLY) */}
        {isDoctor && (
          <section
            aria-label="Latest clinical encounter snapshot"
            className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-2xs sm:px-5"
          >
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                  <IconStethoscope
                    size={17}
                    stroke={1.8}
                    className="text-brand-700"
                    aria-hidden="true"
                  />
                  Latest Encounter
                </h2>
                {latestEncounter && (
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      latestEncounter.is_finalised
                        ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border border-amber-200 bg-amber-50 text-amber-900'
                    }`}
                  >
                    {latestEncounter.is_finalised ? 'Finalised' : 'Draft'}
                  </span>
                )}
              </div>

              {latestEncounter ? (
                <div className="mt-2 space-y-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono tabular-nums text-xs font-bold text-slate-900">
                      {latestEncounter.encounter_code}
                    </span>
                    <span className="tabular-nums text-xs font-medium text-slate-600">
                      {formatIst(latestEncounter.encounter_date)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800">
                    <span className="font-semibold">{latestEncounter.doctor_name}</span>
                    {latestEncounter.department_name ? (
                      <span className="text-slate-600"> · {latestEncounter.department_name}</span>
                    ) : null}
                  </p>
                  {latestEncounter.diagnosis_summary ? (
                    <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-800">
                      {latestEncounter.diagnosis_summary}
                    </p>
                  ) : (
                    <p className="text-xs text-slate-600">No diagnosis summary entered.</p>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  No clinical encounters recorded for this patient yet.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {latestEncounter && (
                <Link
                  to={`/doctor/encounters/${latestEncounter.encounter_id}`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand-700 px-3.5 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 transition-colors"
                >
                  Open Encounter &rarr;
                </Link>
              )}
              {onOpenTab && (
                <button
                  type="button"
                  onClick={() => onOpenTab('clinical')}
                  className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer transition-colors"
                >
                  All Consultations
                  <IconChevronRight size={16} stroke={1.8} aria-hidden="true" />
                </button>
              )}
            </div>
          </section>
        )}
      </div>

      {/* Grouped Profile Cards: Demographics + Contact & Address */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Demographics */}
        <section
          aria-label="Demographics"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
        >
          <h2 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold text-slate-900">
            <IconUser size={17} stroke={1.8} className="text-brand-700" aria-hidden="true" />
            Demographics
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-600">Gender</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {GENDER_LABEL[patient.gender]}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Age</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{computedAge} Years</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Date of Birth</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">{formatIsoDate(patient.dob)}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Blood Group</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {patient.blood_group || 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Permanent URN</dt>
              <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">{patient.urn}</dd>
            </div>
            {patient.legacy_urn ? (
              <div>
                <dt className="text-xs font-medium text-slate-600">Legacy URN</dt>
                <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  {patient.legacy_urn}
                </dd>
              </div>
            ) : (
              <div>
                <dt className="text-xs font-medium text-slate-600">Record Version</dt>
                <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                  v{patient.version_id}
                </dd>
              </div>
            )}
            <div className="col-span-2">
              <dt className="text-xs font-medium text-slate-600">Registered On</dt>
              <dd className="mt-0.5 text-sm font-medium tabular-nums text-slate-800">
                {formatIst(patient.created_at)}
              </dd>
            </div>
          </dl>
        </section>

        {/* Contact & Address */}
        <section
          aria-label="Contact and address"
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-5"
        >
          <h2 className="flex items-center gap-2 border-b border-slate-100 pb-2.5 text-sm font-bold text-slate-900">
            <IconPhone size={17} stroke={1.8} className="text-brand-700" aria-hidden="true" />
            Contact &amp; Address
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
            <div>
              <dt className="text-xs font-medium text-slate-600">Primary Mobile</dt>
              <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">{patient.mobile}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Alternate Mobile</dt>
              <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                {patient.alternate_mobile || 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Email</dt>
              <dd className="mt-0.5 break-all font-medium text-slate-900">
                {patient.email || 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">Emergency Contact</dt>
              <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                {patient.emergency_contact || 'Not recorded'}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-medium text-slate-600">Guardian / Care Of</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {patient.guardian_name}
                {patient.guardian_relationship ? (
                  <span className="font-normal text-slate-600">
                    {' '}
                    ({patient.guardian_relationship})
                  </span>
                ) : null}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs font-medium text-slate-600">Address</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{patient.address}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">District &amp; State</dt>
              <dd className="mt-0.5 font-semibold text-slate-900">
                {patient.district}, {patient.state}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-slate-600">PIN Code</dt>
              <dd className="mt-0.5 font-mono tabular-nums font-semibold text-slate-900">
                {patient.pin_code || 'Not recorded'}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* Role-Adapted Allergies Section (OMITTED COMPLETELY for ADMIN) */}
      {isDoctor && (
        <section
          aria-label="Structured clinical allergies"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <IconAlertTriangle
                  size={18}
                  stroke={1.8}
                  className="text-brand-700"
                  aria-hidden="true"
                />
                Structured Clinical Allergies
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 tabular-nums text-xs font-semibold ${
                  activeAllergyCount > 0
                    ? 'border border-rose-200 bg-rose-50 text-rose-900'
                    : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                }`}
              >
                {activeAllergyCount} Active
              </span>
            </div>

            {canWriteAllergy && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer transition-colors"
              >
                <IconPlus size={18} stroke={1.8} aria-hidden="true" />
                Add Allergy
              </button>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {allergiesQuery.isPending ? (
              <p className="py-4 text-sm text-slate-600" role="status">
                Loading clinical allergies…
              </p>
            ) : allergiesQuery.isError ? (
              <InlineAlert tone="error">
                Unable to load clinical allergies: {allergiesQuery.error.message}
              </InlineAlert>
            ) : allergies.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
                No structured clinical allergies recorded for this patient.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                    <tr>
                      <th scope="col" className="px-3.5 py-3">
                        Substance
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Category
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Severity
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Reaction
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Clinical Notes
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Recorded By
                      </th>
                      {canWriteAllergy && (
                        <th scope="col" className="px-3.5 py-3 text-right">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allergies.map((allergy) => (
                      <tr key={allergy.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-3.5 py-3 font-semibold text-slate-900">
                          {allergy.substance}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-xs font-medium text-slate-700">
                          {CATEGORY_LABEL[allergy.category]}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE_CLASS[allergy.severity]}`}
                          >
                            {SEVERITY_LABEL[allergy.severity]}
                          </span>
                        </td>
                        <td className="max-w-xs px-3.5 py-3 text-slate-800">
                          {allergy.reaction || '—'}
                        </td>
                        <td className="max-w-xs whitespace-pre-wrap px-3.5 py-3 text-slate-700">
                          {allergy.clinical_notes || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${ALLERGY_STATUS_CLASS[allergy.status]}`}
                          >
                            {allergy.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-xs text-slate-600">
                          {allergy.recorded_by_username || '—'}
                        </td>
                        {canWriteAllergy && (
                          <td className="whitespace-nowrap px-3.5 py-3 text-right">
                            <div className="inline-flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEditModal(allergy)}
                                className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer"
                              >
                                Edit
                              </button>
                              {allergy.status === 'ACTIVE' && (
                                <button
                                  type="button"
                                  disabled={resolvingId === allergy.id}
                                  onClick={() => void handleQuickResolve(allergy)}
                                  className="inline-flex min-h-9 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer"
                                >
                                  <IconCheck size={14} stroke={1.8} aria-hidden="true" />
                                  {resolvingId === allergy.id ? 'Resolving…' : 'Resolve'}
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {patient.allergies &&
              patient.allergies.trim() !== '' &&
              !/^none(\s+reported)?$/i.test(patient.allergies.trim()) && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-xs text-amber-900">
                  <span className="font-bold">Legacy registration allergy note:</span>{' '}
                  {patient.allergies}
                </p>
              )}
          </div>
        </section>
      )}

      {role === 'RECEPTION' && (
        <section
          aria-label="Allergy safety alert"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <IconShieldCheck
                size={18}
                stroke={1.8}
                className="text-brand-700"
                aria-hidden="true"
              />
              Allergy Safety Alert
            </h2>
            <span className="text-xs font-medium text-slate-600">
              Read-only safety summary
            </span>
          </div>

          <div className="mt-4">
            {receptionAlert?.has_allergies ? (
              <div
                className={`rounded-lg border p-4 ${
                  receptionAlert.highest_severity === 'SEVERE' ||
                  receptionAlert.highest_severity === 'LIFE_THREATENING'
                    ? 'border-rose-300 bg-rose-50 text-rose-900'
                    : 'border-amber-300 bg-amber-50 text-amber-900'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <IconAlertTriangle size={18} stroke={1.8} aria-hidden="true" />
                  <span>
                    {receptionAlert.count} active allergy alert
                    {receptionAlert.count === 1 ? '' : 's'} on file
                  </span>
                  {receptionAlert.highest_severity && (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${SEVERITY_BADGE_CLASS[receptionAlert.highest_severity]}`}
                    >
                      Highest: {SEVERITY_LABEL[receptionAlert.highest_severity]}
                    </span>
                  )}
                </div>
                {receptionAlert.alert_labels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {receptionAlert.alert_labels.map((label) => (
                      <span
                        key={label}
                        className="rounded-md border border-current/20 bg-white/85 px-2.5 py-1 text-xs font-semibold text-slate-900"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-700">No allergy safety alerts on file.</p>
            )}
          </div>
        </section>
      )}

      {/* Longitudinal Conditions / Problem List (DOCTOR ONLY — never rendered or queried for Reception/Admin) */}
      {conditionsSlot !== undefined ? (
        conditionsSlot
      ) : isDoctor ? (
        <section
          aria-label="Longitudinal conditions problem list"
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <IconStethoscope
                  size={18}
                  stroke={1.8}
                  className="text-brand-700"
                  aria-hidden="true"
                />
                Longitudinal Conditions (Problem List)
              </h2>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 tabular-nums text-xs font-semibold ${
                  activeConditionCount > 0
                    ? 'border border-amber-200 bg-amber-50 text-amber-900'
                    : 'border border-slate-200 bg-slate-100 text-slate-700'
                }`}
              >
                {activeConditionCount} Active
              </span>
            </div>

            {canWriteConditions && (
              <button
                type="button"
                onClick={openAddConditionModal}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer transition-colors"
              >
                <IconPlus size={18} stroke={1.8} aria-hidden="true" />
                Add Condition
              </button>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {conditionsQuery.isPending ? (
              <p className="py-4 text-sm text-slate-600" role="status">
                Loading longitudinal conditions…
              </p>
            ) : conditionsQuery.isError ? (
              <InlineAlert tone="error">
                Unable to load longitudinal conditions: {conditionsQuery.error.message}
              </InlineAlert>
            ) : conditions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-600">
                No longitudinal conditions recorded on this patient&apos;s problem list yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-bold text-slate-700">
                    <tr>
                      <th scope="col" className="px-3.5 py-3">
                        Condition
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        ICD-10
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Status
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Onset Date
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Notes
                      </th>
                      <th scope="col" className="px-3.5 py-3">
                        Recorded By
                      </th>
                      {canWriteConditions && (
                        <th scope="col" className="px-3.5 py-3 text-right">
                          Actions
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {conditions.map((condition) => {
                      const canEditCondition =
                        canWriteConditions &&
                        Boolean(currentDoctorId && condition.doctor_id === currentDoctorId)
                      return (
                      <tr key={condition.id} className="align-top hover:bg-slate-50/70">
                        <td className="px-3.5 py-3 font-semibold text-slate-900">
                          {condition.condition_name}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 font-mono tabular-nums text-xs font-semibold text-slate-800">
                          {condition.icd10_code || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONDITION_STATUS_CLASS[condition.status]}`}
                          >
                            {condition.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 tabular-nums text-xs text-slate-700">
                          {condition.onset_date ? formatIsoDate(condition.onset_date) : '—'}
                        </td>
                        <td className="max-w-xs whitespace-pre-wrap px-3.5 py-3 text-slate-700">
                          {condition.notes || '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-3 text-xs text-slate-600">
                          {condition.doctor_name || '—'}
                        </td>
                        {canWriteConditions && (
                          <td className="whitespace-nowrap px-3.5 py-3 text-right">
                            {canEditCondition ? (
                              <div className="inline-flex items-center gap-2">
                                <select
                                  aria-label={`Status for ${condition.condition_name}`}
                                  value={condition.status}
                                  disabled={updatingConditionId === condition.id}
                                  onChange={(e) =>
                                    void handleConditionStatusChange(
                                      condition,
                                      e.target.value as ConditionStatus,
                                    )
                                  }
                                  className="min-h-9 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 focus:border-brand-700 focus:outline-none focus:ring-1 focus:ring-brand-700 disabled:opacity-50"
                                >
                                  {CONDITION_STATUS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  aria-label={`Edit condition ${condition.condition_name}`}
                                  onClick={() => openEditConditionModal(condition)}
                                  className="inline-flex min-h-9 items-center rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 cursor-pointer"
                                >
                                  Edit
                                </button>
                              </div>
                            ) : (
                              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                                Read-only
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Background & Medical History */}
      <section
        aria-label="Background and medical history"
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs"
      >
        <h2 className="flex items-center gap-2 border-b border-slate-100 pb-3 text-sm font-bold text-slate-900">
          <IconNotes size={18} stroke={1.8} className="text-brand-700" aria-hidden="true" />
          Background &amp; Medical History
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-bold text-slate-700">Medical History Notes</h3>
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm whitespace-pre-wrap text-slate-800">
              {patient.medical_history_notes?.trim()
                ? patient.medical_history_notes
                : 'No medical history notes recorded.'}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-700">Administrative &amp; General Notes</h3>
            <div className="mt-1.5 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm whitespace-pre-wrap text-slate-800">
              {patient.notes?.trim() ? patient.notes : 'No administrative notes recorded.'}
            </div>
          </div>
        </div>
      </section>

      {/* Add / Edit Clinical Allergy Modal (DOCTOR with allergy:write only) */}
      {canWriteAllergy && (
        <Modal
          open={modalOpen}
          onClose={closeModal}
          title={editingAllergy ? `Edit Allergy — ${editingAllergy.substance}` : 'Add Clinical Allergy'}
          description="Structured clinical allergy records are visible to doctors and surface safety alerts to reception."
          variant={editingAllergy ? 'info' : 'warning'}
          busy={createAllergy.isPending || updateAllergy.isPending}
          className="max-w-xl"
        >
          <form onSubmit={(e) => void handleAllergySubmit(e)} className="space-y-4">
            {allergyError && (
              <InlineAlert tone="error">
                <div className="flex flex-wrap items-center gap-3">
                  <span>{allergyError}</span>
                  {hasConflict && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalOpen(false)
                        setEditingAllergy(null)
                        setAllergyError(null)
                        setHasConflict(false)
                        void allergiesQuery.refetch()
                      }}
                      className="inline-flex min-h-9 items-center gap-1 rounded border border-red-300 bg-white px-2.5 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
                    >
                      <IconRefresh size={14} stroke={1.8} aria-hidden="true" />
                      Reload latest
                    </button>
                  )}
                </div>
              </InlineAlert>
            )}

            <div>
              <label htmlFor="allergy-substance" className={LABEL_CLASS}>
                Substance / Allergen <span className="text-rose-800">*</span>
              </label>
              <input
                id="allergy-substance"
                type="text"
                required
                maxLength={160}
                value={form.substance}
                onChange={(e) => setForm((prev) => ({ ...prev, substance: e.target.value }))}
                placeholder="e.g., Penicillin, Sulfa drugs, Peanuts"
                className={INPUT_CLASS}
                data-autofocus
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="allergy-category" className={LABEL_CLASS}>
                  Category
                </label>
                <select
                  id="allergy-category"
                  value={form.category}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, category: e.target.value as AllergyCategory }))
                  }
                  className={INPUT_CLASS}
                >
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="allergy-severity" className={LABEL_CLASS}>
                  Severity
                </label>
                <select
                  id="allergy-severity"
                  value={form.severity}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, severity: e.target.value as AllergySeverity }))
                  }
                  className={INPUT_CLASS}
                >
                  {SEVERITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="allergy-status" className={LABEL_CLASS}>
                  Status
                </label>
                <select
                  id="allergy-status"
                  value={form.status}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, status: e.target.value as AllergyStatus }))
                  }
                  className={INPUT_CLASS}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="allergy-reaction" className={LABEL_CLASS}>
                Reaction
              </label>
              <textarea
                id="allergy-reaction"
                rows={2}
                maxLength={2000}
                value={form.reaction}
                onChange={(e) => setForm((prev) => ({ ...prev, reaction: e.target.value }))}
                placeholder="e.g., Urticaria / rash, facial swelling, bronchospasm"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label htmlFor="allergy-clinical-notes" className={LABEL_CLASS}>
                Clinical Notes
              </label>
              <textarea
                id="allergy-clinical-notes"
                rows={3}
                maxLength={4000}
                value={form.clinicalNotes}
                onChange={(e) => setForm((prev) => ({ ...prev, clinicalNotes: e.target.value }))}
                placeholder="Optional verification details, onset context, or avoidance guidance"
                className={INPUT_CLASS}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={closeModal}
                disabled={createAllergy.isPending || updateAllergy.isPending}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createAllergy.isPending || updateAllergy.isPending}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {createAllergy.isPending || updateAllergy.isPending
                  ? 'Saving…'
                  : editingAllergy
                    ? 'Save Changes'
                    : 'Record Allergy'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add / Edit Longitudinal Condition Modal (DOCTOR with encounter:write only) */}
      {canWriteConditions && (
        <Modal
          open={conditionModalOpen}
          onClose={closeConditionModal}
          title={
            editingCondition
              ? `Edit Condition — ${editingCondition.condition_name}`
              : 'Add Longitudinal Condition'
          }
          description="Track chronic or active clinical conditions across visits on the patient's longitudinal problem list."
          variant="info"
          busy={createCondition.isPending || updateCondition.isPending}
          className="max-w-xl"
        >
          <form onSubmit={(e) => void handleConditionSubmit(e)} className="space-y-4">
            {conditionError && (
              <InlineAlert tone="error">
                <div className="flex flex-wrap items-center gap-3">
                  <span>{conditionError}</span>
                  {conditionConflict && (
                    <button
                      type="button"
                      onClick={() => {
                        setConditionModalOpen(false)
                        setEditingCondition(null)
                        setConditionError(null)
                        setConditionConflict(false)
                        void conditionsQuery.refetch()
                      }}
                      className="inline-flex min-h-9 items-center gap-1 rounded border border-red-300 bg-white px-2.5 text-xs font-semibold text-red-900 hover:bg-red-50 cursor-pointer"
                    >
                      <IconRefresh size={14} stroke={1.8} aria-hidden="true" />
                      Reload latest
                    </button>
                  )}
                </div>
              </InlineAlert>
            )}

            <div>
              <label htmlFor="condition-name" className={LABEL_CLASS}>
                Condition Name <span className="text-rose-800">*</span>
              </label>
              <input
                id="condition-name"
                type="text"
                required
                minLength={2}
                maxLength={255}
                value={conditionForm.conditionName}
                onChange={(e) =>
                  setConditionForm((prev) => ({ ...prev, conditionName: e.target.value }))
                }
                placeholder="e.g., Lumbar radiculopathy, Type 2 diabetes mellitus"
                className={INPUT_CLASS}
                data-autofocus
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="condition-icd10" className={LABEL_CLASS}>
                  ICD-10 Code
                </label>
                <input
                  id="condition-icd10"
                  type="text"
                  maxLength={20}
                  value={conditionForm.icd10Code}
                  onChange={(e) =>
                    setConditionForm((prev) => ({ ...prev, icd10Code: e.target.value }))
                  }
                  placeholder="e.g., M54.16, E11.9"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label htmlFor="condition-status" className={LABEL_CLASS}>
                  Status
                </label>
                <select
                  id="condition-status"
                  value={conditionForm.status}
                  onChange={(e) =>
                    setConditionForm((prev) => ({
                      ...prev,
                      status: e.target.value as ConditionStatus,
                    }))
                  }
                  className={INPUT_CLASS}
                >
                  {CONDITION_STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="condition-onset-date" className={LABEL_CLASS}>
                  Onset Date
                </label>
                <input
                  id="condition-onset-date"
                  type="date"
                  value={conditionForm.onsetDate}
                  onChange={(e) =>
                    setConditionForm((prev) => ({ ...prev, onsetDate: e.target.value }))
                  }
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label htmlFor="condition-resolved-date" className={LABEL_CLASS}>
                  Resolved Date
                </label>
                <input
                  id="condition-resolved-date"
                  type="date"
                  value={conditionForm.resolvedDate}
                  onChange={(e) =>
                    setConditionForm((prev) => ({ ...prev, resolvedDate: e.target.value }))
                  }
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div>
              <label htmlFor="condition-notes" className={LABEL_CLASS}>
                Clinical Notes
              </label>
              <textarea
                id="condition-notes"
                rows={3}
                maxLength={4000}
                value={conditionForm.notes}
                onChange={(e) =>
                  setConditionForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Optional clinical context, severity, or management summary"
                className={INPUT_CLASS}
              />
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={closeConditionModal}
                disabled={createCondition.isPending || updateCondition.isPending}
                className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createCondition.isPending || updateCondition.isPending}
                className="inline-flex min-h-11 items-center rounded-lg bg-brand-700 px-4 text-sm font-semibold text-white shadow-2xs hover:bg-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 disabled:opacity-50 cursor-pointer transition-colors"
              >
                {createCondition.isPending || updateCondition.isPending
                  ? 'Saving…'
                  : editingCondition
                    ? 'Save Condition'
                    : 'Add Condition'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
