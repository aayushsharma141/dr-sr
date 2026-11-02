import { Link } from 'react-router'
import { AppShell } from '../../components/AppShell'
import { useIntegrityCheck } from '../../api/queries'
import type { IntegrityCheckItemOut } from '../../api/types'

export function IntegrityDashboard() {
  const { data, isPending, isError, error, refetch, isFetching } = useIntegrityCheck()

  return (
    <AppShell name="Admin" role="ADMIN">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm text-neutral-500 mb-1">
              <Link to="/admin" className="hover:underline">
                Admin
              </Link>
              <span>/</span>
              <span>Integrity Diagnostic</span>
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">System Integrity Diagnostic</h1>
            <p className="text-sm text-neutral-600 mt-1">
              5-pillar invariant audit across financial ledgers, URNs, receipts, session progress, and photos (BAK-03)
            </p>
          </div>
          <button
            type="button"
            disabled={isFetching}
            onClick={() => refetch()}
            className="px-4 py-2 bg-red-800 hover:bg-red-900 text-white text-sm font-semibold rounded cursor-pointer disabled:opacity-50 shadow-xs"
          >
            {isFetching ? 'Auditing System Invariants...' : 'Run Integrity Diagnostic'}
          </button>
        </div>

        {isPending && <div className="p-8 text-center text-neutral-500">Executing system integrity checks...</div>}
        {isError && (
          <div className="p-8 text-center text-red-600">
            Failed to run integrity audit: {error?.message}
          </div>
        )}

        {data && (
          <>
            {/* Status Banner */}
            <div
              className={`p-5 rounded-lg border flex items-center justify-between shadow-xs ${
                data.is_healthy
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                  : 'bg-red-50 border-red-300 text-red-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-2xl">{data.is_healthy ? '✓' : '⚠'}</span>
                <div>
                  <h2 className="text-base font-bold">
                    {data.is_healthy
                      ? 'All System Invariants Intact & Verified'
                      : 'Integrity Discrepancies Detected'}
                  </h2>
                  <p className="text-xs opacity-90">
                    Passed {data.passed_checks} of {data.total_checks} diagnostic checks. Diagnostic
                    run at {new Date(data.generated_at).toLocaleString()}.
                  </p>
                </div>
              </div>
              <span
                className={`px-3 py-1 text-xs font-bold rounded uppercase tracking-wider ${
                  data.is_healthy
                    ? 'bg-emerald-200 text-emerald-900'
                    : 'bg-red-200 text-red-900'
                }`}
              >
                {data.is_healthy ? 'System Healthy' : 'Action Required'}
              </span>
            </div>

            {/* Invariant Cards Grid */}
            <div className="grid grid-cols-1 gap-4">
              {data.checks.map((check: IntegrityCheckItemOut) => (
                <div
                  key={check.name}
                  className="bg-white p-5 rounded-lg border border-neutral-200 shadow-xs space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          check.passed ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                      <h3 className="font-semibold text-neutral-900 text-base">{check.name}</h3>
                    </div>
                    <span
                      className={`text-xs font-bold px-2 py-0.5 rounded ${
                        check.passed
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200'
                      }`}
                    >
                      {check.passed ? 'PASSED' : 'DISCREPANCY'}
                    </span>
                  </div>

                  <p className="text-sm text-neutral-600">{check.details}</p>

                  {check.discrepancies.length > 0 && (
                    <div className="mt-3 p-3 bg-neutral-900 rounded font-mono text-xs text-neutral-200 overflow-x-auto space-y-1">
                      <p className="text-red-400 font-bold mb-1">Discrepancy Details:</p>
                      <pre>{JSON.stringify(check.discrepancies, null, 2)}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  )
}
