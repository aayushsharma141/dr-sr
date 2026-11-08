import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { Modal } from '../../components/Modal'
import { useBackups, useCreateBackup, useRestoreBackup, useMe } from '../../api/queries'
import type { BackupArchiveInfo } from '../../api/types'
import { PatientExportDialog } from '../../components/admin/PatientExportDialog'
import { ImportWizard } from '../../components/admin/ImportWizard'

type ArchiveKind = 'manual' | 'scheduled' | 'safety' | 'test'
type ArchiveFilter = 'all' | ArchiveKind
type ViewTab = 'archives' | 'schedule'

const RESTORE_CONFIRMATION = 'RESTORE-DATABASE-OVERWRITE'
const PAGE_SIZES = [10, 25, 50] as const

function archiveKind(archive: BackupArchiveInfo): ArchiveKind {
  const source = `${archive.filename} ${archive.label ?? ''}`.toLowerCase()
  if (/prerestore|pre-restore|safety|rollback/.test(source)) return 'safety'
  if (/matrix_test|prerestore_test|test|diagnostic/.test(source)) return 'test'
  if (/scheduled|nightly|daily|weekly|automatic|auto/.test(source)) return 'scheduled'
  return 'manual'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString()
}

function kindLabel(kind: ArchiveKind): string {
  return {
    manual: 'Manual',
    scheduled: 'Scheduled',
    safety: 'Safety snapshot',
    test: 'Test / diagnostic',
  }[kind]
}

