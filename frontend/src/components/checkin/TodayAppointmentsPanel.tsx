import { useMemo, useState, type FormEvent } from 'react'
import {
  useAppointments,
  useRescheduleAppointment,
  useUpdateAppointmentStatus,
  useUpdatePriority,
} from '../../api/queries'
import type { Appointment, PriorityLevel } from '../../api/types'
import { formatToken, istToday } from '../../format'
import { IconCalendar, IconPhone, IconSearch } from '../icons'
import { PRIORITY_LABEL, PriorityBadge } from './PriorityBadge'

type ListView = 'arrive' | 'checked' | 'all'
type RowAction = { id: number; kind: 'no-show' | 'cancel' | 'reschedule' | 'priority' }

const INPUT =
  'min-h-9 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

/** Booked for today and not here yet; a booking marked not arrived can still check in late. */
export function isAwaitingArrival(a: Appointment): boolean {
  return a.status === 'BOOKED' || a.status === 'NO_SHOW'
}

function isCheckedIn(a: Appointment): boolean {
  return a.status === 'ARRIVED' || a.status === 'IN_CONSULTATION' || a.status === 'DONE'
}

function statusView(a: Appointment): { label: string; style: string } {
  switch (a.status) {
    case 'BOOKED':
      return { label: 'Booked', style: 'bg-sky-50 text-sky-800 ring-sky-200' }
    case 'NO_SHOW':
      return { label: 'Not arrived', style: 'bg-slate-100 text-slate-700 ring-slate-200' }
    case 'CANCELLED':
      return { label: 'Cancelled', style: 'bg-red-50 text-red-800 ring-red-200' }
    case 'RESCHEDULED':
      return { label: 'Rescheduled', style: 'bg-slate-100 text-slate-600 ring-slate-200' }
    case 'DONE':
      return { label: 'Seen by doctor', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
    case 'IN_CONSULTATION':
      return { label: 'With doctor', style: 'bg-violet-50 text-violet-800 ring-violet-200' }
    default:
      return a.consultation_status === 'COMPLETED'
        ? { label: 'Seen by doctor', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
        : a.consultation_status === 'IN_CONSULTATION'
          ? { label: 'With doctor', style: 'bg-violet-50 text-violet-800 ring-violet-200' }
          : { label: 'Waiting', style: 'bg-amber-50 text-amber-900 ring-amber-200' }
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Right column of Check-in & Token (OD-22-02): today's bookings, whether made by phone, as a
 * walk-in or earlier. "Check in" hands the booking to the form on the left, where reception
 * confirms the referral, visit type and classification before the token is issued.
 */
export function TodayAppointmentsPanel({
  activeBookingId,
  canCheckIn,
  canManage,
  onCheckIn,
}: {
  activeBookingId: number | null
  canCheckIn: boolean
  canManage: boolean
  onCheckIn: (booking: Appointment) => void
}) {
  const today = istToday()
  const { data, isPending, isError, error } = useAppointments({ appointment_date: today })
  const [view, setView] = useState<ListView>('arrive')
  const [doctorFilter, setDoctorFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<RowAction | null>(null)

  const all = useMemo(() => data?.appointments ?? [], [data])
  const doctors = useMemo(() => {
    const seen = new Map<number, string>()
    for (const a of all) seen.set(a.doctor_id, a.doctor_name_en)
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [all])

  const counts = {
    arrive: all.filter(isAwaitingArrival).length,
    checked: all.filter(isCheckedIn).length,
    all: all.length,
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((a) => (view === 'arrive' ? isAwaitingArrival(a) : view === 'checked' ? isCheckedIn(a) : true))
      .filter((a) => doctorFilter === '' || a.doctor_id === doctorFilter)
      .filter(
        (a) =>
          !q ||
          a.patient_name.toLowerCase().includes(q) ||
          a.patient_urn.toLowerCase().includes(q) ||
          a.patient_mobile.includes(q) ||
          String(a.token_number ?? '') === q,
      )
      .sort((x, y) => {
        const tx = x.expected_time ?? '99'
        const ty = y.expected_time ?? '99'
        return tx === ty ? x.id - y.id : tx.localeCompare(ty)
      })
  }, [all, view, doctorFilter, search])

  const tabs: { key: ListView; label: string }[] = [
    { key: 'arrive', label: 'To arrive' },
    { key: 'checked', label: 'Checked in' },
    { key: 'all', label: 'All' },
  ]

  return (
    <section
      aria-labelledby="today-appointments-heading"
      className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-xs"
    >
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex items-start gap-2">
          <IconCalendar className="mt-0.5 h-5 w-5 text-[#8E1C3D]" />
          <div>
            <h2 id="today-appointments-heading" className="text-base font-bold text-slate-900">
              Today&apos;s appointments
            </h2>
            <p className="text-xs text-slate-500">
              Booked by phone, as walk-ins or earlier. Press Check in when the patient arrives.
            </p>
          </div>
        </div>

        <div role="tablist" aria-label="Which appointments" className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={view === t.key}
              onClick={() => setView(t.key)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-bold transition-colors ${
                view === t.key ? 'bg-white text-[#5D0B26] shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label} <span className="font-mono">({counts[t.key]})</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="relative block">
            <span className="sr-only">Search today&apos;s appointments</span>
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, URN, mobile or token"
              className={`${INPUT} pl-8`}
            />
          </label>
          <label className="block">
            <span className="sr-only">Filter by doctor</span>
            <select
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value ? Number(e.target.value) : '')}
              className={INPUT}
            >
              <option value="">All doctors</option>
              {doctors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="max-h-[38rem] flex-1 overflow-y-auto p-3">
        {isPending ? (
          <p className="p-6 text-center text-xs text-slate-500">Loading today&apos;s appointments…</p>
        ) : isError ? (
          <p role="alert" className="p-6 text-center text-xs font-semibold text-red-700">
            Could not load today&apos;s appointments: {error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500">
            {view === 'arrive'
              ? 'No one booked for today is still to arrive.'
              : view === 'checked'
                ? 'No one has been checked in yet today.'
                : 'No appointments today.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((a) => (
              <AppointmentRow
                key={a.id}
                appointment={a}
                active={a.id === activeBookingId}
                canCheckIn={canCheckIn}
                canManage={canManage}
                action={action?.id === a.id ? action.kind : null}
                onAction={(kind) => setAction(kind ? { id: a.id, kind } : null)}
                onCheckIn={() => {
                  setAction(null)
                  onCheckIn(a)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function AppointmentRow({
  appointment: a,
  active,
  canCheckIn,
  canManage,
  action,
  onAction,
  onCheckIn,
}: {
  appointment: Appointment
  active: boolean
  canCheckIn: boolean
  canManage: boolean
  action: RowAction['kind'] | null
  onAction: (kind: RowAction['kind'] | null) => void
  onCheckIn: () => void
}) {
  const status = statusView(a)
  const time = a.expected_time ? a.expected_time.slice(0, 5) : null
  const waiting = a.status === 'ARRIVED' && a.consultation_status === 'WAITING'

  return (
    <li
      className={`rounded-xl border p-3 text-xs transition-colors ${
        active ? 'border-[#8E1C3D] bg-[#FBF5F7]' : 'border-slate-200 bg-white'
      } ${a.priority_level === 'EMERGENCY' ? 'border-l-4 border-l-red-600' : a.priority_level === 'PRIORITY' ? 'border-l-4 border-l-amber-400' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono font-bold text-slate-700">{time ?? '--:--'}</span>
            <span className="truncate font-bold text-slate-900">{a.patient_name}</span>
            <PriorityBadge level={a.priority_level} reason={a.priority_reason} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-slate-600">
            <span className="font-mono">{a.patient_urn}</span>
            <span className="inline-flex items-center gap-1 font-mono">
              <IconPhone className="h-3 w-3" />
              {a.patient_mobile}
            </span>
          </div>
          <div className="text-slate-700">
            {a.doctor_name_en}
            {a.source && (
              <span className="ml-1.5 text-slate-500">· {a.source === 'PHONE' ? 'Phone booking' : 'Walk-in'}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${status.style}`}>
            {status.label}
          </span>
          {a.token_number != null && (
            <span className="font-mono text-sm font-black text-[#5D0B26]">Token {formatToken(a.token_number)}</span>
          )}
        </div>
      </div>

      {(isAwaitingArrival(a) || waiting) && action === null && (
        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
          {isAwaitingArrival(a) && canCheckIn && (
            <button
              type="button"
              onClick={onCheckIn}
              className="inline-flex min-h-8 items-center rounded-lg bg-[#8E1C3D] px-3 font-bold text-white hover:bg-[#5D0B26]"
            >
              Check in
            </button>
          )}
          {a.status === 'BOOKED' && canManage && (
            <>
              <RowButton onClick={() => onAction('no-show')}>No-show</RowButton>
              <RowButton onClick={() => onAction('reschedule')}>Reschedule</RowButton>
              <RowButton onClick={() => onAction('cancel')}>Cancel</RowButton>
            </>
          )}
          {waiting && canCheckIn && (
            <RowButton onClick={() => onAction('priority')}>Change priority</RowButton>
          )}
        </div>
      )}

      {action === 'no-show' && <NoShowForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'cancel' && <CancelForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'reschedule' && <RescheduleForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'priority' && <PriorityForm appointment={a} onDone={() => onAction(null)} />}
    </li>
  )
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 font-semibold text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  )
}

function InlineForm({
  title,
  error,
  busy,
  submitLabel,
  onSubmit,
  onBack,
  children,
}: {
  title: string
  error: string | null
  busy: boolean
  submitLabel: string
  onSubmit: () => void
  onBack: () => void
  children?: React.ReactNode
}) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        onSubmit()
      }}
      className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5"
    >
      <p className="font-bold text-slate-800">{title}</p>
      {children}
      {error && (
        <p role="alert" className="font-semibold text-red-700">
          {error}
        </p>
      )}
      <div className="flex gap-1.5">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-8 items-center rounded-lg bg-slate-900 px-3 font-bold text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? 'Saving…' : submitLabel}
        </button>
        <RowButton onClick={onBack}>Back</RowButton>
      </div>
    </form>
  )
}

function NoShowForm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const update = useUpdateAppointmentStatus()
  const [error, setError] = useState<string | null>(null)
  return (
    <InlineForm
      title={`Mark ${appointment.patient_name} as not arrived? They can still be checked in later today.`}
      error={error}
      busy={update.isPending}
      submitLabel="Mark no-show"
      onBack={onDone}
      onSubmit={async () => {
        setError(null)
        try {
          await update.mutateAsync({
            id: appointment.id,
            body: { status: 'NO_SHOW', version_id: appointment.version_id },
          })
          onDone()
        } catch (err) {
          setError(errorText(err, 'Could not mark the booking as not arrived.'))
        }
      }}
    />
  )
}

function CancelForm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const update = useUpdateAppointmentStatus()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <InlineForm
      title={`Cancel ${appointment.patient_name}'s booking`}
      error={error}
      busy={update.isPending}
      submitLabel="Cancel booking"
      onBack={onDone}
      onSubmit={async () => {
        setError(null)
        if (reason.trim().length < 3) {
          setError('Enter why the booking is cancelled.')
          return
        }
        try {
          await update.mutateAsync({
            id: appointment.id,
            body: { status: 'CANCELLED', version_id: appointment.version_id, cancellation_reason: reason.trim() },
          })
          onDone()
        } catch (err) {
          setError(errorText(err, 'Could not cancel the booking.'))
        }
      }}
    >
      <label className="block">
        <span className="mb-1 block font-semibold text-slate-700">Reason *</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Patient called to cancel" />
      </label>
    </InlineForm>
  )
}

function RescheduleForm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const reschedule = useRescheduleAppointment()
  const [date, setDate] = useState(appointment.appointment_date)
  const [time, setTime] = useState(appointment.expected_time?.slice(0, 5) ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  return (
    <InlineForm
      title={`Move ${appointment.patient_name}'s booking`}
      error={error}
      busy={reschedule.isPending}
      submitLabel="Save new date"
      onBack={onDone}
      onSubmit={async () => {
        setError(null)
        try {
          await reschedule.mutateAsync({
            id: appointment.id,
            body: {
              version_id: appointment.version_id,
              appointment_date: date,
              expected_time: time ? `${time}:00` : null,
              reason: reason.trim() || null,
            },
          })
          onDone()
        } catch (err) {
          setError(errorText(err, 'Could not move the booking.'))
        }
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block font-semibold text-slate-700">New date *</span>
          <input type="date" required min={istToday()} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold text-slate-700">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={INPUT} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block font-semibold text-slate-700">Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Patient asked for Monday" />
      </label>
    </InlineForm>
  )
}

function PriorityForm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const update = useUpdatePriority()
  const [level, setLevel] = useState<PriorityLevel>(appointment.priority_level ?? 'NORMAL')
  const [reason, setReason] = useState(appointment.priority_reason ?? '')
  const [error, setError] = useState<string | null>(null)
  return (
    <InlineForm
      title={`Priority for ${appointment.patient_name} (token stays ${formatToken(appointment.token_number)})`}
      error={error}
      busy={update.isPending}
      submitLabel="Save priority"
      onBack={onDone}
      onSubmit={async () => {
        setError(null)
        if (level !== 'NORMAL' && reason.trim().length < 3) {
          setError('Enter a reason for Priority or Emergency.')
          return
        }
        try {
          await update.mutateAsync({
            id: appointment.id,
            body: {
              priority_level: level,
              priority_reason: level === 'NORMAL' ? reason.trim() || null : reason.trim(),
              version_id: appointment.version_id,
            },
          })
          onDone()
        } catch (err) {
          setError(errorText(err, 'Could not change the priority.'))
        }
      }}
    >
      <div className="flex gap-1.5">
        {(['NORMAL', 'PRIORITY', 'EMERGENCY'] as PriorityLevel[]).map((l) => (
          <button
            key={l}
            type="button"
            aria-pressed={level === l}
            onClick={() => setLevel(l)}
            className={`min-h-8 flex-1 rounded-lg border px-2 font-bold ${
              level === l
                ? l === 'EMERGENCY'
                  ? 'border-red-600 bg-red-600 text-white'
                  : l === 'PRIORITY'
                    ? 'border-amber-400 bg-amber-100 text-amber-900'
                    : 'border-slate-400 bg-white text-slate-900'
                : 'border-slate-300 bg-white text-slate-600'
            }`}
          >
            {PRIORITY_LABEL[l]}
          </button>
        ))}
      </div>
      <label className="block">
        <span className="mb-1 block font-semibold text-slate-700">Reason {level !== 'NORMAL' ? '*' : '(optional)'}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Severe pain, elderly, pregnant" />
      </label>
    </InlineForm>
  )
}
