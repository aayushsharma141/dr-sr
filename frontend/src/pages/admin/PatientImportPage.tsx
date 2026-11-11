import { ImportWizard } from '../../components/admin/ImportWizard'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { AppShell } from '../../components/AppShell'
import { useMe } from '../../api/queries'

export function PatientImportPage() {
  const { data: me } = useMe()

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        {/* Page Header */}
        <AdminPageHeader
          title="Import Patients"
          description="Staged 8-stage spreadsheet ingestion pipeline for bulk patient registration with automated pre-commit safety backup and duplicate candidate detection."
        />

        {/* 8-Stage Import Wizard Component */}
        <ImportWizard />
      </div>
    </AppShell>
  )
}
