import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { AppShell } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useMe } from '../../api/queries'
import {
  getArchivalCandidates,
  bulkArchivePatients,
  unarchivePatient,
  type ArchivalCandidateItem,
} from '../../api/admin-data-ops'
import { apiFetch } from '../../api/client'
import type { PatientOut } from '../../api/types'
import { IconAlertTriangle, IconCheck, IconServer } from '../../components/icons'
import { toast } from '../../components/ToastHost'

export function BulkArchivePage() {
  const { data: me } = useMe()
  const [tab, setTab] = useState<'candidates' | 'archived'>('candidates')

  // Candidate Filter State
  const [inactivityYears, setInactivityYears] = useState<number>(3)
  const [district, setDistrict] = useState<string>('')
  const [zeroVisitsOnly, setZeroVisitsOnly] = useState<boolean>(false)

  // Candidate Data State
  const [candidates, setCandidates] = useState<ArchivalCandidateItem[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [archiveReason, setArchiveReason] = useState<string>('Standard 3-year inactivity archival per hospital data retention policy')
  const [isArchiving, setIsArchiving] = useState<boolean>(false)

  // Archived Patients State
  const [archivedPatients, setArchivedPatients] = useState<PatientOut[]>([])
  const [loadingArchived, setLoadingArchived] = useState<boolean>(false)
  const [isUnarchiving, setIsUnarchiving] = useState<number | null>(null)

  const fetchCandidates = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSelectedIds(new Set())
      const data = await getArchivalCandidates({
        inactivity_years: inactivityYears,
        district: district.trim() || undefined,
        zero_visits_only: zeroVisitsOnly,
        limit: 100,
      })
      setCandidates(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch archival candidates')
    } finally {
      setLoading(false)
    }
  }, [inactivityYears, district, zeroVisitsOnly])

  const fetchArchivedPatients = useCallback(async () => {
    try {
      setLoadingArchived(true)
      setError(null)
      // Backend defaults to status=active; request status=archived explicitly.
      const data = await apiFetch<PatientOut[]>('/patients?status=archived&limit=100')
      setArchivedPatients(data)
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch archived patients')
    } finally {
      setLoadingArchived(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'candidates') {
      fetchCandidates()
    } else {
      fetchArchivedPatients()
    }
  }, [tab, fetchCandidates, fetchArchivedPatients])

  const eligibleCandidates = candidates.filter((c) => c.can_archive)

  const toggleSelectAll = () => {
    if (selectedIds.size === eligibleCandidates.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(eligibleCandidates.map((c) => c.patient.id)))
    }
  }

  const toggleSelectOne = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const handleExecuteBulkArchive = async () => {
    if (selectedIds.size === 0) return
    if (!archiveReason.trim() || archiveReason.trim().length < 3) {
      toast.error('Please provide an archival reason of at least 3 characters.')
      return
    }

    try {
      setIsArchiving(true)
      const res = await bulkArchivePatients({
        patient_ids: Array.from(selectedIds),
        reason: archiveReason.trim(),
      })
      toast.success(res.message || `Successfully archived ${res.archived_count} patient record(s).`)
      setIsModalOpen(false)
      setSelectedIds(new Set())
      await fetchCandidates()
    } catch (err: any) {
      toast.error(err?.message || 'Bulk archival failed')
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRestorePatient = async (patient: PatientOut) => {
    try {
      setIsUnarchiving(patient.id)
      await unarchivePatient(patient.id, 'Administrative restore requested from UI')
      toast.success(`Restored patient record ${patient.urn} to active status.`)
      await fetchArchivedPatients()
    } catch (err: any) {
      toast.error(err?.message || 'Failed to unarchive patient')
    } finally {
      setIsUnarchiving(null)
    }
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
    <div className="space-y-6">
      <AdminPageHeader
        title="Patient Record Archival"
        description="Filter and soft-archive inactive patient records with strict financial dues guards. Historical clinical records and financial audits remain immutable."
        eyebrow="Patient & Data Management"
        icon={<IconServer className="h-6 w-6 text-brand-700" />}
      />

      {/* Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setTab('candidates')}
          className={`border-b-2 px-4 py-2.5 text-xs font-semibold ${
            tab === 'candidates'
              ? 'border-brand-700 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Archival Candidates ({candidates.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('archived')}
          className={`border-b-2 px-4 py-2.5 text-xs font-semibold ${
            tab === 'archived'
              ? 'border-brand-700 text-brand-700'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Archived Patient Files
        </button>
      </div>

      {/* Load Error Alert */}
      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <IconAlertTriangle className="h-5 w-5 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {tab === 'candidates' ? (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-4 sm:items-end">
            <div>
              <label htmlFor="inactivity-years" className="block text-xs font-semibold text-slate-700">
                Inactivity (Years)
              </label>
              <input
                id="inactivity-years"
                type="number"
                min={1}
                max={20}
                value={inactivityYears}
                onChange={(e) => setInactivityYears(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
              />
            </div>
            <div>
              <label htmlFor="district-filter" className="block text-xs font-semibold text-slate-700">
                District (Optional)
              </label>
              <input
                id="district-filter"
                type="text"
                placeholder="e.g. Bhojpur"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900"
              />
            </div>
            <div className="flex items-center gap-2 pb-2">
              <input
                id="zero-visits"
                type="checkbox"
                checked={zeroVisitsOnly}
                onChange={(e) => setZeroVisitsOnly(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-700"
              />
              <label htmlFor="zero-visits" className="text-xs font-medium text-slate-700">
                Zero registered visits only
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={fetchCandidates}
                disabled={loading}
                className="w-full rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? 'Searching...' : 'Search Candidates'}
              </button>
            </div>
          </div>

          {/* Action Header */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-600">
              Selected: <strong className="text-slate-900">{selectedIds.size}</strong> eligible record(s)
            </span>
            <button
              type="button"
              disabled={selectedIds.size === 0}
              onClick={() => setIsModalOpen(true)}
              className="rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-red-800 disabled:opacity-50"
            >
              Archive Selected ({selectedIds.size})
            </button>
          </div>

          {/* Candidates Table */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            {loading ? (
              <div className="py-12 text-center text-sm text-slate-600">Scanning for archival candidates...</div>
            ) : candidates.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-600">
                No patient files meet the selected archival inactivity criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-700">
                    <tr>
                      <th className="px-4 py-3 w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.size > 0 && selectedIds.size === eligibleCandidates.length}
                          onChange={toggleSelectAll}
                          disabled={eligibleCandidates.length === 0}
                          className="h-4 w-4 rounded border-slate-300 text-brand-700"
                          title="Select all eligible"
                          aria-label="Select all eligible records"
                        />
                      </th>
                      <th className="px-4 py-3">Patient URN &amp; Name</th>
                      <th className="px-4 py-3">District</th>
                      <th className="px-4 py-3">Last Activity</th>
                      <th className="px-4 py-3">Visits</th>
                      <th className="px-4 py-3">Outstanding Dues</th>
                      <th className="px-4 py-3">Archival Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {candidates.map((c) => {
                      const isSelected = selectedIds.has(c.patient.id)
                      return (
                        <tr
                          key={c.patient.id}
                          className={`hover:bg-slate-50/50 ${isSelected ? 'bg-amber-50/30' : ''}`}
                        >
                          <td className="px-4 py-3">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={!c.can_archive}
                              onChange={() => toggleSelectOne(c.patient.id)}
                              className="h-4 w-4 rounded border-slate-300 text-brand-700 disabled:opacity-40"
                              aria-label={`Select ${c.patient.full_name} (${c.patient.urn})`}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-slate-900">{c.patient.full_name}</div>
                            <div className="text-xs text-slate-600">
                              {c.patient.urn} · {c.patient.mobile}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-700">{c.patient.district}</td>
                          <td className="px-4 py-3 text-xs text-slate-700">
                            {c.last_activity_date ? c.last_activity_date : 'No recorded activity'}
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-slate-900">{c.visit_count}</td>
                          <td className="px-4 py-3">
                            {c.total_dues_paise > 0 ? (
                              <span className="font-semibold text-red-700">
                                ₹{(c.total_dues_paise / 100).toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-emerald-700">₹0.00</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {c.can_archive ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                <IconCheck className="h-3.5 w-3.5 text-emerald-700" />
                                Eligible
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700" title={c.blocking_reason || ''}>
                                <IconAlertTriangle className="h-3.5 w-3.5 text-red-600" />
                                {c.blocking_reason}
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Archived Patients List */
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Archived Patient Files ({archivedPatients.length})
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Records marked inactive per data retention policy. They can be restored at any time.
            </p>
          </div>

          {archivedPatients.length >= 100 && (
            <div role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs font-medium text-amber-900">
              Showing first 100 archived patient records. Use Patient Records with the Archived filter to search older entries.
            </div>
          )}

          {loadingArchived ? (
            <div className="py-12 text-center text-sm text-slate-600">Loading archived records...</div>
          ) : archivedPatients.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-600">No archived patient records found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50/75 text-xs font-semibold text-slate-700">
                  <tr>
                    <th className="px-4 py-3">Patient URN &amp; Name</th>
                    <th className="px-4 py-3">Archived At</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {archivedPatients.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-900">{p.full_name}</div>
                        <div className="text-xs text-slate-600">{p.urn} · {p.mobile}</div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {p.archived_at ? new Date(p.archived_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-700">{p.archive_reason || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRestorePatient(p)}
                          disabled={isUnarchiving === p.id}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-50"
                        >
                          {isUnarchiving === p.id ? 'Restoring...' : 'Restore Record'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => { if (!isArchiving) setIsModalOpen(false) }}
        variant="destructive"
        title="Confirm Bulk Archival"
        busy={isArchiving}
        className="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-600">
            You are about to soft-archive <strong className="text-slate-900">{selectedIds.size}</strong> patient file(s).
            Archived files will be excluded from standard active searches and check-ins, but can be restored by an
            administrator.
          </p>

          <div>
            <label htmlFor="archive-reason" className="block text-xs font-semibold text-slate-700">
              Archival Justification / Policy Reason *
            </label>
            <textarea
              id="archive-reason"
              rows={3}
              value={archiveReason}
              onChange={(e) => setArchiveReason(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs text-slate-900 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              data-autofocus
              disabled={isArchiving}
              onClick={() => setIsModalOpen(false)}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isArchiving || archiveReason.trim().length < 3}
              onClick={handleExecuteBulkArchive}
              className="min-h-11 rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {isArchiving ? 'Archiving...' : `Archive ${selectedIds.size} Files`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
    </AppShell>
  )
}
