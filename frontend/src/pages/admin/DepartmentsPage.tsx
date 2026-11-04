import { useEffect, useState, type FormEvent } from 'react'
import { useDepartments, useCreateDepartment, useDoctors, useDoctorDepartments, useAssignDoctorDepartments } from '../../api/queries'
import { AppShell } from '../../components/AppShell'

export function DepartmentsPage() {
  const { data: departments = [], isPending } = useDepartments()
  const { data: doctors = [] } = useDoctors(false)
  const create = useCreateDepartment()
  const assign = useAssignDoctorDepartments()
  const [name, setName] = useState('')
  const [nameHi, setNameHi] = useState('')
  const [doctorId, setDoctorId] = useState<number | null>(null)
  const { data: assigned = [] } = useDoctorDepartments(doctorId)
  const [ids, setIds] = useState<number[]>([])
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => setIds(assigned.map((item) => item.id)), [assigned])

  async function createDepartment(event: FormEvent) {
    event.preventDefault()
    setError(''); setNotice('')
    try {
      await create.mutateAsync({ name_en: name.trim(), name_hi: nameHi.trim() || null })
      setName(''); setNameHi(''); setNotice('Department created.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Create failed.') }
  }

  async function saveAssignments(event: FormEvent) {
    event.preventDefault()
    const doctor = doctors.find((item) => item.id === doctorId)
    if (!doctor) return
    setError(''); setNotice('')
    try {
      await assign.mutateAsync({ doctorId: doctor.id, body: { department_ids: ids, version_id: doctor.version_id } })
      setNotice('Doctor assignments saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed.') }
  }

  return <AppShell><main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
    <header><p className="text-xs font-semibold uppercase text-red-900">Administration</p><h1 className="text-2xl font-bold">Departments & Specialties</h1><p className="mt-1 text-sm text-neutral-600">Configure reception departments and doctor memberships.</p></header>
    {notice && <p role="status" className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-900">{notice}</p>}
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    <section className="space-y-3 rounded-lg border bg-white p-4">
      <h2 className="font-semibold">Create department</h2>
      <form onSubmit={createDepartment} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Name (English)<input required value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <label className="text-sm">Name (Hindi)<input value={nameHi} onChange={(e) => setNameHi(e.target.value)} className="mt-1 w-full rounded border p-2" /></label>
        <button disabled={create.isPending || !name.trim()} className="w-fit rounded bg-red-900 px-4 py-2 text-sm text-white disabled:opacity-50">{create.isPending ? 'Creating…' : 'Create department'}</button>
      </form>
    </section>
    <section className="rounded-lg border bg-white p-4">
      <h2 className="font-semibold">Active department catalogue</h2>
      {isPending ? <p className="mt-2 text-sm text-neutral-500">Loading…</p> : <ul className="mt-2 divide-y">{departments.map((d) => <li key={d.id} className="py-2 text-sm">{d.name_en}{d.name_hi ? ` / ${d.name_hi}` : ''}</li>)}</ul>}
      {!isPending && departments.length === 0 && <p className="mt-2 text-sm text-neutral-500">No departments configured.</p>}
    </section>
    <section className="space-y-3 rounded-lg border bg-white p-4">
      <h2 className="font-semibold">Assign doctor specialties</h2>
      <label className="block text-sm">Doctor<select value={doctorId ?? ''} onChange={(e) => setDoctorId(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded border p-2 sm:max-w-md"><option value="">Select doctor</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name_en}{d.is_active ? '' : ' (Inactive)'}</option>)}</select></label>
      {doctorId !== null && <form onSubmit={saveAssignments} className="space-y-3"><fieldset className="space-y-2"><legend className="text-sm font-medium">Departments</legend>{departments.map((d) => <label key={d.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ids.includes(d.id)} onChange={(e) => setIds((old) => e.target.checked ? [...old, d.id] : old.filter((id) => id !== d.id))} />{d.name_en}{d.name_hi ? ` / ${d.name_hi}` : ''}</label>)}</fieldset><button disabled={assign.isPending || !departments.length} className="rounded bg-red-900 px-4 py-2 text-sm text-white disabled:opacity-50">{assign.isPending ? 'Saving…' : 'Save assignments'}</button></form>}
    </section>
  </main></AppShell>
}
