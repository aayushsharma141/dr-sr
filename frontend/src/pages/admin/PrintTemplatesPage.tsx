import { useMe } from '../../api/queries'
import { AppShell } from '../../components/AppShell'
import { PrintTemplateEditor } from '../../components/admin/PrintTemplateEditor'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'

export function PrintTemplatesPage() {
  const { data: me } = useMe()
  const name = me?.full_name || 'Administrator'

  return (
    <AppShell name={name} role="ADMIN">
      <div className="mx-auto w-full max-w-[1600px] space-y-6">
        <AdminPageHeader
          title="Print Templates"
          description="Configure per-document bilingual header and footer texts for prescriptions, receipts, identity cards, and consultation summaries."
        />

        <PrintTemplateEditor />
      </div>
    </AppShell>
  )
}
