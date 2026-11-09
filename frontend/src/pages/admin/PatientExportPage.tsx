import { useState } from 'react'
import { PatientExportDialog } from '../../components/admin/PatientExportDialog'
import { AppShell } from '../../components/AppShell'
import { useMe } from '../../api/queries'

export function PatientExportPage() {
  const { data: me } = useMe()
  const [isDialogOpen, setIsDialogOpen] = useState<boolean>(false)
  const [lastExportedFile, setLastExportedFile] = useState<string | null>(null)

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Export Patients
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Permission-checked, field-selective, formula-sanitized dataset streaming in CSV and Excel formats.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsDialogOpen(true)}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-[#8E1C3D] px-6 py-2.5 font-medium text-white shadow-xs hover:bg-[#721631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
          >
            Export Patient Dataset
          </button>
        </div>

        {/* Success notification banner */}
        {lastExportedFile && (
          <div
            role="status"
            className="rounded-lg border border-emerald-300 bg-emerald-50 p-4 text-emerald-900"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold">Dataset Export Generated Successfully</p>
                <p className="text-sm mt-0.5">
                  File <span className="font-mono font-medium">{lastExportedFile}</span> has been streamed directly to your browser download folder.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLastExportedFile(null)}
                className="text-xs font-bold text-emerald-800 hover:underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Informational Cards */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100 text-[#8E1C3D]">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                </svg>
              </span>
              <h2 className="font-semibold text-slate-900">Role-Scoped Governance</h2>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Only authorized administrators with verified audit trails can export clinical data. All extraction events are immutably logged with timestamp, user ID, and field selection.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              </span>
              <h2 className="font-semibold text-slate-900">Formula Injection Sanitized</h2>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Cells starting with dangerous spreadsheet formula characters (=, +, -, @, tab, CR) are safely escaped to prevent formula execution vulnerabilities in Microsoft Excel.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </span>
              <h2 className="font-semibold text-slate-900">Zero Server Persistence</h2>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-slate-600">
              Generated files stream directly to the browser stream without writing temporary files to server disk. Zero persistent residual patient files remain on the server.
            </p>
          </div>
        </div>

        {/* Export Configuration Dialog */}
        <PatientExportDialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          onExportSuccess={(filename) => {
            setLastExportedFile(filename || 'export.csv')
          }}
        />
      </div>
    </AppShell>
  )
}
