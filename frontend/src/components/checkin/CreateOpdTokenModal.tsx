import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Modal } from '../Modal'
import { toast } from '../ToastHost'
import { PriorityBadge } from './PriorityBadge'
import {
  AppointmentStatusBadge,
  useDebouncedValue,
  useIstToday,
  type ReceptionStatusKey,
} from '../reception/AppointmentStatusBadge'
import {
  useAppointment,
  useAppointments,
  useBookAppointment,
  useCheckDuplicate,
  useCheckIn,
  useConsultingDoctors,
  useCreateOpdArrival,
  useMe,
  useOpdArrivals,
  useOverview,
  usePatient,
  usePatients,
  useWalkIn,
} from '../../api/queries'
import { ApiError, createIdempotencyKey, isTimeoutError } from '../../api/client'
import type {
  Appointment,
  CheckInDetails,
  OpdArrival,
  PatientOut,
  PriorityLevel,
  ReceptionOverview,
  ReferralSource,
  VisitKind,
} from '../../api/types'
import { formatPaise, formatToken } from '../../format'
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconPrinter,
  IconSearch,
  IconTicket,
  IconUserPlus,
  IconX,
} from '../icons'

export interface CreateOpdTokenModalProps {
  open: boolean
  onClose: () => void
  /** Optional initial date when opened from the Appointments toolbar (clamped to >= today). Defaults to today. */
  initialDate?: string
  /** Optional deep-link patient ID (e.g. from ?patient_id=X) */
  initialPatientId?: number | null
  /** Optional deep-link appointment ID (e.g. from ?appointment_id=Y) */
  initialAppointmentId?: number | null
  /** Optional booking passed directly when clicking "Check in" on a row in AppointmentsReception */
  initialBooking?: Appointment | null
  /** Called when form is cleared or deep-link params should be cleaned up */
  onClearPreset?: () => void
  /** Optional callback after an advance booking is created (e.g. so parent knows the booked date) */
  onBooked?: (appointment: Appointment) => void
}

type PatientMode = 'new' | 'existing'
type FlowKind = 'walk_in' | 'appointment_checkin' | 'advance_booking'

const FLOW_META: Record<FlowKind, { label: string; hint: string; classes: string }> = {
  walk_in: {
    label: 'Walk-in Check-in',
    hint: 'Immediate token & queue entry for today',
    classes: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  },
  appointment_checkin: {
    label: 'Appointment Check-in',
    hint: 'Checking in an existing booking for today',
    classes: 'border-sky-200 bg-sky-50 text-sky-900',
  },
  advance_booking: {
    label: 'Advance Booking',
    hint: 'Future date — token issued on arrival',
    classes: 'border-amber-300 bg-amber-50 text-amber-900',
  },
}

function extractExistingToken(err: ApiError): number | null {
  const details =
    typeof err.extra?.details === 'object' && err.extra.details !== null
      ? (err.extra.details as Record<string, unknown>)
      : null
  const candidates: unknown[] = [
    err.extra?.existing_token_number,
    err.extra?.token_number,
    details?.existing_token_number,
    details?.token_number,
  ]
  for (const val of candidates) {
    if (typeof val === 'number' && Number.isFinite(val)) return val
  }
  return null
}

function activeTokenStatus(a: Appointment): { key: ReceptionStatusKey; label: string } {
  if (
    a.status === 'DONE' ||
    a.status === 'COMPLETED' ||
    a.consultation_status === 'COMPLETED'
  ) {
    return { key: 'COMPLETED', label: 'Completed' }
  }
  if (a.status === 'IN_CONSULTATION' || a.consultation_status === 'IN_CONSULTATION') {
    return { key: 'IN_CABIN', label: 'In Cabin' }
  }
  return { key: 'WAITING', label: 'Waiting' }
}

const LABEL = 'mb-1.5 block text-xs font-semibold text-slate-700'
const INPUT =
  'min-h-[38px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-2xs placeholder:text-slate-400 transition-colors duration-150 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:bg-slate-100'

const REFERRAL_OPTIONS: { value: ReferralSource; label: string; shortLabel: string; nameLabel: string }[] = [
  { value: 'SELF', label: 'Self (came on their own)', shortLabel: 'Self', nameLabel: '' },
  { value: 'DOCTOR', label: 'Doctor referral', shortLabel: 'Doctor referral', nameLabel: "Referring doctor's name" },
  { value: 'PERSONAL', label: 'Patient / personal reference', shortLabel: 'Personal reference', nameLabel: "Referring person's name" },
  { value: 'ORGANIZATION', label: 'Hospital / organisation', shortLabel: 'Organisation', nameLabel: 'Hospital or organisation name' },
  { value: 'OTHER', label: 'Other / unknown', shortLabel: 'Other', nameLabel: 'Details (optional)' },
]
const REFERRAL_NEEDS_NAME: ReferralSource[] = ['DOCTOR', 'PERSONAL', 'ORGANIZATION']

function sexLabel(gender: string): string {
  return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Other'
}

function formatSlipDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

type IssuedToken =
  | {
      kind: 'arrival'
      arrival: OpdArrival
      departmentName: string | null
      cabinCode: string | null
    }
  | {
      kind: 'checked_in'
      appointment: Appointment
      departmentName: string | null
      cabinCode: string | null
    }

type Issued =
  | IssuedToken
  | {
      kind: 'booked'
      appointment: Appointment
      departmentName: string | null
      cabinCode: string | null
    }

