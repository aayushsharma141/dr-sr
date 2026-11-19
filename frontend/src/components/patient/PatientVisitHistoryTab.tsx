import { useState } from 'react'
import { Link } from 'react-router'
import { usePatientVisits } from '../../api/queries'
import type { EncounterLinkBrief, PatientVisitHistoryItem, Role } from '../../api/types'
import { formatPaise, formatToken, withDoctorTitle } from '../../format'
import { TableSkeleton } from '../AdminSkeleton'
import { InlineAlert } from '../InlineAlert'

export interface PatientVisitHistoryTabProps {
  patientId: number
  role: Role
}

const PAGE_LIMIT = 20

const IST_VISIT_DATE_FORMATTER = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatVisitDateIst(visitDate: string): string {
  const trimmed = visitDate.trim()
  if (!trimmed) return '—'
  // Date-only ISO strings (YYYY-MM-DD) are anchored to IST midnight so local TZ never shifts the day.
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00+05:30`)
    : new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return IST_VISIT_DATE_FORMATTER.format(parsed)
}

function formatSafePaise(paise: number): string {
  return paise < 0 ? `-${formatPaise(Math.abs(paise))}` : formatPaise(paise)
}

function visitStatusBadgeClass(status: string): string {
  switch (status.toUpperCase()) {
    case 'OPEN':
      return 'bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200'
    case 'CLOSED':
      return 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200'
    case 'CANCELLED':
      return 'bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200'
    default:
      return 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200'
  }
}

function paymentStatusConfig(status: string | null): { label: string; className: string } {
  switch ((status ?? '').toUpperCase()) {
    case 'PAID':
      return {
        label: 'Paid',
        className: 'bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200',
      }
    case 'PARTIAL':
      return {
        label: 'Partial',
        className: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
      }
    case 'UNPAID':
      return {
        label: 'Unpaid',
        className: 'bg-red-50 text-red-800 ring-1 ring-inset ring-red-200',
      }
    case 'NO_CHARGES':
      return {
        label: 'No charges',
        className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
      }
    default:
      return {
        label: status || '—',
        className: 'bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200',
      }
  }
}

function formatTokens(tokenNumbers: number[]): string {
  if (tokenNumbers.length === 0) return '—'
  return tokenNumbers.map((token) => formatToken(token)).join(', ')
}

function formatDoctors(doctors: string[]): string {
  if (doctors.length === 0) return '—'
  return doctors.map((name) => withDoctorTitle(name)).join(', ')
}

function formatDepartments(departments: string[]): string {
  if (departments.length === 0) return '—'
  return departments.join(', ')
}

function EncounterBadges({ encounters }: { encounters: EncounterLinkBrief[] | null }) {
  if (!encounters || encounters.length === 0) {
    return <span className="text-xs text-slate-600">No encounter</span>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {encounters.map((enc) => (
        <Link
          key={enc.encounter_id}
          to={`/doctor/encounters/${enc.encounter_id}`}
          aria-label={`Open clinical encounter ${enc.encounter_code} (${enc.is_finalised ? 'Finalised' : 'Draft'}) by ${withDoctorTitle(enc.doctor_name)}`}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-800 transition-colors duration-150 hover:border-[#8E1C3D] hover:bg-rose-50 hover:text-[#8E1C3D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
        >
          <span className="font-mono font-semibold tabular-nums">{enc.encounter_code}</span>
          <span
            className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
              enc.is_finalised
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-amber-100 text-amber-800'
            }`}
          >
            {enc.is_finalised ? 'Finalised' : 'Draft'}
          </span>
        </Link>
      ))}
    </div>
  )
}

