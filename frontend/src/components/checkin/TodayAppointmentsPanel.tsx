import { useMemo, useRef, useState, type FormEvent } from 'react'
import {
  useAppointments,
  useRescheduleAppointment,
  useUpdateAppointmentStatus,
  useUpdatePriority,
} from '../../api/queries'
import type { Appointment, PriorityLevel } from '../../api/types'
import { istToday } from '../../format'
import { IconSearch } from '../icons'
import { PriorityBadge } from './PriorityBadge'

type ListView = 'all' | 'arrive' | 'checked'
type RowAction = { id: number; kind: 'no-show' | 'cancel' | 'reschedule' | 'priority' }

const INPUT =
  'min-h-9 w-full rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-xs font-medium text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600'

/** Booked for today and not here yet; a booking marked not arrived can still check in late. */
export function isAwaitingArrival(a: Appointment): boolean {
  return (
    a.status === 'BOOKED' ||
    a.status === 'NO_SHOW' ||
    a.status === 'TO_ARRIVE' ||
    a.status === 'REGISTERED'
  )
}

function isCheckedIn(a: Appointment): boolean {
  return (
    a.status === 'ARRIVED' ||
    a.status === 'CHECKED_IN' ||
    a.status === 'WAITING' ||
    a.status === 'IN_CONSULTATION' ||
    a.status === 'DONE' ||
    a.status === 'COMPLETED' ||
    a.consultation_status === 'WAITING' ||
    a.consultation_status === 'IN_CONSULTATION' ||
    a.consultation_status === 'COMPLETED'
  )
}

function isNewPatient(a: Appointment): boolean {
  return a.visit_kind === 'NEW'
}

function formatDisplayDate(dateStr: string): string {
  try {
    const [y, m, d] = dateStr.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return dateStr
  }
}

