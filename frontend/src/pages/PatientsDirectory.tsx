import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { usePatients, usePatientCount, useMe } from '../api/queries'
import type {
  PatientDirectoryFilters,
  PatientDirectorySort,
  PatientDirectoryStatus,
} from '../api/types'
import { formatPaise } from '../format'
import { AppShell } from '../components/AppShell'
import { TableSkeleton } from '../components/AdminSkeleton'
import { IconSearch } from '../components/icons'

// Rows shown per page. The list endpoint returns a plain array with no total,
// so each page asks for one extra row to learn whether a next page exists.
export const PATIENTS_PAGE_SIZE = 20

const VISIT_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatVisitDate(value: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+05:30` : value
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return value
  return VISIT_DATE_FORMATTER.format(parsed)
}

export function PatientsDirectory() {
  const { data: me } = useMe()
  const navigate = useNavigate()

  const canFilterDueBalance =
    (me?.role === 'ADMIN' || me?.role === 'RECEPTION') &&
    Boolean(me?.permissions.includes('payment:read'))

  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<PatientDirectoryStatus>('active')
  const [genderFilter, setGenderFilter] = useState<'' | 'M' | 'F' | 'O'>('')
  const [districtInput, setDistrictInput] = useState('')
  const [debouncedDistrict, setDebouncedDistrict] = useState('')
  const [hasDueBalance, setHasDueBalance] = useState(false)
  const [sortBy, setSortBy] = useState<PatientDirectorySort>('recent')
  const [page, setPage] = useState(0)

  useEffect(() => {
    const next = searchInput.trim()
    if (next === debouncedQuery) return
    const handler = setTimeout(() => {
      // A new search always starts again from the first page.
      setDebouncedQuery(next)
      setPage(0)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchInput, debouncedQuery])

  useEffect(() => {
    const next = districtInput.trim()
    if (next === debouncedDistrict) return
    const handler = setTimeout(() => {
      setDebouncedDistrict(next)
      setPage(0)
    }, 300)
    return () => clearTimeout(handler)
  }, [districtInput, debouncedDistrict])

  const directoryFilters = useMemo<PatientDirectoryFilters>(
    () => ({
      status: statusFilter,
      gender: genderFilter || undefined,
      district: debouncedDistrict || undefined,
      has_due_balance: canFilterDueBalance && hasDueBalance ? true : undefined,
      sort_by: sortBy,
    }),
    [statusFilter, genderFilter, debouncedDistrict, canFilterDueBalance, hasDueBalance, sortBy],
  )

  const hasActiveFilters = Boolean(
    debouncedQuery ||
      statusFilter !== 'active' ||
      genderFilter !== '' ||
      debouncedDistrict ||
      (canFilterDueBalance && hasDueBalance),
  )

  const canResetControls =
    hasActiveFilters || Boolean(searchInput.trim()) || Boolean(districtInput.trim()) || sortBy !== 'recent'

  function handleResetFilters() {
    setSearchInput('')
    setDebouncedQuery('')
    setStatusFilter('active')
    setGenderFilter('')
    setDistrictInput('')
    setDebouncedDistrict('')
    setHasDueBalance(false)
    setSortBy('recent')
    setPage(0)
  }

  const {
    data: fetched = [],
    isPending,
    isError,
    error,
  } = usePatients(
    debouncedQuery,
    PATIENTS_PAGE_SIZE + 1,
    page * PATIENTS_PAGE_SIZE,
    undefined,
    directoryFilters,
  )

  const { data: countData } = usePatientCount(debouncedQuery, directoryFilters)
  const total = countData?.total

  const patients = fetched.slice(0, PATIENTS_PAGE_SIZE)
  const hasNextPage =
    fetched.length > PATIENTS_PAGE_SIZE || (total !== undefined && (page + 1) * PATIENTS_PAGE_SIZE < total)
  const firstRowNumber = page * PATIENTS_PAGE_SIZE + 1
  const lastRowNumber = page * PATIENTS_PAGE_SIZE + patients.length
  const totalPages = total !== undefined ? Math.max(1, Math.ceil(total / PATIENTS_PAGE_SIZE)) : undefined

  return (
    <AppShell
      name={me?.full_name || 'Staff'}
      role={me?.role || 'RECEPTION'}
    >
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Patient Records
            </h1>
            <p className="text-sm text-slate-600">
              Search and manage patients
            </p>
          </div>
          {me?.role === 'RECEPTION' && (
            <Link
              to="/reception/patients/new"
              className="inline-flex items-center justify-center px-4 py-2 bg-brand-700 text-white rounded-lg text-sm font-semibold hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 min-h-[44px] min-w-[44px] shadow-2xs transition-colors"
            >
              + New patient
            </Link>
          )}
        </div>

        {/* Search & Server-Side Filter Controls */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs space-y-3">
          <div className="relative">
            <label htmlFor="patient-search-input" className="sr-only">
              Search patients by URN, Mobile, or Name
            </label>
            <input
              id="patient-search-input"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by URN, mobile or name"
              className="w-full px-4 py-3 pl-10 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
            />
            <span
              className="pointer-events-none absolute left-3 top-3.5 text-slate-500"
              aria-hidden="true"
            >
              <IconSearch className="h-4 w-4" />
            </span>
            {searchInput && (
              <button
                type="button"
                onClick={() => {
                  setSearchInput('')
                  setDebouncedQuery('')
                  setPage(0)
                }}
                className="absolute right-3 top-3 text-slate-600 hover:text-brand-800 text-sm font-medium px-2 py-1 cursor-pointer"
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3 pt-1">
            <div className="min-w-[130px] flex-1 sm:flex-none">
              <label
                htmlFor="patient-filter-status"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Status
              </label>
              <select
                id="patient-filter-status"
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as PatientDirectoryStatus)
                  setPage(0)
                }}
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </div>

            <div className="min-w-[130px] flex-1 sm:flex-none">
              <label
                htmlFor="patient-filter-gender"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Gender
              </label>
              <select
                id="patient-filter-gender"
                value={genderFilter}
                onChange={(e) => {
                  setGenderFilter(e.target.value as '' | 'M' | 'F' | 'O')
                  setPage(0)
                }}
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              >
                <option value="">All</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other</option>
              </select>
            </div>

            <div className="min-w-[160px] flex-1 sm:max-w-[220px]">
              <label
                htmlFor="patient-filter-district"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                District
              </label>
              <input
                id="patient-filter-district"
                type="text"
                value={districtInput}
                onChange={(e) => setDistrictInput(e.target.value)}
                placeholder="Filter by district"
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-500 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              />
            </div>

            <div className="min-w-[150px] flex-1 sm:flex-none">
              <label
                htmlFor="patient-filter-sort"
                className="mb-1 block text-xs font-semibold text-slate-600"
              >
                Sort by
              </label>
              <select
                id="patient-filter-sort"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value as PatientDirectorySort)
                  setPage(0)
                }}
                className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-700 focus-visible:outline-2 focus-visible:outline-brand-700"
              >
                <option value="recent">Most Recent</option>
                <option value="name">Name A–Z</option>
                <option value="urn">URN</option>
              </select>
            </div>

            {canFilterDueBalance && (
              <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm font-medium text-slate-800 hover:bg-slate-100">
                <input
                  id="patient-filter-due-balance"
                  type="checkbox"
                  checked={hasDueBalance}
                  onChange={(e) => {
                    setHasDueBalance(e.target.checked)
                    setPage(0)
                  }}
                  className="h-4 w-4 accent-brand-700"
                />
                Has Due Balance
              </label>
            )}

            {canResetControls && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-brand-700"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Content Section */}
        {isPending ? (
          <TableSkeleton label="Loading patients..." rows={6} columns={9} />
        ) : isError ? (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 text-sm"
          >
            Failed to load patients: {error.message}
          </div>
        ) : patients.length === 0 && page > 0 ? (
          <div className="bg-white p-12 text-center rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <p className="text-base font-semibold text-slate-900">
              No more patients on this page
            </p>
            <button
              type="button"
              onClick={() => setPage(0)}
              className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[44px]"
            >
              Back to first page
            </button>
          </div>
        ) : patients.length === 0 ? (
          <div className="bg-white p-10 text-center rounded-xl border border-slate-200 shadow-2xs space-y-4">
            <div>
              <p className="text-base font-semibold text-slate-900">
                {debouncedQuery
                  ? `No patients found matching "${debouncedQuery}"`
                  : hasActiveFilters
                    ? 'No patients match the selected filters'
                    : 'No patients registered yet'}
              </p>
              <p className="text-sm text-slate-600 mt-1">
                {debouncedQuery
                  ? 'Check the spelling, or search by mobile or URN.'
                  : hasActiveFilters
                    ? 'Try adjusting or resetting your filters.'
                    : me?.role === 'RECEPTION'
                      ? 'Register the first patient.'
                      : 'No patient records are available yet.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center justify-center px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[44px]"
                >
                  Reset filters
                </button>
              )}
              {me?.role === 'RECEPTION' && (
                <Link
                  to="/reception/patients/new"
                  className="inline-flex items-center justify-center px-4 py-2 bg-brand-700 text-white rounded-lg text-sm font-semibold hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 min-h-[44px] shadow-2xs transition-colors"
                >
                  New patient
                </Link>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <div className="overflow-x-auto">
              <table className="block md:table w-full text-left text-sm text-slate-700">
                <thead className="hidden md:table-header-group bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <tr>
                    <th scope="col" className="px-4 py-3">Photo</th>
                    <th scope="col" className="px-4 py-3">URN</th>
                    <th scope="col" className="px-4 py-3">Patient Name</th>
                    <th scope="col" className="px-4 py-3">Guardian</th>
                    <th scope="col" className="px-4 py-3">Age / Gender</th>
                    <th scope="col" className="px-4 py-3">Mobile</th>
                    <th scope="col" className="px-4 py-3">District</th>
                    <th scope="col" className="px-4 py-3">Visits</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group divide-y divide-slate-200">
                  {patients.map((p) => {
                    const hasBalanceDue =
                      canFilterDueBalance &&
                      typeof p.outstanding_paise === 'number' &&
                      p.outstanding_paise > 0

                    return (
                      <tr
                        key={p.id}
                        className="block md:table-row p-4 md:p-0 space-y-1.5 md:space-y-0 hover:bg-slate-50 transition-colors"
                        data-testid={`patient-row-${p.id}`}
                      >
                        <td className="hidden md:table-cell px-4 py-3 whitespace-nowrap">
                          <div className="w-10 h-10 rounded-full border border-brand-200 bg-brand-50 flex items-center justify-center overflow-hidden">
                            {p.photo_path ? (
                              <img
                                src={`/api/patients/${p.id}/photo`}
                                alt={p.full_name}
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                  // Fallback avatar on broken/unauthorized image
                                  (e.currentTarget as HTMLImageElement).style.display = 'none'
                                }}
                              />
                            ) : (
                              <span className="text-xs font-bold text-brand-800">
                                {p.full_name.charAt(0).toUpperCase()}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="block md:table-cell md:px-4 md:py-3 whitespace-nowrap font-mono tabular-nums text-xs md:text-sm font-bold text-brand-800">
                          {p.urn}
                        </td>
                        <td className="block md:table-cell md:px-4 md:py-3 font-semibold text-slate-900 text-base md:text-sm">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{p.full_name}</span>
                            {p.is_archived && (
                              <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                                Archived
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="block md:table-cell md:px-4 md:py-3 text-xs md:text-sm text-slate-600">
                          <span className="md:hidden font-medium text-slate-500">Guardian: </span>
                          {p.guardian_name}
                        </td>
                        <td className="inline-block md:table-cell md:px-4 md:py-3 mr-3 md:mr-0 whitespace-nowrap tabular-nums text-xs md:text-sm text-slate-600">
                          {p.age_years}y / {p.gender}
                        </td>
                        <td className="inline-block md:table-cell md:px-4 md:py-3 whitespace-nowrap font-mono tabular-nums text-xs md:text-sm text-slate-700">
                          {p.mobile}
                        </td>
                        <td className="block md:table-cell md:px-4 md:py-3 text-xs md:text-sm text-slate-600">
                          <span className="md:hidden font-medium text-slate-500">District: </span>
                          {p.district}
                        </td>
                        <td className="block md:table-cell md:px-4 md:py-3 whitespace-nowrap text-xs text-slate-600">
                          <div className="flex flex-wrap md:flex-col items-center md:items-start gap-1.5 md:gap-0.5">
                            {typeof p.visit_count === 'number' ? (
                              <span className="font-semibold tabular-nums text-slate-800">
                                {p.visit_count} {p.visit_count === 1 ? 'visit' : 'visits'}
                              </span>
                            ) : (
                              <span className="text-slate-500">—</span>
                            )}
                            {p.last_visit_date && (
                              <span className="text-xs tabular-nums text-slate-600">
                                Last: {formatVisitDate(p.last_visit_date)}
                              </span>
                            )}
                            {hasBalanceDue && (
                              <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold tabular-nums text-amber-900">
                                Due {formatPaise(p.outstanding_paise as number)}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="block md:table-cell pt-2 md:pt-3 md:px-4 md:py-3 whitespace-nowrap md:text-right space-x-2">
                          {me?.role === 'DOCTOR' && (
                            <Link
                              to={`/reception/patients/${p.id}?tab=clinical`}
                              className="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold text-white bg-brand-700 hover:bg-brand-800 rounded-lg shadow-2xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 min-h-[36px] transition-colors"
                            >
                              Clinical Chart
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => navigate(`/reception/patients/${p.id}`)}
                            className="px-2.5 py-1.5 text-xs font-semibold text-brand-800 bg-brand-50 border border-brand-200 hover:bg-brand-100 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[36px] transition-colors"
                          >
                            View Card
                          </button>
                          {/* Opens the registration form pre-filled; RECEPTION only, as on the API. */}
                          {me?.role === 'RECEPTION' && (
                            <Link
                              to={`/reception/patients/${p.id}/edit`}
                              className="inline-flex items-center px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 hover:text-brand-800 hover:border-brand-300 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[36px] transition-colors"
                            >
                              Edit
                            </Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <nav
              aria-label="Patient list pages"
              className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-600"
            >
              <p role="status" className="tabular-nums">
                Showing {firstRowNumber}–{lastRowNumber}
                {total !== undefined ? ` of ${total} patients` : ''}
              </p>
              <div className="flex items-center gap-2">
                <span className="mr-1 tabular-nums">
                  Page {page + 1}
                  {totalPages !== undefined ? ` of ${totalPages}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[36px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!hasNextPage}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg focus-visible:outline-2 focus-visible:outline-brand-700 cursor-pointer min-h-[36px] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </nav>
          </div>
        )}
      </div>
    </AppShell>
  )
}
