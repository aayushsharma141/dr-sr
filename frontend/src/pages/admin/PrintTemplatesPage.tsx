import { useMe } from '../../api/queries'
import { AppShell } from '../../components/AppShell'
import { PrintTemplateEditor } from '../../components/admin/PrintTemplateEditor'

export function PrintTemplatesPage() {
  const { data: me } = useMe()
  const name = me?.full_name || 'Administrator'

  return (
    <AppShell name={name} role="ADMIN">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Print Templates</h1>
          <p className="mt-1 text-sm text-slate-600">
            Configure per-document bilingual header and footer texts for prescriptions, receipts, identity cards, and consultation summaries.
          </p>
        </div>

        <PrintTemplateEditor />
      </div>
    </AppShell>
  )
}
