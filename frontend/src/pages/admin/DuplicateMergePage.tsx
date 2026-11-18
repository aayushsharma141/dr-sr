import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { AppShell } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useMe } from '../../api/queries'
import {
  getDuplicateCandidates,
  mergePatients,
  unmergePatient,
  type DuplicateCandidatePair,
  type PatientMergeRequest,
} from '../../api/admin-data-ops'
import { IconAlertTriangle, IconCheck, IconUsers, IconHistory } from '../../components/icons'
import { toast } from '../../components/ToastHost'

interface MergedHistoryItem {
  secondaryId: number
  secondaryUrn: string
  masterUrn: string
  timestamp: string
}

const COMPARABLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'full_name', label: 'Full Name' },
  { key: 'guardian_name', label: 'Guardian' },
  { key: 'gender', label: 'Gender' },
  { key: 'age_years', label: 'Age' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'address', label: 'Address' },
  { key: 'district', label: 'District' },
  { key: 'allergies', label: 'Allergies' },
]

export function DuplicateMergePage() {
  const { data: me } = useMe()
  const [candidates, setCandidates] = useState<DuplicateCandidatePair[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Side-by-side Modal State
  const [selectedPair, setSelectedPair] = useState<DuplicateCandidatePair | null>(null)
  const [overrides, setOverrides] = useState<Record<string, any>>({})
  const [mergeReason, setMergeReason] = useState<string>('')
  const [isMerging, setIsMerging] = useState<boolean>(false)

  // Undo / Recent merges state
  const [recentMerges, setRecentMerges] = useState<MergedHistoryItem[]>([])
  const [isUnmerging, setIsUnmerging] = useState<number | null>(null)

  const fetchCandidates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await getDuplicateCandidates(50)
      setCandidates(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to load duplicate candidates')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCandidates()
  }, [fetchCandidates])

  const openCompareModal = (pair: DuplicateCandidatePair) => {
    setSelectedPair(pair)
    setOverrides({})
    setMergeReason('Duplicate patient records identified during routine administrative audit')
    setError(null)
  }

  const closeCompareModal = () => {
    setSelectedPair(null)
    setOverrides({})
    setMergeReason('')
  }

  const toggleOverride = (fieldKey: string, duplicateValue: any) => {
    setOverrides((prev) => {
      const updated = { ...prev }
      if (updated[fieldKey] !== undefined) {
        delete updated[fieldKey]
      } else {
        updated[fieldKey] = duplicateValue
      }
      return updated
    })
  }

  const handleExecuteMerge = async () => {
    if (!selectedPair) return
    if (!mergeReason.trim() || mergeReason.trim().length < 3) {
      toast.error('A valid merge reason (minimum 3 characters) is required.')
      return
    }

    try {
      setIsMerging(true)
      const payload: PatientMergeRequest = {
        master_patient_id: selectedPair.master.id,
        secondary_patient_id: selectedPair.duplicate.id,
        reason: mergeReason.trim(),
        demographic_overrides: Object.keys(overrides).length > 0 ? overrides : undefined,
      }

      await mergePatients(payload)

      setRecentMerges((prev) => [
        {
          secondaryId: selectedPair.duplicate.id,
          secondaryUrn: selectedPair.duplicate.urn,
          masterUrn: selectedPair.master.urn,
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ])

      toast.success(`Successfully merged ${selectedPair.duplicate.urn} into ${selectedPair.master.urn}.`)
      closeCompareModal()
      await fetchCandidates()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to complete patient merge')
    } finally {
      setIsMerging(false)
    }
  }

  const handleUndoMerge = async (item: MergedHistoryItem) => {
    try {
      setIsUnmerging(item.secondaryId)
      await unmergePatient(item.secondaryId, 'Administrative undo requested from UI')
      setRecentMerges((prev) => prev.filter((m) => m.secondaryId !== item.secondaryId))
      toast.success(`Reactivated patient record ${item.secondaryUrn}.`)
      await fetchCandidates()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to unmerge patient record')
    } finally {
      setIsUnmerging(null)
    }
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
    <div className="space-y-6">
      <AdminPageHeader
        title="Duplicate Patient Resolution"
        description="Review suspected duplicate patient files, resolve demographic discrepancies, and merge records under an alias pointer without tampering with historical payments."
        eyebrow="Patient & Data Management"
        icon={<IconUsers className="h-6 w-6 text-brand-700" />}
        actions={
          <button
            type="button"
            onClick={fetchCandidates}
            disabled={loading}
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Scanning...' : 'Refresh Scan'}
          </button>
        }
      />

      {/* Load Error Alert */}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <IconAlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Recent Merges Banner */}
      {recentMerges.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
            <IconHistory className="h-4 w-4" />
            <span>Recent Merges in this Session</span>
          </div>
          <div className="mt-2 divide-y divide-slate-200">
            {recentMerges.map((item) => (
              <div key={item.secondaryId} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-semibold text-slate-900">{item.secondaryUrn}</span>
                  <span className="text-slate-500"> merged into </span>
                  <span className="font-semibold text-brand-700">{item.masterUrn}</span>
                  <span className="ml-2 text-xs text-slate-600">({item.timestamp})</span>
                </div>
                <button
                  type="button"
                  onClick={() => handleUndoMerge(item)}
                  disabled={isUnmerging === item.secondaryId}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
                >
                  {isUnmerging === item.secondaryId ? 'Restoring...' : 'Undo Merge'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Suspected Pairs Table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Suspected Duplicate Records Queue ({candidates.length})
          </h2>
          <p className="mt-0.5 text-xs text-slate-600">
            Pairs matching identical 10-digit mobile phone numbers and high normalized name similarity.
          </p>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-slate-600">Scanning patient database for duplicate records...</div>
        ) : candidates.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-600">
            No suspected duplicate patient files found. Patient directory is clean.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-700">
                <tr>
                  <th className="px-4 py-3">Master Patient</th>
                  <th className="px-4 py-3">Duplicate Candidate</th>
                  <th className="px-4 py-3">Similarity</th>
                  <th className="px-4 py-3">Safety Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {candidates.map((pair, idx) => (
                  <tr key={`${pair.master.id}-${pair.duplicate.id}-${idx}`} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{pair.master.full_name}</div>
                      <div className="text-xs text-slate-600">
                        {pair.master.urn} · {pair.master.mobile} · {pair.master_visit_count} visit(s)
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{pair.duplicate.full_name}</div>
                      <div className="text-xs text-slate-600">
                        {pair.duplicate.urn} · {pair.duplicate.mobile} · {pair.duplicate_visit_count} visit(s)
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                        {Math.round(pair.similarity_score * 100)}% Match
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {pair.has_open_visit ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-800">
                          <IconAlertTriangle className="h-3.5 w-3.5 text-red-600" />
                          Open visit active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <IconCheck className="h-3.5 w-3.5 text-emerald-700" />
                          Ready for merge
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openCompareModal(pair)}
                        className="rounded-lg bg-brand-700 px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-brand-800"
                      >
                        Compare &amp; Merge
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Side-by-Side Comparison & Merge Modal */}
      <Modal
        open={selectedPair !== null}
        onClose={() => { if (!isMerging) closeCompareModal() }}
        variant="destructive"
        title="Compare & Merge Patient Records"
        busy={isMerging}
        className="max-w-3xl"
      >
        {selectedPair && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              Merging will deactivate duplicate record <span className="font-semibold">{selectedPair.duplicate.urn}</span> and
              link it to master record <span className="font-semibold">{selectedPair.master.urn}</span>. Historical clinical
              records and payments remain fully preserved.
            </p>

            {selectedPair.has_open_visit && (
              <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                <IconAlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
                <span>
                  <strong>Cannot Merge:</strong> Either the master or duplicate patient has an active open visit.
                  Please close or complete the consultation first.
                </span>
              </div>
            )}

            {/* Side-by-side Demographic Comparison */}
            <div className="rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <th className="px-3 py-2 w-1/4">Field</th>
                    <th className="px-3 py-2 w-1/3">Master ({selectedPair.master.urn})</th>
                    <th className="px-3 py-2 w-1/3">Duplicate ({selectedPair.duplicate.urn})</th>
                    <th className="px-3 py-2 text-center">Use Dup</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {COMPARABLE_FIELDS.map((f) => {
                    const masterVal = (selectedPair.master as any)[f.key] ?? '—'
                    const dupVal = (selectedPair.duplicate as any)[f.key] ?? '—'
                    const isOverridden = overrides[f.key] !== undefined
                    const isDifferent = masterVal !== dupVal

                    return (
                      <tr key={f.key} className={isOverridden ? 'bg-amber-50/50' : ''}>
                        <td className="px-3 py-2 font-medium text-slate-600">{f.label}</td>
                        <td className={`px-3 py-2 ${isOverridden ? 'line-through text-slate-600' : 'text-slate-900 font-medium'}`}>
                          {String(masterVal)}
                        </td>
                        <td className={`px-3 py-2 ${isOverridden ? 'font-bold text-brand-700' : 'text-slate-700'}`}>
                          {String(dupVal)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {isDifferent && (
                            <input
                              type="checkbox"
                              checked={isOverridden}
                              onChange={() => toggleOverride(f.key, (selectedPair.duplicate as any)[f.key])}
                              className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-700"
                              title={`Override master ${f.label} with duplicate value`}
                              aria-label={`Override master ${f.label} with duplicate value`}
                            />
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Justification Reason */}
            <div>
              <label htmlFor="merge-reason" className="block text-xs font-semibold text-slate-700">
                Administrative Justification / Reason *
              </label>
              <textarea
                id="merge-reason"
                rows={2}
                value={mergeReason}
                onChange={(e) => setMergeReason(e.target.value)}
                placeholder="Reason for merging duplicate records..."
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              />
            </div>

            {/* Modal Actions */}
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <button
                type="button"
                data-autofocus
                disabled={isMerging}
                onClick={closeCompareModal}
                className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={selectedPair.has_open_visit || isMerging || mergeReason.trim().length < 3}
                onClick={handleExecuteMerge}
                className="min-h-11 rounded-lg bg-brand-700 px-4 py-2 text-xs font-semibold text-white hover:bg-brand-800 disabled:opacity-50"
              >
                {isMerging ? 'Merging...' : 'Confirm Alias Merge'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
    </AppShell>
  )
}