/** A segmented two-or-three-way choice; the selected option is white with the brand gold edge. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string
  value: T | null
  /** selectedClass replaces the default selected look, e.g. red for Emergency. */
  options: { value: T; label: ReactNode; selectedClass?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-lg border border-slate-300 bg-slate-100/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
            value === o.value
              ? (o.selectedClass ?? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs')
              : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function CreateOpdTokenModal({
  open,
  onClose,
  initialDate,
  initialPatientId,
  initialAppointmentId,
  initialBooking,
  onClearPreset,
  onBooked,
}: CreateOpdTokenModalProps) {
  const qc = useQueryClient()
  const { data: me } = useMe()
  const permissions = me?.permissions ?? []
  const isReception = me?.role === 'RECEPTION'
  const canCheckIn = permissions.includes('visit:write')
  const canManageBookings = permissions.includes('appointment:write')
  const canCreateArrival =
    permissions.includes('patient:create') && permissions.includes('appointment:write')
  const today = useIstToday()

  const clampedInitialDate = initialDate && initialDate >= today ? initialDate : today

  // --- Date & Booking Mode ---------------------------------------------------------------
  const [appointmentDate, setAppointmentDate] = useState(clampedInitialDate)
  const [expectedTime, setExpectedTime] = useState('')

  // --- Patient ---------------------------------------------------------------------------
  const [mode, setMode] = useState<PatientMode>(clampedInitialDate > today ? 'existing' : 'new')
  // New patient (OD-22-03)
  const [fullName, setFullName] = useState('')
  const [ageYears, setAgeYears] = useState('')
  const [mobile, setMobile] = useState('')
  const [notDuplicate, setNotDuplicate] = useState(false)
  // Existing patient (OD-22-04)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(null)
  const [visitKind, setVisitKind] = useState<VisitKind | null>(null)
  // A booking for today being checked in (passed directly or picked from patient's bookings).
  const [booking, setBooking] = useState<Appointment | null>(null)

  // --- Visit -----------------------------------------------------------------------------
  const [doctorKey, setDoctorKey] = useState('')
  const [referralSource, setReferralSource] = useState<ReferralSource>('SELF')
  const [referrerName, setReferrerName] = useState('')
  const [referralOpen, setReferralOpen] = useState(false)
  const [priority, setPriority] = useState<PriorityLevel>('NORMAL')
  const [priorityReason, setPriorityReason] = useState('')
  const [remarks, setRemarks] = useState('')

  // --- Confirmation, Idempotency & In-Flight Lock ----------------------------------------
  const [confirmSignature, setConfirmSignature] = useState<string | null>(null)
  const [timeoutRetryMsg, setTimeoutRetryMsg] = useState<string | null>(null)
  const inFlightRef = useRef(false)
  const pendingIdempotencyRef = useRef<{ signature: string; key: string } | null>(null)

  const [issued, setIssued] = useState<Issued | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [presetApplied, setPresetApplied] = useState(false)

  // Reset internal modal state cleanly whenever `open` transitions false -> true.
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setPrintOpen(false)
      setIssued(null)
      setConfirmSignature(null)
      setTimeoutRetryMsg(null)
      setFullName('')
      setAgeYears('')
      setMobile('')
      setNotDuplicate(false)
      setSearchQuery('')
      setVisitKind(null)
      setDoctorKey('')
      setReferralSource('SELF')
      setReferrerName('')
      setReferralOpen(false)
      setRemarks('')
      setExpectedTime('')
      if (initialBooking) {
        setMode('existing')
        setSelectedPatient(bookingPatient(initialBooking))
        setBooking(initialBooking)
        setDoctorKey(`${initialBooking.department_id}:${initialBooking.doctor_id}`)
        setPriority(initialBooking.priority_level ?? 'NORMAL')
        setPriorityReason(initialBooking.priority_reason ?? '')
        setAppointmentDate(today)
        setPresetApplied(true)
      } else {
        setMode(clampedInitialDate > today ? 'existing' : 'new')
        setSelectedPatient(null)
        setBooking(null)
        setPriority('NORMAL')
        setPriorityReason('')
        setAppointmentDate(clampedInitialDate)
        setPresetApplied(false)
      }
    } else {
      setPrintOpen(false)
      setConfirmSignature(null)
      setTimeoutRetryMsg(null)
    }
  }

  // Clear refs when modal opens/closes without writing refs during render.
  useEffect(() => {
    pendingIdempotencyRef.current = null
    inFlightRef.current = false
  }, [open])

  // Deep-link preset hydration (?patient_id=&appointment_id=) when no direct initialBooking was passed.
  const presetPatientId = open && !presetApplied && !initialBooking ? (initialPatientId ?? null) : null
  const presetBookingId = open && !presetApplied && !initialBooking ? (initialAppointmentId ?? 0) : 0
  const { data: presetPatient } = usePatient(presetPatientId)
  const { data: presetBooking, isPending: presetBookingPending } = useAppointment(presetBookingId)

  if (open && !presetApplied && !initialBooking) {
    if (presetPatient && (!presetBookingId || !presetBookingPending)) {
      setPresetApplied(true)
      setMode('existing')
      setSelectedPatient(presetPatient)
      if (
        presetBooking &&
        presetBooking.patient_id === presetPatient.id &&
        isBookable(presetBooking, today)
      ) {
        setBooking(presetBooking)
        setDoctorKey(`${presetBooking.department_id}:${presetBooking.doctor_id}`)
        setPriority(presetBooking.priority_level ?? 'NORMAL')
        setPriorityReason(presetBooking.priority_reason ?? '')
        setAppointmentDate(today)
      }
    } else if (!presetPatientId && presetBookingId > 0 && presetBooking) {
      setPresetApplied(true)
      setMode('existing')
      setSelectedPatient(bookingPatient(presetBooking))
      if (isBookable(presetBooking, today)) {
        setBooking(presetBooking)
        setDoctorKey(`${presetBooking.department_id}:${presetBooking.doctor_id}`)
        setPriority(presetBooking.priority_level ?? 'NORMAL')
        setPriorityReason(presetBooking.priority_reason ?? '')
        setAppointmentDate(today)
      }
    }
  }

  const isFutureDate = appointmentDate > today
  const isBookingOnly = !booking && isFutureDate
  const flowKind: FlowKind = isBookingOnly
    ? 'advance_booking'
    : booking
      ? 'appointment_checkin'
      : 'walk_in'
  const flowMeta = FLOW_META[flowKind]

  // --- Data ------------------------------------------------------------------------------
  const { options: doctorOptions, isPending: doctorsPending } = useConsultingDoctors()
  const { data: receptionOverview } = useOverview<ReceptionOverview>('reception', {
    enabled: open && isReception,
  })
  const debouncedQuery = useDebouncedValue(searchQuery, 200)
  const { data: searchResults, isPending: searching } = usePatients(debouncedQuery, 8, 0, {
    enabled: open && mode === 'existing' && debouncedQuery.trim().length >= 2,
  })
  const debouncedFullName = useDebouncedValue(fullName, 250)
  const debouncedMobile = useDebouncedValue(mobile, 250)
  const duplicateCheck = useCheckDuplicate(
    debouncedFullName,
    debouncedMobile,
    open && !isBookingOnly && mode === 'new' && !issued,
  )
  const duplicateMatch = duplicateCheck.data?.has_duplicate ? duplicateCheck.data.matching_patient : null

  const walkIn = useWalkIn()
  const checkIn = useCheckIn()
  const createArrival = useCreateOpdArrival()
  const bookAppointment = useBookAppointment()
  const busy =
    walkIn.isPending ||
    checkIn.isPending ||
    createArrival.isPending ||
    bookAppointment.isPending

  // Today's appointments and pending arrivals: single source for next token, queue load & live issued reconciliation.
  const { data: allAppointmentsData } = useAppointments({ appointment_date: today }, { enabled: open })
  const allTodayAppointments = useMemo(
    () => allAppointmentsData?.appointments ?? [],
    [allAppointmentsData],
  )
  const { data: arrivalData } = useOpdArrivals(today, { enabled: open })
  const pendingArrivals = useMemo(
    () => arrivalData?.arrivals ?? [],
    [arrivalData],
  )

  // Patient-specific appointments for the selected appointmentDate (both today and future dates — never truncated by day-list pagination).
  const { data: patientDateAppointmentsData } = useAppointments(
    { appointment_date: appointmentDate, patient_id: selectedPatient?.id },
    { enabled: open && mode === 'existing' && selectedPatient != null && Boolean(appointmentDate) },
  )

  // Merge patient-specific today query with today's day list (deduplicated by id) so both live and mocked data stay consistent.
  const patientTodayAppointments = useMemo(() => {
    if (selectedPatient == null) return []
    const byId = new Map<number, Appointment>()
    for (const a of allTodayAppointments) {
      if (a.patient_id === selectedPatient.id && a.appointment_date === today) {
        byId.set(a.id, a)
      }
    }
    if (appointmentDate === today) {
      for (const a of patientDateAppointmentsData?.appointments ?? []) {
        if (a.patient_id === selectedPatient.id && a.appointment_date === today) {
          byId.set(a.id, a)
        }
      }
    }
    return [...byId.values()]
  }, [allTodayAppointments, appointmentDate, patientDateAppointmentsData, selectedPatient, today])

  const patientBookings = useMemo(
    () => patientTodayAppointments.filter((a) => isBookable(a, today)),
    [patientTodayAppointments, today],
  )

  const patientActiveTokens = useMemo(
    () =>
      patientTodayAppointments.filter(
        (a) =>
          a.status !== 'CANCELLED' &&
          a.status !== 'RESCHEDULED' &&
          a.consultation_status !== 'CANCELLED' &&
          !isBookable(a, today) &&
          (a.consultation_status != null || a.token_number != null),
      ),
    [patientTodayAppointments, today],
  )

  const patientFutureBookings = useMemo(() => {
    if (!isBookingOnly || selectedPatient == null) return []
    return (patientDateAppointmentsData?.appointments ?? []).filter(
      (a) =>
        a.patient_id === selectedPatient.id &&
        a.appointment_date === appointmentDate &&
        a.status !== 'CANCELLED' &&
        a.status !== 'RESCHEDULED',
    )
  }, [appointmentDate, isBookingOnly, patientDateAppointmentsData, selectedPatient])

  const { liveIssued, issuedCancelled } = useMemo(() => {
    if (!issued) return { liveIssued: null, issuedCancelled: false }
    if (issued.kind === 'arrival') {
      const candidate = pendingArrivals.find((a) => a.id === issued.arrival.id)
      const live =
        candidate && candidate.version_id >= issued.arrival.version_id ? candidate : issued.arrival
      return {
        liveIssued: { ...issued, arrival: live },
        issuedCancelled: live.status === 'CANCELLED',
      }
    }
    if (issued.kind === 'booked') {
      const candidate =
        issued.appointment.appointment_date === today
          ? allTodayAppointments.find((a) => a.id === issued.appointment.id)
          : undefined
      const live =
        candidate && candidate.version_id >= issued.appointment.version_id
          ? candidate
          : issued.appointment
      return {
        liveIssued: { ...issued, appointment: live },
        issuedCancelled: live.status === 'CANCELLED',
      }
    }
    const candidate = allTodayAppointments.find((a) => a.id === issued.appointment.id)
    const live =
      candidate && candidate.version_id >= issued.appointment.version_id
        ? candidate
        : issued.appointment
    return {
      liveIssued: { ...issued, appointment: live },
      issuedCancelled: live.status === 'CANCELLED' || live.consultation_status === 'CANCELLED',
    }
  }, [issued, pendingArrivals, allTodayAppointments, today])

  // The doctor comes from the booking when one is being checked in, else from the list.
  const chosenOption = useMemo(() => {
    if (booking) {
      return (
        doctorOptions.find(
          (o) => o.doctor.id === booking.doctor_id && o.department.id === booking.department_id,
        ) ?? doctorOptions.find((o) => o.doctor.id === booking.doctor_id) ?? null
      )
    }
    return doctorOptions.find((o) => `${o.department.id}:${o.doctor.id}` === doctorKey) ?? null
  }, [booking, doctorKey, doctorOptions])

  // Live queue load per doctor: prefers authoritative reception overview (doctors_today) merged with today's lists.
  const doctorLoadById = useMemo(() => {
    const map = new Map<number, { waiting: number; inConsultation: number }>()
    for (const d of receptionOverview?.doctors_today ?? []) {
      map.set(d.doctor_id, {
        waiting: (d.waiting ?? 0) + (d.pending_arrivals ?? 0),
        inConsultation: d.in_consultation ?? 0,
      })
    }
    for (const o of doctorOptions) {
      const docId = o.doctor.id
      if (map.has(docId)) continue
      let waiting = 0
      let inConsultation = 0
      for (const a of allTodayAppointments) {
        if (a.doctor_id !== docId) continue
        if (a.status === 'IN_CONSULTATION' || a.consultation_status === 'IN_CONSULTATION') {
          inConsultation += 1
        } else if (
          a.consultation_status !== 'COMPLETED' &&
          (a.status === 'BOOKED' ||
            a.status === 'TO_ARRIVE' ||
            a.status === 'REGISTERED' ||
            a.status === 'ARRIVED' ||
            a.status === 'CHECKED_IN' ||
            a.status === 'WAITING')
        ) {
          waiting += 1
        }
      }
      for (const p of pendingArrivals) {
        if (p.doctor_id === docId && p.status === 'TO_ARRIVE') {
          waiting += 1
        }
      }
      map.set(docId, { waiting, inConsultation })
    }
    return map
  }, [receptionOverview, doctorOptions, allTodayAppointments, pendingArrivals])

  const selectedDoctorLoad = chosenOption ? (doctorLoadById.get(chosenOption.doctor.id) ?? null) : null

  const nextTokenPreview = useMemo(() => {
    if (!chosenOption) return null
    const docId = chosenOption.doctor.id
    const apptTokens = allTodayAppointments
      .filter((a) => a.doctor_id === docId && a.token_number != null)
      .map((a) => a.token_number as number)
    const arrivalTokens = pendingArrivals
      .filter((a) => a.doctor_id === docId && a.token_number != null)
      .map((a) => a.token_number as number)
    const allTokens = [...apptTokens, ...arrivalTokens]
    const maxTok = allTokens.length > 0 ? Math.max(...allTokens) : 0
    return maxTok + 1
  }, [chosenOption, allTodayAppointments, pendingArrivals])

  const departments = useMemo(() => {
    const groups = new Map<number, { name: string; options: typeof doctorOptions }>()
    for (const o of doctorOptions) {
      const g = groups.get(o.department.id) ?? { name: o.department.name_en, options: [] }
      g.options.push(o)
      groups.set(o.department.id, g)
    }
    return [...groups.entries()]
  }, [doctorOptions])

  // Canonical form signature: any edit to any input automatically exits confirmation mode and invalidates pending idempotencyKey.
  const formSignature = useMemo(
    () =>
      JSON.stringify([
        mode,
        appointmentDate,
        expectedTime,
        fullName,
        ageYears,
        mobile,
        notDuplicate,
        duplicateMatch?.id ?? null,
        selectedPatient?.id ?? null,
        visitKind,
        booking?.id ?? null,
        doctorKey,
        referralSource,
        referrerName,
        priority,
        priorityReason,
        remarks,
      ]),
    [
      mode,
      appointmentDate,
      expectedTime,
      fullName,
      ageYears,
      mobile,
      notDuplicate,
      duplicateMatch?.id,
      selectedPatient?.id,
      visitKind,
      booking?.id,
      doctorKey,
      referralSource,
      referrerName,
      priority,
      priorityReason,
      remarks,
    ],
  )

  const [prevFormSignature, setPrevFormSignature] = useState(formSignature)
  if (formSignature !== prevFormSignature) {
    setPrevFormSignature(formSignature)
    if (confirmSignature !== null) setConfirmSignature(null)
    if (timeoutRetryMsg !== null) setTimeoutRetryMsg(null)
  }

  const confirming = confirmSignature !== null && confirmSignature === formSignature
  const activeTimeoutRetryMsg = confirming ? timeoutRetryMsg : null

  useEffect(() => {
    if (
      pendingIdempotencyRef.current &&
      pendingIdempotencyRef.current.signature !== formSignature
    ) {
      pendingIdempotencyRef.current = null
    }
  }, [formSignature])

  // --- Actions ---------------------------------------------------------------------------
  const resetVisit = () => {
    setDoctorKey('')
    setReferralSource('SELF')
    setReferrerName('')
    setReferralOpen(false)
    setPriority('NORMAL')
    setPriorityReason('')
    setRemarks('')
    setExpectedTime('')
  }

  const resetAll = () => {
    if (busy || inFlightRef.current) return
    pendingIdempotencyRef.current = null
    setConfirmSignature(null)
    setTimeoutRetryMsg(null)
    setPrintOpen(false)
    setFullName('')
    setAgeYears('')
    setMobile('')
    setNotDuplicate(false)
    setSearchQuery('')
    setSelectedPatient(null)
    setVisitKind(null)
    setBooking(null)
    setAppointmentDate(clampedInitialDate)
    resetVisit()
    setIssued(null)
    onClearPreset?.()
  }

  const unlinkBooking = () => {
    if (busy) return
    if (booking) {
      setDoctorKey(`${booking.department_id}:${booking.doctor_id}`)
    }
    setBooking(null)
  }

  const switchMode = (next: PatientMode) => {
    if (busy || next === mode) return
    if (booking) {
      setDoctorKey(`${booking.department_id}:${booking.doctor_id}`)
    }
    setMode(next)
    setBooking(null)
  }

  const choosePatient = (patient: PatientOut) => {
    if (busy) return
    setMode('existing')
    setSelectedPatient(patient)
    setSearchQuery('')
    setVisitKind(null)
    setBooking(null)
  }

  const takeBooking = (b: Appointment) => {
    if (busy) return
    setConfirmSignature(null)
    setTimeoutRetryMsg(null)
    setPrintOpen(false)
    setIssued(null)
    setMode('existing')
    setSelectedPatient((current) =>
      current?.id === b.patient_id ? current : bookingPatient(b),
    )
    setBooking(b)
    setDoctorKey(`${b.department_id}:${b.doctor_id}`)
    setAppointmentDate(today)
    setVisitKind(null)
    setPriority(b.priority_level ?? 'NORMAL')
    setPriorityReason(b.priority_reason ?? '')
  }

  // Everything the desk must have before submitting; shown inline so reception is never left guessing.
  const canSubmit = isBookingOnly
    ? canManageBookings
    : mode === 'new'
      ? canCreateArrival
      : canCheckIn

  const missing: string[] = []
  if (!booking && (!appointmentDate || appointmentDate < today)) {
    missing.push('valid appointment date')
  }
  if (isBookingOnly) {
    if (mode === 'new') {
      missing.push('registered patient')
    } else if (!selectedPatient) {
      missing.push('patient')
    }
    if (!chosenOption) missing.push('consulting doctor')
  } else {
    if (mode === 'new') {
      if (fullName.trim().length < 2) missing.push('patient name')
      if (ageYears === '' || Number(ageYears) < 0 || Number(ageYears) > 150) missing.push('age')
      if (mobile.replace(/\D/g, '').length < 10) missing.push('10-digit phone number')
      if (duplicateMatch && !notDuplicate) missing.push('confirmation that this is a different patient')
    } else {
      if (!selectedPatient) missing.push('patient')
      if (!visitKind) missing.push('consultation type')
      if (REFERRAL_NEEDS_NAME.includes(referralSource) && referrerName.trim().length < 2) {
        missing.push('referrer name')
      }
    }
    if (!chosenOption) missing.push('consulting doctor')
    if (priority !== 'NORMAL' && priorityReason.trim().length < 3) missing.push('priority reason')
  }

  const details = (): CheckInDetails => ({
    referral_source: referralSource,
    referrer_name: referralSource === 'SELF' ? null : referrerName.trim() || null,
    priority_level: priority,
    priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
    visit_kind: mode === 'new' ? 'NEW' : (visitKind ?? 'NEW'),
  })

  const executeSubmit = async () => {
    if (inFlightRef.current || busy) return
    if (!canSubmit || missing.length > 0 || !chosenOption) return

    inFlightRef.current = true
    setTimeoutRetryMsg(null)

    if (
      !pendingIdempotencyRef.current ||
      pendingIdempotencyRef.current.signature !== formSignature
    ) {
      pendingIdempotencyRef.current = {
        signature: formSignature,
        key: createIdempotencyKey(),
      }
    }
    const idempotencyKey = pendingIdempotencyRef.current.key

    try {
      if (isBookingOnly) {
        if (!selectedPatient) return
        const appointment = await bookAppointment.mutateAsync({
          patient_id: selectedPatient.id,
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          appointment_date: appointmentDate,
          expected_time: expectedTime
            ? expectedTime.length === 5
              ? `${expectedTime}:00`
              : expectedTime
            : null,
          source: 'PHONE',
          notes: remarks.trim() || null,
          issue_token: false,
          idempotencyKey,
        })
        pendingIdempotencyRef.current = null
        setConfirmSignature(null)
        setTimeoutRetryMsg(null)
        setIssued({
          kind: 'booked',
          appointment,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        toast.success(
          `Booked appointment for ${appointment.patient_name} on ${formatSlipDate(appointment.appointment_date)}.`,
        )
        onBooked?.(appointment)
        return
      }

      if (mode === 'new') {
        const arrival = await createArrival.mutateAsync({
          full_name: fullName.trim(),
          age_years: Number(ageYears),
          mobile: mobile.trim(),
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          priority_level: priority,
          priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
          idempotencyKey,
        })
        pendingIdempotencyRef.current = null
        setConfirmSignature(null)
        setTimeoutRetryMsg(null)
        setFullName('')
        setAgeYears('')
        setMobile('')
        setNotDuplicate(false)
        setPriority('NORMAL')
        setPriorityReason('')
        setRemarks('')
        setIssued({
          kind: 'arrival',
          arrival,
          departmentName: arrival.department_name || chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        toast.success(`Added ${arrival.full_name} to Today's Arrivals.`)
        return
      }

      if (booking) {
        const appointment = await checkIn.mutateAsync({
          id: booking.id,
          body: {
            version_id: booking.version_id,
            patient_id: selectedPatient?.id ?? booking.patient_id,
            ...details(),
          },
          idempotencyKey,
        })
        pendingIdempotencyRef.current = null
        setConfirmSignature(null)
        setTimeoutRetryMsg(null)
        setIssued({
          kind: 'checked_in',
          appointment,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        toast.success(`Checked in ${appointment.patient_name} (Token ${formatToken(appointment.token_number)}).`)
        return
      }

      if (selectedPatient) {
        const appointment = await walkIn.mutateAsync({
          patient_id: selectedPatient.id,
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          notes: remarks.trim() || null,
          ...details(),
          idempotencyKey,
        })
        pendingIdempotencyRef.current = null
        setConfirmSignature(null)
        setTimeoutRetryMsg(null)
        setIssued({
          kind: 'checked_in',
          appointment,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        toast.success(`Checked in ${appointment.patient_name} (Token ${formatToken(appointment.token_number)}).`)
        return
      }
    } catch (err: unknown) {
      if (isTimeoutError(err)) {
        // Keep pendingIdempotencyRef and stay in confirmation view so Confirm replays the exact same Idempotency-Key safely.
        setTimeoutRetryMsg(
          isBookingOnly
            ? 'Connection timed out — click Confirm again to retry safely without creating a duplicate booking.'
            : 'Connection timed out — click Confirm again to retry safely without creating a duplicate token.',
        )
        return
      }

      const isDomainClientError =
        err instanceof ApiError && err.status >= 400 && err.status < 500
      if (isDomainClientError) {
        pendingIdempotencyRef.current = null
        setConfirmSignature(null)
        setTimeoutRetryMsg(null)
      }

      const isConflict =
        err instanceof ApiError &&
        (err.status === 409 ||
          err.code === 'duplicate_appointment' ||
          err.code === 'duplicate_opd_arrival')
      if (isConflict) {
        void qc.invalidateQueries({ queryKey: ['appointments'] })
        void qc.invalidateQueries({ queryKey: ['opd-arrivals'] })
        void qc.invalidateQueries({ queryKey: ['overview', 'reception'] })
      }

      const existingToken = err instanceof ApiError ? extractExistingToken(err) : null
      const existingTokenSuffix =
        existingToken != null
          ? ` (Existing active token ${formatToken(existingToken, chosenOption.doctor.cabin_code)})`
          : ''

      if (isBookingOnly) {
        if (err instanceof ApiError && err.code === 'duplicate_appointment') {
          toast.error(
            `This patient already has an active appointment with this doctor on this date${existingTokenSuffix}. Reschedule or cancel the existing booking instead.`,
          )
        } else if (err instanceof Error && err.message) {
          toast.error(err.message)
        } else {
          toast.error('The appointment was not booked. Please try again.')
        }
        return
      }

      const matchingBooking =
        mode === 'existing'
          ? patientBookings.find((b) => b.doctor_id === chosenOption.doctor.id) ?? patientBookings[0] ?? null
          : null
      if (err instanceof ApiError && err.code === 'duplicate_appointment' && matchingBooking) {
        toast.error(
          `This patient already has a booking with this doctor today${existingTokenSuffix}. Check that booking in instead.`,
          {
            action: {
              label: 'Check in their booking instead',
              onClick: () => takeBooking(matchingBooking),
            },
          },
        )
      } else if (
        err instanceof ApiError &&
        (err.code === 'duplicate_opd_arrival' || err.code === 'duplicate_appointment')
      ) {
        const fallbackToken =
          existingToken ??
          (mode === 'existing'
            ? patientActiveTokens.find((a) => a.doctor_id === chosenOption.doctor.id)?.token_number ?? null
            : pendingArrivals.find(
                (a) =>
                  a.doctor_id === chosenOption.doctor.id &&
                  a.status === 'TO_ARRIVE' &&
                  a.mobile.replace(/\D/g, '') === mobile.replace(/\D/g, ''),
              )?.token_number ?? null)
        const tokenNote =
          fallbackToken != null
            ? ` (Existing active token ${formatToken(fallbackToken, chosenOption.doctor.cabin_code)})`
            : ''
        const baseMessage =
          err.message ||
          (err.code === 'duplicate_opd_arrival'
            ? 'This mobile number already has a pending arrival in this doctor’s queue today.'
            : 'This patient already has an active token with this doctor today.')
        toast.error(`${baseMessage}${tokenNote}`)
      } else if (err instanceof Error && err.message) {
        toast.error(err.message)
      } else {
        toast.error('The token was not issued. Please try again.')
      }
    } finally {
      inFlightRef.current = false
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (inFlightRef.current || busy) return
    if (!canSubmit) return
    if (missing.length > 0 || !chosenOption) {
      toast.error(`Still needed: ${missing.join(', ')}.`)
      return
    }
    if (!confirming) {
      if (
        !pendingIdempotencyRef.current ||
        pendingIdempotencyRef.current.signature !== formSignature
      ) {
        pendingIdempotencyRef.current = {
          signature: formSignature,
          key: createIdempotencyKey(),
        }
      }
      setTimeoutRetryMsg(null)
      setConfirmSignature(formSignature)
      return
    }
    await executeSubmit()
  }

  const hasFormInput = Boolean(
    selectedPatient ||
      fullName ||
      ageYears ||
      mobile ||
      searchQuery ||
      booking ||
      doctorKey ||
      referralSource !== 'SELF' ||
      referrerName ||
      priority !== 'NORMAL' ||
      priorityReason ||
      remarks ||
      expectedTime ||
      appointmentDate !== clampedInitialDate,
  )

  const modalTitle = issued
    ? issued.kind === 'booked'
      ? 'Appointment Booked'
      : 'Token Generated'
    : isBookingOnly
      ? 'Book Appointment'
      : 'Create OPD Token'

  const submitLabel = isBookingOnly
    ? 'Book Appointment'
    : booking
      ? 'Check in Booking'
      : mode === 'new'
        ? 'Generate Token'
        : 'Check in & Generate Token'
  const confirmLabel = isBookingOnly ? 'Confirm & Book Appointment' : 'Confirm & Issue Token'
  const busyLabel = isBookingOnly ? 'Booking…' : 'Issuing token…'

  const showRemarks = !isBookingOnly && mode === 'existing' && !booking
  const selectedReferralMeta =
    REFERRAL_OPTIONS.find((o) => o.value === referralSource) ?? REFERRAL_OPTIONS[0]

  const hasSameDoctorActiveConflict =
    chosenOption != null &&
    patientActiveTokens.some(
      (a) =>
        a.doctor_id === chosenOption.doctor.id &&
        activeTokenStatus(a).key !== 'COMPLETED',
    )

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={
          <span className="inline-flex items-center gap-2">
            {isBookingOnly || issued?.kind === 'booked' ? (
              <IconCalendar aria-hidden="true" className="h-5 w-5 text-[#8E1C3D]" />
            ) : (
              <IconTicket aria-hidden="true" className="h-5 w-5 text-[#8E1C3D]" />
            )}
            {modalTitle}
          </span>
        }
        dismiss="closerequest"
        busy={busy}
        className="max-w-xl"
      >
        <div className="space-y-4">
          <div className="space-y-2.5 border-b border-slate-100 pb-3.5">
            <div className="flex items-center justify-between gap-2">
              <ol
                aria-label="Check-in steps"
                className="grid flex-1 grid-cols-2 gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-1"
              >
                <li
                  aria-current={!issued ? 'step' : undefined}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                    !issued
                      ? 'bg-white text-[#5D0B26] shadow-2xs ring-1 ring-[#C39A35]/60'
                      : 'text-emerald-800'
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${
                      !issued ? 'bg-[#8E1C3D] text-white' : 'bg-emerald-700 text-white'
                    }`}
                  >
                    {issued ? <IconCheck aria-hidden="true" className="h-3.5 w-3.5" /> : '01'}
                  </span>
                  <span className="min-w-0 truncate">Patient &amp; Visit</span>
                </li>
                <li
                  aria-current={issued ? 'step' : undefined}
                  className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-semibold ${
                    issued
                      ? 'bg-white text-[#5D0B26] shadow-2xs ring-1 ring-[#C39A35]/60'
                      : 'text-slate-600'
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold tabular-nums ${
                      issued ? 'bg-[#8E1C3D] text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    02
                  </span>
                  <span className="min-w-0 truncate">
                    {isBookingOnly || issued?.kind === 'booked' ? 'Confirmation' : 'Token & Check-in'}
                  </span>
                </li>
              </ol>

              {hasFormInput && !issued && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={resetAll}
                  className="shrink-0 text-xs font-medium text-slate-600 transition-colors duration-150 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                >
                  Clear form
                </button>
              )}
            </div>
          </div>

          {!issued ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Mode distinction pill */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  data-testid="opd-flow-badge"
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${flowMeta.classes}`}
                >
                  {flowKind === 'advance_booking' ? (
                    <IconCalendar aria-hidden="true" className="h-3.5 w-3.5" />
                  ) : (
                    <IconTicket aria-hidden="true" className="h-3.5 w-3.5" />
                  )}
                  {flowMeta.label}
                </span>
                <span className="text-xs text-slate-600">{flowMeta.hint}</span>
              </div>

              {/* 0. Date picker (hidden when checking in an existing today booking) */}
              {!booking && (
                <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="checkin-date" className={LABEL}>
                        Appointment date *
                      </label>
                      <input
                        id="checkin-date"
                        type="date"
                        min={today}
                        value={appointmentDate}
                        onChange={(e) => setAppointmentDate(e.target.value)}
                        disabled={busy}
                        className={`${INPUT} tabular-nums`}
                        required
                      />
                    </div>
                    {isFutureDate && (
                      <p className="flex min-h-[38px] items-center text-xs font-medium text-slate-700">
                        Advance booking — token will be issued on arrival.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* 1. Patient */}
              <div className="space-y-3">
                <Segmented<PatientMode>
                  label="Patient type"
                  value={mode}
                  onChange={switchMode}
                  disabled={busy}
                  options={[
                    {
                      value: 'new',
                      label: (
                        <>
                          <IconUserPlus aria-hidden="true" className="h-4 w-4" /> New patient
                        </>
                      ),
                    },
                    {
                      value: 'existing',
                      label: (
                        <>
                          <IconSearch aria-hidden="true" className="h-4 w-4" /> Existing patient
                        </>
                      ),
                    },
                  ]}
                />

                {mode === 'new' ? (
                  isBookingOnly ? (
                    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-xs text-amber-950">
                      <p className="leading-relaxed font-medium">
                        Advance bookings require a registered patient (URN).
                        Quick walk-in intake is for today&apos;s immediate arrivals only.
                      </p>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => switchMode('existing')}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[#8E1C3D] px-3 py-1.5 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                          <IconSearch aria-hidden="true" className="h-3.5 w-3.5" />
                          Search existing patient
                        </button>
                        <Link
                          to="/reception/patients/new"
                          aria-disabled={busy || undefined}
                          tabIndex={busy ? -1 : undefined}
                          onClick={(e) => {
                            if (busy) {
                              e.preventDefault()
                              return
                            }
                            onClose()
                          }}
                          className={`inline-flex min-h-9 items-center rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-xs font-semibold text-amber-950 transition-colors duration-150 hover:bg-amber-100 ${
                            busy ? 'pointer-events-none opacity-50' : ''
                          }`}
                        >
                          Register new patient first →
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <NewPatientFields
                      fullName={fullName}
                      setFullName={(v) => {
                        setFullName(v)
                        setNotDuplicate(false)
                      }}
                      ageYears={ageYears}
                      setAgeYears={setAgeYears}
                      mobile={mobile}
                      setMobile={(v) => {
                        setMobile(v)
                        setNotDuplicate(false)
                      }}
                      duplicate={duplicateMatch ?? null}
                      notDuplicate={notDuplicate}
                      setNotDuplicate={setNotDuplicate}
                      onUseExisting={(p) => choosePatient(p)}
                      disabled={busy}
                    />
                  )
                ) : selectedPatient ? (
                  <SelectedPatientCard
                    patient={selectedPatient}
                    onClose={onClose}
                    disabled={busy}
                    onChange={() => {
                      if (busy) return
                      if (booking) {
                        setDoctorKey(`${booking.department_id}:${booking.doctor_id}`)
                      }
                      setSelectedPatient(null)
                      setBooking(null)
                      setVisitKind(null)
                    }}
                  />
                ) : (
                  <PatientSearch
                    query={searchQuery}
                    setQuery={setSearchQuery}
                    results={searchResults}
                    searching={searching || searchQuery !== debouncedQuery}
                    onPick={choosePatient}
                    disabled={busy}
                  />
                )}

                {!isBookingOnly && mode === 'existing' && selectedPatient && patientActiveTokens.length > 0 && (
                  <div
                    role="status"
                    className={`space-y-2 rounded-lg border px-3.5 py-2.5 text-xs ${
                      hasSameDoctorActiveConflict
                        ? 'border-amber-300 bg-amber-50 text-amber-950'
                        : 'border-sky-200 bg-sky-50 text-sky-950'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">
                        {hasSameDoctorActiveConflict
                          ? 'Same-doctor conflict — already checked in today'
                          : 'Already checked in today'}
                      </span>
                      <AppointmentStatusBadge status="CHECKED_IN" />
                    </div>
                    {hasSameDoctorActiveConflict && chosenOption && (
                      <p className="font-medium text-amber-900">
                        This patient already has an active token with {chosenOption.doctor.name_en} today.
                      </p>
                    )}
                    <div className="space-y-1.5">
                      {patientActiveTokens.map((a) => {
                        const st = activeTokenStatus(a)
                        const isSameDocConflict =
                          chosenOption != null &&
                          a.doctor_id === chosenOption.doctor.id &&
                          st.key !== 'COMPLETED'
                        return (
                          <div
                            key={a.id}
                            className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                          >
                            <span
                              className={
                                isSameDocConflict
                                  ? 'font-semibold text-amber-950'
                                  : hasSameDoctorActiveConflict
                                    ? 'text-amber-900'
                                    : 'text-sky-900'
                              }
                            >
                              {a.token_number != null ? `Token #${a.token_number} · ` : ''}
                              {a.doctor_name_en}
                              {isSameDocConflict ? ' · Same doctor' : ''}
                            </span>
                            <AppointmentStatusBadge status={st.key} label={st.label} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {isBookingOnly && mode === 'existing' && selectedPatient && patientFutureBookings.length > 0 && (
                  <div
                    role="status"
                    className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950"
                  >
                    <p className="font-semibold">
                      Existing booking on {formatSlipDate(appointmentDate)}:
                    </p>
                    <div className="space-y-1.5">
                      {patientFutureBookings.map((b) => {
                        const sameDoc = chosenOption != null && b.doctor_id === chosenOption.doctor.id
                        return (
                          <div
                            key={b.id}
                            className="flex flex-wrap items-center justify-between gap-2 tabular-nums"
                          >
                            <span className={sameDoc ? 'font-semibold text-amber-950' : 'text-amber-900'}>
                              {b.doctor_name_en}
                              {b.expected_time ? ` at ${b.expected_time.slice(0, 5)}` : ''}
                              {sameDoc ? ' · Same doctor (duplicate booking)' : ''}
                            </span>
                            <AppointmentStatusBadge status="BOOKED" />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {!isBookingOnly && mode === 'existing' && selectedPatient && (
                  <div>
                    <span className={LABEL}>Consultation type *</span>
                    <Segmented<VisitKind>
                      label="Consultation type"
                      value={visitKind}
                      onChange={setVisitKind}
                      disabled={busy}
                      options={[
                        { value: 'NEW', label: 'New consultation' },
                        { value: 'FOLLOW_UP', label: 'Follow-up / Revisit' },
                      ]}
                    />
                  </div>
                )}
              </div>

              {/* 2. Doctor & booking (hidden when booking-only + new patient blocked state? Keep doctor hidden only if blocked or show in existing/immediate mode) */}
              {!(isBookingOnly && mode === 'new') && (
                <div className="space-y-2.5">
                  {booking ? (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs text-sky-950">
                        <span className="flex min-w-0 items-center gap-2">
                          <IconCalendar aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
                          <span className="tabular-nums">
                            Booked appointment with <span className="font-semibold">{booking.doctor_name_en}</span>
                            {booking.expected_time ? ` at ${booking.expected_time.slice(0, 5)}` : ''}
                            {booking.status === 'NO_SHOW' ? ' (marked not arrived; checking in late)' : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={unlinkBooking}
                          className="font-semibold text-sky-800 underline transition-colors duration-150 hover:text-sky-950 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                          Not this booking
                        </button>
                      </div>
                      {!doctorsPending && !chosenOption && (
                        <p role="alert" className="text-xs font-medium text-amber-800">
                          Booked doctor is currently inactive or unassigned. Click &ldquo;Not this booking&rdquo; to
                          choose an available doctor.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      {!isBookingOnly && mode === 'existing' && patientBookings.length > 0 && (
                        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
                          <p className="font-semibold">This patient is booked for today:</p>
                          {patientBookings.map((b) => (
                            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span className="tabular-nums">
                                {b.doctor_name_en}
                                {b.expected_time ? ` at ${b.expected_time.slice(0, 5)}` : ''}
                              </span>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => takeBooking(b)}
                                className="inline-flex min-h-8 items-center rounded-lg bg-[#8E1C3D] px-3 font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                              >
                                Check in this booking
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div>
                        <label htmlFor="checkin-doctor" className={LABEL}>
                          Consulting doctor *
                        </label>
                        <select
                          id="checkin-doctor"
                          value={doctorKey}
                          onChange={(e) => setDoctorKey(e.target.value)}
                          disabled={busy || (doctorsPending && doctorOptions.length === 0)}
                          className={INPUT}
                        >
                          <option value="">{doctorsPending ? 'Loading doctors…' : 'Choose consulting doctor'}</option>
                          {departments.map(([deptId, group]) => (
                            <optgroup key={deptId} label={group.name}>
                              {group.options.map((o) => {
                                const load = doctorLoadById.get(o.doctor.id)
                                const loadHint =
                                  !isBookingOnly && load
                                    ? load.waiting === 0 && load.inConsultation === 0
                                      ? ' · Available'
                                      : ` · ${load.waiting} waiting`
                                    : ''
                                return (
                                  <option key={`${deptId}:${o.doctor.id}`} value={`${deptId}:${o.doctor.id}`}>
                                    {o.doctor.name_en}
                                    {o.doctor.qualification ? ` (${o.doctor.qualification})` : ''}
                                    {loadHint}
                                  </option>
                                )
                              })}
                            </optgroup>
                          ))}
                        </select>
                        {!doctorsPending && doctorOptions.length === 0 && (
                          <p role="alert" className="mt-1.5 text-xs font-medium text-amber-800">
                            No doctor is assigned to a department yet. Ask the administrator to add doctors to a
                            department (Admin → Departments).
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  {chosenOption && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                      <span>
                        {chosenOption.department.name_en} · Consultation fee{' '}
                        <span className="font-mono font-semibold tabular-nums text-slate-900">
                          {formatPaise(chosenOption.doctor.default_fee_paise)}
                        </span>
                      </span>
                      {!isBookingOnly && selectedDoctorLoad && (
                        <span
                          data-testid="doctor-queue-load"
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${
                            selectedDoctorLoad.waiting === 0 && selectedDoctorLoad.inConsultation === 0
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                              : 'border-slate-200 bg-slate-100 text-slate-700'
                          }`}
                        >
                          {selectedDoctorLoad.waiting === 0 && selectedDoctorLoad.inConsultation === 0
                            ? 'Available — 0 waiting'
                            : `Waiting: ${selectedDoctorLoad.waiting} · In Cabin: ${selectedDoctorLoad.inConsultation}`}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* 3a. Booking-only extra fields: Expected time & Remarks */}
              {isBookingOnly && mode === 'existing' && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.8fr_1.2fr]">
                  <div>
                    <label htmlFor="checkin-expected-time" className={LABEL}>
                      Expected time (optional)
                    </label>
                    <input
                      id="checkin-expected-time"
                      type="time"
                      value={expectedTime}
                      onChange={(e) => setExpectedTime(e.target.value)}
                      disabled={busy}
                      className={`${INPUT} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label htmlFor="checkin-remarks" className={LABEL}>
                      Remarks / notes (optional)
                    </label>
                    <input
                      id="checkin-remarks"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      disabled={busy}
                      maxLength={1000}
                      placeholder="Chief symptom or note"
                      className={INPUT}
                    />
                  </div>
                </div>
              )}

              {/* 3b. Immediate Check-in fields: Priority, Remarks & Referral */}
              {!isBookingOnly && (
                <div className="space-y-3">
                  <div className={showRemarks ? 'grid grid-cols-1 gap-3 sm:grid-cols-[0.85fr_1.15fr]' : undefined}>
                    <div>
                      <label htmlFor="checkin-priority" className={LABEL}>
                        Priority *
                      </label>
                      <select
                        id="checkin-priority"
                        value={priority}
                        onChange={(e) => {
                          const v = e.target.value as PriorityLevel
                          setPriority(v)
                          if (v === 'NORMAL') setPriorityReason('')
                        }}
                        disabled={busy}
                        className={INPUT}
                      >
                        <option value="NORMAL">Normal</option>
                        <option value="PRIORITY">High</option>
                        <option value="EMERGENCY">Emergency</option>
                      </select>
                    </div>
                    {showRemarks && (
                      <div>
                        <label htmlFor="checkin-remarks" className={LABEL}>
                          Remarks (optional)
                        </label>
                        <input
                          id="checkin-remarks"
                          value={remarks}
                          onChange={(e) => setRemarks(e.target.value)}
                          disabled={busy}
                          maxLength={1000}
                          className={INPUT}
                        />
                      </div>
                    )}
                  </div>
                  {priority !== 'NORMAL' && (
                    <div>
                      <label htmlFor="checkin-priority-reason" className={LABEL}>
                        Reason for {priority === 'EMERGENCY' ? 'emergency' : 'priority'} *
                      </label>
                      <input
                        id="checkin-priority-reason"
                        value={priorityReason}
                        onChange={(e) => setPriorityReason(e.target.value)}
                        disabled={busy}
                        maxLength={500}
                        placeholder={priority === 'EMERGENCY' ? 'e.g. Severe acute pain' : 'e.g. 82 years old'}
                        className={`${INPUT} ${priority === 'EMERGENCY' ? 'border-red-400' : 'border-amber-400'}`}
                      />
                    </div>
                  )}

                  {mode === 'existing' && (
                    <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-medium text-slate-700">
                          Referred by:{' '}
                          <span className="font-semibold text-slate-900">
                            {selectedReferralMeta.shortLabel}
                            {referralSource !== 'SELF' && referrerName.trim()
                              ? ` (${referrerName.trim()})`
                              : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          disabled={busy}
                          aria-expanded={referralOpen}
                          onClick={() => setReferralOpen((isOpen) => !isOpen)}
                          className="shrink-0 text-xs font-semibold text-[#8E1C3D] transition-colors duration-150 hover:underline disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                        >
                          {referralOpen ? 'Hide' : 'Change'}
                        </button>
                      </div>
                      {referralOpen && (
                        <div className="space-y-2.5 pt-1">
                          <div>
                            <label htmlFor="checkin-referral-source" className={LABEL}>
                              Referred by *
                            </label>
                            <select
                              id="checkin-referral-source"
                              value={referralSource}
                              onChange={(e) => {
                                const next = e.target.value as ReferralSource
                                setReferralSource(next)
                                if (next === 'SELF') setReferrerName('')
                              }}
                              disabled={busy}
                              className={INPUT}
                            >
                              {REFERRAL_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          {referralSource !== 'SELF' && (
                            <div>
                              <label htmlFor="checkin-referrer-name" className={LABEL}>
                                {selectedReferralMeta.nameLabel || 'Referrer name'}
                                {REFERRAL_NEEDS_NAME.includes(referralSource) ? ' *' : ''}
                              </label>
                              <input
                                id="checkin-referrer-name"
                                value={referrerName}
                                onChange={(e) => setReferrerName(e.target.value)}
                                disabled={busy}
                                maxLength={120}
                                placeholder={
                                  REFERRAL_NEEDS_NAME.includes(referralSource)
                                    ? 'Enter name (min 2 characters)'
                                    : 'Optional details'
                                }
                                className={INPUT}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Compact inline Next-Token preview (immediate check-in only) */}
              {!isBookingOnly && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5">
                  <div>
                    <span className="block text-xs font-semibold text-slate-800">Next available token</span>
                    <span className="block text-xs text-slate-600">Preview only</span>
                  </div>
                  <span
                    data-testid="next-token-preview"
                    className="font-mono text-xl font-bold tracking-tight tabular-nums text-emerald-800"
                  >
                    {chosenOption
                      ? formatToken(nextTokenPreview ?? 1, chosenOption.doctor.cabin_code)
                      : '#--'}
                  </span>
                </div>
              )}

              <div className="space-y-2 border-t border-slate-100 pt-3.5">
                {!canSubmit && (
                  <p role="alert" className="text-xs font-medium text-amber-800">
                    Your account does not have permission to perform this action.
                  </p>
                )}
                {canSubmit && missing.length > 0 && (
                  <p className="text-xs text-slate-600">Still needed: {missing.join(', ')}.</p>
                )}

                {confirming && chosenOption && missing.length === 0 && canSubmit ? (
                  <div
                    data-testid="opd-confirm-bar"
                    className="space-y-3 rounded-lg border border-[#C39A35] bg-[#FBF5F7] p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#C39A35]/30 pb-2">
                      <span className="font-semibold text-[#5D0B26]">
                        {isBookingOnly
                          ? 'Confirm appointment details'
                          : 'Confirm check-in before issuing token'}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${flowMeta.classes}`}
                      >
                        {flowMeta.label}
                      </span>
                    </div>

                    <dl className="space-y-1.5 text-xs">
                      <div className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 font-medium text-slate-600">Patient</dt>
                        <dd className="min-w-0 text-right font-semibold text-slate-900">
                          {mode === 'existing' && selectedPatient ? (
                            <>
                              <span className="block truncate">{selectedPatient.full_name}</span>
                              <span className="block font-mono tabular-nums text-[#5D0B26]">
                                {selectedPatient.urn}
                              </span>
                            </>
                          ) : (
                            <span className="tabular-nums">
                              {fullName.trim()} · {ageYears} y ·{' '}
                              <span className="font-mono">{mobile.trim()}</span>
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <dt className="shrink-0 font-medium text-slate-600">Consulting doctor</dt>
                        <dd className="min-w-0 text-right font-semibold text-slate-900">
                          <span className="block truncate">{chosenOption.doctor.name_en}</span>
                          <span className="block truncate font-normal text-slate-600">
                            {chosenOption.department.name_en}
                          </span>
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="shrink-0 font-medium text-slate-600">Consultation fee</dt>
                        <dd className="font-mono font-semibold tabular-nums text-slate-900">
                          {formatPaise(chosenOption.doctor.default_fee_paise)}
                        </dd>
                      </div>
                      {isBookingOnly ? (
                        <div className="flex items-center justify-between gap-3">
                          <dt className="shrink-0 font-medium text-slate-600">Date &amp; time</dt>
                          <dd className="font-semibold tabular-nums text-slate-900">
                            {formatSlipDate(appointmentDate)}
                            {expectedTime ? ` · ${expectedTime.slice(0, 5)}` : ' · Any time'}
                          </dd>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <dt className="shrink-0 font-medium text-slate-600">Priority</dt>
                          <dd className="flex flex-col items-end gap-0.5">
                            <PriorityBadge level={priority} reason={priorityReason} showNormal />
                            {priority !== 'NORMAL' && priorityReason.trim() && (
                              <span className="text-slate-700">{priorityReason.trim()}</span>
                            )}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {activeTimeoutRetryMsg && (
                      <div
                        role="alert"
                        className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900"
                      >
                        <IconAlertTriangle
                          aria-hidden="true"
                          className="mt-0.5 h-4 w-4 shrink-0 text-red-700"
                        />
                        <span>{activeTimeoutRetryMsg}</span>
                      </div>
                    )}

                    <div className="grid grid-cols-[auto_1fr] gap-2.5 pt-1">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setConfirmSignature(null)
                          setTimeoutRetryMsg(null)
                        }}
                        className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
                      >
                        Edit
                      </button>
                      <button
                        type="submit"
                        disabled={busy}
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                      >
                        {isBookingOnly ? (
                          <IconCalendar aria-hidden="true" className="h-4 w-4" />
                        ) : (
                          <IconTicket aria-hidden="true" className="h-4 w-4" />
                        )}
                        {busy ? busyLabel : confirmLabel}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={busy || missing.length > 0 || !canSubmit}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {isBookingOnly ? (
                      <IconCalendar aria-hidden="true" className="h-4 w-4" />
                    ) : (
                      <IconTicket aria-hidden="true" className="h-4 w-4" />
                    )}
                    {busy ? busyLabel : submitLabel}
                  </button>
                )}
              </div>
            </form>
          ) : liveIssued ? (
            <StepTwoIssued
              issued={liveIssued}
              canCreateArrival={canCreateArrival}
              isCancelled={issuedCancelled}
              onPrint={() => setPrintOpen(true)}
              onNext={resetAll}
              onClose={onClose}
            />
          ) : null}
        </div>
      </Modal>

      {liveIssued && liveIssued.kind !== 'booked' && (
        <TokenSlipModal
          issued={liveIssued}
          isCancelled={issuedCancelled}
          open={printOpen}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </>
  )
}

/** A booking that can still be checked in today (including late NO_SHOW, TO_ARRIVE, and REGISTERED without consultation). */
function isBookable(a: Appointment, today: string): boolean {
  return (
    a.appointment_date === today &&
    a.consultation_status == null &&
    (a.status === 'BOOKED' ||
      a.status === 'NO_SHOW' ||
      a.status === 'TO_ARRIVE' ||
      a.status === 'REGISTERED')
  )
}

/** The patient as the booking describes them, until their full record is needed. */
function bookingPatient(b: Appointment): PatientOut {
  return {
    id: b.patient_id,
    urn: b.patient_urn,
    full_name: b.patient_name,
    mobile: b.patient_mobile,
  } as PatientOut
}

function NewPatientFields(props: {
  fullName: string
  setFullName: (v: string) => void
  ageYears: string
  setAgeYears: (v: string) => void
  mobile: string
  setMobile: (v: string) => void
  duplicate: PatientOut | null
  notDuplicate: boolean
  setNotDuplicate: (v: boolean) => void
  onUseExisting: (p: PatientOut) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <label htmlFor="np-name" className={LABEL}>
          Patient name *
        </label>
        <input
          id="np-name"
          data-autofocus
          value={props.fullName}
          onChange={(e) => props.setFullName(e.target.value)}
          disabled={props.disabled}
          maxLength={120}
          className={INPUT}
          autoComplete="name"
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[0.7fr_1.3fr]">
        <div>
          <label htmlFor="np-age" className={LABEL}>
            Age (years) *
          </label>
          <input
            id="np-age"
            type="number"
            min={0}
            max={150}
            value={props.ageYears}
            onChange={(e) => props.setAgeYears(e.target.value)}
            disabled={props.disabled}
            className={`${INPUT} tabular-nums`}
            required
          />
        </div>
        <div>
          <label htmlFor="np-mobile" className={LABEL}>
            Phone number *
          </label>
          <input
            id="np-mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={props.mobile}
            onChange={(e) => props.setMobile(e.target.value)}
            disabled={props.disabled}
            maxLength={15}
            placeholder="10-digit mobile"
            className={`${INPUT} tabular-nums`}
            required
          />
        </div>
      </div>

      {props.duplicate && (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="flex items-center gap-2 font-semibold">
            <IconAlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-700" />
            <span className="min-w-0 truncate tabular-nums">
              Already registered? {props.duplicate.full_name} ({props.duplicate.urn})
            </span>
          </p>
          <p className="leading-relaxed">
            Same phone number. If this is the same person, check in their existing record instead of creating a duplicate.
          </p>
          <div className="flex flex-wrap items-center gap-2.5 pt-0.5">
            <button
              type="button"
              disabled={props.disabled}
              onClick={() => props.onUseExisting(props.duplicate!)}
              className="inline-flex min-h-8 items-center rounded-lg bg-amber-800 px-3 text-xs font-semibold text-white transition-colors duration-150 hover:bg-amber-900 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              Use this patient
            </button>
            <div className="inline-flex items-center gap-2">
              <input
                id="np-not-duplicate"
                type="checkbox"
                checked={props.notDuplicate}
                disabled={props.disabled}
                onChange={(e) => props.setNotDuplicate(e.target.checked)}
                className="rounded border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D] disabled:cursor-not-allowed cursor-pointer"
              />
              <label htmlFor="np-not-duplicate" className="cursor-pointer text-xs font-medium text-slate-700">
                Different patient with same phone number
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PatientSearch({
  query,
  setQuery,
  results,
  searching,
  onPick,
  disabled = false,
}: {
  query: string
  setQuery: (v: string) => void
  results: PatientOut[] | undefined
  searching: boolean
  onPick: (p: PatientOut) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <label htmlFor="find-existing-input" className={LABEL}>
          Find existing patient
        </label>
        <div className="relative">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          />
          <input
            id="find-existing-input"
            data-autofocus
            type="text"
            aria-label="Search patient by URN, name or mobile"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={disabled}
            placeholder="Enter mobile number or hospital URN"
            className={`${INPUT} pl-9 pr-9`}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              disabled={disabled}
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 transition-colors duration-150 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <IconX aria-hidden="true" className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="text-xs text-slate-600">
          Verify the matching patient before creating today&apos;s visit.
        </p>
      </div>
      {query.trim().length >= 2 && (
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          {searching ? (
            <p className="p-3 text-center text-xs text-slate-600">Searching…</p>
          ) : results && results.length > 0 ? (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={disabled}
                onClick={() => onPick(p)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-xs transition-colors duration-150 hover:bg-[#FBF5F7] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{p.full_name}</span>
                  <span className="block font-mono tabular-nums text-[#5D0B26]">{p.urn}</span>
                </span>
                <span className="shrink-0 text-right tabular-nums text-slate-600">
                  <span className="block font-mono">{p.mobile}</span>
                  <span className="block">
                    {p.age_years} y · {sexLabel(p.gender)}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="p-3 text-center text-xs text-slate-600">
              No registered patient matches. Switch to New patient to register them.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function SelectedPatientCard({
  patient,
  onChange,
  onClose,
  disabled = false,
}: {
  patient: PatientOut
  onChange: () => void
  onClose: () => void
  disabled?: boolean
}) {
  // A patient chosen from a booking carries only name, URN and mobile until their record loads.
  const { data: full } = usePatient(patient.id)
  const p = full ?? patient
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
            <IconCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="min-w-0 truncate">{p.full_name}</span>
          </p>
          <p className="mt-0.5 font-mono font-semibold tabular-nums text-[#5D0B26]">{p.urn}</p>
          <p className="mt-0.5 tabular-nums text-slate-600">
            {p.age_years != null ? `${p.age_years} y · ${sexLabel(p.gender)} · ` : ''}
            <span className="font-mono">{p.mobile}</span>
            {p.guardian_name ? ` · Guardian: ${p.guardian_name}` : ''}
          </p>
          {p.address && <p className="truncate text-slate-600">{p.address}</p>}
          <p className="mt-1.5 font-medium text-emerald-800">Confirm with the patient that these details are theirs.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={onChange}
            className="font-medium text-slate-600 transition-colors duration-150 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            Not this patient
          </button>
          <Link
            to={`/reception/patients/${p.id}`}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : undefined}
            onClick={(e) => {
              if (disabled) {
                e.preventDefault()
                return
              }
              onClose()
            }}
            className={`font-semibold text-[#8E1C3D] hover:underline ${
              disabled ? 'pointer-events-none opacity-50' : ''
            }`}
          >
            Patient file
          </Link>
        </div>
      </div>
    </div>
  )
}

function StepTwoIssued({
  issued,
  canCreateArrival,
  isCancelled,
  onPrint,
  onNext,
  onClose,
}: {
  issued: Issued
  canCreateArrival: boolean
  isCancelled: boolean
  onPrint: () => void
  onNext: () => void
  onClose: () => void
}) {
  if (issued.kind === 'booked') {
    const appt = issued.appointment
    return (
      <div role="status" className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <AppointmentStatusBadge status={isCancelled ? 'CANCELLED' : 'BOOKED'} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center">
          <span className="block text-xs font-semibold tracking-tight text-slate-600">
            Scheduled Appointment
          </span>
          <div className="mt-1 text-lg font-bold tracking-tight tabular-nums text-[#5D0B26]">
            {formatSlipDate(appt.appointment_date)}
            {appt.expected_time ? ` · ${appt.expected_time.slice(0, 5)}` : ''}
          </div>
          <p className="mt-1.5 text-xs text-slate-600">
            No token issued yet — token is generated when the patient arrives at Appointments.
          </p>
        </div>

        <dl className="space-y-2 rounded-lg border border-slate-200 bg-white p-3.5 text-xs">
          <div className="flex items-start justify-between gap-3">
            <dt className="shrink-0 font-medium text-slate-600">Patient</dt>
            <dd className="min-w-0 text-right font-semibold text-slate-900">
              <span className="block truncate">{appt.patient_name}</span>
              <span className="block font-mono text-xs font-semibold tabular-nums text-[#5D0B26]">
                {appt.patient_urn}
              </span>
            </dd>
          </div>
          <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2">
            <dt className="shrink-0 font-medium text-slate-600">Doctor</dt>
            <dd className="min-w-0 text-right font-semibold text-slate-900">
              <span className="block truncate">{appt.doctor_name_en}</span>
              {issued.departmentName && (
                <span className="block truncate font-normal text-slate-600">{issued.departmentName}</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="space-y-2 border-t border-slate-100 pt-3.5">
          <button
            type="button"
            onClick={onNext}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
          >
            Book / check in next
          </button>
          <div className="grid grid-cols-2 gap-2.5">
            <Link
              to={`/reception/patients/${appt.patient_id}`}
              onClick={onClose}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50"
            >
              Patient file
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  const isArrival = issued.kind === 'arrival'
  const tokenNumber = isArrival ? issued.arrival.token_number : issued.appointment.token_number
  const tokenText = formatToken(tokenNumber, issued.cabinCode)
  const patientName = isArrival ? issued.arrival.full_name : issued.appointment.patient_name
  const doctorName = isArrival ? issued.arrival.doctor_name_en : issued.appointment.doctor_name_en
  const priorityLevel = isArrival ? issued.arrival.priority_level : issued.appointment.priority_level
  const priorityReason = isArrival ? issued.arrival.priority_reason : issued.appointment.priority_reason

  return (
    <div role="status" className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        {isCancelled ? (
          <AppointmentStatusBadge status="CANCELLED" />
        ) : isArrival ? (
          <AppointmentStatusBadge
            status="TO_ARRIVE"
            label="To arrive · Pending full registration"
          />
        ) : (
          <AppointmentStatusBadge
            status="CHECKED_IN"
            label="Checked In · Waiting for doctor"
          />
        )}
      </div>

      {isCancelled && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-semibold text-red-800"
        >
          This token has been cancelled and cannot be printed.
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 text-center">
        <span className="block text-xs font-semibold tracking-tight text-slate-600">
          OPD Token
        </span>
        <div
          data-testid="issued-token"
          className="mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums text-[#5D0B26]"
        >
          {tokenText}
        </div>
      </div>

      <dl className="space-y-2 rounded-lg border border-slate-200 bg-white p-3.5 text-xs">
        <div className="flex items-start justify-between gap-3">
          <dt className="shrink-0 font-medium text-slate-600">Patient</dt>
          <dd className="min-w-0 text-right font-semibold text-slate-900">
            <span className="block truncate">{patientName}</span>
            {!isArrival && (
              <span className="block font-mono text-xs font-semibold tabular-nums text-[#5D0B26]">
                {issued.appointment.patient_urn}
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-3 border-t border-slate-100 pt-2">
          <dt className="shrink-0 font-medium text-slate-600">Doctor</dt>
          <dd className="min-w-0 text-right font-semibold text-slate-900">
            <span className="block truncate">{doctorName}</span>
            {issued.departmentName && (
              <span className="block truncate font-normal text-slate-600">{issued.departmentName}</span>
            )}
          </dd>
        </div>
        {!isArrival && issued.appointment.visit_kind && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
            <dt className="shrink-0 font-medium text-slate-600">Consultation</dt>
            <dd className="font-semibold text-slate-800">
              {issued.appointment.visit_kind === 'FOLLOW_UP' ? 'Follow-up / Revisit' : 'New consultation'}
            </dd>
          </div>
        )}
        {priorityLevel && priorityLevel !== 'NORMAL' && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
            <dt className="shrink-0 font-medium text-slate-600">Priority</dt>
            <dd className="flex flex-col items-end gap-0.5">
              <PriorityBadge level={priorityLevel} reason={priorityReason} />
              {priorityReason && <span className="text-xs text-slate-600">{priorityReason}</span>}
            </dd>
          </div>
        )}
      </dl>

      <div className="space-y-2 border-t border-slate-100 pt-3.5">
        {isArrival ? (
          <>
            {canCreateArrival && !isCancelled && (
              <Link
                to={`/reception/patients/new?arrival_id=${issued.arrival.id}&doctor_id=${issued.arrival.doctor_id}`}
                onClick={onClose}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Complete Registration &amp; Check In →
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isCancelled}
                onClick={onPrint}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                <IconPrinter aria-hidden="true" className="h-4 w-4" />
                Print Token
              </button>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 cursor-pointer"
              >
                Next patient
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
            >
              Check in next patient
            </button>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={isCancelled}
                onClick={onPrint}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                <IconPrinter aria-hidden="true" className="h-4 w-4" />
                Print Token
              </button>
              <Link
                to={`/reception/patients/${issued.appointment.patient_id}`}
                onClick={onClose}
                className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors duration-150 hover:bg-slate-50"
              >
                Patient file
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TokenSlipModal({
  issued,
  isCancelled,
  open,
  onClose,
}: {
  issued: IssuedToken
  isCancelled: boolean
  open: boolean
  onClose: () => void
}) {
  const isArrival = issued.kind === 'arrival'
  const tokenNumber = isArrival ? issued.arrival.token_number : issued.appointment.token_number
  const tokenText = formatToken(tokenNumber, issued.cabinCode)
  const patientName = isArrival ? issued.arrival.full_name : issued.appointment.patient_name
  const doctorName = isArrival ? issued.arrival.doctor_name_en : issued.appointment.doctor_name_en
  const appointmentDate = isArrival
    ? issued.arrival.appointment_date
    : issued.appointment.appointment_date
  const priorityLevel = isArrival ? issued.arrival.priority_level : issued.appointment.priority_level
  const priorityReason = isArrival ? issued.arrival.priority_reason : issued.appointment.priority_reason

  return (
    <Modal
      open={open}
      onClose={onClose}
      print="receipt"
      variant="info"
      title="Print OPD Token"
      className="max-w-sm"
    >
      <div className="space-y-4">
        {isCancelled && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 print:hidden"
          >
            This token has been cancelled and cannot be printed.
          </div>
        )}
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 print:mx-auto print:max-w-sm print:border print:border-slate-300 print:p-6">
          <div className="border-b border-dashed border-slate-300 pb-3 text-center">
            <p className="text-sm font-bold uppercase tracking-wide text-[#5D0B26]">
              Kalyan Hospital
            </p>
            <p className="text-xs font-semibold text-slate-600">OPD Token Slip</p>
          </div>

          <div className="py-1 text-center">
            <span className="block text-xs font-semibold tracking-tight text-slate-600">
              Token Number
            </span>
            <div
              data-testid="print-slip-token"
              className="mt-1 font-mono text-4xl font-bold tracking-tight tabular-nums text-[#5D0B26]"
            >
              {tokenText}
            </div>
            <div className="mt-1 flex justify-center">
              {isCancelled ? (
                <AppointmentStatusBadge status="CANCELLED" />
              ) : isArrival ? (
                <AppointmentStatusBadge
                  status="TO_ARRIVE"
                  label="To arrive · Pending full registration"
                />
              ) : (
                <AppointmentStatusBadge
                  status="CHECKED_IN"
                  label="Checked In · Waiting for doctor"
                />
              )}
            </div>
          </div>

          <dl className="space-y-1.5 border-t border-dashed border-slate-300 pt-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-slate-600">Date</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{formatSlipDate(appointmentDate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-slate-600">Patient</dt>
              <dd className="text-right font-semibold text-slate-900">{patientName}</dd>
            </div>
            {!isArrival && (
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-slate-600">URN</dt>
                <dd className="font-mono font-semibold tabular-nums text-[#5D0B26]">
                  {issued.appointment.patient_urn}
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-slate-600">Doctor</dt>
              <dd className="text-right font-semibold text-slate-900">{doctorName}</dd>
            </div>
            {issued.departmentName && (
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-slate-600">Department</dt>
                <dd className="text-right font-semibold text-slate-800">{issued.departmentName}</dd>
              </div>
            )}
            {!isArrival && issued.appointment.visit_kind && (
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-slate-600">Consultation</dt>
                <dd className="font-semibold text-slate-800">
                  {issued.appointment.visit_kind === 'FOLLOW_UP'
                    ? 'Follow-up / Revisit'
                    : 'New consultation'}
                </dd>
              </div>
            )}
            {priorityLevel && priorityLevel !== 'NORMAL' && (
              <div className="flex items-center justify-between gap-2">
                <dt className="font-semibold text-slate-600">Priority</dt>
                <dd>
                  <PriorityBadge level={priorityLevel} reason={priorityReason} />
                </dd>
              </div>
            )}
          </dl>

          <p className="border-t border-dashed border-slate-300 pt-2.5 text-center text-xs text-slate-600">
            {isArrival
              ? 'Please complete registration at reception before consultation.'
              : 'Please wait in the OPD waiting area for your token.'}
          </p>
        </div>

        <div className="flex justify-end print:hidden">
          <button
            type="button"
            data-autofocus
            disabled={isCancelled}
            onClick={() => window.print()}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#5D0B26] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            <IconPrinter aria-hidden="true" className="h-4 w-4" />
            Print Slip
          </button>
        </div>
      </div>
    </Modal>
  )
}
