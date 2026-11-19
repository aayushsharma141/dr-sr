import { useState, type FormEvent } from 'react'
import { InlineAlert } from '../InlineAlert'
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash } from '../icons'
import {
  useEncounterDiagnoses,
  useCreateEncounterDiagnosis,
  useDeleteEncounterDiagnosis,
} from '../../api/queries'
import type { DiagnosisType } from '../../api/types'

const FIELD_LABEL = 'mb-1.5 block text-xs font-medium text-slate-700'
const TEXT_FIELD =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 transition-colors duration-150 placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const STRUCTURED_DIAGNOSIS_TYPES: { value: DiagnosisType; label: string }[] = [
  { value: 'PRIMARY', label: 'Primary' },
  { value: 'SECONDARY', label: 'Secondary' },
  { value: 'PROVISIONAL', label: 'Provisional' },
]

export interface EncounterStructuredDiagnosesPanelProps {
  encounterId: number
  patientId: number
  isReadOnly: boolean
}

export function EncounterStructuredDiagnosesPanel({
  encounterId,
  patientId,
  isReadOnly,
}: EncounterStructuredDiagnosesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [diagName, setDiagName] = useState('')
  const [icd10Code, setIcd10Code] = useState('')
  const [diagType, setDiagType] = useState<DiagnosisType>('PRIMARY')
  const [promoteToCondition, setPromoteToCondition] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const diagnosesQuery = useEncounterDiagnoses(encounterId, encounterId > 0)
  const createDiagnosis = useCreateEncounterDiagnosis(encounterId, patientId || undefined)
  const deleteDiagnosis = useDeleteEncounterDiagnosis(encounterId)

  const diagnoses = Array.isArray(diagnosesQuery.data) ? diagnosesQuery.data : []

  const handleAddDiagnosis = async (e: FormEvent) => {
    e.preventDefault()
    if (isReadOnly) return
    const trimmedName = diagName.trim()
    if (trimmedName.length < 2) {
      setErrorMsg('Diagnosis name must be at least 2 characters.')
      return
    }
    setErrorMsg(null)
    try {
      await createDiagnosis.mutateAsync({
        diagnosis_name: trimmedName,
        icd10_code: icd10Code.trim() || null,
        diagnosis_type: diagType,
        promote_to_condition: promoteToCondition,
      })
      setDiagName('')
      setIcd10Code('')
      setDiagType('PRIMARY')
      setPromoteToCondition(false)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to add structured diagnosis.')
    }
  }

  const handleDeleteDiagnosis = async (diagnosisId: number) => {
    if (isReadOnly) return
    setErrorMsg(null)
    setDeletingId(diagnosisId)
    try {
      await deleteDiagnosis.mutateAsync(diagnosisId)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to remove structured diagnosis.')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div
      data-testid="structured-diagnoses-panel"
      className="border-t border-slate-200 pt-4"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-left text-sm font-semibold text-slate-900 transition-colors duration-150 hover:bg-slate-100"
      >
        <span className="flex items-center gap-2">
          {expanded ? (
            <IconChevronDown size={16} stroke={1.8} className="shrink-0" aria-hidden="true" />
          ) : (
            <IconChevronRight size={16} stroke={1.8} className="shrink-0" aria-hidden="true" />
          )}
          <span>Structured Diagnoses (ICD-10)</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200 tabular-nums">
            {diagnoses.length}
          </span>
        </span>
        <span className="text-xs font-medium text-slate-600">
          {expanded ? 'Hide' : isReadOnly ? 'View' : 'Add / View'}
        </span>
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-slate-50/40 p-3.5">
          {errorMsg && (
            <InlineAlert tone="error" onDismiss={() => setErrorMsg(null)}>
              {errorMsg}
            </InlineAlert>
          )}

          {diagnoses.length === 0 ? (
            <p className="text-xs leading-relaxed text-slate-600">
              No structured diagnoses added for this encounter yet.
            </p>
          ) : (
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {diagnoses.map((diag) => (
                <li
                  key={diag.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-rose-50 px-2 py-0.5 font-semibold text-rose-900 ring-1 ring-inset ring-rose-200">
                      {diag.diagnosis_type}
                    </span>
                    {diag.icd10_code && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono font-semibold text-slate-900 tabular-nums">
                        {diag.icd10_code}
                      </span>
                    )}
                    <span className="font-semibold text-slate-900">{diag.diagnosis_name}</span>
                    {diag.patient_condition_id != null && (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800">
                        On Problem List
                      </span>
                    )}
                  </div>
                  {!isReadOnly && (
                    <button
                      type="button"
                      disabled={deletingId === diag.id}
                      onClick={() => void handleDeleteDiagnosis(diag.id)}
                      aria-label={`Remove diagnosis ${diag.diagnosis_name}`}
                      className="inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 transition-colors duration-150 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <IconTrash size={13} stroke={1.8} className="shrink-0" aria-hidden="true" />
                      {deletingId === diag.id ? 'Removing…' : 'Remove'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!isReadOnly && (
            <form onSubmit={(e) => void handleAddDiagnosis(e)} className="space-y-3 border-t border-slate-200 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label htmlFor="enc-struct-diag-name" className={FIELD_LABEL}>
                    Diagnosis Name
                  </label>
                  <input
                    id="enc-struct-diag-name"
                    type="text"
                    required
                    minLength={2}
                    maxLength={255}
                    value={diagName}
                    onChange={(e) => setDiagName(e.target.value)}
                    placeholder="e.g. Lumbar radiculopathy"
                    className={TEXT_FIELD}
                  />
                </div>
                <div>
                  <label htmlFor="enc-struct-diag-icd10" className={FIELD_LABEL}>
                    ICD-10 Code
                  </label>
                  <input
                    id="enc-struct-diag-icd10"
                    type="text"
                    maxLength={20}
                    value={icd10Code}
                    onChange={(e) => setIcd10Code(e.target.value)}
                    placeholder="e.g. M54.16"
                    className={`${TEXT_FIELD} font-mono tabular-nums`}
                  />
                </div>
                <div>
                  <label htmlFor="enc-struct-diag-type" className={FIELD_LABEL}>
                    Type
                  </label>
                  <select
                    id="enc-struct-diag-type"
                    value={diagType}
                    onChange={(e) => setDiagType(e.target.value as DiagnosisType)}
                    className={TEXT_FIELD}
                  >
                    {STRUCTURED_DIAGNOSIS_TYPES.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-800">
                  <input
                    type="checkbox"
                    checked={promoteToCondition}
                    onChange={(e) => setPromoteToCondition(e.target.checked)}
                    className="h-4 w-4 shrink-0 rounded border-slate-300 accent-[#8E1C3D]"
                  />
                  <span>Promote to Problem List</span>
                </label>

                <button
                  type="submit"
                  disabled={createDiagnosis.isPending}
                  className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-lg bg-[#8E1C3D] px-3.5 py-2 text-xs font-medium text-white shadow-2xs transition-colors duration-150 hover:bg-[#721631] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <IconPlus size={14} stroke={1.8} className="shrink-0" aria-hidden="true" />
                  {createDiagnosis.isPending ? 'Adding…' : 'Add Diagnosis'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
