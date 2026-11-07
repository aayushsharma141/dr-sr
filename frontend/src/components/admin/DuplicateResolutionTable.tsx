import { InlineAlert } from '../InlineAlert'

export interface DuplicateCandidatePatient {
  id: number
  urn: string
  full_name: string
  guardian_name: string
  gender: string
  age_years: number
  mobile: string
  address: string
  legacy_urn?: string | null
}

export interface DuplicateRowItem {
  row_id: number
  row_index: number
  mapped_data: Record<string, any>
  duplicate_patient_id?: number | null
  duplicate_patient?: DuplicateCandidatePatient | null
  duplicate_resolution?: 'SKIP' | 'IMPORT_AS_NEW' | string | null
  validation_errors?: Record<string, any> | null
}

export interface DuplicateResolutionTableProps {
  duplicates: DuplicateRowItem[]
  resolutions: Record<number, 'SKIP' | 'IMPORT_AS_NEW'>
  onResolutionChange: (rowId: number, resolution: 'SKIP' | 'IMPORT_AS_NEW') => void
  onBulkSkip: () => void
  isResolving?: boolean
}

export function DuplicateResolutionTable({
  duplicates,
  resolutions,
  onResolutionChange,
  onBulkSkip,
  isResolving = false,
}: DuplicateResolutionTableProps) {
  if (duplicates.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-xs dark:border-slate-700 dark:bg-slate-800">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h3 className="mt-4 text-base font-semibold text-slate-900 dark:text-slate-100">
          No Duplicate Records Detected
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          All staged rows have unique mobile numbers, addresses, and names. Proceed to 'Review Import Preview' to prepare the batch for commit.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Policy and Safety Notice */}
      <InlineAlert tone="info">
        <p className="font-semibold text-blue-900">Patient Safety Policy</p>
        <p className="mt-1 text-sm text-blue-800">
          Hospital records are never overwritten. Selecting 'Import as New' will create a separate patient with a new URN.
        </p>
      </InlineAlert>

      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/60">
        <div>
          <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            {duplicates.length} Duplicate Candidate{duplicates.length > 1 ? 's' : ''} Flagged
          </h4>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            Default choice is to skip duplicates. Choose 'Import as New' only if this is a distinct individual.
          </p>
        </div>
        <button
          type="button"
          onClick={onBulkSkip}
          disabled={isResolving}
          className="min-h-[44px] cursor-pointer rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
        >
          Skip All Flagged Duplicates
        </button>
      </div>

      {/* Duplicate candidate comparison list */}
      <div className="space-y-4">
        {duplicates.map((item) => {
          const currentResolution = resolutions[item.row_id] || item.duplicate_resolution || 'SKIP'
          const staged = item.mapped_data || {}
          const existing = item.duplicate_patient

          const mobileMatch = existing && staged.mobile && staged.mobile === existing.mobile
          const addressMatch = existing && staged.address && staged.address.toLowerCase() === existing.address.toLowerCase()
          const legacyMatch = existing && staged.legacy_urn && (staged.legacy_urn === existing.legacy_urn || staged.legacy_urn === existing.urn)

          return (
            <div
              key={item.row_id}
              className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition-colors dark:border-slate-700 dark:bg-slate-800"
            >
              {/* Row header & Decision toggle */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-700/80">
                <div>
                  <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                    Row #{item.row_index}
                  </span>
                  <span className="ml-2 font-semibold text-slate-900 dark:text-slate-100">
                    {staged.full_name || 'Unnamed Patient'}
                  </span>
                  {item.validation_errors?.duplicate_reason && (
                    <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                      {item.validation_errors.duplicate_reason}
                    </p>
                  )}
                </div>

                {/* Per-row resolution segmented toggle */}
                <div
                  role="radiogroup"
                  aria-label={`Resolution for row ${item.row_index}`}
                  className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-700"
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={currentResolution === 'SKIP'}
                    onClick={() => onResolutionChange(item.row_id, 'SKIP')}
                    className={`min-h-[44px] cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-all ${currentResolution === 'SKIP'
                        ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                      }`}
                  >
                    Skip Row (Default)
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={currentResolution === 'IMPORT_AS_NEW'}
                    onClick={() => onResolutionChange(item.row_id, 'IMPORT_AS_NEW')}
                    className={`min-h-[44px] cursor-pointer rounded-md px-4 py-2 text-xs font-semibold transition-all ${currentResolution === 'IMPORT_AS_NEW'
                        ? 'bg-[#8E1C3D] text-white shadow-xs'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                      }`}
                  >
                    Import as New
                  </button>
                </div>
              </div>

              {/* Side-by-side cards comparison */}
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Proposed Staged Row */}
                <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/20">
                  <div className="flex items-center justify-between pb-2 border-b border-blue-200/60 dark:border-blue-900/60">
                    <span className="text-xs font-bold uppercase tracking-wide text-blue-900 dark:text-blue-300">
                      Import Row Data
                    </span>
                    <span className="text-xs text-blue-700 dark:text-blue-400">
                      URN: (Pending Allocation)
                    </span>
                  </div>
                  <dl className="mt-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-300">Name:</dt>
                      <dd className="font-semibold text-slate-900 dark:text-slate-100">{staged.full_name || '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-300">Guardian:</dt>
                      <dd className="font-medium text-slate-800 dark:text-slate-200">{staged.guardian_name || '—'}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-300">Age / Gender:</dt>
                      <dd className="text-slate-800 dark:text-slate-200">{staged.age_years || '—'} yrs / {staged.gender || '—'}</dd>
                    </div>
                    <div className={`flex justify-between rounded px-1.5 py-0.5 ${mobileMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                      <dt className="text-slate-600 dark:text-slate-300">Mobile:</dt>
                      <dd className={`font-semibold ${mobileMatch ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>
                        {staged.mobile || '—'}
                      </dd>
                    </div>
                    <div className={`flex justify-between rounded px-1.5 py-0.5 ${addressMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                      <dt className="text-slate-600 dark:text-slate-300">Address:</dt>
                      <dd className={`font-medium ${addressMatch ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>
                        {staged.address || '—'}
                      </dd>
                    </div>
                    {staged.legacy_urn && (
                      <div className={`flex justify-between rounded px-1.5 py-0.5 ${legacyMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                        <dt className="text-slate-600 dark:text-slate-300">Old Identifier:</dt>
                        <dd className="font-semibold text-slate-800 dark:text-slate-200">{staged.legacy_urn}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Existing Hospital Patient */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/60">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-700">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                      Existing Hospital Record
                    </span>
                    <span className="font-mono text-xs font-bold text-indigo-700 dark:text-indigo-400">
                      {existing?.urn || 'No URN'}
                    </span>
                  </div>
                  {existing ? (
                    <dl className="mt-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <dt className="text-slate-600 dark:text-slate-300">Name:</dt>
                        <dd className="font-semibold text-slate-900 dark:text-slate-100">{existing.full_name}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-600 dark:text-slate-300">Guardian:</dt>
                        <dd className="font-medium text-slate-800 dark:text-slate-200">{existing.guardian_name}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-600 dark:text-slate-300">Age / Gender:</dt>
                        <dd className="text-slate-800 dark:text-slate-200">{existing.age_years} yrs / {existing.gender}</dd>
                      </div>
                      <div className={`flex justify-between rounded px-1.5 py-0.5 ${mobileMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                        <dt className="text-slate-600 dark:text-slate-300">Mobile:</dt>
                        <dd className={`font-semibold ${mobileMatch ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>
                          {existing.mobile}
                        </dd>
                      </div>
                      <div className={`flex justify-between rounded px-1.5 py-0.5 ${addressMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                        <dt className="text-slate-600 dark:text-slate-300">Address:</dt>
                        <dd className={`font-medium ${addressMatch ? 'text-amber-900 dark:text-amber-300' : 'text-slate-800 dark:text-slate-200'}`}>
                          {existing.address}
                        </dd>
                      </div>
                      {existing.legacy_urn && (
                        <div className={`flex justify-between rounded px-1.5 py-0.5 ${legacyMatch ? 'bg-amber-100 dark:bg-amber-950/60' : ''}`}>
                          <dt className="text-slate-600 dark:text-slate-300">Old Identifier:</dt>
                          <dd className="font-semibold text-slate-800 dark:text-slate-200">{existing.legacy_urn}</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="mt-4 text-xs italic text-slate-500">Record details unavailable.</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