function statusView(a: Appointment): { label: string; style: string } {
  switch (a.status) {
    case 'BOOKED':
      return { label: 'Booked', style: 'bg-sky-50 text-sky-800 ring-sky-200' }
    case 'TO_ARRIVE':
    case 'REGISTERED':
      return { label: 'To arrive', style: 'bg-amber-950/50 text-amber-500 border border-amber-900' }
    case 'NO_SHOW':
      return { label: 'No-show', style: 'bg-slate-100 text-slate-700 ring-slate-200' }
    case 'CANCELLED':
      return { label: 'Cancelled', style: 'bg-slate-100 text-slate-600 ring-slate-200' }
    case 'RESCHEDULED':
      return { label: 'Rescheduled', style: 'bg-slate-100 text-slate-600 ring-slate-200' }
    case 'DONE':
    case 'COMPLETED':
      return { label: 'Completed', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
    case 'IN_CONSULTATION':
      return { label: 'In Cabin', style: 'bg-violet-50 text-violet-800 ring-violet-200' }
    default:
      return a.consultation_status === 'COMPLETED'
        ? { label: 'Completed', style: 'bg-emerald-50 text-emerald-800 ring-emerald-200' }
        : a.consultation_status === 'IN_CONSULTATION'
          ? { label: 'In Cabin', style: 'bg-violet-50 text-violet-800 ring-violet-200' }
          : { label: 'Waiting', style: 'bg-slate-100 text-slate-800 ring-slate-200' }
  }
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

/**
 * Right column of Check-in & Token: today's appointments desk.
 * Tabs: All, To Arrive, Checked In.
 */
export function TodayAppointmentsPanel({
  activeBookingId,
  canCheckIn,
  canManage,
  onCheckIn,
  onRegisterPatient,
}: {
  activeBookingId: number | null
  canCheckIn: boolean
  canManage: boolean
  onCheckIn: (booking: Appointment) => void
  onRegisterPatient?: (booking: Appointment) => void
}) {
  const today = istToday()
  const { data, isPending, isError, error } = useAppointments({ appointment_date: today })
  const [view, setView] = useState<ListView>('all')
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
    all: all.length,
    arrive: all.filter(isAwaitingArrival).length,
    checked: all.filter(isCheckedIn).length,
  }

  const selectedDoctorName = useMemo(() => {
    if (doctorFilter === '') return 'All doctors'
    return doctors.find(([id]) => id === doctorFilter)?.[1] ?? 'All doctors'
  }, [doctorFilter, doctors])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all
      .filter((a) =>
        view === 'arrive'
          ? isAwaitingArrival(a)
          : view === 'checked'
            ? isCheckedIn(a)
            : true,
      )
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
        // Tokens in queue order
        const tokX = x.token_number ?? 9999
        const tokY = y.token_number ?? 9999
        if (tokX !== tokY) return tokX - tokY
        const tx = x.expected_time ?? '99'
        const ty = y.expected_time ?? '99'
        return tx === ty ? x.id - y.id : tx.localeCompare(ty)
      })
  }, [all, view, doctorFilter, search])

  const tabs: { key: ListView; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'arrive', label: 'To arrive' },
    { key: 'checked', label: 'Checked-in' },
  ]
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  const handleTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex: number | null = null
    if (e.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length
    } else if (e.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length
    } else if (e.key === 'Home') {
      nextIndex = 0
    } else if (e.key === 'End') {
      nextIndex = tabs.length - 1
    }

    if (nextIndex !== null) {
      e.preventDefault()
      setView(tabs[nextIndex].key)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <section
      aria-labelledby="today-appointments-heading"
      className="flex flex-col rounded-2xl border border-zinc-800 bg-[#0a0a0a] text-zinc-100 shadow-md"
    >
      <div className="space-y-3 border-b border-zinc-800/80 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="today-appointments-heading" className="text-base font-bold text-white">
              Today&apos;s appointments
            </h2>
            <p className="mt-0.5 text-xs text-zinc-200">
              {formatDisplayDate(today)} · {selectedDoctorName}
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-emerald-800/80 bg-emerald-950/60 px-2.5 py-0.5 text-xs font-semibold text-emerald-400 shadow-2xs">
            LAN Online
          </span>
        </div>

        {/* 3 Tabs with count on top */}
        <div role="tablist" aria-label="Which appointments" className="flex gap-2 rounded-xl bg-zinc-900/60 p-1 border border-zinc-800/70">
          {tabs.map((t, idx) => {
            const isSelected = view === t.key
            return (
              <button
                key={t.key}
                ref={(el) => {
                  tabRefs.current[idx] = el
                }}
                type="button"
                role="tab"
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onKeyDown={(e) => handleTabKeyDown(e, idx)}
                onClick={() => setView(t.key)}
                className={`flex flex-1 flex-col items-center justify-center rounded-lg py-2 transition-colors ${
                  isSelected
                    ? 'bg-zinc-800/95 text-white shadow-sm'
                    : 'text-zinc-200 hover:text-white hover:bg-zinc-800/40'
                }`}
              >
                <span className="font-mono text-sm font-bold text-white leading-none">
                  {counts[t.key]}
                </span>
                <span className="mt-1 text-xs font-medium leading-none">
                  {t.label}
                </span>
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div className="space-y-2">
          <label className="relative block">
            <span className="sr-only">Search today&apos;s appointments</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, URN, mobile or token"
              className={`${INPUT} pl-9`}
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

      <div className="max-h-[42rem] flex-1 overflow-y-auto p-4 space-y-3">
        {isPending ? (
          <p className="p-6 text-center text-xs text-zinc-500">Loading today&apos;s appointments…</p>
        ) : isError ? (
          <p role="alert" className="p-6 text-center text-xs font-semibold text-red-400">
            Could not load today&apos;s appointments: {error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-xs text-zinc-500">
            {view === 'arrive'
              ? 'No one booked for today is still to arrive.'
              : view === 'checked'
                ? 'No one has been checked in yet today.'
                : 'No appointments today.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((a) => (
              <AppointmentCard
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
                onRegisterPatient={() => {
                  setAction(null)
                  if (onRegisterPatient) {
                    onRegisterPatient(a)
                  } else {
                    onCheckIn(a)
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

function AppointmentCard({
  appointment: a,
  active,
  canCheckIn,
  canManage,
  action,
  onAction,
  onCheckIn,
  onRegisterPatient,
}: {
  appointment: Appointment
  active: boolean
  canCheckIn: boolean
  canManage: boolean
  action: RowAction['kind'] | null
  onAction: (kind: RowAction['kind'] | null) => void
  onCheckIn: () => void
  onRegisterPatient: () => void
}) {
  const status = statusView(a)
  const isChecked = isCheckedIn(a)
  const isAwaiting = isAwaitingArrival(a)
  const isNew = isNewPatient(a)

  return (
    <li
      className={`rounded-2xl border p-4 text-xs transition-colors shadow-2xs ${
        active
          ? 'border-[#8E1C3D] bg-zinc-900/90'
          : 'border-zinc-800/90 bg-[#0d0d0e]'
      } ${
        a.priority_level === 'EMERGENCY'
          ? 'border-l-4 border-l-red-600'
          : a.priority_level === 'PRIORITY'
            ? 'border-l-4 border-l-amber-500'
            : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left side of card */}
        <div className="min-w-0 space-y-1">
          <p className="truncate text-base font-bold text-white tracking-tight">{a.patient_name}</p>
          <p className="font-mono text-xs text-zinc-200">{a.patient_urn}</p>
          <p className="text-xs text-zinc-200">{a.doctor_name_en}</p>
          <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
            <PriorityBadge level={a.priority_level} reason={a.priority_reason} showNormal={true} />
          </div>
          {isChecked && (
            <p className="pt-1 text-xs font-semibold text-emerald-400">
              Checked-in · Waiting
            </p>
          )}
        </div>

        {/* Right side of card */}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${status.style}`}
          >
            {status.label}
          </span>
          {a.token_number != null && (
            <span className="font-mono text-xl font-bold text-white mt-0.5">
              #{a.token_number}
            </span>
          )}
          <span className="text-xs text-zinc-200">
            {isNew ? 'New patient' : 'Existing patient'}
          </span>
          {isChecked && canCheckIn && action === null && (
            <button
              type="button"
              onClick={() => onAction('priority')}
              className="mt-2 inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              Change priority
            </button>
          )}
        </div>
      </div>

      {/* To arrive bottom actions */}
      {isAwaiting && action === null && (
        <div className="mt-3 pt-3 border-t border-zinc-800/80">
          {isNew ? (
            <button
              type="button"
              onClick={onRegisterPatient}
              className="w-full rounded-xl bg-zinc-200 py-2.5 px-4 text-xs font-bold text-zinc-900 hover:bg-white transition-colors text-center shadow-xs"
            >
              Register patient
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-zinc-200">
                {a.patient_mobile || a.patient_urn}
              </span>
              <button
                type="button"
                onClick={onCheckIn}
                className="rounded-lg bg-zinc-200 px-4 py-1.5 text-xs font-bold text-zinc-900 hover:bg-white transition-colors shadow-xs"
              >
                Check in
              </button>
            </div>
          )}
        </div>
      )}

      {/* Secondary booking management actions */}
      {a.status === 'BOOKED' && canManage && action === null && (
        <div className="mt-2 flex flex-wrap gap-1.5 pt-1 text-xs">
          <RowButton onClick={() => onAction('no-show')}>No-show</RowButton>
          <RowButton onClick={() => onAction('reschedule')}>Reschedule</RowButton>
          <RowButton onClick={() => onAction('cancel')}>Cancel booking</RowButton>
        </div>
      )}

      {action === 'priority' && <PriorityForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'no-show' && <NoShowForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'cancel' && <CancelForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'reschedule' && <RescheduleForm appointment={a} onDone={() => onAction(null)} />}
    </li>
  )
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors"
    >
      {children}
    </button>
  )
}

/** Priority change form matching Image 4 specifications */
function PriorityForm({
  appointment,
  onDone,
}: {
  appointment: Appointment
  onDone: () => void
}) {
  const update = useUpdatePriority()
  const [level, setLevel] = useState<PriorityLevel>(appointment.priority_level ?? 'NORMAL')
  const [reason, setReason] = useState(appointment.priority_reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!reason.trim()) {
      setError('A reason is mandatory when changing priority.')
      return
    }
    try {
      await update.mutateAsync({
        id: appointment.id,
        body: {
          priority_level: level,
          priority_reason: reason.trim(),
          version_id: appointment.version_id,
        },
      })
      onDone()
    } catch (err) {
      setError(errorText(err, 'Could not change the priority.'))
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/90 p-3.5"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-zinc-200">
          Change priority: {appointment.patient_name} (#{appointment.token_number ?? '--'})
        </p>
      </div>

      <div>
        <label htmlFor="priority-level-select" className="mb-1 block text-xs font-semibold text-zinc-200">
          Priority *
        </label>
        <select
          id="priority-level-select"
          value={level}
          onChange={(e) => setLevel(e.target.value as PriorityLevel)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-100 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        >
          <option value="NORMAL">Normal (Regular queue)</option>
          <option value="PRIORITY">High (Needs preferential attention)</option>
          <option value="EMERGENCY">Emergency (Immediate clinical attention)</option>
        </select>
      </div>

      <div>
        <label htmlFor="priority-reason-input" className="mb-1 block text-xs font-semibold text-zinc-200">
          Mandatory Reason *
        </label>
        <textarea
          id="priority-reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          placeholder="Enter reason for updating priority..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs font-semibold text-red-400">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-lg bg-zinc-100 px-3.5 py-1.5 text-xs font-bold text-zinc-900 hover:bg-white disabled:opacity-50 transition-colors"
        >
          {update.isPending ? 'Saving…' : 'Save priority'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
    </form>
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
      className="mt-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3"
    >
      <p className="font-bold text-zinc-200 text-xs">{title}</p>
      {children}
      {error && (
        <p role="alert" className="font-semibold text-red-400 text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-8 items-center rounded-lg bg-zinc-100 px-3 text-xs font-bold text-zinc-900 hover:bg-white disabled:opacity-50"
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
        <span className="mb-1 block font-semibold text-zinc-200">Reason *</span>
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
          <span className="mb-1 block font-semibold text-zinc-200">New date *</span>
          <input type="date" required min={istToday()} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
        </label>
        <label className="block">
          <span className="mb-1 block font-semibold text-zinc-200">Time</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={INPUT} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block font-semibold text-zinc-200">Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className={INPUT} placeholder="e.g. Patient asked for Monday" />
      </label>
    </InlineForm>
  )
}
