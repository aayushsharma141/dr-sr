import { useId, useState } from 'react'
import { Link } from 'react-router'
import {
  useEncounter,
  useEncounterDiagnoses,
  useEncounterVitals,
  usePatientEncounters,
} from '../../api/queries'
import type {
  DiagnosisType,
  EncounterDiagnosisOut,
  EncounterSummary,
  VitalObservationResponse,
} from '../../api/types'
import { formatIst, withDoctorTitle } from '../../format'
import { TableSkeleton } from '../AdminSkeleton'
import { InlineAlert } from '../InlineAlert'
import {
  IconActivity,
  IconChevronDown,
  IconChevronRight,
  IconNotes,
  IconRefresh,
  IconStethoscope,
} from '../icons'

export interface PatientClinicalRecordsTabProps {
  patientId: number
}

type EncounterListItem = EncounterSummary & {
  encounter_code?: string | null
  visit_id?: number | null
  symptoms?: string | null
  clinical_notes?: string | null
}

const DIAGNOSIS_TYPE_BADGE: Record<DiagnosisType, string> = {
  PRIMARY: 'border border-rose-300 bg-rose-50 text-rose-900',
  SECONDARY: 'border border-sky-200 bg-sky-50 text-sky-900',
  PROVISIONAL: 'border border-amber-200 bg-amber-50 text-amber-900',
}

function formatVitalsEntries(vitals: VitalObservationResponse): { label: string; value: string }[] {
  const entries: { label: string; value: string }[] = []
  if (vitals.systolic_bp != null || vitals.diastolic_bp != null) {
    entries.push({
      label: 'BP',
      value: `${vitals.systolic_bp ?? '—'}/${vitals.diastolic_bp ?? '—'} mmHg`,
    })
  }
  if (vitals.pulse_bpm != null) {
    entries.push({ label: 'Pulse', value: `${vitals.pulse_bpm} bpm` })
  }
  if (vitals.temperature_f != null) {
    entries.push({ label: 'Temp', value: `${vitals.temperature_f} °F` })
  }
  if (vitals.spo2_percent != null) {
    entries.push({ label: 'SpO₂', value: `${vitals.spo2_percent}%` })
  }
  if (vitals.respiratory_rate != null) {
    entries.push({ label: 'RR', value: `${vitals.respiratory_rate} /min` })
  }
  if (vitals.weight_kg != null) {
    entries.push({ label: 'Weight', value: `${vitals.weight_kg} kg` })
  }
  if (vitals.height_cm != null) {
    entries.push({ label: 'Height', value: `${vitals.height_cm} cm` })
  }
  if (vitals.bmi != null) {
    entries.push({ label: 'BMI', value: String(vitals.bmi) })
  }
  return entries
}

function DiagnosisChip({ diag }: { diag: EncounterDiagnosisOut }) {
  return (
    <span
      className={`inline-flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium ${DIAGNOSIS_TYPE_BADGE[diag.diagnosis_type]}`}
    >
      <span className="font-bold">{diag.diagnosis_type}</span>
      {diag.icd10_code && (
        <span className="rounded bg-white/80 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-900 ring-1 ring-inset ring-slate-300">
          {diag.icd10_code}
        </span>
      )}
      <span className="font-semibold text-slate-900">{diag.diagnosis_name}</span>
      {diag.status !== 'ACTIVE' && (
        <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-xs font-medium text-slate-700">
          {diag.status}
        </span>
      )}
    </span>
  )
}

