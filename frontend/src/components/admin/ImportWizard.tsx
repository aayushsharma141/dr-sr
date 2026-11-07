import React, { useState, useRef } from 'react'
import { apiFetch, ApiError } from '../../api/client'
import { InlineAlert } from '../InlineAlert'
import { Modal } from '../Modal'
import {
  DuplicateResolutionTable,
  type DuplicateRowItem,
} from './DuplicateResolutionTable'

export type ImportStage =
  | 'upload'
  | 'inspect'
  | 'map'
  | 'validate'
  | 'resolve'
  | 'preview'
  | 'commit'
  | 'reconcile'

const STAGES: { id: ImportStage; number: number; label: string }[] = [
  { id: 'upload', number: 1, label: 'Upload' },
  { id: 'inspect', number: 2, label: 'Inspect' },
  { id: 'map', number: 3, label: 'Map' },
  { id: 'validate', number: 4, label: 'Validate' },
  { id: 'resolve', number: 5, label: 'Resolve' },
  { id: 'preview', number: 6, label: 'Preview' },
  { id: 'commit', number: 7, label: 'Commit' },
  { id: 'reconcile', number: 8, label: 'Reconcile' },
]

export const CANONICAL_FIELD_LABELS: Record<string, string> = {
  full_name: 'Full Name *',
  guardian_name: 'Guardian Name *',
  gender: 'Gender (M/F/O) *',
  age_years: 'Age (Years) *',
  dob: 'Date of Birth',
  mobile: 'Mobile Number *',
  address: 'Address / Village *',
  district: 'District',
  state: 'State',
  emergency_contact: 'Emergency Contact',
  legacy_urn: 'Legacy / Prior Hospital URN',
}

interface InspectResponse {
  filename: string
  file_type: string
  encoding: string | null
  delimiter: string | null
  total_rows: number
  headers: string[]
  sample_rows: Record<string, any>[]
  suggested_mapping: Record<string, string>
  canonical_fields: string[]
}

interface BatchSummary {
  batch_id: string
  filename: string
  total_rows: number
  valid_rows: number
  duplicate_rows: number
  invalid_rows: number
  committed_rows: number
  status: string
  safety_backup_file?: string | null
}

interface CommitResult {
  batch_id: string
  status: string
  committed_rows: number
  safety_backup_file?: string | null
  urn_range_start?: string | null
  urn_range_end?: string | null
}

