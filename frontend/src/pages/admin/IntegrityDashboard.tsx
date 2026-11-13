import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useIntegrityHistory, useLatestIntegrityRun, useRunIntegrityCheck } from '../../api/integrity'
import { useMe } from '../../api/queries'
import type { IntegrityReportOut, IntegritySeverity } from '../../api/types'
import {
  CHECK_INFO,
  checkTitle,
  countBySeverity,
  type Finding,
  type FindingGroup,
  formatBytes,
  groupFindings,
  SEVERITY_LABEL,
  summaryHeadline,
} from '../../admin/integrity'
import { AppShell } from '../../components/AppShell'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { TableSkeleton } from '../../components/AdminSkeleton'
import { InlineAlert } from '../../components/InlineAlert'

const IST_ZONE = 'Asia/Kolkata'
/** Checks about stored files rather than patient, payment or treatment records. */
const FILE_CHECKS = new Set(['photo_files', 'asset_files'])

type TabFilter = 'all' | 'issues' | 'passed' | 'history'

function formatIst(iso: string | null | undefined): string {
  if (!iso) return 'date unknown'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('en-IN', { timeZone: IST_ZONE, dateStyle: 'medium', timeStyle: 'short' })
}

function rupees(value: unknown): string {
  const paise = Number(value)
  return Number.isFinite(paise) ? `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '—'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

const severityStyle: Record<IntegritySeverity, { pill: string; edge: string; badge: string }> = {
  ERROR: {
    pill: 'border-red-300 bg-red-50 text-red-900',
    edge: 'border-l-red-700',
    badge: 'bg-red-100 text-red-800 border-red-200',
  },
  WARNING: {
    pill: 'border-amber-300 bg-amber-50 text-amber-950',
    edge: 'border-l-amber-600',
    badge: 'bg-amber-100 text-amber-800 border-amber-200',
  },
  CLEANUP: {
    pill: 'border-slate-300 bg-slate-100 text-slate-800',
    edge: 'border-l-slate-400',
    badge: 'bg-slate-100 text-slate-700 border-slate-200',
  },
}

const linkClass = 'font-semibold text-[#5D0B26] underline underline-offset-2 hover:text-[#8E1C3D]'
const actionClass =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-[#8E1C3D] px-4 text-xs font-bold text-white shadow-2xs hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] transition-colors'

function PatientLink({ finding }: { finding: Finding }) {
  if (finding.patient_id == null) return null
  return (
    <Link to={`/reception/patients/${String(finding.patient_id)}`} className={linkClass}>
      {finding.urn ? `Open ${String(finding.urn)}` : 'Open patient'}
    </Link>
  )
}

interface GroupCopy {
  title: string
  impact: string
  action?: { label: string; to: string }
  row: (finding: Finding) => ReactNode
}

function copyFor(group: FindingGroup): GroupCopy {
  const n = group.findings.length
  switch (group.key) {
    case 'missing_asset_file': {
      const first = group.findings[0]
      const isActiveLogo = n === 1 && first.asset_type === 'LOGO' && first.is_active === true
      return {
        title: isActiveLogo ? 'Hospital logo file is missing' : `${plural(n, 'hospital file is', 'hospital files are')} missing`,
        impact:
          'The record exists, but its file is not on the server. Anything that prints or shows it will be blank until it is uploaded again.',
        action: { label: 'Upload Again', to: '/admin/settings#hospital-crest' },
        row: (f) => (
          <>
            {f.asset_type === 'LOGO' ? 'Logo' : String(f.asset_type ?? 'File')}
            {f.is_active === true ? ' (in use)' : f.is_active === false ? ' (not in use)' : ''}
            {f.uploaded_at ? ` · uploaded ${formatIst(String(f.uploaded_at))}` : ''}
            {f.original_filename ? ` · ${String(f.original_filename)}` : ''}
          </>
        ),
      }
    }
    case 'missing_photo_file':
      return {
        title: `${plural(n, 'patient photo is', 'patient photos are')} missing`,
        impact: 'The patient record points to a photo that is not on the server, so the photo will not show on the profile or registration card.',
        row: (f) => (
          <>
            Patient {String(f.urn ?? f.patient_id)} · <PatientLink finding={f} />
          </>
        ),
      }
    case 'unlinked_files': {
      const photos = group.findings.filter((f) => f.issue === 'orphan_photo_file').length
      const assets = n - photos
      const where = [photos ? `${photos} in patient photos` : '', assets ? `${assets} in hospital files` : '']
        .filter(Boolean)
        .join(', ')
      return {
        title: `${plural(n, 'stored file is', 'stored files are')} not linked to any record`,
        impact: `${where}. No patient or hospital record uses them. They are harmless, but they take space and are often leftovers from testing.`,
        row: (f) => (
          <>
            {f.issue === 'orphan_photo_file' ? 'Patient photos' : 'Hospital files'} · {String(f.filename)} · {formatBytes(f.bytes)}
          </>
        ),
      }
    }
    case 'overpaid_ledger':
      return {
        title: `${plural(n, 'treatment package is', 'treatment packages are')} paid above the agreed price`,
        impact: 'More has been collected than the package price. Check the receipts with billing before any refund or reversal.',
        row: (f) => (
          <>
            Plan {String(f.plan_id)} · agreed {rupees(f.agreed_price_paise)} · paid {rupees(f.paid_sum_paise)} · over by{' '}
            {rupees(f.excess_paise)} · <PatientLink finding={f} />
          </>
        ),
      }
    case 'negative_agreed_price':
      return {
        title: `${plural(n, 'treatment package has', 'treatment packages have')} a price below zero`,
        impact: 'A package price cannot be negative. Ask billing to correct the plan before more payments are taken against it.',
        row: (f) => (
          <>
            Plan {String(f.plan_id)} · price {rupees(f.agreed_price_paise)} · <PatientLink finding={f} />
          </>
        ),
      }
    case 'duplicate_urn':
      return {
        title: `${plural(n, 'patient ID is', 'patient IDs are')} used more than once`,
        impact: 'Two or more patients share one registration number. Confirm who is who before changing either record.',
        action: { label: 'Open Patient Records', to: '/reception/patients' },
        row: (f) => (
          <>
            {String(f.urn)} · on {String(f.occurrences)} patients
          </>
        ),
      }
    case 'urn_sequence_gap': {
      const total = group.findings.reduce((sum, f) => sum + Number(f.missing_count ?? 0), 0)
      return {
        title: `${plural(total, 'patient ID number has', 'patient ID numbers have')} no patient`,
        impact:
          'These numbers were issued or reserved but belong to no patient, usually because a registration was started and not finished. The hospital has not set a policy for these gaps.',
        row: (f) => {
          const numbers = Array.isArray(f.missing_numbers) ? (f.missing_numbers as number[]) : []
          const shown = numbers.map((num) => `KH-${String(f.year)}-${String(num).padStart(4, '0')}`).join(', ')
          return (
            <>
              {String(f.year)}: {shown}
              {f.missing_numbers_truncated ? ` (showing ${numbers.length} of ${String(f.missing_count)})` : ''}
            </>
          )
        },
      }
    }
    case 'duplicate_receipt':
      return {
        title: `${plural(n, 'receipt number is', 'receipt numbers are')} used more than once`,
        impact: 'Two or more payments share a receipt number. Compare them with the cashbook before reversing either.',
        action: { label: 'Open Receipts & Reversals', to: '/admin/billing' },
        row: (f) => (
          <>
            Receipt {String(f.receipt_number)} · on {String(f.occurrences)} payments
          </>
        ),
      }
    case 'session_count_mismatch':
      return {
        title: `${plural(n, 'treatment plan has', 'treatment plans have')} the wrong session count`,
        impact: 'The plan’s completed-session count differs from the sessions actually finalised. Check with the treating team before correcting it.',
        row: (f) => (
          <>
            Plan {String(f.plan_id)} · recorded {String(f.recorded_completed_sessions)} · finalised{' '}
            {String(f.actual_finalised_sessions)} · <PatientLink finding={f} />
          </>
        ),
      }
    default:
      return {
        title: `${plural(n, 'finding', 'findings')}: ${group.key.replaceAll('_', ' ')}`,
        impact: 'Review this with the administrator responsible for this area.',
        row: (f) => (
          <>
            {Object.entries(f)
              .filter(([key]) => !['issue', 'severity', 'check_code'].includes(key))
              .map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value)}`)
              .join(' · ')}
          </>
        ),
      }
  }
}

