import { useIntegrityCheck, useMe } from '../../api/queries'
import type { IntegrityCheckItemOut } from '../../api/types'
import { AppShell } from '../../components/AppShell'
import { InlineAlert } from '../../components/InlineAlert'

const IST_ZONE = 'Asia/Kolkata'

type CheckState = 'passed' | 'warning' | 'error'

function checkState(check: IntegrityCheckItemOut): CheckState {
  if (check.passed) return 'passed'
  return check.severity === 'WARNING' ? 'warning' : 'error'
}

const STATE_BADGE: Record<CheckState, { label: string; className: string; dot: string }> = {
  passed: { label: 'PASSED', className: 'bg-emerald-50 text-emerald-800 border-emerald-300', dot: 'bg-emerald-700' },
  warning: { label: 'WARNING', className: 'bg-amber-50 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  error: { label: 'DISCREPANCY', className: 'bg-red-50 text-red-800 border-red-300', dot: 'bg-red-700' },
}

function formatIst(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return `${d.toLocaleString('en-IN', { timeZone: IST_ZONE, dateStyle: 'medium', timeStyle: 'medium' })} IST`
}

interface UrnGapFinding {
  year: number
  max_issued: number
  max_observed_on_patient: number
  sequence_counter: number
  missing_count: number
  missing_numbers: number[]
  missing_numbers_truncated: boolean
}

function asUrnGap(d: Record<string, unknown>): UrnGapFinding | null {
  if (d.issue !== 'urn_sequence_gap') return null
  const num = (v: unknown) => (typeof v === 'number' ? v : null)
  const year = num(d.year)
  const maxIssued = num(d.max_issued)
  const maxObserved = num(d.max_observed_on_patient)
  const counter = num(d.sequence_counter)
  const missingCount = num(d.missing_count)
  if (year === null || maxIssued === null || maxObserved === null || counter === null || missingCount === null) {
    return null
  }
  const missing = Array.isArray(d.missing_numbers)
    ? d.missing_numbers.filter((n): n is number => typeof n === 'number')
    : []
  return {
    year,
    max_issued: maxIssued,
    max_observed_on_patient: maxObserved,
    sequence_counter: counter,
    missing_count: missingCount,
    missing_numbers: missing,
    missing_numbers_truncated: d.missing_numbers_truncated === true,
  }
}

/** Same format as the server's URN generator: KH-YYYY-XXXX, sequence zero-padded to 4 digits. */
function formatUrn(year: number, seq: number): string {
  return `KH-${year}-${String(seq).padStart(4, '0')}`
}

function UrnGapTable({ gaps }: { gaps: UrnGapFinding[] }) {
  return (
    <div className="overflow-x-auto rounded border border-amber-300 bg-white">
      <table className="w-full" aria-label="URN sequence gaps by year">
        <thead className="border-b border-amber-200 bg-amber-50">
          <tr>
            <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-800">Year</th>
            <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-800">Highest issued</th>
            <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-800">Highest on a patient</th>
            <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-800">Sequence counter</th>
            <th scope="col" className="px-3 py-2 text-right text-sm font-semibold text-slate-800">Unmapped numbers</th>
            <th scope="col" className="px-3 py-2 text-left text-sm font-semibold text-slate-800">Unmapped URNs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {gaps.map((g) => (
            <tr key={g.year}>
              <th scope="row" className="px-3 py-2 text-left text-sm font-semibold text-slate-900">{g.year}</th>
              <td className="px-3 py-2 text-right text-sm text-slate-800">{g.max_issued}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-800">{g.max_observed_on_patient}</td>
              <td className="px-3 py-2 text-right text-sm text-slate-800">{g.sequence_counter}</td>
              <td className="px-3 py-2 text-right text-sm font-semibold text-slate-900">{g.missing_count}</td>
              <td className="px-3 py-2 text-sm text-slate-800">
                <span className="font-mono">{g.missing_numbers.map((n) => formatUrn(g.year, n)).join(', ')}</span>
                {g.missing_numbers_truncated && (
                  <span className="block text-slate-700">
                    First {g.missing_numbers.length} of {g.missing_count} listed.
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Discrepancies({ check }: { check: IntegrityCheckItemOut }) {
  if (check.discrepancies.length === 0) return null
  const gaps: UrnGapFinding[] = []
  const other: Record<string, unknown>[] = []
  for (const d of check.discrepancies) {
    const gap = asUrnGap(d)
    if (gap) gaps.push(gap)
    else other.push(d)
  }
  return (
    <div className="space-y-3">
      {gaps.length > 0 && <UrnGapTable gaps={gaps} />}
      {other.length > 0 && (
        <div className="overflow-x-auto rounded bg-slate-100 p-3">
          <p className="mb-1 text-sm font-bold text-slate-900">Discrepancy Details:</p>
          <pre className="text-sm text-slate-900">{JSON.stringify(other, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export function IntegrityDashboard() {
  const { data: me } = useMe()
  const { data, isPending, isError, error, refetch, isFetching } = useIntegrityCheck()

  const warnings = data?.warning_checks ?? 0
  const errors = data?.failed_checks ?? 0

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">System Integrity Diagnostic</h1>
            <p className="mt-1 text-sm text-slate-700">
              Invariant audit across financial ledgers, URNs, receipts, session progress, and photos (BAK-03)
            </p>
          </div>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="inline-flex min-h-11 items-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-semibold text-white hover:bg-[#5D0B26] disabled:opacity-60"
          >
            {isFetching ? 'Auditing System Invariants...' : 'Run Integrity Diagnostic'}
          </button>
        </div>

        {isPending && (
          <p role="status" className="p-8 text-center text-sm text-slate-700">
            Executing system integrity checks...
          </p>
        )}
        {isError && <InlineAlert tone="error">Failed to run integrity audit: {error.message}</InlineAlert>}

        {data && (
          <>
            <div
              role={data.is_healthy ? 'status' : 'alert'}
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-5 shadow-xs ${
                !data.is_healthy
                  ? 'border-red-300 bg-red-50 text-red-900'
                  : warnings > 0
                    ? 'border-amber-300 bg-amber-50 text-amber-900'
                    : 'border-emerald-300 bg-emerald-50 text-emerald-900'
              }`}
            >
              <div>
                <h2 className="text-base font-bold">
                  {!data.is_healthy
                    ? 'Integrity Discrepancies Detected'
                    : warnings > 0
                      ? 'No Errors Found; Warnings to Review'
                      : 'All System Invariants Intact & Verified'}
                </h2>
                <p className="text-sm">
                  Passed {data.passed_checks} of {data.total_checks} checks · {errors} error
                  {errors === 1 ? '' : 's'} · {warnings} warning{warnings === 1 ? '' : 's'}. Run at{' '}
                  {formatIst(data.generated_at)}.
                </p>
                {data.is_healthy && warnings > 0 && (
                  <p className="text-sm">Warnings are reported only; they do not make the system unhealthy.</p>
                )}
              </div>
              <span className="rounded border border-current px-3 py-1 text-sm font-bold uppercase tracking-wider">
                {!data.is_healthy ? 'Action Required' : warnings > 0 ? 'Review Warnings' : 'System Healthy'}
              </span>
            </div>

            <ul className="grid grid-cols-1 gap-4">
              {data.checks.map((check) => {
                const state = checkState(check)
                const badge = STATE_BADGE[state]
                return (
                  <li
                    key={check.name}
                    className="space-y-3 rounded-lg border border-slate-200 bg-white p-5 shadow-xs"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 rounded-full ${badge.dot}`} />
                        <h3 className="text-base font-semibold text-slate-900">{check.name}</h3>
                      </div>
                      <span className={`rounded border px-2 py-0.5 text-sm font-bold ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-800">{check.details}</p>
                    {state === 'warning' && (
                      <p className="text-sm text-slate-800">
                        Warning-level finding: reported for review, it does not mark the system unhealthy.
                      </p>
                    )}
                    <Discrepancies check={check} />
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </AppShell>
  )
}
