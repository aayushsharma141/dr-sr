import { ImportWizard } from '../../components/admin/ImportWizard'

export function PatientImportPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-1 border-b border-slate-200 pb-5 dark:border-slate-700">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Patient Import Centre
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Staged 8-stage spreadsheet ingestion pipeline for bulk patient registration with automated pre-commit safety backup and duplicate candidate detection.
        </p>
      </div>

      {/* 8-Stage Import Wizard Component */}
      <ImportWizard />
    </div>
  )
}