function EncounterCard({
  encounter,
  patientId,
}: {
  encounter: EncounterListItem
  patientId: number
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()

  // Lazy-load full encounter details, structured diagnoses, and vitals only when expanded.
  const detailQuery = useEncounter(expanded ? encounter.id : 0)
  const diagnosesQuery = useEncounterDiagnoses(encounter.id, expanded)
  const vitalsQuery = useEncounterVitals(expanded ? encounter.id : 0)

  const detail = detailQuery.data
  const encounterCode =
    detail?.encounter_code ?? encounter.encounter_code ?? `ENC-#${encounter.id}`
  const visitId = detail?.visit_id ?? encounter.visit_id ?? null
  const symptoms = detail?.symptoms ?? encounter.symptoms ?? ''
  const clinicalNotes = detail?.clinical_notes ?? encounter.clinical_notes ?? ''
  const legacyDiagnosis = detail?.diagnosis ?? encounter.diagnosis
  const addendaCount = detail ? detail.addenda.length : encounter.addenda_count
  const diagnoses = diagnosesQuery.data ?? []
  const vitalEntries = vitalsQuery.data ? formatVitalsEntries(vitalsQuery.data) : []

  return (
    <article
      aria-label={`Clinical encounter ${encounterCode}`}
      className="rounded-xl border border-slate-200 bg-white shadow-2xs transition-colors"
    >
      {/* Card Header */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-900 ring-1 ring-inset ring-slate-200">
                {encounterCode}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  encounter.is_finalised
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                {encounter.is_finalised ? 'Finalised' : 'Draft'}
              </span>
              {addendaCount > 0 && (
                <span className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-semibold text-sky-900">
                  {addendaCount} {addendaCount === 1 ? 'Addendum' : 'Addenda'}
                </span>
              )}
              {detail && visitId == null && (
                <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                  Legacy (no visit)
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-800">
              <span className="font-semibold text-slate-900">
                {withDoctorTitle(encounter.doctor_name)}
              </span>
              <span className="text-xs font-medium text-slate-600">
                {formatIst(encounter.encounter_date)}
              </span>
            </div>

            {legacyDiagnosis && (
              <p className="text-sm text-slate-800">
                <span className="font-semibold text-slate-700">Diagnosis:</span>{' '}
                <span>{legacyDiagnosis}</span>
              </p>
            )}

            {!expanded && symptoms && (
              <p className="line-clamp-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Chief complaint:</span> {symptoms}
              </p>
            )}
          </div>

          {/* Drill-down Links & Expand Toggle */}
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/doctor/encounters/${encounter.id}`}
              className="inline-flex min-h-10 items-center rounded-lg bg-[#5D0B26] px-3 text-xs font-semibold text-white transition hover:bg-[#7A1235] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
            >
              Open Encounter &rarr;
            </Link>
            {visitId != null && (
              <Link
                to={`/patients/${patientId}/visits/${visitId}`}
                className="inline-flex min-h-10 items-center rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-semibold text-[#8E1C3D] transition hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Open Visit Workspace &rarr;
              </Link>
            )}
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              aria-expanded={expanded}
              aria-controls={panelId}
              className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
            >
              {expanded ? (
                <IconChevronDown size={16} stroke={1.8} aria-hidden="true" />
              ) : (
                <IconChevronRight size={16} stroke={1.8} aria-hidden="true" />
              )}
              {expanded ? 'Hide Details' : 'View Details'}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Clinical Details */}
      {expanded && (
        <div
          id={panelId}
          className="space-y-4 border-t border-slate-200 bg-slate-50/60 p-4 sm:p-5"
        >
          {detailQuery.isPending ? (
            <p className="text-xs font-medium text-slate-600" role="status">
              Loading clinical encounter details…
            </p>
          ) : detailQuery.isError ? (
            <InlineAlert tone="error">
              Unable to load full encounter details: {detailQuery.error.message}
            </InlineAlert>
          ) : null}

          {/* Vitals Snapshot */}
          {vitalEntries.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                <IconActivity size={16} stroke={1.8} className="text-[#8E1C3D]" aria-hidden="true" />
                Vitals Snapshot
              </h3>
              <dl className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {vitalEntries.map((item) => (
                  <div
                    key={item.label}
                    className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5"
                  >
                    <dt className="text-xs font-medium text-slate-600">{item.label}</dt>
                    <dd className="mt-0.5 text-xs font-bold text-slate-900 tabular-nums">
                      {item.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Structured Diagnoses + Legacy Diagnosis */}
          <div className="rounded-lg border border-slate-200 bg-white p-3.5 space-y-2.5">
            <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
              <IconStethoscope
                size={16}
                stroke={1.8}
                className="text-[#8E1C3D]"
                aria-hidden="true"
              />
              Diagnoses
            </h3>

            {diagnosesQuery.isPending ? (
              <p className="text-xs text-slate-600" role="status">
                Loading structured diagnoses…
              </p>
            ) : diagnosesQuery.isError ? (
              <InlineAlert tone="error">
                Unable to load structured diagnoses: {diagnosesQuery.error.message}
              </InlineAlert>
            ) : diagnoses.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {diagnoses.map((diag) => (
                  <DiagnosisChip key={diag.id} diag={diag} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-600">
                No structured ICD-10 diagnoses recorded for this encounter.
              </p>
            )}

            {legacyDiagnosis && (
              <div className="border-t border-slate-100 pt-2 text-xs text-slate-700">
                <span className="font-semibold text-slate-800">Clinical impression:</span>{' '}
                <span className="whitespace-pre-wrap">{legacyDiagnosis}</span>
              </div>
            )}
          </div>

          {/* Chief Complaint / Symptoms & Clinical Notes */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-700">
                <IconNotes size={16} stroke={1.8} className="text-[#8E1C3D]" aria-hidden="true" />
                Chief Complaint / Symptoms
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {symptoms.trim() || 'No chief complaint recorded.'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-3.5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-700">
                Clinical Notes
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-800">
                {clinicalNotes.trim() || 'No clinical notes recorded.'}
              </p>
            </div>
          </div>

          {/* Addenda */}
          {detail && detail.addenda.length > 0 && (
            <div className="rounded-lg border border-sky-200 bg-white p-3.5 space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-sky-900">
                Dated Addenda ({detail.addenda.length})
              </h3>
              <ul className="divide-y divide-slate-100">
                {detail.addenda.map((addendum) => (
                  <li key={addendum.id} className="py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-900">
                        {withDoctorTitle(addendum.doctor_name)}
                      </span>
                      <span className="text-slate-600">{formatIst(addendum.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                      {addendum.addendum_text}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer metadata */}
          {encounter.finalised_at && (
            <p className="text-xs text-slate-600">
              Finalised on {formatIst(encounter.finalised_at)}
            </p>
          )}
        </div>
      )}
    </article>
  )
}

export function PatientClinicalRecordsTab({ patientId }: PatientClinicalRecordsTabProps) {
  const { data, isPending, isError, error, refetch, isFetching } =
    usePatientEncounters(patientId)

  const encounters: EncounterListItem[] = Array.isArray(data) ? data : []

  return (
    <section aria-labelledby="patient-clinical-records-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="patient-clinical-records-heading" className="text-base font-bold text-slate-900">
            Clinical Records
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            {encounters.length > 0
              ? `${encounters.length} ${encounters.length === 1 ? 'encounter' : 'encounters'} on file (newest first)`
              : 'Doctor consultation encounters, structured diagnoses, and clinical addenda'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          aria-label="Refresh clinical records"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
        >
          <IconRefresh size={16} stroke={1.8} aria-hidden="true" />
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isPending ? (
        <TableSkeleton label="Loading clinical records..." rows={4} columns={4} />
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load clinical encounters{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => void refetch()}
              aria-label="Retry loading clinical encounters"
              className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-900 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : encounters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm font-medium text-slate-700">
            No clinical encounters recorded for this patient yet.
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Consultations authored by doctors will appear here with diagnoses, vitals, and addenda.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {encounters.map((encounter) => (
            <EncounterCard key={encounter.id} encounter={encounter} patientId={patientId} />
          ))}
        </div>
      )}
    </section>
  )
}
