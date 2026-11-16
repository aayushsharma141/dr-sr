import { useMemo, useState } from 'react'
import type * as React from 'react'
import { Link } from 'react-router'
import { AppShell } from '../components/AppShell'
import { useAppointments, useDepartments, useDoctorDepartments, useDoctors, useMe, useReassignAppointment, useUpdateAppointmentStatus } from '../api/queries'
import type { Appointment, PriorityLevel } from '../api/types'
import { ApiError } from '../api/client'
import { InlineAlert } from '../components/InlineAlert'
import { Modal } from '../components/Modal'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { formatIst, formatToken, istToday } from '../format'

/**
 * Waiting Room (design §7 item 5, S2 in the UI-SPEC). Reception's queue-management workspace.
 *
 * Three columns: Waiting, In Cabin, Completed, for today. Waiting is ordered by the suggested
 * order (OD-22-07): EMERGENCY by classification time, then PRIORITY, then NORMAL, each by token.
 * Positions are computed here and never stored. Refreshes every 10 seconds and shows when it
 * last updated. There is no Complete control: the doctor completes the consultation (OD-22-19).
 */

const SUGGESTED_RANK: Record<PriorityLevel, number> = { EMERGENCY: 0, PRIORITY: 1, NORMAL: 2 }

function suggestedOrder(a: Appointment, b: Appointment): number {
  const ra = SUGGESTED_RANK[a.priority_level ?? 'NORMAL']
  const rb = SUGGESTED_RANK[b.priority_level ?? 'NORMAL']
  if (ra !== rb) return ra - rb
  if (ra === 0) {
    const ta = a.priority_updated_at ?? a.status_updated_at
    const tb = b.priority_updated_at ?? b.status_updated_at
    if (ta !== tb) return ta < tb ? -1 : 1
  }
  return (a.token_number ?? 0) - (b.token_number ?? 0)
}

function matchesSearch(a: Appointment, query: string): boolean {
  if (!query) return true
  const q = query.trim().toLowerCase()
  return (
    a.patient_name.toLowerCase().includes(q) ||
    a.patient_urn.toLowerCase().includes(q) ||
    formatToken(a.token_number).toLowerCase().includes(q)
  )
}