export function BackupManagerPage() {
  const { data: me } = useMe()
  const [searchParams, setSearchParams] = useSearchParams()
  const [showImportModal, setShowImportModal] = useState(() => searchParams.get('action') === 'import')
  const [showExportDialog, setShowExportDialog] = useState(() => searchParams.get('action') === 'export')

  const clearActionParam = () => {
    if (searchParams.has('action')) {
      const next = new URLSearchParams(searchParams)
      next.delete('action')
      setSearchParams(next, { replace: true })
    }
  }

  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'import') setShowImportModal(true)
    if (action === 'export') setShowExportDialog(true)
  }, [searchParams])

  const [activeTab, setActiveTab] = useState<ViewTab>('archives')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [label, setLabel] = useState('')
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<ArchiveFilter>('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [pageSize, setPageSize] = useState<number>(10)
  const [page, setPage] = useState(1)
  const [restoreArchive, setRestoreArchive] = useState<BackupArchiveInfo | null>(null)
  const [restorePhrase, setRestorePhrase] = useState('')
  const [restoreReason, setRestoreReason] = useState('')
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error' | 'warning'; message: string } | null>(null)

  const { data, isPending, isError, error, refetch, isFetching } = useBackups()
  const createBackup = useCreateBackup()
  const restoreBackup = useRestoreBackup()

  const archives = data?.backups ?? []
  const filteredArchives = useMemo(() => {
    const query = search.trim().toLowerCase()
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null

    return archives.filter((archive) => {
      const kind = archiveKind(archive)
      const created = new Date(archive.created_at).getTime()
      const matchesQuery = !query
        || archive.filename.toLowerCase().includes(query)
        || (archive.label ?? '').toLowerCase().includes(query)
      const matchesKind = kindFilter === 'all' || kind === kindFilter
      const matchesFrom = from === null || (Number.isFinite(created) && created >= from)
      const matchesTo = to === null || (Number.isFinite(created) && created <= to)
      return matchesQuery && matchesKind && matchesFrom && matchesTo
    })
  }, [archives, dateFrom, dateTo, kindFilter, search])

  const pageCount = Math.max(1, Math.ceil(filteredArchives.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visibleArchives = filteredArchives.slice((safePage - 1) * pageSize, safePage * pageSize)
  const storageBytes = archives.reduce((sum, archive) => sum + archive.size_bytes, 0)
  const validCount = archives.filter((archive) => archive.is_valid).length
  const latestArchive = archives[0]

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)
    try {
      const created = await createBackup.mutateAsync({ label: label.trim() || undefined })
      setLabel('')
      setShowCreateForm(false)
      setFeedback({ tone: 'success', message: `Backup created: ${created.filename}` })
      await refetch()
    } catch (err) {
      setFeedback({ tone: 'error', message: `Backup could not be created: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  }

  const closeRestore = () => {
    setRestoreArchive(null)
    setRestorePhrase('')
    setRestoreReason('')
  }

  const handleRestore = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!restoreArchive || restorePhrase !== RESTORE_CONFIRMATION || restoreReason.trim().length < 10) return

    setFeedback(null)
    try {
      const result = await restoreBackup.mutateAsync({
        archive_filename: restoreArchive.filename,
        create_prerestore_snapshot: true,
        confirmation_phrase: RESTORE_CONFIRMATION,
        reason: restoreReason.trim(),
      })
      setFeedback({
        tone: 'success',
        message: `Restore completed. Safety snapshot: ${result.prerestore_snapshot || 'not reported'}.`,
      })
      closeRestore()
      await refetch()
    } catch (err) {
      setFeedback({ tone: 'error', message: `Restore failed: ${err instanceof Error ? err.message : 'Unknown error'}` })
    }
  }

  const resetFilters = () => {
    setSearch('')
    setKindFilter('all')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-5">
        <header className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs text-slate-500">
              <Link to="/admin" className="hover:text-[#5D0B26] hover:underline">Administration</Link>
              <span aria-hidden="true">/</span>
              <span>Backup & Recovery</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Backup & Restore</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Review backup copies, check archive integrity, and manage data portability (patient spreadsheet import & dataset export).
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-2xs hover:border-[#8E1C3D] hover:bg-slate-50 hover:text-[#5D0B26]"
            >
              <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import Spreadsheet
            </button>
            <button
              type="button"
              onClick={() => setShowExportDialog(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 shadow-2xs hover:border-[#8E1C3D] hover:bg-slate-50 hover:text-[#5D0B26]"
            >
              <svg className="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export Dataset
            </button>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { setActiveTab('archives'); setShowCreateForm((shown) => !shown) }}
              className="min-h-11 rounded-lg bg-[#5D0B26] px-4 text-sm font-semibold text-white hover:bg-[#4A081E] shadow-2xs"
            >
              {showCreateForm ? 'Close backup form' : 'Create backup'}
            </button>
          </div>
        </header>

        {!restoreArchive && feedback && (
          <div role={feedback.tone === 'error' ? 'alert' : 'status'} className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-sm ${
            feedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : feedback.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}>
            <span>{feedback.message}</span>
            <button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss message" className="font-bold">×</button>
          </div>
        )}

        <section aria-label="Backup overview" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Archive integrity</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{validCount} <span className="text-sm font-medium text-slate-500">/ {archives.length}</span></p>
            <p className="mt-1 text-xs text-slate-500">{archives.length > 0 && validCount === archives.length ? 'All listed archives passed the latest check' : 'Review archives that need attention'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest archive</p>
            <p className="mt-2 text-lg font-bold text-slate-900">{latestArchive ? formatDate(latestArchive.created_at) : 'No archives yet'}</p>
            <p className="mt-1 text-xs text-slate-500">{latestArchive ? (latestArchive.is_valid ? 'Integrity check passed' : 'Integrity check failed') : 'Create the first backup copy'}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Storage in listed archives</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{formatBytes(storageBytes)}</p>
            <p className="mt-1 text-xs text-slate-500">Combined size of {archives.length} archive files</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Automation status</p>
            <p className="mt-2 text-lg font-bold text-slate-900">Not reported</p>
            <p className="mt-1 text-xs text-slate-500">Schedule details are not available from the current server API</p>
          </div>
        </section>

        {/* Data Portability Cards (Import & Export) */}
        <section aria-label="Data portability and migration" className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D]">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Patient Spreadsheet Ingestion</h2>
                  <p className="text-xs text-slate-600 font-medium">8-Stage CSV/XLSX Bulk Import Pipeline</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Bulk register patients from legacy spreadsheets with automatic pre-commit safety snapshot, column header matching, and interactive duplicate candidate resolution.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-[#8E1C3D] px-4 text-xs font-bold text-white shadow-2xs hover:bg-[#741732] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              >
                Launch Import Wizard →
              </button>
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-800">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </span>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Patient Dataset Export</h2>
                  <p className="text-xs text-slate-600 font-medium">Permission-Checked CSV & Excel Stream</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Export field-selective demographic and clinical records with date range filtering, formula neutralization, and direct streaming without persistent server temp files.
              </p>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowExportDialog(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-xs font-bold text-slate-800 shadow-2xs hover:border-[#8E1C3D] hover:bg-slate-50 hover:text-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
              >
                Configure & Export Dataset →
              </button>
            </div>
          </div>
        </section>

        {showCreateForm && (
          <section className="rounded-xl border border-[#D9C7CD] bg-white p-5 shadow-sm">
            <div className="mb-3">
              <h2 className="text-base font-bold text-slate-900">Create a manual backup</h2>
              <p className="mt-1 text-sm text-slate-600">The server creates and checks a new backup copy. This may take several minutes.</p>
            </div>
            <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="backup-label" className="mb-1 block text-sm font-semibold text-slate-700">Backup label <span className="font-normal text-slate-500">(optional)</span></label>
                <input
                  id="backup-label"
                  type="text"
                  maxLength={50}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="For example: before software update"
                  className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
                />
                <p className="mt-1 text-xs text-slate-500">Use a short description that helps staff identify this copy later.</p>
              </div>
              <button type="submit" disabled={createBackup.isPending} className="min-h-11 rounded-lg bg-[#5D0B26] px-5 text-sm font-semibold text-white hover:bg-[#4A081E] disabled:cursor-not-allowed disabled:opacity-50">
                {createBackup.isPending ? 'Creating backup…' : 'Start backup'}
              </button>
            </form>
          </section>
        )}

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-slate-50 p-2" role="tablist" aria-label="Backup management views">
            <button type="button" role="tab" aria-selected={activeTab === 'archives'} onClick={() => setActiveTab('archives')} className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${activeTab === 'archives' ? 'bg-white text-[#5D0B26] shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70'}`}>
              Backup archives <span className="ml-1 text-xs text-slate-500">({archives.length})</span>
            </button>
            <button type="button" role="tab" aria-selected={activeTab === 'schedule'} onClick={() => setActiveTab('schedule')} className={`min-h-10 rounded-lg px-4 text-sm font-semibold ${activeTab === 'schedule' ? 'bg-white text-[#5D0B26] shadow-sm ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70'}`}>
              Schedule & automation
            </button>
          </div>

          {activeTab === 'schedule' ? (
            <div className="p-5 sm:p-7">
              <div className="max-w-2xl rounded-xl border border-amber-200 bg-amber-50 p-4">
                <h2 className="text-base font-bold text-amber-950">Schedule information is not connected</h2>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  The current backup API reports archive files but does not provide the active schedule, retention settings or next run time. These values are intentionally not guessed or presented as configured.
                </p>
                <p className="mt-2 text-sm leading-6 text-amber-900">
                  Ask the system administrator to confirm that automatic backups are enabled on the hospital server and that the latest scheduled run completed successfully.
                </p>
              </div>
              <div className="mt-5 rounded-lg border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-900">What is still needed to manage schedules here?</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                  <li>A server API for schedule frequency, enabled state and next run.</li>
                  <li>Approved backup destinations and retention settings.</li>
                  <li>Execution history, failure details and audit events.</li>
                </ul>
              </div>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Available backup copies</h2>
                    <p className="mt-1 text-xs text-slate-500">Integrity is checked by the server when this archive list is loaded.</p>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{filteredArchives.length} matching archives</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="xl:col-span-2">
                    <label htmlFor="backup-search" className="mb-1 block text-xs font-semibold text-slate-600">Search archives</label>
                    <input id="backup-search" type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Search filename or label…" className="min-h-10 w-full rounded-lg border border-slate-300 px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15" />
                  </div>
                  <div>
                    <label htmlFor="backup-kind" className="mb-1 block text-xs font-semibold text-slate-600">Backup type</label>
                    <select id="backup-kind" value={kindFilter} onChange={(event) => { setKindFilter(event.target.value as ArchiveFilter); setPage(1) }} className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm">
                      <option value="all">All types</option>
                      <option value="manual">Manual</option>
                      <option value="scheduled">Scheduled</option>
                      <option value="safety">Safety snapshot</option>
                      <option value="test">Test / diagnostic</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor="backup-from" className="mb-1 block text-xs font-semibold text-slate-600">From date</label>
                      <input id="backup-from" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setPage(1) }} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-xs" />
                    </div>
                    <div>
                      <label htmlFor="backup-to" className="mb-1 block text-xs font-semibold text-slate-600">To date</label>
                      <input id="backup-to" type="date" min={dateFrom || undefined} value={dateTo} onChange={(event) => { setDateTo(event.target.value); setPage(1) }} className="min-h-10 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-xs" />
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" onClick={resetFilters} className="text-xs font-semibold text-[#7B1D3B] hover:underline">Clear filters</button>
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    Rows per page
                    <select aria-label="Rows per page" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="min-h-9 rounded-lg border border-slate-300 bg-white px-2">
                      {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              {isPending && <div role="status" className="p-8 text-center text-sm text-slate-500">Loading backup archives…</div>}
              {isError && <div role="alert" className="p-8 text-center text-sm text-red-700">Backup archives could not be loaded: {error?.message}</div>}
              {!isPending && !isError && (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-left text-sm">
                      <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        <tr>
                          <th scope="col" className="px-4 py-3">Archive</th>
                          <th scope="col" className="px-4 py-3">Type</th>
                          <th scope="col" className="px-4 py-3">Created</th>
                          <th scope="col" className="px-4 py-3">Size</th>
                          <th scope="col" className="px-4 py-3">Integrity</th>
                          <th scope="col" className="px-4 py-3 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visibleArchives.length === 0 ? (
                          <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-slate-500">No archives match these filters. Try changing the search or date range.</td></tr>
                        ) : visibleArchives.map((archive) => {
                          const kind = archiveKind(archive)
                          return (
                            <tr key={archive.filename} className="hover:bg-slate-50/80">
                              <td className="max-w-[320px] px-4 py-3">
                                <p className="break-all font-mono text-xs font-semibold text-slate-800">{archive.filename}</p>
                                {archive.label && <p className="mt-1 text-xs text-slate-500">{archive.label}</p>}
                              </td>
                              <td className="px-4 py-3"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">{kindLabel(kind)}</span></td>
                              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{formatDate(archive.created_at)}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-slate-700">{formatBytes(archive.size_bytes)}</td>
                              <td className="px-4 py-3">
                                {archive.is_valid
                                  ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><span aria-hidden="true">●</span> Integrity passed</span>
                                  : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-800"><span aria-hidden="true">●</span> Check failed</span>}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <details className="relative inline-block text-left">
                                  <summary className="flex min-h-9 cursor-pointer list-none items-center rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">More actions <span className="ml-2" aria-hidden="true">⌄</span></summary>
                                  <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
                                    <button type="button" disabled={!archive.is_valid} onClick={() => { setRestoreArchive(archive); setRestorePhrase(''); setRestoreReason('') }} className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40">Restore this archive…</button>
                                  </div>
                                </details>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
                    <p className="text-xs text-slate-500">
                      {filteredArchives.length === 0 ? '0 results' : `Showing ${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, filteredArchives.length)} of ${filteredArchives.length}`}
                    </p>
                    <div className="flex items-center gap-2">
                      <button type="button" disabled={safePage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">Previous</button>
                      <span className="min-w-20 text-center text-xs tabular-nums text-slate-600">Page {safePage} of {pageCount}</span>
                      <button type="button" disabled={safePage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} className="min-h-9 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-700 disabled:opacity-40">Next</button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>

        {/* Export Configuration Dialog */}
        <PatientExportDialog
          open={showExportDialog}
          onClose={() => {
            setShowExportDialog(false)
            clearActionParam()
          }}
          onExportSuccess={(filename) => {
            setFeedback({
              tone: 'success',
              message: `Dataset export completed. File ${filename || 'export.csv'} streamed directly to your browser.`,
            })
          }}
        />

        {/* Import Wizard Modal Dialog */}
        <Modal
          open={showImportModal}
          onClose={() => {
            setShowImportModal(false)
            clearActionParam()
          }}
          title="Patient Import Centre"
          description="Staged 8-stage spreadsheet ingestion pipeline for bulk patient registration with automated pre-commit safety backup."
          variant="info"
          dismiss="closerequest"
          className="max-w-5xl w-full"
        >
          <div className="max-h-[75vh] overflow-y-auto px-1 py-2">
            <ImportWizard />
          </div>
        </Modal>

        {restoreArchive && (
          <Modal
            open
            variant="destructive"
            title="Restore hospital records?"
            onClose={closeRestore}
            busy={restoreBackup.isPending}
            className="max-w-xl"
          >
            <div className="space-y-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-red-800">Destructive operation</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">Restoring replaces the current database with the selected archive. Newer patient, treatment and payment records may be lost.</p>
              </div>
              {feedback && feedback.tone === 'error' && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
                  {feedback.message}
                </div>
              )}
              <div className="break-all rounded-lg bg-slate-50 p-3 font-mono text-xs text-slate-800">{restoreArchive.filename}</div>
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                A pre-restore safety snapshot is requested before the database is changed. The server checks archive integrity before restoration.
              </div>
              <form onSubmit={handleRestore} className="space-y-3">
                <div>
                  <label htmlFor="restore-reason" className="mb-1 block text-sm font-semibold text-slate-700">Reason for restoration <span className="text-red-700">*</span></label>
                  <textarea id="restore-reason" required minLength={10} maxLength={500} rows={3} value={restoreReason} onChange={(event) => setRestoreReason(event.target.value)} placeholder="Explain why this restore is necessary and who authorised it…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15" />
                  <p className="mt-1 text-xs text-slate-500">At least 10 characters. This reason is recorded in the audit history.</p>
                </div>
                <div>
                  <label htmlFor="restore-confirmation" className="mb-1 block text-sm font-semibold text-slate-700">Type the confirmation phrase</label>
                  <input id="restore-confirmation" required value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} autoComplete="off" spellCheck={false} placeholder={RESTORE_CONFIRMATION} className="min-h-11 w-full rounded-lg border border-slate-300 px-3 font-mono text-xs focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15" />
                </div>
                <div className="flex flex-col-reverse justify-end gap-2 border-t border-slate-200 pt-4 sm:flex-row">
                  <button type="button" data-autofocus onClick={closeRestore} disabled={restoreBackup.isPending} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                  <button type="submit" disabled={restoreBackup.isPending || restorePhrase !== RESTORE_CONFIRMATION || restoreReason.trim().length < 10} className="min-h-11 rounded-lg bg-red-800 px-4 text-sm font-bold text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-40">
                    {restoreBackup.isPending ? 'Restoring…' : 'Confirm database restoration'}
                  </button>
                </div>
              </form>
            </div>
          </Modal>
        )}
      </div>
    </AppShell>
  )
}
