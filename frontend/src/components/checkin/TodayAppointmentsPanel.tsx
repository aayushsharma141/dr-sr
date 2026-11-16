import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  useAppointments,
  useRescheduleAppointment,
  useUpdateAppointmentStatus,
  useUpdatePriority,
  useUpdateOpdArrivalPriority,
  useOpdArrivals,
} from '../../api/queries'
import type { Appointment, OpdArrival, PriorityLevel } from '../../api/types'
import { istToday } from '../../format'
import { IconSearch, IconX } from '../icons'
import { PriorityBadge } from './PriorityBadge'

type ListView = 'all' | 'arrive' | 'checked'
type RowAction = { key: string; kind: 'no-show' | 'cancel' | 'reschedule' | 'priority' }
type QueueRow = { key: string; appointment: Appointment; pendingArrival?: OpdArrival }

const INPUT =
  'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

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

function arrivalAsAppointment(arrival: OpdArrival): Appointment {
  return {
    id: -arrival.id,
    patient_id: -arrival.id,
    patient_urn: '',
    patient_name: arrival.full_name,
    patient_mobile: arrival.mobile,
    patient_age: arrival.age_years,
    doctor_id: arrival.doctor_id,
    department_id: arrival.department_id,
    department_name: arrival.department_name,
    doctor_name_en: arrival.doctor_name_en,
    doctor_name_hi: null,
    appointment_date: arrival.appointment_date,
    token_number: arrival.token_number,
    status: 'TO_ARRIVE',
    status_updated_at: arrival.created_at,
    check_in_at: null,
    cancellation_reason: null,
    notes: null,
    source: 'WALK_IN',
    expected_time: null,
    visit_id: null,
    consultation_status: null,
    rescheduled_from_id: null,
    visit_kind: 'NEW',
    priority_level: arrival.priority_level,
    priority_reason: arrival.priority_reason ?? null,
    version_id: arrival.version_id,
    created_at: arrival.created_at,
    updated_at: arrival.created_at,
  } as Appointment
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
      return { label: 'To arrive', style: 'bg-amber-50 text-amber-800 ring-amber-200' }
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
  canRegister,
  canManage,
  onCheckIn,
  onRegisterArrival,
}: {
  activeBookingId: number | null
  canCheckIn: boolean
  canRegister: boolean
  canManage: boolean
  onCheckIn: (booking: Appointment) => void
  onRegisterArrival: (arrival: OpdArrival) => void
}) {
  const today = istToday()
  const { data, isPending, isError, error, refetch, isFetching } = useAppointments({ appointment_date: today })
  const { data: arrivalData, isPending: arrivalsPending, isError: arrivalsError, error: arrivalsErrorValue, refetch: refetchArrivals } = useOpdArrivals(today)
  const [view, setView] = useState<ListView>('all')
  const [doctorFilter, setDoctorFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<RowAction | null>(null)
  const [arrivalVerification, setArrivalVerification] = useState<Record<string, string>>({})

  const all = useMemo(() => data?.appointments ?? [], [data])
  const pendingArrivals = useMemo(() => arrivalData?.arrivals ?? [], [arrivalData])
  const doctors = useMemo(() => {
    const seen = new Map<number, string>()
    for (const a of all) seen.set(a.doctor_id, a.doctor_name_en)
    for (const arrival of pendingArrivals) seen.set(arrival.doctor_id, arrival.doctor_name_en)
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [all, pendingArrivals])

  const counts = {
    all: all.length + pendingArrivals.length,
    arrive: all.filter(isAwaitingArrival).length + pendingArrivals.length,
    checked: all.filter(isCheckedIn).length,
  }

  const selectedDoctorName = useMemo(() => {
    if (doctorFilter === '') return 'All doctors'
    return doctors.find(([id]) => id === doctorFilter)?.[1] ?? 'All doctors'
  }, [doctorFilter, doctors])

  const rows = useMemo(() => {
    const entries: QueueRow[] = [
      ...all.map((appointment) => ({ key: `appointment-${appointment.id}`, appointment })),
      ...pendingArrivals.map((arrival) => ({
        key: `arrival-${arrival.id}`,
        pendingArrival: arrival,
        appointment: arrivalAsAppointment(arrival),
      })),
    ]
    const q = search.trim().toLowerCase()
    return entries
      .filter(({ appointment: a }) =>
        view === 'arrive'
          ? isAwaitingArrival(a)
          : view === 'checked'
            ? isCheckedIn(a)
            : true,
      )
      .filter(({ appointment: a }) => doctorFilter === '' || a.doctor_id === doctorFilter)
      .filter(
        ({ appointment: a }) =>
          !q ||
          a.patient_name.toLowerCase().includes(q) ||
          (a.patient_urn ?? '').toLowerCase().includes(q) ||
          a.patient_mobile.includes(q) ||
          String(a.token_number ?? '') === q,
      )
      .sort(({ appointment: x }, { appointment: y }) => {
        // Tokens in queue order
        const tokX = x.token_number ?? 9999
        const tokY = y.token_number ?? 9999
        if (tokX !== tokY) return tokX - tokY
        const tx = x.expected_time ?? '99'
        const ty = y.expected_time ?? '99'
        return tx === ty ? x.id - y.id : tx.localeCompare(ty)
      })
  }, [all, pendingArrivals, view, doctorFilter, search])

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
      className="flex flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xs"
    >
      <div className="space-y-3 border-b border-slate-200 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="today-appointments-heading" className="text-base font-bold text-slate-900">
              Today&apos;s appointments
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {formatDisplayDate(today)} · {selectedDoctorName}
            </p>
          </div>
          <button type="button" onClick={() => { void refetch(); void refetchArrivals() }} disabled={isFetching} aria-label="Refresh appointments" className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-50">
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {tabs.map((t) => <button key={t.key} type="button" onClick={() => setView(t.key)} className={`rounded-xl border p-2 text-left ${view === t.key ? 'border-[#8E1C3D] bg-[#FBF5F7]' : 'border-slate-200 bg-white'}`}>
            <span className="block text-lg font-bold text-[#5D0B26]">{counts[t.key]}</span><span className="text-xs text-slate-600">{t.key === 'all' ? 'All' : t.key === 'arrive' ? 'To Arrive' : 'Checked In'}</span>
          </button>)}
        </div>

        {/* 3 Tabs with count on top */}
        <div role="tablist" aria-label="Which appointments" className="flex gap-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
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
                    ? 'border border-[#E4C8D1] bg-white text-[#5D0B26] shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-[#5D0B26]'
                }`}
              >
                <span className="font-mono text-sm font-bold text-[#5D0B26] leading-none">
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
        <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
          <label className="relative block">
            <span className="sr-only">Search today&apos;s appointments</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
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

      <div className="max-h-[42rem] flex-1 overflow-auto p-4">
        {isPending || arrivalsPending ? (
          <p className="p-6 text-center text-xs text-slate-500">Loading today&apos;s appointments…</p>
        ) : isError || arrivalsError ? (
          <p role="alert" className="p-6 text-center text-xs font-semibold text-red-700">
            Could not load today&apos;s appointments: {error?.message ?? arrivalsErrorValue?.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
            {view === 'arrive'
              ? 'No one booked for today is still to arrive.'
              : view === 'checked'
                ? 'No one has been checked in yet today.'
                : 'No appointments today.'}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full min-w-[900px] border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-slate-600"><tr>{['Token', 'Patient', 'Patient Type', 'Consulting Doctor', 'Priority', 'Actions'].map((h) => <th key={h} scope="col" className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-200">
          {rows.map(({ key, appointment: a, pendingArrival }) => (
              <AppointmentCard
                key={key}
                appointment={a}
                pendingArrival={pendingArrival}
                active={a.id === activeBookingId}
                canCheckIn={canCheckIn}
                canRegister={canRegister}
                canManage={canManage}
                arrivalVerification={arrivalVerification[key] ?? ''}
                onArrivalVerificationChange={(value) =>
                  setArrivalVerification((current) => ({ ...current, [key]: value }))
                }
                action={action?.key === key ? action.kind : null}
                onAction={(kind) => setAction(kind ? { key, kind } : null)}
                onRegisterArrival={() => pendingArrival && onRegisterArrival(pendingArrival)}
                onCheckIn={() => {
                  setAction(null)
                  onCheckIn(a)
                }}
              />
            ))}
            </tbody></table></div>
        )}
      </div>
    </section>
  )
}

function AppointmentCard({
  appointment: a,
  pendingArrival,
  active,
  canCheckIn,
  canRegister,
  canManage,
  arrivalVerification,
  onArrivalVerificationChange,
  action,
  onAction,
  onCheckIn,
  onRegisterArrival,
}: {
  appointment: Appointment
  pendingArrival?: OpdArrival
  active: boolean
  canCheckIn: boolean
  canRegister: boolean
  canManage: boolean
  arrivalVerification: string
  onArrivalVerificationChange: (value: string) => void
  action: RowAction['kind'] | null
  onAction: (kind: RowAction['kind'] | null) => void
  onCheckIn: () => void
  onRegisterArrival: () => void
}) {
  const status = statusView(a)
  const isChecked = isCheckedIn(a)
  const isAwaiting = isAwaitingArrival(a)
  const isNew = pendingArrival != null || isNewPatient(a)
  const registerPendingArrival = pendingArrival != null

  return (
    <>
    <tr
      className={`text-xs transition-colors ${
        active
          ? 'bg-[#FBF5F7]'
          : 'bg-white'
      }`}
    >
      <td className="px-3 py-3 font-mono font-bold text-[#5D0B26]">{a.token_number != null ? `#${a.token_number}` : '—'}</td>
      <td className="px-3 py-3"><p className="font-semibold text-slate-900">{pendingArrival?.full_name ?? a.patient_name}</p><p className="mt-0.5 text-slate-500">{pendingArrival ? pendingArrival.mobile : a.patient_urn}{pendingArrival?.age_years != null ? ` · ${pendingArrival.age_years} yrs` : (a as Appointment & { patient_age?: number }).patient_age != null ? ` · ${(a as Appointment & { patient_age?: number }).patient_age} yrs` : ''}</p></td>
      <td className="px-3 py-3 text-slate-700">{isNew ? 'New patient' : 'Existing patient'}</td>
      <td className="px-3 py-3 text-slate-700">{a.doctor_name_en}{a.department_name && <span className="block text-slate-500">{a.department_name}</span>}</td>
      <td className="px-3 py-3"><PriorityBadge level={a.priority_level} reason={a.priority_reason} showNormal /></td>
      <td className="px-3 py-3"><div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${status.style}`}
          >
            {status.label}
          </span>
          {(isChecked || registerPendingArrival) && canManage && action === null && (
            <button
              type="button"
              onClick={() => onAction('priority')}
              className="mt-2 inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] transition-colors"
            >
              Change priority
            </button>
          )}
        {isAwaiting && action === null && registerPendingArrival && canRegister ? (
            <button
              type="button"
              onClick={onRegisterArrival}
              className="min-h-9 rounded-lg bg-[#8E1C3D] px-3 text-xs font-bold text-white hover:bg-[#5D0B26] transition-colors"
            >
              Register
            </button>
          ) : isAwaiting && action === null && canCheckIn ? (
            <>
              <input
                type="text"
                value={arrivalVerification}
                onChange={(event) => onArrivalVerificationChange(event.target.value)}
                aria-label={`Verify ${a.patient_name} by mobile or URN`}
                placeholder="Enter mobile no. or URN"
                className="min-h-9 w-40 rounded-lg border border-slate-300 bg-white px-2 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
              />
              <button
                type="button"
                disabled={!matchesPatientReference(arrivalVerification, a.patient_mobile, a.patient_urn)}
                onClick={onCheckIn}
                className="min-h-9 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white hover:bg-emerald-800 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                Check in
              </button>
            </>
          ) : null}
        {a.status === 'BOOKED' && canManage && action === null && <details className="relative"><summary className="min-h-9 cursor-pointer list-none rounded-lg border border-slate-300 px-3 py-2 font-semibold text-slate-700">More</summary><div className="absolute right-0 z-10 mt-1 flex min-w-max flex-col gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"><RowButton onClick={() => onAction('no-show')}>No-show</RowButton><RowButton onClick={() => onAction('reschedule')}>Reschedule</RowButton><RowButton onClick={() => onAction('cancel')}>Cancel booking</RowButton></div></details>}
      </div></td>
      </tr>
      {action && <tr><td colSpan={6} className="bg-slate-50 p-3">{action === 'priority' && <PriorityForm appointment={a} pendingArrival={pendingArrival} onDone={() => onAction(null)} />}
      {action === 'no-show' && <NoShowForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'cancel' && <CancelForm appointment={a} onDone={() => onAction(null)} />}
      {action === 'reschedule' && <RescheduleForm appointment={a} onDone={() => onAction(null)} />}</td></tr>}
    </>
  )
}

function matchesPatientReference(value: string, mobile: string, urn: string): boolean {
  const normalized = value.trim().toUpperCase()
  const typedDigits = normalized.replace(/\D/g, '')
  const mobileDigits = mobile.replace(/\D/g, '')
  return normalized.length > 0 && (normalized === urn.toUpperCase() || (mobileDigits.length > 0 && typedDigits === mobileDigits))
}

function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] transition-colors"
    >
      {children}
    </button>
  )
}

/** Priority change form matching Image 4 specifications */
function PriorityForm({
  appointment,
  pendingArrival,
  onDone,
}: {
  appointment: Appointment
  pendingArrival?: OpdArrival
  onDone: () => void
}) {
  const update = useUpdatePriority()
  const updateArrival = useUpdateOpdArrivalPriority()
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
      if (pendingArrival) {
        await updateArrival.mutateAsync({
          id: pendingArrival.id,
          body: {
            priority_level: level,
            reason: reason.trim(),
            version_id: pendingArrival.version_id,
          },
        })
      } else {
        await update.mutateAsync({
          id: appointment.id,
          body: {
            priority_level: level,
            priority_reason: reason.trim(),
            version_id: appointment.version_id,
          },
        })
      }
      onDone()
    } catch (err) {
      setError(errorText(err, 'Could not change the priority.'))
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 space-y-3 rounded-xl border border-[#E4C8D1] bg-[#FBF5F7] p-3.5"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-800">
          Change priority: {pendingArrival?.full_name ?? appointment.patient_name} (#{appointment.token_number ?? '--'})
        </p>
      </div>

      <div>
        <label htmlFor="priority-level-select" className="mb-1 block text-xs font-semibold text-slate-700">
          Priority *
        </label>
        <select
          id="priority-level-select"
          value={level}
          onChange={(e) => setLevel(e.target.value as PriorityLevel)}
          className="min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
        >
          <option value="NORMAL">Normal (Regular queue)</option>
          <option value="PRIORITY">High (Needs preferential attention)</option>
          <option value="EMERGENCY">Emergency (Immediate clinical attention)</option>
        </select>
      </div>

      <div>
        <label htmlFor="priority-reason-input" className="mb-1 block text-xs font-semibold text-slate-700">
          Mandatory Reason *
        </label>
        <textarea
          id="priority-reason-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={2}
          placeholder="Enter reason for updating priority..."
          className="w-full rounded-lg border border-slate-300 bg-white p-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
        />
      </div>

      {error && (
        <p role="alert" className="text-xs font-semibold text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={update.isPending || updateArrival.isPending}
          className="min-h-9 rounded-lg bg-[#8E1C3D] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#5D0B26] disabled:opacity-50 transition-colors"
        >
          {update.isPending || updateArrival.isPending ? 'Saving…' : 'Save priority'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] transition-colors"
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
      className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3"
    >
      <p className="font-bold text-slate-800 text-xs">{title}</p>
      {children}
      {error && (
        <p role="alert" className="font-semibold text-red-700 text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-9 items-center rounded-lg bg-[#8E1C3D] px-3 text-xs font-bold text-white hover:bg-[#5D0B26] disabled:opacity-50"
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