function BillingCell({ visit }: { visit: PatientVisitHistoryItem }) {
  if (
    visit.bill_total_paise === null &&
    visit.paid_paise === null &&
    visit.due_paise === null &&
    visit.payment_status === null
  ) {
    return <span className="text-xs text-slate-600">—</span>
  }

  const payBadge = paymentStatusConfig(visit.payment_status)
  const billTotal = visit.bill_total_paise ?? 0
  const paid = visit.paid_paise ?? 0
  const due = visit.due_paise ?? 0

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${payBadge.className}`}
        >
          {payBadge.label}
        </span>
        {visit.payment_status !== 'NO_CHARGES' && (
          <span className="text-xs font-semibold text-slate-900 tabular-nums">
            {formatSafePaise(billTotal)}
          </span>
        )}
      </div>
      {visit.payment_status !== 'NO_CHARGES' && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-600 tabular-nums">
          <span>Paid: {formatSafePaise(paid)}</span>
          <span className={due > 0 ? 'font-semibold text-red-700' : 'text-slate-600'}>
            Due: {formatSafePaise(due)}
          </span>
        </div>
      )}
    </div>
  )
}

export function PatientVisitHistoryTab({ patientId, role }: PatientVisitHistoryTabProps) {
  const [pageState, setPageState] = useState<{ patientId: number; offset: number }>({
    patientId,
    offset: 0,
  })
  const offset = pageState.patientId === patientId ? pageState.offset : 0

  const isDoctor = role === 'DOCTOR'
  const canViewBilling = role === 'ADMIN' || role === 'RECEPTION'

  const { data, isPending, isError, error, refetch, isFetching } = usePatientVisits(patientId, {
    limit: PAGE_LIMIT,
    offset,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const limit = data?.limit ?? PAGE_LIMIT
  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  const rangeStart = total === 0 ? 0 : offset + 1
  const rangeEnd = Math.min(offset + items.length, total)

  const handlePrev = () => {
    setPageState({ patientId, offset: Math.max(0, offset - PAGE_LIMIT) })
  }

  const handleNext = () => {
    if (offset + PAGE_LIMIT < total) {
      setPageState({ patientId, offset: offset + PAGE_LIMIT })
    }
  }

  return (
    <section aria-labelledby="patient-visit-history-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="min-w-0">
          <h2 id="patient-visit-history-heading" className="text-base font-semibold tracking-tight text-slate-900">
            Visit History
          </h2>
          <p className="mt-0.5 text-xs tabular-nums text-slate-600">
            {total > 0
              ? `Showing ${rangeStart}–${rangeEnd} of ${total} ${total === 1 ? 'visit' : 'visits'}`
              : 'Chronological record of hospital visits'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh visit history"
          className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {isPending ? (
        <TableSkeleton
          label="Loading patient visit history..."
          rows={4}
          columns={isDoctor || canViewBilling ? 6 : 5}
        />
      ) : isError ? (
        <InlineAlert tone="error">
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Could not load visit history{error?.message ? `: ${error.message}` : '.'}
            </span>
            <button
              type="button"
              onClick={() => refetch()}
              aria-label="Retry loading visit history"
              className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-900 transition-colors duration-150 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Retry
            </button>
          </div>
        </InlineAlert>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-2xs space-y-1">
          <p className="text-sm font-medium text-slate-700">
            No visits recorded for this patient yet.
          </p>
          <p className="text-xs text-slate-600">
            Visits created at check-in or appointment arrival will appear here chronologically.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop structured table */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-2xs">
            <table className="w-full min-w-[780px] text-left text-sm text-slate-800">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">
                    Visit &amp; Date
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">
                    Token(s)
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">
                    Doctor(s) &amp; Department(s)
                  </th>
                  <th scope="col" className="whitespace-nowrap px-4 py-3">
                    Consultations &amp; Status
                  </th>
                  {isDoctor && (
                    <th scope="col" className="whitespace-nowrap px-4 py-3">
                      Clinical Encounters
                    </th>
                  )}
                  {canViewBilling && (
                    <th scope="col" className="whitespace-nowrap px-4 py-3">
                      Billing Summary
                    </th>
                  )}
                  <th scope="col" className="whitespace-nowrap px-4 py-3 text-right">
                    Workspace
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((visit) => {
                  const visitWorkspaceHref = `/patients/${patientId}/visits/${visit.visit_id}`
                  const doctorNames = formatDoctors(visit.doctors)
                  const departmentNames = formatDepartments(visit.departments)
                  return (
                    <tr
                      key={visit.visit_id}
                      className="align-top transition-colors duration-150 hover:bg-slate-50/80"
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-200">
                          {visit.visit_code}
                        </span>
                        <div className="mt-1 text-xs font-medium tabular-nums text-slate-600">
                          {formatVisitDateIst(visit.visit_date)}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs font-semibold tabular-nums text-slate-800">
                        {formatTokens(visit.token_numbers)}
                      </td>
                      <td className="max-w-[240px] px-4 py-3">
                        <div className="min-w-0 truncate text-sm font-medium text-slate-900" title={doctorNames}>
                          {doctorNames}
                        </div>
                        <div className="mt-0.5 min-w-0 truncate text-xs text-slate-600" title={departmentNames}>
                          {departmentNames}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${visitStatusBadgeClass(visit.status)}`}
                        >
                          {visit.status}
                        </span>
                        <div className="mt-1 text-xs tabular-nums text-slate-600">
                          {visit.completed_consultations} / {visit.consultation_count}{' '}
                          {visit.consultation_count === 1 ? 'consultation' : 'consultations'}
                        </div>
                      </td>
                      {isDoctor && (
                        <td className="px-4 py-3">
                          <EncounterBadges encounters={visit.encounter_links} />
                        </td>
                      )}
                      {canViewBilling && (
                        <td className="whitespace-nowrap px-4 py-3">
                          <BillingCell visit={visit} />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link
                          to={visitWorkspaceHref}
                          aria-label={`Open Visit Workspace for ${visit.visit_code}`}
                          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-[#8E1C3D] transition-colors duration-150 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                        >
                          Open Visit Workspace &rarr;
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile stacked cards */}
          <div className="space-y-3 md:hidden">
            {items.map((visit) => {
              const visitWorkspaceHref = `/patients/${patientId}/visits/${visit.visit_id}`
              return (
                <article
                  key={visit.visit_id}
                  aria-label={`Visit ${visit.visit_code}`}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-900 ring-1 ring-inset ring-slate-200">
                        {visit.visit_code}
                      </span>
                      <p className="text-xs font-medium tabular-nums text-slate-600">
                        {formatVisitDateIst(visit.visit_date)}
                      </p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${visitStatusBadgeClass(visit.status)}`}
                    >
                      {visit.status}
                    </span>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                    <div>
                      <dt className="font-medium text-slate-600">Token(s)</dt>
                      <dd className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
                        {formatTokens(visit.token_numbers)}
                      </dd>
                    </div>
                    <div>
                      <dt className="font-medium text-slate-600">Consultations</dt>
                      <dd className="mt-0.5 font-semibold tabular-nums text-slate-900">
                        {visit.completed_consultations} / {visit.consultation_count}
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="font-medium text-slate-600">Doctor(s)</dt>
                      <dd className="mt-0.5 truncate text-sm font-medium text-slate-900">
                        {formatDoctors(visit.doctors)}
                      </dd>
                    </div>
                    <div className="col-span-2 min-w-0">
                      <dt className="font-medium text-slate-600">Department(s)</dt>
                      <dd className="mt-0.5 truncate text-slate-700">
                        {formatDepartments(visit.departments)}
                      </dd>
                    </div>
                  </dl>

                  {isDoctor && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                      <p className="text-xs font-semibold text-slate-700">Clinical Encounters</p>
                      <EncounterBadges encounters={visit.encounter_links} />
                    </div>
                  )}

                  {canViewBilling && (
                    <div className="space-y-1.5 border-t border-slate-100 pt-2.5">
                      <p className="text-xs font-semibold text-slate-700">Billing Summary</p>
                      <BillingCell visit={visit} />
                    </div>
                  )}

                  <div className="border-t border-slate-100 pt-3">
                    <Link
                      to={visitWorkspaceHref}
                      aria-label={`Open Visit Workspace for ${visit.visit_code}`}
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2 text-xs font-semibold text-[#8E1C3D] transition-colors duration-150 hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
                    >
                      Open Visit Workspace &rarr;
                    </Link>
                  </div>
                </article>
              )
            })}
          </div>

          {total > limit && (
            <nav
              aria-label="Visit history pagination"
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xs"
            >
              <p className="text-xs tabular-nums text-slate-600">
                Showing {rangeStart}–{rangeEnd} of {total} visits
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={!hasPrev || isFetching}
                  aria-label="Previous visits page"
                  className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
                >
                  &larr; Previous
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!hasNext || isFetching}
                  aria-label="Next visits page"
                  className="inline-flex min-h-[38px] items-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer shadow-2xs"
                >
                  Next &rarr;
                </button>
              </div>
            </nav>
          )}
        </>
      )}
    </section>
  )
}