export function WaitingRoom() {
  const { data: me } = useMe()
  const today = useMemo(() => istToday(), [])
  const list = useAppointments({ appointment_date: today }, { refetchInterval: 10000 })
  const doctors = useDoctors(true)
  const departments = useDepartments()

  const [doctorFilter, setDoctorFilter] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [search, setSearch] = useState('')

  const all = list.data?.appointments ?? []
  const visible = all.filter(
    (a) =>
      (!doctorFilter || String(a.doctor_id) === doctorFilter) &&
      (!departmentFilter || String(a.department_id ?? '') === departmentFilter) &&
      matchesSearch(a, search),
  )

  const waiting = visible
    .filter((a) => a.status === 'ARRIVED' && a.consultation_status === 'WAITING')
    .sort(suggestedOrder)
  const inCabin = visible.filter((a) => a.consultation_status === 'IN_CONSULTATION')
  const completed = visible.filter((a) => a.consultation_status === 'COMPLETED')

  const updatedAt = list.dataUpdatedAt ? new Date(list.dataUpdatedAt) : null

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <section aria-labelledby="waiting-room-title" className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 id="waiting-room-title" className="text-base font-bold text-neutral-900">Waiting Room</h1>
          <p className="text-sm text-neutral-600">
            {updatedAt
              ? `Last updated ${updatedAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}`
              : 'Loading today’s queue…'}
          </p>
        </div>
      </header>

      {list.isError && (
        <InlineAlert tone="error">
          Could not refresh the queue. The data below may be out of date
          {updatedAt ? ` (last updated ${formatIst(updatedAt.toISOString())}).` : '.'} Try again.
        </InlineAlert>
      )}

      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col text-sm font-semibold text-neutral-700">
          Doctor
          <select
            value={doctorFilter}
            onChange={(e) => setDoctorFilter(e.target.value)}
            className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">All doctors</option>
            {(doctors.data ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name_en}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm font-semibold text-neutral-700">
          Department
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">All departments</option>
            {(departments.data ?? []).filter((d) => d.is_active).map((d) => (
              <option key={d.id} value={d.id}>{d.name_en}</option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[240px] flex-1 flex-col text-sm font-semibold text-neutral-700">
          Search by name, URN or token
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mt-1 min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
          />
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Waiting" count={waiting.length} emptyText="No one is waiting.">
          {waiting.map((a, index) => (
            <WaitingCard key={a.id} appt={a} position={index + 1} />
          ))}
        </Column>
        <Column title="In Cabin" count={inCabin.length} emptyText="No one is in a cabin.">
          {inCabin.map((a) => (
            <PlainCard key={a.id} appt={a} />
          ))}
        </Column>
        <Column title="Completed" count={completed.length} emptyText="No consultations completed yet today.">
          {completed.map((a) => (
            <PlainCard key={a.id} appt={a} billLink />
          ))}
        </Column>
      </div>
    </section>
    </AppShell>
  )
}

function Column({ title, count, emptyText, children }: { title: string; count: number; emptyText: string; children: React.ReactNode }) {
  return (
    <div className="flex max-h-[70vh] flex-col rounded-lg border border-neutral-200 bg-neutral-50">
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-neutral-600">{title}</h2>
        <span className="font-mono text-sm text-neutral-700">{count}</span>
      </div>
      <div className="space-y-2 overflow-y-auto p-4">
        {count === 0 ? <p className="text-sm text-neutral-500">{emptyText}</p> : children}
      </div>
    </div>
  )
}

function CardFrame({ appt, children }: { appt: Appointment; children?: React.ReactNode }) {
  return (
    <article className="rounded-md border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-bold text-neutral-900">{formatToken(appt.token_number)}</p>
          <p className="truncate text-base font-bold text-neutral-900" title={appt.patient_name}>
            {appt.patient_name}
          </p>
          <p className="text-xs text-neutral-600">
            {appt.patient_urn} · {appt.doctor_name_en}
          </p>
        </div>
        <PriorityBadge level={appt.priority_level} />
      </div>
      {children}
    </article>
  )
}

function PlainCard({ appt, billLink = false }: { appt: Appointment; billLink?: boolean }) {
  return (
    <CardFrame appt={appt}>
      {billLink && (
        <Link
          to={`/reception/billing?appointment_id=${appt.id}&patient_id=${appt.patient_id}`}
          className="mt-2 inline-flex min-h-[44px] items-center text-sm font-semibold text-brand-700 underline"
        >
          Open bill
        </Link>
      )}
    </CardFrame>
  )
}

function WaitingCard({ appt, position }: { appt: Appointment; position: number }) {
  const [reassignOpen, setReassignOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const cancel = useUpdateAppointmentStatus()

  const submitCancel = (e: React.FormEvent) => {
    e.preventDefault()
    const text = reason.trim()
    if (text.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setError(null)
    cancel.mutate(
      {
        id: appt.id,
        body: { status: 'CANCELLED', version_id: appt.version_id, cancellation_reason: text },
      },
      {
        onSuccess: () => {
          setCancelOpen(false)
          setReason('')
        },
        onError: (err) =>
          setError(
            err instanceof ApiError && err.status === 409
              ? 'This patient was updated by someone else. The queue has refreshed; check it and try again.'
              : 'Could not cancel the consultation. It is still waiting. Try again.',
          ),
      },
    )
  }

  return (
    <CardFrame appt={appt}>
      <p className="mt-2 text-xs text-neutral-600">Position {position}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setReassignOpen(true)}
          className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800"
        >
          Reassign
        </button>
        <button
          type="button"
          onClick={() => setCancelOpen((v) => !v)}
          className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm font-semibold text-neutral-800"
        >
          Cancel consultation
        </button>
      </div>

      {cancelOpen && (
        <form onSubmit={submitCancel} className="mt-2 space-y-2">
          <label className="block text-sm font-semibold text-neutral-700">
            Reason for cancelling
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 px-3 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={cancel.isPending}
            className="min-h-[44px] rounded-md bg-danger-600 px-3 text-sm font-semibold text-white disabled:opacity-70"
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel consultation'}
          </button>
        </form>
      )}

      {error && (
        <div className="mt-2">
          <InlineAlert tone="error">{error}</InlineAlert>
        </div>
      )}

      {reassignOpen && (
        <ReassignDialog appt={appt} onClose={() => setReassignOpen(false)} />
      )}
    </CardFrame>
  )
}

function ReassignDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const doctors = useDoctors(true)
  const reassign = useReassignAppointment()
  const [targetDoctorId, setTargetDoctorId] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const targetId = targetDoctorId ? Number(targetDoctorId) : null
  const targetDepartments = useDoctorDepartments(targetId)
  const sameDepartment =
    targetDepartments.data?.some((d) => d.id === appt.department_id) ?? false
  const needsDepartment = targetId !== null && targetDepartments.isSuccess && !sameDepartment

  const candidates = (doctors.data ?? []).filter((d) => d.id !== appt.doctor_id && d.is_active)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (targetId === null) {
      setError('Choose the doctor to move the patient to.')
      return
    }
    if (needsDepartment && !departmentId) {
      setError('Choose one of this doctor’s departments.')
      return
    }
    const text = reason.trim()
    if (text.length < 3) {
      setError('Enter a reason of at least 3 characters.')
      return
    }
    setError(null)
    reassign.mutate(
      {
        id: appt.id,
        body: {
          version_id: appt.version_id,
          new_doctor_id: targetId,
          new_department_id: needsDepartment ? Number(departmentId) : null,
          reason: text,
        },
      },
      {
        onSuccess: () => onClose(),
        onError: (err) => {
          if (err instanceof ApiError && err.code === 'department_required') {
            setError('Choose one of this doctor’s departments.')
          } else if (err instanceof ApiError && err.status === 409) {
            setError('This patient was updated by someone else. The queue has refreshed; check it and try again.')
          } else {
            setError('Could not move the patient. The consultation is still waiting. Try again.')
          }
        },
      },
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Reassign ${formatToken(appt.token_number)} (${appt.patient_name})?`}
      description={`The old token stays in history. The patient gets a new token from the new doctor's sequence.`}
      variant="warning"
      dismiss="none"
      busy={reassign.isPending}
      className="max-w-md"
    >
      <form onSubmit={submit} className="space-y-3">
        <label className="block text-sm font-semibold text-neutral-700">
          Move to doctor
          <select
            value={targetDoctorId}
            onChange={(e) => {
              setTargetDoctorId(e.target.value)
              setDepartmentId('')
            }}
            className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
          >
            <option value="">Choose a doctor</option>
            {candidates.map((d) => (
              <option key={d.id} value={d.id}>{d.name_en}</option>
            ))}
          </select>
        </label>

        {needsDepartment && (
          <label className="block text-sm font-semibold text-neutral-700">
            Department for this consultation
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
            >
              <option value="">Choose a department</option>
              {(targetDepartments.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>{d.name_en}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block text-sm font-semibold text-neutral-700">
          Reason
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full min-h-[44px] rounded-md border border-neutral-300 px-3 text-sm"
          />
        </label>

        {error && <InlineAlert tone="error">{error}</InlineAlert>}

        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-md border border-neutral-300 bg-white px-4 text-sm font-semibold"
          >
            Keep with current doctor
          </button>
          <button
            type="submit"
            disabled={reassign.isPending}
            className="min-h-[44px] rounded-md bg-danger-600 px-4 text-sm font-semibold text-white disabled:opacity-70"
          >
            {reassign.isPending ? 'Reassigning…' : 'Reassign & issue new token'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