const ROWS_SHOWN = 5

function FindingRow({ group }: { group: FindingGroup }) {
  const copy = copyFor(group)
  const style = severityStyle[group.severity]
  const first = group.findings.slice(0, ROWS_SHOWN)
  const rest = group.findings.slice(ROWS_SHOWN)
  return (
    <li className={`rounded-xl border border-l-4 border-slate-200 bg-white p-4 shadow-2xs transition-all ${style.edge}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${style.pill}`}>
              {SEVERITY_LABEL[group.severity]}
            </span>
            <h3 className="text-base font-bold text-slate-900">{copy.title}</h3>
          </div>
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-600">{copy.impact}</p>
          <ul className="mt-2.5 space-y-1 rounded-lg bg-slate-50 p-2.5 font-mono text-xs text-slate-700">
            {first.map((finding, index) => (
              <li key={index} className="break-words">
                {copy.row(finding)}
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-semibold text-[#5D0B26] hover:underline">
                Show all {group.findings.length}
              </summary>
              <ul className="mt-1.5 space-y-1 rounded-lg bg-slate-50 p-2.5 font-mono text-xs text-slate-700">
                {rest.map((finding, index) => (
                  <li key={index} className="break-words">
                    {copy.row(finding)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {copy.action && (
          <div className="shrink-0 pt-1">
            <Link to={copy.action.to} className={actionClass}>
              {copy.action.label}
            </Link>
          </div>
        )}
      </div>
    </li>
  )
}

/** Counts checks, e.g. "5 of 7 passed · 1 with a problem · 1 with clean-up". */
function runResult(
  run: Pick<IntegrityReportOut, 'passed_checks' | 'total_checks' | 'failed_checks' | 'warning_checks' | 'cleanup_checks'>,
): string {
  const parts = [`${run.passed_checks} of ${run.total_checks} passed`]
  if (run.failed_checks) parts.push(`${run.failed_checks} with a problem`)
  if (run.warning_checks) parts.push(`${run.warning_checks} to review`)
  if (run.cleanup_checks) parts.push(`${run.cleanup_checks} with clean-up`)
  return parts.join(' · ')
}

function RecentRuns() {
  const { data } = useIntegrityHistory(10)
  const runs = data?.runs ?? []
  if (runs.length === 0) return null
  return (
    <section aria-label="Recent runs" aria-labelledby="recent-runs" className="rounded-xl border border-slate-200 bg-white p-5 shadow-2xs">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div>
          <h2 id="recent-runs" className="text-base font-bold text-slate-900">
            Recent runs
          </h2>
          <p className="text-xs text-slate-500">Immutable audit log of automated and manual invariant diagnostics</p>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="mt-3 w-full text-left text-xs">
          <thead className="sticky top-0 z-10 bg-white text-slate-500 border-b border-slate-100 uppercase tracking-wider">
            <tr>
              <th className="py-2.5 pr-4 font-semibold">Timestamp</th>
              <th className="py-2.5 pr-4 font-semibold">Initiated By</th>
              <th className="py-2.5 font-semibold">Diagnostic Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((run, index) => (
              <tr key={run.id} className="hover:bg-slate-50/50 transition-colors" style={{ transitionDelay: `${index * 50}ms` }}>
                <td className="py-2.5 pr-4 font-medium text-slate-800">{formatIst(run.generated_at)}</td>
                <td className="py-2.5 pr-4 font-semibold text-slate-700">{run.run_by_username ?? 'System'}</td>
                <td className={`py-2.5 ${run.failed_checks ? 'font-bold text-red-700' : 'font-medium text-slate-700'}`}>
                  {runResult(run)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export function IntegrityDashboard() {
  const { data: me } = useMe()
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const latest = useLatestIntegrityRun()
  const runCheck = useRunIntegrityCheck()
  const report = latest.data ?? null
  const groups = groupFindings(report)
  const counts = countBySeverity(groups)
  const passed = report?.checks.filter((check) => check.passed) ?? []
  const recordsConsistent = (report?.checks ?? [])
    .filter((check) => !FILE_CHECKS.has(check.code))
    .every((check) => check.passed)
  const busy = runCheck.isPending

  const hasErrors = counts.ERROR > 0
  const hasWarnings = counts.WARNING > 0

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <main className="mx-auto w-full max-w-[1600px] space-y-5 px-1 pb-8">
        {/* Header */}
        <header className="flex flex-col justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xs sm:flex-row sm:items-center">
          <AdminPageHeader
            icon={
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-[#8E1C3D]">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </span>
            }
            title="Data Integrity"
            description={
              report
                ? `Last checked ${formatIst(report.generated_at)}${report.run_by_username ? ` by ${report.run_by_username}` : ''} · read-only`
                : 'Checks patient IDs, payments, treatment progress and stored files. Read-only.'
            }
          />
          <button
            type="button"
            disabled={busy || latest.isPending}
            onClick={() => runCheck.mutate()}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-5 text-sm font-semibold text-white shadow-2xs hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-wait disabled:opacity-60 transition-colors"
          >
            <svg className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {busy ? 'Checking…' : 'Run Check Now'}
          </button>
        </header>

        {runCheck.isError && (
          <InlineAlert tone="error">The check could not finish. No records were changed. Check your connection and try again.</InlineAlert>
        )}
        {latest.isError && (
          <InlineAlert tone="error">Could not load the last result. Check your connection, then reload the page.</InlineAlert>
        )}
        {latest.isPending && <TableSkeleton label="Loading integrity diagnostics…" rows={3} columns={4} />}

        {latest.isSuccess && !report && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-2xs">
            <h2 className="text-lg font-bold text-slate-900">No check has been run yet</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-600">
              Run Check Now looks for mismatches in patient IDs, receipt numbers, package payments, session counts and stored
              files. It only reads records and changes nothing.
            </p>
          </section>
        )}

        {report && (
          <>
            {/* 4-Card Executive KPI Overview Strip */}
            <section aria-label="Integrity overview metrics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {/* Card 1: System Status */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">System Status</p>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${hasErrors
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : hasWarnings
                        ? 'bg-amber-50 text-amber-800 border border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    }`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${hasErrors ? 'bg-red-600 animate-pulse' : hasWarnings ? 'bg-amber-500' : 'bg-emerald-600'
                      }`} />
                    {hasErrors ? 'Action Required' : hasWarnings ? 'Review Needed' : 'All Checks Passed'}
                  </span>
                </div>
                <p className="mt-2 text-xl font-extrabold text-slate-900">{summaryHeadline(counts)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {recordsConsistent && groups.length > 0
                    ? 'Clinical & financial ledgers verified without discrepancy'
                    : `${report.passed_checks} of ${report.total_checks} automated invariants verified`}
                </p>
              </div>

              {/* Card 2: Passing Checks Ratio */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Passing Checks</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-extrabold text-slate-900">{report.passed_checks}</span>
                  <span className="text-sm font-semibold text-slate-500">/ {report.total_checks} checks</span>
                  <span className="ml-auto text-xs font-bold text-slate-600">
                    {report.total_checks ? Math.round((report.passed_checks / report.total_checks) * 100) : 0}%
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                    style={{ width: `${report.total_checks ? Math.round((report.passed_checks / report.total_checks) * 100) : 0}%` }}
                  />
                </div>
              </div>

              {/* Card 3: Identified Findings */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Identified Findings</p>
                <div className="mt-2 flex items-baseline gap-3">
                  <span className="text-2xl font-extrabold text-slate-900">{groups.length}</span>
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    {counts.ERROR > 0 && <span className="text-red-700 font-bold">{counts.ERROR} problem{counts.ERROR > 1 ? 's' : ''}</span>}
                    {counts.ERROR > 0 && counts.CLEANUP > 0 && <span className="text-slate-500">·</span>}
                    {counts.CLEANUP > 0 && <span className="text-slate-600">{counts.CLEANUP} clean-up</span>}
                    {groups.length === 0 && <span className="text-emerald-700">Zero discrepancies detected</span>}
                  </div>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {counts.ERROR > 0 ? 'Review active problems affecting file/data consistency' : 'No operational blockers identified'}
                </p>
              </div>

              {/* Card 4: Clinical & Financial Consistency */}
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Clinical & Financial Data</p>
                <div className="mt-2 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                      recordsConsistent ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {recordsConsistent ? '✓' : '!'}
                  </span>
                  <span className="text-sm font-bold text-slate-900">
                    {recordsConsistent ? '100% Invariant Verified' : 'Discrepancies in Records'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {recordsConsistent
                    ? 'Patient URNs, receipts, ledgers & sessions intact'
                    : 'Patient URNs, receipts, ledgers or sessions need follow-up'}
                </p>
              </div>
            </section>

            {/* Banner summary for test & screen readers */}
            <section
              aria-labelledby="result-heading"
              aria-live="polite"
              className={`rounded-xl border border-l-4 bg-white p-4 shadow-2xs ${hasErrors
                  ? 'border-slate-200 border-l-red-700'
                  : hasWarnings
                    ? 'border-slate-200 border-l-amber-600'
                    : 'border-slate-200 border-l-emerald-700'
                }`}
            >
              <h2 id="result-heading" className="text-lg font-bold text-slate-900">
                {summaryHeadline(counts)}
              </h2>
              <p className="mt-0.5 text-xs text-slate-600">
                {report.passed_checks} of {report.total_checks} checks passed
                {recordsConsistent && groups.length > 0 ? ' · patient, payment and treatment records are consistent' : ''}
              </p>
            </section>

            {/* Interactive View Navigation Pills */}
            <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('all')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'all'
                    ? 'bg-[#5D0B26] text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                All Checks ({report.total_checks})
              </button>
              {groups.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('issues')}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'issues'
                      ? 'bg-red-700 text-white shadow-2xs'
                      : 'bg-white border border-red-200 text-red-800 hover:bg-red-50'
                    }`}
                >
                  <span>Action Required</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeTab === 'issues' ? 'bg-white/20 text-white' : 'bg-red-100 text-red-900'
                    }`}>
                    {groups.length}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveTab('passed')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'passed'
                    ? 'bg-emerald-700 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <span>Passed Checks</span>
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${activeTab === 'passed' ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-900'
                  }`}>
                  {passed.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('history')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${activeTab === 'history'
                    ? 'bg-slate-800 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
              >
                Run History
              </button>
            </div>

            {/* Findings List (Issues / Problems) */}
            {(activeTab === 'all' || activeTab === 'issues') && groups.length > 0 && (
              <section aria-label="Findings" aria-labelledby="findings-heading">
                <h2 id="findings-heading" className="sr-only">
                  Findings
                </h2>
                <ul className="space-y-3">
                  {groups.map((group) => (
                    <FindingRow key={group.key} group={group} />
                  ))}
                </ul>
              </section>
            )}

            {/* Passed Checks Section */}
            {(activeTab === 'all' || activeTab === 'passed') && passed.length > 0 && (
              <section aria-label="Passed checks">
                <details
                  className="rounded-xl border border-slate-200 bg-white shadow-2xs overflow-hidden"
                  open={activeTab === 'passed' || groups.length === 0}
                >
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between px-5 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                        ✓
                      </span>
                      <span>Passed · {plural(passed.length, 'check', 'checks')}</span>
                    </div>
                    <span className="text-xs text-slate-500 font-normal">Click to toggle list</span>
                  </summary>
                  <div className="border-t border-slate-100 p-4">
                    <ul className="grid gap-3 sm:grid-cols-2">
                      {passed.map((check) => {
                        const info = CHECK_INFO[check.code]
                        return (
                          <li
                            key={check.code || check.name}
                            className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/60 p-3"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 font-bold text-xs text-slate-900">
                                <span aria-hidden="true" className="text-emerald-700">
                                  ✓
                                </span>
                                {checkTitle(check)}
                              </div>
                              {info?.purpose && (
                                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                  {info.purpose}
                                </p>
                              )}
                            </div>
                            <span className="shrink-0 rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold uppercase text-emerald-800">
                              Passed
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                </details>
              </section>
            )}

            {/* Diagnostic History */}
            {(activeTab === 'all' || activeTab === 'history') && <RecentRuns />}
          </>
        )}
      </main>
    </AppShell>
  )
}
