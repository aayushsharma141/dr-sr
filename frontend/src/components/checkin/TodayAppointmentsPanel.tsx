import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  useAppointments,
  useConsultingDoctors,
  useOpdArrivals,
  useRescheduleAppointment,
  useUpdateAppointmentStatus,
  useUpdatePriority,
  useUpdateOpdArrivalPriority,
  useCancelOpdArrival,
} from '../../api/queries'
import type { Appointment, OpdArrival, PriorityLevel } from '../../api/types'
import { formatToken } from '../../format'
import { IconSearch, IconX } from '../icons'
import { AppointmentStatusBadge, type ReceptionStatusKey, useIstToday } from '../reception/AppointmentStatusBadge'
import { PriorityBadge } from './PriorityBadge'

type ListView = 'all' | 'arrive' | 'checked'
type RowAction = { key: string; kind: 'no-show' | 'cancel' | 'reschedule' | 'priority' }
type QueueRow = { key: string; appointment: Appointment; pendingArrival?: OpdArrival }

const INPUT =
  'min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const FILTER_INPUT =
  'min-h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'

const CHECKED_IN_STATUSES = new Set([
  'ARRIVED',
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'DONE',
  'COMPLETED',
])

export function isCancelled(a: Appointment): boolean {
  return a.status === 'CANCELLED' || a.consultation_status === 'CANCELLED'
}

/** Checked-in / tokenized consultations promote to Checked In; unarrived/registered bookings stay in To Arrive */
export function isCheckedIn(a: Appointment, pendingArrival?: OpdArrival): boolean {
  if (isCancelled(a) || pendingArrival != null || a.status === 'RESCHEDULED') return false
  return a.consultation_status != null || CHECKED_IN_STATUSES.has(a.status)
}