export function ImportWizard() {
  const [currentStage, setCurrentStage] = useState<ImportStage>('upload')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [inspectData, setInspectData] = useState<InspectResponse | null>(null)
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({})
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateRowItem[]>([])
  const [resolutions, setResolutions] = useState<Record<number, 'SKIP' | 'IMPORT_AS_NEW'>>({})
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)

  // Status & error states
  const [isLoading, setIsLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<{ title: string; body: string } | null>(null)
  const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
  const [isCommitting, setIsCommitting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const stageIndex = STAGES.findIndex((s) => s.id === currentStage)

  // --- Stage 1: Upload & Inspect Trigger ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      if (file.size > 10 * 1024 * 1024) {
        setErrorMessage({
          title: 'File Too Large',
          body: 'File size exceeds maximum allowed 10 MB limit. Please select a smaller file.',
        })
        return
      }
      setSelectedFile(file)
      setErrorMessage(null)
    }
  }

  const handleUploadAndInspect = async () => {
    if (!selectedFile) return
    setIsLoading(true)
    setLoadingMessage('Analyzing spreadsheet structure and detecting encoding...')
    setErrorMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)

      const result = await apiFetch<InspectResponse>('/admin/imports/inspect', {
        method: 'POST',
        body: formData,
      })

      setInspectData(result)
      // Seed initial column mapping with server suggestions
      const initialMap: Record<string, string> = {}
      for (const h of result.headers) {
        initialMap[h] = result.suggested_mapping[h] || ''
      }
      setColumnMapping(initialMap)
      setCurrentStage('inspect')
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      setErrorMessage({
        title: 'The uploaded file cannot be parsed.',
        body:
          apiErr?.message ||
          'Ensure the file is a valid CSV or XLSX spreadsheet under 10 MB with standard column headers. Save as UTF-8 in Excel and try again.',
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  // --- Stage 3: Map Columns & Stage Batch ---
  const handleConfirmMappingAndStage = async () => {
    if (!selectedFile) return
    setIsLoading(true)
    setLoadingMessage('Staging spreadsheet rows into isolation staging table...')
    setErrorMessage(null)

    try {
      const formData = new FormData()
      formData.append('file', selectedFile)
      formData.append('column_mapping', JSON.stringify(columnMapping))

      const batch = await apiFetch<BatchSummary>('/admin/imports', {
        method: 'POST',
        body: formData,
      })

      setBatchSummary(batch)
      setCurrentStage('validate')
      // Automatically run validation when entering validate stage
      await handleRunValidation(batch.batch_id)
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      setErrorMessage({
        title: 'Staging Failed',
        body: apiErr?.message || 'Could not stage spreadsheet rows. Please review column mappings.',
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  // --- Stage 4: Run Validation ---
  const handleRunValidation = async (batchId?: string) => {
    const id = batchId || batchSummary?.batch_id
    if (!id) return
    setIsLoading(true)
    setLoadingMessage('Validating row demographics and checking duplicate candidates...')
    setErrorMessage(null)

    try {
      const summary = await apiFetch<BatchSummary>(`/admin/imports/${id}/validate`, {
        method: 'POST',
      })
      setBatchSummary((prev) => (prev ? { ...prev, ...summary } : summary))

      // Fetch duplicate rows if any flagged
      if (summary.duplicate_rows > 0) {
        const dupResponse = await apiFetch<{ batch_id: string; duplicates: DuplicateRowItem[] }>(
          `/admin/imports/${id}/duplicates`
        )
        setDuplicates(dupResponse.duplicates || [])
        // Initialize decisions as SKIP (default)
        const initRes: Record<number, 'SKIP' | 'IMPORT_AS_NEW'> = {}
        dupResponse.duplicates.forEach((d) => {
          initRes[d.row_id] = (d.duplicate_resolution as 'SKIP' | 'IMPORT_AS_NEW') || 'SKIP'
        })
        setResolutions(initRes)
      } else {
        setDuplicates([])
      }
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      setErrorMessage({
        title: 'Validation Failed',
        body: apiErr?.message || 'Row validation could not be executed.',
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  // --- Stage 5: Resolve Duplicates ---
  const handleResolutionChange = (rowId: number, resolution: 'SKIP' | 'IMPORT_AS_NEW') => {
    setResolutions((prev) => ({ ...prev, [rowId]: resolution }))
  }

  const handleBulkSkip = () => {
    const allSkip: Record<number, 'SKIP' | 'IMPORT_AS_NEW'> = {}
    duplicates.forEach((d) => {
      allSkip[d.row_id] = 'SKIP'
    })
    setResolutions(allSkip)
  }

  const handleSaveResolutionsAndPreview = async () => {
    if (!batchSummary) return
    setIsLoading(true)
    setLoadingMessage('Recording duplicate resolution decisions...')
    setErrorMessage(null)

    try {
      if (duplicates.length > 0) {
        const payload = {
          resolutions: Object.entries(resolutions).map(([rowId, res]) => ({
            row_id: Number(rowId),
            resolution: res,
          })),
        }
        await apiFetch(`/admin/imports/${batchSummary.batch_id}/resolve`, {
          method: 'POST',
          body: payload,
        })
      }
      setCurrentStage('preview')
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      setErrorMessage({
        title: 'Resolution Save Failed',
        body: apiErr?.message || 'Could not save duplicate decisions.',
      })
    } finally {
      setIsLoading(false)
      setLoadingMessage(null)
    }
  }

  // --- Stage 7: Commit Batch ---
  const handleExecuteCommit = async () => {
    if (!batchSummary) return
    setIsCommitModalOpen(false)
    setIsCommitting(true)
    setLoadingMessage('Creating automated safety backup before committing import...')
    setErrorMessage(null)

    try {
      const result = await apiFetch<CommitResult>(`/admin/imports/${batchSummary.batch_id}/commit`, {
        method: 'POST',
      })
      setCommitResult(result)
      setCurrentStage('reconcile')
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : null
      setErrorMessage({
        title: 'Import commit aborted because pre-import safety backup failed.',
        body:
          apiErr?.message ||
          'The automated database backup encountered a disk or permission error. Check server storage space in System Health, verify backup configuration, and retry "Commit Import Batch".',
      })
    } finally {
      setIsCommitting(false)
      setLoadingMessage(null)
    }
  }

  // --- Stage 8: Error CSV Download ---
  const handleDownloadErrors = () => {
    if (!batchSummary) return
    const url = `/api/admin/imports/${batchSummary.batch_id}/errors`
    window.open(url, '_blank')
  }

  const handleResetWizard = () => {
    setSelectedFile(null)
    setInspectData(null)
    setColumnMapping({})
    setBatchSummary(null)
    setDuplicates([])
    setResolutions({})
    setCommitResult(null)
    setErrorMessage(null)
    setCurrentStage('upload')
  }

  // Count planned commit records
  const validCount = batchSummary?.valid_rows || 0
  const importAsNewCount = Object.values(resolutions).filter((r) => r === 'IMPORT_AS_NEW').length
  const totalToCommit = validCount + importAsNewCount
  const skippedCount = duplicates.length - importAsNewCount

  return (
    <div className="space-y-6">
      {/* 8-Stage Stepper Header */}
      <nav aria-label="Import Progress" className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <ol className="flex min-w-[680px] items-center justify-between">
          {STAGES.map((s, idx) => {
            const isCompleted = idx < stageIndex
            const isActive = s.id === currentStage

            return (
              <li key={s.id} className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    isCompleted
                      ? 'bg-emerald-700 text-white'
                      : isActive
                        ? 'bg-[#8E1C3D] text-white shadow-xs'
                        : 'border border-slate-300 text-slate-500 dark:border-slate-600 dark:text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    s.number
                  )}
                </div>
                <span
                  className={`text-xs font-semibold ${
                    isActive
                      ? 'text-slate-900 font-bold dark:text-slate-100'
                      : isCompleted
                        ? 'text-emerald-800 dark:text-emerald-400'
                        : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {s.label}
                </span>
                {idx < STAGES.length - 1 && (
                  <div className={`mx-2 h-0.5 w-6 sm:w-10 ${idx < stageIndex ? 'bg-emerald-600' : 'bg-slate-200 dark:bg-slate-700'}`} />
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* Global Error Banner */}
      {errorMessage && (
        <InlineAlert tone="error" onDismiss={() => setErrorMessage(null)}>
          <p className="font-bold">{errorMessage.title}</p>
          <p className="mt-1 text-sm">{errorMessage.body}</p>
        </InlineAlert>
      )}

      {/* Global Loading Spinner Banner */}
      {(isLoading || isCommitting) && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200">
          <svg className="h-5 w-5 animate-spin text-indigo-600 dark:text-indigo-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-sm font-semibold">{loadingMessage || 'Processing batch...'}</p>
        </div>
      )}

      {/* --- STAGE 1: UPLOAD --- */}
      {currentStage === 'upload' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 1: Upload Patient Spreadsheet</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Select a CSV or Microsoft Excel (.xlsx) file containing patient demographics. Files up to 10 MB are supported.
          </p>

          <div
            onClick={() => fileInputRef.current?.click()}
            className="mt-6 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center cursor-pointer transition-colors hover:border-slate-400 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:border-slate-500"
          >
            <svg className="h-12 w-12 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
              {selectedFile ? selectedFile.name : 'Drag and drop spreadsheet here, or click to browse'}
            </p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Supports .csv (UTF-8, UTF-8-BOM, Windows-1252) and .xlsx
            </p>
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Upload spreadsheet file"
              accept=".csv,.xlsx,.xls,.tsv"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {selectedFile && (
            <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-100 p-3 text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              <span>Selected: <strong className="font-semibold">{selectedFile.name}</strong> ({(selectedFile.size / 1024).toFixed(1)} KB)</span>
              <button
                type="button"
                onClick={() => setSelectedFile(null)}
                className="cursor-pointer text-red-600 hover:underline dark:text-red-400"
              >
                Clear
              </button>
            </div>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              disabled={!selectedFile || isLoading}
              onClick={handleUploadAndInspect}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#721630] disabled:opacity-50"
            >
              Upload Import File
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 2: INSPECT --- */}
      {currentStage === 'inspect' && inspectData && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 2: File Structure Inspection</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Spreadsheet encoding and headers were analyzed automatically.
              </p>
            </div>
            <div className="flex gap-2">
              <span className="rounded-md bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-900 dark:bg-blue-950 dark:text-blue-300">
                Format: {inspectData.file_type.toUpperCase()}
              </span>
              <span className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-800 dark:bg-slate-700 dark:text-slate-200">
                Encoding: {inspectData.encoding || 'N/A'}
              </span>
              <span className="rounded-md bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
                Total Rows: {inspectData.total_rows}
              </span>
            </div>
          </div>

          {/* Sample rows table */}
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Sample Data Preview (First 5 Rows)
            </h3>
            <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs dark:divide-slate-700">
                <thead className="bg-slate-50 font-bold text-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                  <tr>
                    {inspectData.headers.map((h, i) => (
                      <th key={i} className="px-3 py-2.5 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-800">
                  {inspectData.sample_rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-50/50 dark:hover:bg-slate-700/50">
                      {inspectData.headers.map((h, cIdx) => (
                        <td key={cIdx} className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {row[h] !== undefined && row[h] !== '' ? String(row[h]) : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentStage('upload')}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Back to Upload
            </button>
            <button
              type="button"
              onClick={() => setCurrentStage('map')}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630]"
            >
              Confirm File Inspection
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 3: MAP --- */}
      {currentStage === 'map' && inspectData && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 3: Column Mapping</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Map spreadsheet columns to canonical hospital demographic fields. Columns marked with (*) are required for registration.
          </p>

          <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 font-bold text-slate-800 dark:bg-slate-900/50 dark:text-slate-200">
                <tr>
                  <th className="px-4 py-3">Spreadsheet Column Header</th>
                  <th className="px-4 py-3">Sample Value</th>
                  <th className="px-4 py-3">Target Patient Field</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-800">
                {inspectData.headers.map((header) => {
                  const sampleVal = inspectData.sample_rows[0]?.[header] || '—'
                  const mappedField = columnMapping[header] || ''

                  return (
                    <tr key={header}>
                      <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                        {header}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                        {String(sampleVal)}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          aria-label={`Target field for ${header}`}
                          value={mappedField}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({ ...prev, [header]: e.target.value }))
                          }
                          className="min-h-[44px] w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 shadow-xs focus:border-indigo-500 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                        >
                          <option value="">(Ignore Column)</option>
                          {Object.entries(CANONICAL_FIELD_LABELS).map(([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentStage('inspect')}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Back to Inspect
            </button>
            <button
              type="button"
              disabled={isLoading}
              onClick={handleConfirmMappingAndStage}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630] disabled:opacity-50"
            >
              Confirm Column Mapping
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 4: VALIDATE --- */}
      {currentStage === 'validate' && batchSummary && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 4: Batch Validation Results</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Staged records verified against required hospital invariants (D-20-10).
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleRunValidation()}
              disabled={isLoading}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
            >
              Run Batch Validation
            </button>
          </div>

          {/* Validation Metrics Grid */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Rows</span>
              <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{batchSummary.total_rows}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Valid Rows</span>
              <p className="mt-2 text-2xl font-bold text-emerald-900 dark:text-emerald-200">{batchSummary.valid_rows}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/60 dark:bg-amber-950/30">
              <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">Duplicate Candidates</span>
              <p className="mt-2 text-2xl font-bold text-amber-900 dark:text-amber-200">{batchSummary.duplicate_rows}</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/30">
              <span className="text-xs font-semibold text-red-800 dark:text-red-300">Invalid Rows</span>
              <p className="mt-2 text-2xl font-bold text-red-900 dark:text-red-200">{batchSummary.invalid_rows}</p>
            </div>
          </div>

          {batchSummary.invalid_rows === 0 ? (
            <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 text-center dark:border-emerald-900 dark:bg-emerald-950/20">
              <h3 className="text-base font-semibold text-emerald-900 dark:text-emerald-200">Zero Validation Errors</h3>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-300">
                All staged records satisfy required demographic formats. Click 'Review Import Preview' to verify batch counts.
              </p>
            </div>
          ) : (
            <div className="mt-6">
              <InlineAlert tone="error">
                <p className="font-semibold text-red-900">
                  {batchSummary.invalid_rows} Invalid Row{batchSummary.invalid_rows > 1 ? 's' : ''} Held Back
                </p>
                <p className="mt-1 text-xs text-red-800">
                  Rows missing required fields (name, guardian, gender, age, mobile, address) will not be committed. They do not block valid rows and can be downloaded as an error CSV in the Reconcile step (D-20-10).
                </p>
              </InlineAlert>
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentStage('map')}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Back to Mapping
            </button>
            <button
              type="button"
              onClick={() => {
                if (batchSummary.duplicate_rows > 0) {
                  setCurrentStage('resolve')
                } else {
                  setCurrentStage('preview')
                }
              }}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630]"
            >
              {batchSummary.duplicate_rows > 0 ? 'Resolve Duplicate Records' : 'Review Import Preview'}
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 5: RESOLVE --- */}
      {currentStage === 'resolve' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="border-b border-slate-200 pb-4 dark:border-slate-700">
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 5: Duplicate Resolution</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Flagged candidates matched against existing hospital patients by mobile, address, or old URN (D-20-13).
            </p>
          </div>

          <div className="mt-6">
            <DuplicateResolutionTable
              duplicates={duplicates}
              resolutions={resolutions}
              onResolutionChange={handleResolutionChange}
              onBulkSkip={handleBulkSkip}
              isResolving={isLoading}
            />
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentStage('validate')}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Back to Validation
            </button>
            <button
              type="button"
              onClick={handleSaveResolutionsAndPreview}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630]"
            >
              Resolve Duplicate Records
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 6: PREVIEW --- */}
      {currentStage === 'preview' && batchSummary && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 6: Import Preview & Confirmation</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Review the final batch composition before initiating commit.
          </p>

          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-6 dark:border-slate-700 dark:bg-slate-900/40">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide dark:text-slate-100">
              Batch Summary: {batchSummary.filename}
            </h3>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 text-xs">
              <div className="rounded-lg bg-white p-3 shadow-xs dark:bg-slate-800">
                <dt className="text-slate-600 dark:text-slate-300">Total Rows in File</dt>
                <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{batchSummary.total_rows}</dd>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3 shadow-xs dark:bg-emerald-950/40">
                <dt className="text-emerald-800 dark:text-emerald-300">Valid Records to Commit</dt>
                <dd className="mt-1 text-xl font-bold text-emerald-900 dark:text-emerald-200">{totalToCommit}</dd>
              </div>
              <div className="rounded-lg bg-amber-50 p-3 shadow-xs dark:bg-amber-950/40">
                <dt className="text-amber-800 dark:text-amber-300">Duplicates Skipped</dt>
                <dd className="mt-1 text-xl font-bold text-amber-900 dark:text-amber-200">{skippedCount}</dd>
              </div>
              <div className="rounded-lg bg-red-50 p-3 shadow-xs dark:bg-red-950/40">
                <dt className="text-red-800 dark:text-red-300">Invalid Rows Held Back</dt>
                <dd className="mt-1 text-xl font-bold text-red-900 dark:text-red-200">{batchSummary.invalid_rows}</dd>
              </div>
            </dl>
          </div>

          <div className="mt-6">
            <InlineAlert tone="info">
              <p className="font-semibold text-blue-900">Safety Backup Notice</p>
              <p className="mt-1 text-xs text-blue-800">
                Committing will trigger an automatic pre-import safety backup. URNs will be sequentially allocated only for committed records. Import batches cannot be bulk deleted.
              </p>
            </InlineAlert>
          </div>

          <div className="mt-6 flex justify-between">
            <button
              type="button"
              onClick={() => setCurrentStage(duplicates.length > 0 ? 'resolve' : 'validate')}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={totalToCommit === 0}
              onClick={() => setIsCommitModalOpen(true)}
              className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630] disabled:opacity-50"
            >
              Commit Import Batch
            </button>
          </div>
        </div>
      )}

      {/* --- STAGE 8: RECONCILE --- */}
      {currentStage === 'reconcile' && commitResult && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center gap-3 border-b border-slate-200 pb-4 dark:border-slate-700">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Step 8: Batch Reconciliation</h2>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Patient records committed successfully to hospital database with gap-free URN sequence (D-20-09).
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Allocated URN Range</span>
              <p className="mt-2 font-mono text-base font-bold text-emerald-900 dark:text-emerald-200">
                {commitResult.urn_range_start && commitResult.urn_range_end
                  ? `${commitResult.urn_range_start} → ${commitResult.urn_range_end}`
                  : 'N/A'}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Patients Committed</span>
              <p className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">{commitResult.committed_rows}</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 dark:border-blue-900/60 dark:bg-blue-950/30">
              <span className="text-xs font-semibold text-blue-800 dark:text-blue-300">Safety Backup Archive</span>
              <p className="mt-2 text-xs font-mono font-medium text-blue-900 truncate dark:text-blue-200">
                {commitResult.safety_backup_file || 'Automated bundle'}
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-6 dark:border-slate-700">
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Download a CSV file containing invalid or skipped rows along with exact failure reasons for offline correction.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleDownloadErrors}
                className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
              >
                Download Error Records
              </button>
              <button
                type="button"
                onClick={handleResetWizard}
                className="min-h-[44px] cursor-pointer rounded-lg bg-[#8E1C3D] px-6 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721630]"
              >
                Import Another Register
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Commit (Copywriting contract enforced) */}
      <Modal
        open={isCommitModalOpen}
        onClose={() => setIsCommitModalOpen(false)}
        variant="destructive"
        title="Commit Import Batch"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-700 dark:text-slate-300">
            Are you sure you want to commit {totalToCommit} valid patient records to the hospital database? This will automatically generate a safety backup and assign gap-free URNs. Imported records cannot be bulk-deleted. Click 'Confirm Batch Commit' to execute or 'Cancel Batch Commit' to review staging rows.
          </p>
          <div className="flex justify-end gap-3 pt-4 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => setIsCommitModalOpen(false)}
              className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel Batch Commit
            </button>
            <button
              type="button"
              onClick={handleExecuteCommit}
              className="min-h-[44px] cursor-pointer rounded-lg bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-xs hover:bg-red-800"
            >
              Confirm Batch Commit
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
