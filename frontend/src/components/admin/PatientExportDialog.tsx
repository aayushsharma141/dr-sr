import { useState, type FormEvent } from 'react'
import { getCsrfToken } from '../../api/client'
import type { PatientExportRequest } from '../../api/types'
import { istToday } from '../../format'
import { Modal } from '../Modal'

export interface PatientExportDialogProps {
  open: boolean
  onClose: () => void
  onExportSuccess?: (filename?: string) => void
}

interface FieldOption {
  key: string
  label: string
}

interface FieldGroup {
  id: string
  title: string
  isClinical?: boolean
  fields: FieldOption[]
}

const FIELD_GROUPS: FieldGroup[] = [
  {
    id: 'demographics',
    title: 'Group 1: Core Demographics',
    fields: [
      { key: 'full_name', label: 'Full Name' },
      { key: 'urn', label: 'URN' },
      { key: 'guardian_name', label: 'Guardian Name' },
      { key: 'gender', label: 'Gender' },
      { key: 'age_years', label: 'Age' },
      { key: 'mobile', label: 'Mobile Number' },
      { key: 'address', label: 'Address' },
      { key: 'district', label: 'District' },
      { key: 'state', label: 'State' },
    ],
  },
  {
    id: 'administrative',
    title: 'Group 2: Administrative Identifiers',
    fields: [
      { key: 'emergency_contact', label: 'Emergency Contact' },
      { key: 'legacy_urn', label: 'Legacy URN' },
    ],
  },
  {
    id: 'notes',
    title: 'Group 3: Patient Profile Notes',
    fields: [
      { key: 'allergies', label: 'Allergies' },
      { key: 'notes', label: 'Reception Patient Notes' },
    ],
  },
  {
    id: 'clinical',
    title: 'Group 4: Complete Clinical Content',
    isClinical: true,
    fields: [
      { key: 'encounters', label: 'Encounters & Consultation Notes' },
      { key: 'clinical_notes', label: 'Clinical Notes' },
      { key: 'addenda', label: 'Encounter Addenda' },
      { key: 'assessments', label: 'Specialty Assessments (Physio VAS/ROM & Ophth OD/OS)' },
      { key: 'vitals', label: 'Vitals & Calculated BMI' },
      { key: 'diagnoses', label: 'Diagnoses' },
      { key: 'prescriptions', label: 'Prescriptions & Medications' },
      { key: 'treatment_plans', label: 'Treatment Plans' },
      { key: 'sessions', label: 'Physiotherapy Session Logs' },
    ],
  },
]

const DEFAULT_SELECTED_FIELDS: string[] = [
  'full_name',
  'urn',
  'guardian_name',
  'gender',
  'age_years',
  'mobile',
  'address',
  'district',
  'state',
  'emergency_contact',
  'legacy_urn',
]

const CLINICAL_FIELD_KEYS = new Set([
  'encounters',
  'clinical_notes',
  'addenda',
  'assessments',
  'vitals',
  'diagnoses',
  'prescriptions',
  'treatment_plans',
  'sessions',
])

