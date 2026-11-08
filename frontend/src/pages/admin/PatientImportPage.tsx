import { ImportWizard } from '../../components/admin/ImportWizard'
import { AppShell } from '../../components/AppShell'
import { useMe } from '../../api/queries'

export function PatientImportPage() {
  const { data: me } = useMe()

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex flex-col gap-1 border-b border-slate-200 pb-5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Patient Import Centre
          </h1>
          <p className="text-sm text-slate-600">
            Staged 8-stage spreadsheet ingestion pipeline for bulk patient registration with automated pre-commit safety backup and duplicate candidate detection.
          </p>
        </div>

        {/* 8-Stage Import Wizard Component */}
        <ImportWizard />
      </div>
    </AppShell>
  )
}