/** Unarrived bookings and unregistered arrivals remain in To Arrive */
export function isAwaitingArrival(a: Appointment, pendingArrival?: OpdArrival): boolean {
  if (isCancelled(a) || a.status === 'RESCHEDULED') return false
  return !isCheckedIn(a, pendingArrival)
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
    status: arrival.status === 'CANCELLED' ? 'CANCELLED' : 'TO_ARRIVE',
    status_updated_at: arrival.created_at,
    check_in_at: null,
    cancellation_reason: arrival.priority_reason ?? null,
    notes: null,
    source: 'WALK_IN',
    expected_time: null,
    visit_id: null,
    consultation_status: arrival.status === 'CANCELLED' ? 'CANCELLED' : null,
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

/** Canonical badge status across the OPD desk: To arrive, Checked In, Rescheduled, or Cancelled */
export function statusKey(a: Appointment, pendingArrival?: OpdArrival): ReceptionStatusKey {
  if (isCancelled(a)) return 'CANCELLED'
  if (a.status === 'RESCHEDULED') return 'RESCHEDULED'
  if (isCheckedIn(a, pendingArrival)) return 'CHECKED_IN'
  return 'TO_ARRIVE'
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
  onRegisterPatient,
}: {
  activeBookingId: number | null
  canCheckIn?: boolean
  canRegister: boolean
  canManage: boolean
  onCheckIn?: (booking: Appointment) => void
  onRegisterArrival: (arrival: OpdArrival) => void
  onRegisterPatient?: (booking: Appointment) => void
}) {
  const today = useIstToday()
  const { data, isPending, isError, error, refetch, isFetching } = useAppointments({ appointment_date: today })
  const { data: arrivalData, isPending: arrivalsPending, isError: arrivalsError, error: arrivalsErrorValue, refetch: refetchArrivals } = useOpdArrivals(today)
  const [view, setView] = useState<ListView>('arrive')
  const [doctorFilter, setDoctorFilter] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [action, setAction] = useState<RowAction | null>(null)
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null)

  const selectView = (next: ListView) => {
    setView(next)
    setOpenMenuKey(null)
    setAction(null)
  }

  const { options: consultingDoctors } = useConsultingDoctors()
  const doctorCabinMap = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const o of consultingDoctors) {
      if (o.doctor.cabin_code) {
        map.set(o.doctor.id, o.doctor.cabin_code)
      }
    }
    return map
  }, [consultingDoctors])

  const all = useMemo(() => data?.appointments ?? [], [data])
  const pendingArrivals = useMemo(() => arrivalData?.arrivals ?? [], [arrivalData])
  const doctors = useMemo(() => {
    const seen = new Map<number, string>()
    for (const a of all) seen.set(a.doctor_id, a.doctor_name_en)
    for (const arrival of pendingArrivals) seen.set(arrival.doctor_id, arrival.doctor_name_en)
    return [...seen.entries()].sort((x, y) => x[1].localeCompare(y[1]))
  }, [all, pendingArrivals])

  const selectedDoctorName = useMemo(() => {
    if (doctorFilter === '') return 'All doctors'
    return doctors.find(([id]) => id === doctorFilter)?.[1] ?? 'All doctors'
  }, [doctorFilter, doctors])

  const filteredEntries = useMemo(() => {
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
      .filter(({ appointment: a }) => doctorFilter === '' || a.doctor_id === doctorFilter)
      .filter(
        ({ appointment: a }) =>
          !q ||
          a.patient_name.toLowerCase().includes(q) ||
          (a.patient_urn ?? '').toLowerCase().includes(q) ||
          a.patient_mobile.includes(q) ||
          String(a.token_number ?? '') === q,
      )
  }, [all, pendingArrivals, doctorFilter, search])

  const counts = useMemo(() => {
    const arrive = filteredEntries.filter(({ appointment: a, pendingArrival }) => isAwaitingArrival(a, pendingArrival)).length
    const checked = filteredEntries.filter(({ appointment: a, pendingArrival }) => isCheckedIn(a, pendingArrival)).length
    const cancelled = filteredEntries.filter(({ appointment: a }) => isCancelled(a)).length
    const rescheduled = filteredEntries.filter(({ appointment: a }) => !isCancelled(a) && a.status === 'RESCHEDULED').length
    return {
      all: filteredEntries.length,
      arrive,
      checked,
      cancelled,
      rescheduled,
    }
  }, [filteredEntries])

  const rows = useMemo(() => {
    return filteredEntries
      .filter(({ appointment: a, pendingArrival }) =>
        view === 'arrive'
          ? isAwaitingArrival(a, pendingArrival)
          : view === 'checked'
            ? isCheckedIn(a, pendingArrival)
            : true,
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
  }, [filteredEntries, view])

  const tabs: { key: ListView; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'arrive', label: 'To Arrive' },
    { key: 'checked', label: 'Checked In' },
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
      selectView(tabs[nextIndex].key)
      tabRefs.current[nextIndex]?.focus()
    }
  }

  return (
    <section
      aria-labelledby="today-appointments-heading"
      className="flex flex-col rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-xs"
    >
      <div className="space-y-2.5 border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="today-appointments-heading" className="text-base font-bold text-slate-900">
              Today&apos;s appointments
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              {formatDisplayDate(today)} · {selectedDoctorName}
              {(counts.cancelled > 0 || counts.rescheduled > 0) &&
                ` · ${counts.arrive + counts.checked} active${counts.cancelled > 0 ? ` · ${counts.cancelled} cancelled` : ''}${counts.rescheduled > 0 ? ` · ${counts.rescheduled} rescheduled` : ''}`}
            </p>
          </div>
          <button type="button" onClick={() => { void refetch(); void refetchArrivals() }} disabled={isFetching} aria-label="Refresh appointments" className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] disabled:opacity-50">
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        <div
          role="tablist"
          aria-label="Which appointments"
          className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1"
        >
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
                onClick={() => selectView(t.key)}
                className={`min-h-8 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                  isSelected
                    ? 'bg-[#8E1C3D] text-white shadow-2xs'
                    : 'text-slate-700 hover:bg-white hover:text-[#5D0B26]'
                }`}
              >
                {t.label} ({counts[t.key]})
              </button>
            )
          })}
        </div>

        {/* Filters */}
        <div className="grid gap-2 sm:grid-cols-[1fr_11.5rem]">
          <label className="relative block">
            <span className="sr-only">Search today&apos;s appointments</span>
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setOpenMenuKey(null)
                setAction(null)
              }}
              placeholder="Search name, URN, mobile or token"
              className={`${FILTER_INPUT} pl-9`}
            />
          </label>
          <label className="block">
            <span className="sr-only">Filter by doctor</span>
            <select
              value={doctorFilter}
              onChange={(e) => {
                setDoctorFilter(e.target.value ? Number(e.target.value) : '')
                setOpenMenuKey(null)
                setAction(null)
              }}
              className={FILTER_INPUT}
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

      <div className="max-h-[42rem] flex-1 overflow-y-auto p-4">
        {isPending || arrivalsPending ? (
          <p className="p-6 text-center text-xs text-slate-500">Loading today&apos;s appointments…</p>
        ) : (
          <>
            {(isError || arrivalsError) && (
              <div role="alert" className="mb-3 space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">
                <p>{rows.length > 0 ? 'Queue data is incomplete.' : 'Queue data could not load.'} Refresh to try again.</p>
                {isError && <p>Appointments: {errorText(error, 'failed to load')}</p>}
                {arrivalsError && <p>Pending arrivals: {errorText(arrivalsErrorValue, 'failed to load')}</p>}
              </div>
            )}
            {rows.length === 0 && !isError && !arrivalsError ? (
              <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500">
                {view === 'arrive'
                  ? 'No one booked for today is still to arrive.'
                  : view === 'checked'
                    ? 'No one has been checked in yet today.'
                    : 'No appointments today.'}
              </p>
            ) : rows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      {['Token', 'Patient', 'Doctor', 'Status', 'Action'].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2.5 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {rows.map(({ key, appointment: a, pendingArrival }) => (
                      <AppointmentCard
                        key={key}
                        today={today}
                        appointment={a}
                        pendingArrival={pendingArrival}
                        cabinCode={doctorCabinMap.get(a.doctor_id)}
                        active={a.id === activeBookingId}
                        canCheckIn={Boolean(canCheckIn)}
                        canRegister={canRegister}
                        canManage={canManage}
                        action={action?.key === key ? action.kind : null}
                        menuOpen={openMenuKey === key}
                        onMenuOpenChange={(open) => setOpenMenuKey(open ? key : null)}
                        onAction={(kind) => {
                          setOpenMenuKey(null)
                          setAction(kind ? { key, kind } : null)
                        }}
                        onCheckIn={onCheckIn ? () => onCheckIn(a) : undefined}
                        onRegisterArrival={() => {
                          if (pendingArrival) onRegisterArrival(pendingArrival)
                        }}
                        onRegisterPatient={onRegisterPatient ? () => onRegisterPatient(a) : undefined}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

function AppointmentCard({
  today,
  appointment: a,
  pendingArrival,
  cabinCode,
  active,
  canCheckIn,
  canRegister,
  canManage,
  action,
  menuOpen,
  onMenuOpenChange,
  onAction,
  onCheckIn,
  onRegisterArrival,
  onRegisterPatient,
}: {
  today: string
  appointment: Appointment
  pendingArrival?: OpdArrival
  cabinCode?: string | null
  active: boolean
  canCheckIn: boolean
  canRegister: boolean
  canManage: boolean
  action: RowAction['kind'] | null
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  onAction: (kind: RowAction['kind'] | null) => void
  onCheckIn?: () => void
  onRegisterArrival: () => void
  onRegisterPatient?: () => void
}) {
  const badgeStatus = statusKey(a, pendingArrival)
  const isAwaiting = isAwaitingArrival(a, pendingArrival)
  const isCancelledRow = isCancelled(a)
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuContainerRef = useRef<HTMLDivElement | null>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  const primaryCta = (() => {
    if (!isAwaiting) return null
    if (pendingArrival != null) {
      return canRegister ? { label: 'Register', onClick: onRegisterArrival } : null
    }
    if (
      a.status === 'BOOKED' ||
      a.status === 'NO_SHOW' ||
      a.status === 'REGISTERED' ||
      (a.status === 'TO_ARRIVE' && Boolean(a.patient_urn))
    ) {
      return canCheckIn && onCheckIn ? { label: 'Check in', onClick: onCheckIn } : null
    }
    return canRegister && onRegisterPatient ? { label: 'Register', onClick: onRegisterPatient } : null
  })()

  const menuItems: { label: string; kind: RowAction['kind']; danger?: boolean }[] = []
  const canChangeArrivalPriority =
    pendingArrival != null && pendingArrival.status === 'TO_ARRIVE' && canManage
  const canChangeApptPriority =
    !pendingArrival &&
    !isCancelledRow &&
    (a.consultation_status === 'WAITING' || a.consultation_status === 'IN_CONSULTATION') &&
    canCheckIn
  if (canChangeArrivalPriority || canChangeApptPriority) {
    menuItems.push({ label: 'Change priority', kind: 'priority' })
  }
  if (!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'TO_ARRIVE')) {
    menuItems.push({ label: 'No-show', kind: 'no-show' })
  }
  if (!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'NO_SHOW' || a.status === 'TO_ARRIVE')) {
    menuItems.push({ label: 'Reschedule', kind: 'reschedule' })
  }
  if (pendingArrival != null && pendingArrival.status === 'TO_ARRIVE' && canManage) {
    menuItems.push({ label: 'Cancel arrival', kind: 'cancel', danger: true })
  }
  if (!pendingArrival && canManage && (a.status === 'BOOKED' || a.status === 'TO_ARRIVE' || a.status === 'REGISTERED')) {
    menuItems.push({ label: 'Cancel booking', kind: 'cancel', danger: true })
  }

  useLayoutEffect(() => {
    if (!menuOpen || !moreButtonRef.current) return
    const rect = moreButtonRef.current.getBoundingClientRect()
    const menuWidth = 160
    const estimatedHeight = menuItems.length * 36 + 12
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow
    const top = openUp ? Math.max(8, rect.top - estimatedHeight - 4) : rect.bottom + 4
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))
    setMenuPos({ top, left })
  }, [menuOpen, menuItems.length])

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: PointerEvent) => {
      if (!menuContainerRef.current?.contains(e.target as Node)) {
        onMenuOpenChange(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onMenuOpenChange(false)
        moreButtonRef.current?.focus()
      }
    }
    const onScrollOrResize = () => {
      onMenuOpenChange(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [menuOpen, onMenuOpenChange])

  const showRowControls = action === null || action === 'priority'

  return (
    <>
      <tr className={`text-xs transition-colors ${active ? 'bg-[#FBF5F7]' : 'bg-white'}`}>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono font-bold text-[#5D0B26]">
          {a.token_number != null ? formatToken(a.token_number, cabinCode) : '—'}
        </td>
        <td className="px-3 py-2.5 font-semibold text-slate-900">
          {pendingArrival?.full_name ?? a.patient_name}
        </td>
        <td className="px-3 py-2.5 text-slate-700">
          <span>{a.doctor_name_en}</span>
          {a.department_name && <span className="block text-slate-500">{a.department_name}</span>}
        </td>
        <td className="px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <AppointmentStatusBadge status={badgeStatus} />
            <PriorityBadge level={a.priority_level} reason={a.priority_reason} />
          </div>
        </td>
        <td className="px-3 py-2.5">
          {!primaryCta && menuItems.length === 0 ? (
            <span className="text-slate-500">—</span>
          ) : showRowControls ? (
            <div className="flex items-center gap-1.5">
              {primaryCta && action === null && (
                <button
                  type="button"
                  onClick={primaryCta.onClick}
                  className="inline-flex min-h-8 items-center whitespace-nowrap rounded-lg bg-[#8E1C3D] px-2.5 py-1 text-xs font-bold text-white transition-colors hover:bg-[#5D0B26]"
                >
                  {primaryCta.label}
                </button>
              )}
              {menuItems.length > 0 && (
                <div ref={menuContainerRef} className="relative">
                  <button
                    ref={moreButtonRef}
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => onMenuOpenChange(!menuOpen)}
                    className="inline-flex min-h-8 items-center rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:border-[#8E1C3D] hover:text-[#5D0B26]"
                  >
                    More
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      style={
                        menuPos
                          ? { position: 'fixed', top: menuPos.top, left: menuPos.left }
                          : { position: 'fixed' }
                      }
                      className="z-50 flex min-w-[9.5rem] flex-col rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
                    >
                      {menuItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onMenuOpenChange(false)
                            onAction(item.kind)
                          }}
                          className={`min-h-8 w-full rounded-md px-2.5 py-1 text-left text-xs font-semibold transition-colors ${
                            item.danger
                              ? 'text-red-700 hover:bg-red-50'
                              : 'text-slate-700 hover:bg-slate-100 hover:text-[#5D0B26]'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </td>
      </tr>
      {action === 'priority' && (
        <tr>
          <td colSpan={5} className="h-0 border-0 p-0">
            <PriorityModal
              appointment={a}
              pendingArrival={pendingArrival}
              onDone={() => {
                onAction(null)
                moreButtonRef.current?.focus()
              }}
            />
          </td>
        </tr>
      )}
      {action && action !== 'priority' && (
        <tr>
          <td colSpan={5} className="bg-slate-50 p-3">
            {action === 'no-show' && <NoShowForm appointment={a} onDone={() => onAction(null)} />}
            {action === 'cancel' && <CancelForm appointment={a} pendingArrival={pendingArrival} onDone={() => onAction(null)} />}
            {action === 'reschedule' && <RescheduleForm today={today} appointment={a} onDone={() => onAction(null)} />}
          </td>
        </tr>
      )}
    </>
  )
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

/** Compact popup modal for changing priority (Blue arrow 2) */
function PriorityModal({
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
  const selectRef = useRef<HTMLSelectElement | null>(null)

  useEffect(() => {
    selectRef.current?.focus()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (reason.trim().length < 3) {
      setError('Enter a reason of at least 3 characters when changing priority.')
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

  const patientName = pendingArrival?.full_name ?? appointment.patient_name
  const tokenNum = appointment.token_number != null ? `#${appointment.token_number}` : '--'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="priority-popup-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onDone()
      }}
    >
      <div className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 id="priority-popup-title" className="text-sm font-bold text-slate-900">
              Change priority
            </h3>
            <p className="mt-0.5 text-xs text-slate-600">
              {patientName} ({tokenNum})
            </p>
          </div>
          <button
            type="button"
            onClick={onDone}
            aria-label="Close dialog"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label htmlFor="priority-level-select" className="mb-1 block text-xs font-semibold text-slate-700">
              Priority *
            </label>
            <select
              id="priority-level-select"
              ref={selectRef}
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
              Reason *
            </label>
            <textarea
              id="priority-reason-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              placeholder="Enter reason for updating priority..."
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-900 placeholder:text-slate-500 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-semibold text-red-700">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onDone}
              className="min-h-9 rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-[#8E1C3D] hover:text-[#5D0B26] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={update.isPending || updateArrival.isPending}
              className="min-h-9 rounded-lg bg-[#8E1C3D] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#5D0B26] disabled:opacity-50 transition-colors shadow-2xs"
            >
              {update.isPending || updateArrival.isPending ? 'Saving…' : 'Save priority'}
            </button>
          </div>
        </form>
      </div>
    </div>
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

function CancelForm({
  appointment,
  pendingArrival,
  onDone,
}: {
  appointment: Appointment
  pendingArrival?: OpdArrival
  onDone: () => void
}) {
  const update = useUpdateAppointmentStatus()
  const cancelArrival = useCancelOpdArrival()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isBusy = update.isPending || cancelArrival.isPending

  const name = pendingArrival?.full_name ?? appointment.patient_name
  const target = pendingArrival ? 'arrival' : 'booking'
  return (
    <InlineForm
      title={`Cancel ${name}'s ${target}`}
      error={error}
      busy={isBusy}
      submitLabel={`Cancel ${target}`}
      onBack={onDone}
      onSubmit={async () => {
        setError(null)
        if (reason.trim().length < 3) {
          setError(`Enter why the ${target} is cancelled.`)
          return
        }
        try {
          if (pendingArrival) {
            await cancelArrival.mutateAsync({
              id: pendingArrival.id,
              body: { version_id: pendingArrival.version_id, reason: reason.trim() },
            })
          } else {
            await update.mutateAsync({
              id: appointment.id,
              body: { status: 'CANCELLED', version_id: appointment.version_id, cancellation_reason: reason.trim() },
            })
          }
          onDone()
        } catch (err) {
          setError(errorText(err, `Could not cancel the ${target}.`))
        }
      }}
    >
      <label className="block">
        <span className="mb-1 block font-semibold text-slate-700">Reason *</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={INPUT}
          placeholder="e.g. Patient called to cancel"
          required
        />
      </label>
    </InlineForm>
  )
}

function RescheduleForm({ today, appointment, onDone }: { today: string; appointment: Appointment; onDone: () => void }) {
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
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block font-semibold text-slate-700">New date *</span>
          <input type="date" required min={today} value={date} onChange={(e) => setDate(e.target.value)} className={INPUT} />
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