export function PatientExportDialog({ open, onClose, onExportSuccess }: PatientExportDialogProps) {
  // Scope states
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [departmentId, setDepartmentId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Field selection states
  const [selectedFields, setSelectedFields] = useState<string[]>(DEFAULT_SELECTED_FIELDS)

  // Export settings states
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv')
  const [reason, setReason] = useState<string>('')
  const [isExporting, setIsExporting] = useState<boolean>(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [reasonTouched, setReasonTouched] = useState<boolean>(false)

  const hasClinicalFields = selectedFields.some((f) => CLINICAL_FIELD_KEYS.has(f))
  const isReasonValid = reason.trim().length >= 5
  const hasFields = selectedFields.length > 0
  const canExport = hasFields && isReasonValid && !isExporting

  const toggleField = (fieldKey: string) => {
    setSelectedFields((prev) =>
      prev.includes(fieldKey) ? prev.filter((k) => k !== fieldKey) : [...prev, fieldKey]
    )
  }

  const toggleGroup = (group: FieldGroup) => {
    const groupKeys = group.fields.map((f) => f.key)
    const allSelected = groupKeys.every((k) => selectedFields.includes(k))
    if (allSelected) {
      setSelectedFields((prev) => prev.filter((k) => !groupKeys.includes(k)))
    } else {
      setSelectedFields((prev) => Array.from(new Set([...prev, ...groupKeys])))
    }
  }

  const handleExport = async (e: FormEvent) => {
    e.preventDefault()
    setReasonTouched(true)
    if (!canExport) return

    setIsExporting(true)
    setErrorMessage(null)
    setStatusMessage('Querying patient database and generating stream... Download will start automatically.')

    try {
      const payload: PatientExportRequest = {
        reason: reason.trim(),
        format,
        scope: {
          start_date: startDate ? startDate : null,
          end_date: endDate ? endDate : null,
          department_id: departmentId ? Number(departmentId) : null,
          search_query: searchQuery.trim() ? searchQuery.trim() : null,
        },
        fields: selectedFields,
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      const csrf = getCsrfToken()
      if (csrf) {
        headers['X-CSRF-Token'] = csrf
      }

      const res = await fetch('/api/admin/exports', {
        method: 'POST',
        headers,
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        let errMsg = 'Failed to generate export dataset.'
        try {
          const errData = await res.json()
          if (errData.message) errMsg = errData.message
          else if (errData.detail) errMsg = typeof errData.detail === 'string' ? errData.detail : JSON.stringify(errData.detail)
        } catch {
          // fallback
        }
        throw new Error(errMsg)
      }

      // Extract filename from Content-Disposition header
      let filename = `patients_export_${istToday().replace(/-/g, '')}.${format}`
      const disposition = res.headers.get('Content-Disposition')
      if (disposition && disposition.includes('filename=')) {
        const match = disposition.match(/filename="?([^"]+)"?/)
        if (match && match[1]) {
          filename = match[1]
        }
      }

      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(downloadUrl)

      setStatusMessage(null)
      onExportSuccess?.(filename)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      setErrorMessage(msg)
      setStatusMessage(null)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export Patient Dataset"
      description="Configure patient scope, field selections, format, and documented purpose."
      className="max-w-3xl"
      busy={isExporting}
    >
      <form onSubmit={handleExport} className="space-y-6 text-sm text-slate-800 dark:text-slate-200">
        {/* Error notification banner */}
        {errorMessage && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
          >
            <p className="font-semibold">Export Failed</p>
            <p className="mt-1">{errorMessage}</p>
          </div>
        )}

        {/* Progress status notification */}
        {statusMessage && (
          <div
            role="status"
            className="rounded-lg border border-blue-300 bg-blue-50 p-4 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
          >
            <p className="font-semibold">Generating Dataset Stream</p>
            <p className="mt-1">{statusMessage}</p>
          </div>
        )}

        {/* 1. Scope Configuration Card */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-750 dark:bg-slate-850">
          <h2 className="text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">
            1. Scope & Filter Parameters
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="export-start-date"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
              >
                Start Date
              </label>
              <input
                id="export-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="export-end-date"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
              >
                End Date
              </label>
              <input
                id="export-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>

            <div>
              <label
                htmlFor="export-department"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
              >
                Department
              </label>
              <select
                id="export-department"
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="">All Departments</option>
                <option value="1">Physiotherapy</option>
                <option value="2">Ophthalmology</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="export-search-query"
                className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300"
              >
                Patient Search Query (Optional)
              </label>
              <input
                id="export-search-query"
                type="text"
                value={searchQuery}
                placeholder="Name, URN, Mobile..."
                onChange={(e) => setSearchQuery(e.target.value)}
                className="mt-1 block h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* 2. Field Selection Matrix */}
        <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-750 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">
              2. Field Selection Matrix ({selectedFields.length} selected)
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSelectedFields(DEFAULT_SELECTED_FIELDS)}
                className="cursor-pointer text-xs font-medium text-[#8E1C3D] hover:underline dark:text-rose-400"
              >
                Reset Default
              </button>
              <span aria-hidden="true" className="text-slate-500 dark:text-slate-400">|</span>
              <button
                type="button"
                onClick={() => setSelectedFields([])}
                className="cursor-pointer text-xs font-medium text-slate-600 hover:underline dark:text-slate-300"
              >
                Clear All
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {FIELD_GROUPS.map((group) => {
              const groupKeys = group.fields.map((f) => f.key)
              const someSelected = groupKeys.some((k) => selectedFields.includes(k))
              const allSelected = groupKeys.every((k) => selectedFields.includes(k))

              return (
                <div
                  key={group.id}
                  className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-700/80"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 dark:border-slate-800">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                      {group.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group)}
                      className="cursor-pointer text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {allSelected ? 'Deselect Group' : someSelected ? 'Select Remaining' : 'Select Group'}
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                    {group.fields.map((f) => {
                      const isChecked = selectedFields.includes(f.key)
                      return (
                        <label
                          key={f.key}
                          className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleField(f.key)}
                            className="h-4 w-4 rounded-sm border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-700"
                          />
                          <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                            {f.label}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Clinical Export Security Callout (Amber Notice per D-20-15) */}
        {hasClinicalFields && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <div className="flex items-start gap-3">
              <svg
                className="mt-0.5 h-5 w-5 shrink-0 text-amber-800 dark:text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="2"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 7.5h.008v.008H12v-.008z"
                />
              </svg>
              <div>
                <p className="font-semibold tracking-wide">Clinical Content Access Notice</p>
                <p className="mt-1 text-xs leading-relaxed">
                  Access Notice: You are exporting sensitive medical records and consultation notes. This action is permitted for administrative governance and is recorded in the permanent audit trail with your documented justification.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* 3. Export Format & Formula Injection Security */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-750 dark:bg-slate-850">
          <h2 className="text-sm font-semibold tracking-wide text-slate-900 dark:text-slate-100">
            3. Export Format & Security Neutralization
          </h2>
          <div className="mt-3 flex flex-wrap gap-6">
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="export-format"
                value="csv"
                checked={format === 'csv'}
                onChange={() => setFormat('csv')}
                className="h-4 w-4 border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                CSV (UTF-8, Universal)
              </span>
            </label>
            <label className="flex min-h-11 cursor-pointer items-center gap-2">
              <input
                type="radio"
                name="export-format"
                value="xlsx"
                checked={format === 'xlsx'}
                onChange={() => setFormat('xlsx')}
                className="h-4 w-4 border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
              />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Microsoft Excel (.xlsx)
              </span>
            </label>
          </div>

          <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            Formula Injection Security: Values beginning with &apos;=&apos;, &apos;+&apos;, &apos;-&apos;, or &apos;@&apos; will be prepended with a single quote to prevent automated formula execution.
          </p>
        </div>

        {/* 4. Mandatory Export Justification */}
        <div>
          <label
            htmlFor="export-reason"
            className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300"
          >
            Documented Purpose / Justification for Export (Audited){' '}
            <span className="text-rose-600 dark:text-rose-400">*</span>
          </label>
          <textarea
            id="export-reason"
            rows={3}
            value={reason}
            onChange={(e) => {
              setReason(e.target.value)
              if (!reasonTouched) setReasonTouched(true)
            }}
            onBlur={() => setReasonTouched(true)}
            placeholder="Enter reason of at least 5 characters (e.g., Annual statutory accounting and clinical audit)..."
            className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 shadow-xs focus:border-[#8E1C3D] focus:ring-1 focus:ring-[#8E1C3D] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          />
          {reasonTouched && !isReasonValid && (
            <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
              Export justification must be at least 5 characters in length.
            </p>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex flex-col-reverse justify-end gap-3 pt-4 sm:flex-row border-t border-slate-200 dark:border-slate-700">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canExport}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-[#8E1C3D] px-6 py-2.5 font-medium text-white shadow-xs hover:bg-[#721631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isExporting ? 'Streaming Export...' : 'Export Patient Dataset'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
