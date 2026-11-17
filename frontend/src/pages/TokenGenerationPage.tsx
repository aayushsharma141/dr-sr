import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { Modal } from '../components/Modal'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { TodayAppointmentsPanel } from '../components/checkin/TodayAppointmentsPanel'
import {
  AppointmentStatusBadge,
  parsePositiveIntParam,
  useDebouncedValue,
  useIstToday,
} from '../components/reception/AppointmentStatusBadge'
import {
  useAppointment,
  useAppointments,
  useCheckDuplicate,
  useCheckIn,
  useConsultingDoctors,
  useCreateOpdArrival,
  useMe,
  useOpdArrivals,
  usePatient,
  usePatients,
  useWalkIn,
} from '../api/queries'
import { ApiError } from '../api/client'
import type {
  Appointment,
  CheckInDetails,
  OpdArrival,
  PatientOut,
  PriorityLevel,
  ReferralSource,
  VisitKind,
} from '../api/types'
import { formatPaise, formatToken } from '../format'
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconPrinter,
  IconSearch,
  IconTicket,
  IconUserPlus,
  IconX,
} from '../components/icons'

type PatientMode = 'new' | 'existing'

const LABEL = 'mb-1 block text-xs font-semibold text-slate-700'
const INPUT =
  'min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:bg-slate-100'

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

type Issued =
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

/** A segmented two-or-three-way choice; the selected option is white with the brand gold edge. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T | null
  /** selectedClass replaces the default selected look, e.g. red for Emergency. */
  options: { value: T; label: ReactNode; selectedClass?: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-lg border border-slate-300 bg-slate-100/70 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-bold transition-colors ${
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

export function TokenGenerationPage() {
  const { data: me } = useMe()
  const permissions = me?.permissions ?? []
  const canCheckIn = permissions.includes('visit:write')
  const canManageBookings = permissions.includes('appointment:write')
  const canCreateArrival =
    permissions.includes('patient:create') && permissions.includes('appointment:write')
  const today = useIstToday()
  const navigate = useNavigate()

  // --- Patient ---------------------------------------------------------------------------
  const [mode, setMode] = useState<PatientMode>('new')
  // New patient (OD-22-03)
  const [fullName, setFullName] = useState('')
  const [ageYears, setAgeYears] = useState('')
  const [mobile, setMobile] = useState('')
  const [notDuplicate, setNotDuplicate] = useState(false)
  // Existing patient (OD-22-04)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(null)
  const [visitKind, setVisitKind] = useState<VisitKind | null>(null)
  // A booking for today being checked in (from the list on the right, or the patient's own).
  const [booking, setBooking] = useState<Appointment | null>(null)

  // --- Visit -----------------------------------------------------------------------------
  const [doctorKey, setDoctorKey] = useState('')
  const [referralSource, setReferralSource] = useState<ReferralSource>('SELF')
  const [referrerName, setReferrerName] = useState('')
  const [referralOpen, setReferralOpen] = useState(false)
  const [priority, setPriority] = useState<PriorityLevel>('NORMAL')
  const [priorityReason, setPriorityReason] = useState('')
  const [remarks, setRemarks] = useState('')

  const [issued, setIssued] = useState<Issued | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const location = useLocation()
  const locationNotice = (location.state as { notice?: string } | null)?.notice
  const [notice, setNotice] = useState<string | null>(locationNotice ?? null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [duplicateBooking, setDuplicateBooking] = useState(false)

  // "Check In" on the Dashboard and on Appointments opens this desk with the patient and their
  // booking already chosen (?patient_id=&appointment_id=).
  const [searchParams, setSearchParams] = useSearchParams()
  const [presetApplied, setPresetApplied] = useState(false)
  const presetPatientId = parsePositiveIntParam(searchParams.get('patient_id'))
  const presetBookingId = parsePositiveIntParam(searchParams.get('appointment_id')) ?? 0
  const { data: presetPatient } = usePatient(presetApplied ? null : presetPatientId)
  const { data: presetBooking, isPending: presetBookingPending } = useAppointment(
    presetApplied ? 0 : presetBookingId,
  )
  if (!presetApplied && presetPatient && (!presetBookingId || !presetBookingPending)) {
    setPresetApplied(true)
    setMode('existing')
    setSelectedPatient(presetPatient)
    if (
      presetBooking &&
      presetBooking.patient_id === presetPatient.id &&
      isBookable(presetBooking, today)
    ) {
      setBooking(presetBooking)
      setPriority(presetBooking.priority_level ?? 'NORMAL')
      setPriorityReason(presetBooking.priority_reason ?? '')
    }
  }

  // --- Data ------------------------------------------------------------------------------
  const { options: doctorOptions, isPending: doctorsPending } = useConsultingDoctors()
  const debouncedQuery = useDebouncedValue(searchQuery, 200)
  const { data: searchResults, isPending: searching } = usePatients(debouncedQuery, 8, 0, {
    enabled: mode === 'existing' && debouncedQuery.trim().length >= 2,
  })
  const duplicateCheck = useCheckDuplicate(fullName, mobile, mode === 'new' && !issued)
  const duplicateMatch = duplicateCheck.data?.has_duplicate ? duplicateCheck.data.matching_patient : null

  const walkIn = useWalkIn()
  const checkIn = useCheckIn()
  const createArrival = useCreateOpdArrival()
  const busy = walkIn.isPending || checkIn.isPending || createArrival.isPending

  // Today's appointments and pending arrivals: single source for next token, bookings, active tokens & live issued reconciliation
  const { data: allAppointmentsData } = useAppointments({ appointment_date: today })
  const allTodayAppointments = useMemo(
    () => allAppointmentsData?.appointments ?? [],
    [allAppointmentsData],
  )
  const { data: arrivalData } = useOpdArrivals(today)
  const pendingArrivals = useMemo(
    () => arrivalData?.arrivals ?? [],
    [arrivalData],
  )

  const patientBookings = useMemo(
    () =>
      selectedPatient == null
        ? []
        : allTodayAppointments.filter(
            (a) => a.patient_id === selectedPatient.id && isBookable(a, today),
          ),
    [allTodayAppointments, selectedPatient, today],
  )

  const patientActiveTokens = useMemo(
    () =>
      selectedPatient == null
        ? []
        : allTodayAppointments.filter(
            (a) =>
              a.patient_id === selectedPatient.id &&
              a.appointment_date === today &&
              a.status !== 'CANCELLED' &&
              a.status !== 'RESCHEDULED' &&
              a.consultation_status !== 'CANCELLED' &&
              !isBookable(a, today) &&
              (a.consultation_status != null || a.token_number != null),
          ),
    [allTodayAppointments, selectedPatient, today],
  )

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
    const candidate = allTodayAppointments.find((a) => a.id === issued.appointment.id)
    const live =
      candidate && candidate.version_id >= issued.appointment.version_id
        ? candidate
        : issued.appointment
    return {
      liveIssued: { ...issued, appointment: live },
      issuedCancelled: live.status === 'CANCELLED' || live.consultation_status === 'CANCELLED',
    }
  }, [issued, pendingArrivals, allTodayAppointments])

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

  // --- Actions ---------------------------------------------------------------------------
  const resetVisit = () => {
    setDoctorKey('')
    setReferralSource('SELF')
    setReferrerName('')
    setReferralOpen(false)
    setPriority('NORMAL')
    setPriorityReason('')
    setRemarks('')
  }

  const resetAll = () => {
    setPrintOpen(false)
    setFullName('')
    setAgeYears('')
    setMobile('')
    setNotDuplicate(false)
    setSearchQuery('')
    setSelectedPatient(null)
    setVisitKind(null)
    setBooking(null)
    resetVisit()
    setErrorMsg(null)
    setDuplicateBooking(false)
    setIssued(null)
    if (searchParams.has('patient_id') || searchParams.has('appointment_id')) {
      setSearchParams({}, { replace: true })
    }
  }

  const switchMode = (next: PatientMode) => {
    if (next === mode) return
    setMode(next)
    setBooking(null)
    setErrorMsg(null)
    setDuplicateBooking(false)
  }

  const choosePatient = (patient: PatientOut) => {
    setMode('existing')
    setSelectedPatient(patient)
    setSearchQuery('')
    setVisitKind(null)
    setBooking(null)
    setErrorMsg(null)
    setDuplicateBooking(false)
  }

  /** "Check in" on the right: the form takes the booking; reception confirms the rest. */
  const takeBooking = (b: Appointment) => {
    setPrintOpen(false)
    setIssued(null)
    setMode('existing')
    setSelectedPatient((current) =>
      current?.id === b.patient_id ? current : bookingPatient(b),
    )
    setBooking(b)
    setVisitKind(null)
    resetVisit()
    setPriority(b.priority_level ?? 'NORMAL')
    setPriorityReason(b.priority_reason ?? '')
    setErrorMsg(null)
    setDuplicateBooking(false)
  }

  // Everything the desk must have before the token can be issued; shown as the reason the
  // button is disabled, so reception is never left guessing.
  const canSubmit = mode === 'new' ? canCreateArrival : canCheckIn
  const missing: string[] = []
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

  const details = (): CheckInDetails => ({
    referral_source: referralSource,
    referrer_name: referralSource === 'SELF' ? null : referrerName.trim() || null,
    priority_level: priority,
    priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
    visit_kind: mode === 'new' ? 'NEW' : (visitKind ?? 'NEW'),
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setNotice(null)
    setDuplicateBooking(false)
    if (!canSubmit) return
    if (missing.length > 0 || !chosenOption) {
      setErrorMsg(`Still needed: ${missing.join(', ')}.`)
      return
    }
    try {
      if (mode === 'new') {
        const arrival = await createArrival.mutateAsync({
          full_name: fullName.trim(),
          age_years: Number(ageYears),
          mobile: mobile.trim(),
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          priority_level: priority,
          priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
        })
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
        return
      }

      if (booking) {
        const appointment = await checkIn.mutateAsync({
          id: booking.id,
          body: { version_id: booking.version_id, ...details() },
        })
        setIssued({
          kind: 'checked_in',
          appointment,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        return
      }

      if (selectedPatient) {
        const appointment = await walkIn.mutateAsync({
          patient_id: selectedPatient.id,
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          notes: remarks.trim() || null,
          ...details(),
        })
        setIssued({
          kind: 'checked_in',
          appointment,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        return
      }
    } catch (err: unknown) {
      const matchingBooking =
        mode === 'existing'
          ? patientBookings.find((b) => b.doctor_id === chosenOption.doctor.id) ?? patientBookings[0] ?? null
          : null
      if (err instanceof ApiError && err.code === 'duplicate_appointment' && matchingBooking) {
        setDuplicateBooking(true)
        setErrorMsg('This patient already has a booking with this doctor today. Check that booking in instead.')
      } else if (err instanceof Error && err.message) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('The token was not issued. Please try again.')
      }
    }
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
      remarks,
  )
  const submitLabel = mode === 'new' ? 'Generate Token' : 'Check in & Generate Token'
  const showRemarks = mode === 'existing' && !booking
  const selectedReferralMeta =
    REFERRAL_OPTIONS.find((o) => o.value === referralSource) ?? REFERRAL_OPTIONS[0]

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-4">
        <h1 className="sr-only">Check-in &amp; Token</h1>

        {notice && (
          <div
            role="status"
            className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 shadow-2xs"
          >
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss notification"
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950"
            >
              <IconX aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900"
          >
            <span>{errorMsg}</span>
            {duplicateBooking && patientBookings.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  takeBooking(
                    patientBookings.find((b) => b.doctor_id === chosenOption?.doctor.id) ??
                      patientBookings[0],
                  )
                }
                className="inline-flex min-h-9 items-center rounded-lg border border-red-300 bg-white px-3 text-xs font-bold text-red-900 hover:bg-red-100"
              >
                Check in their booking instead
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(22rem,25rem)_minmax(0,1fr)]">
          {/* LEFT: Two-step Check-in & Token card */}
          <section
            aria-labelledby="check-in-form-heading"
            className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs"
          >
            <div className="space-y-2.5 border-b border-slate-100 pb-3">
              <div className="flex items-center justify-between gap-2">
                <h2 id="check-in-form-heading" className="flex items-center gap-2 text-base font-bold text-slate-900">
                  <IconTicket aria-hidden="true" className="h-5 w-5 text-[#8E1C3D]" />
                  {issued ? 'Token Generated' : 'Create OPD Token'}
                </h2>
                {hasFormInput && !issued && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="text-xs font-semibold text-slate-600 hover:text-red-700"
                  >
                    Clear form
                  </button>
                )}
              </div>

              <ol
                aria-label="Check-in steps"
                className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200 bg-slate-50 p-1"
              >
                <li
                  aria-current={!issued ? 'step' : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${
                    !issued
                      ? 'bg-white text-[#5D0B26] shadow-2xs ring-1 ring-[#C39A35]/60'
                      : 'text-emerald-800'
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                      !issued ? 'bg-[#8E1C3D] text-white' : 'bg-emerald-700 text-white'
                    }`}
                  >
                    {issued ? <IconCheck aria-hidden="true" className="h-3.5 w-3.5" /> : '01'}
                  </span>
                  <span className="truncate">Patient &amp; Visit</span>
                </li>
                <li
                  aria-current={issued ? 'step' : undefined}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold ${
                    issued
                      ? 'bg-white text-[#5D0B26] shadow-2xs ring-1 ring-[#C39A35]/60'
                      : 'text-slate-600'
                  }`}
                >
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                      issued ? 'bg-[#8E1C3D] text-white' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    02
                  </span>
                  <span className="truncate">Token &amp; Check-in</span>
                </li>
              </ol>
            </div>

            {!issued ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                {/* 1. Patient */}
                <div className="space-y-2.5">
                  <Segmented<PatientMode>
                    label="Patient type"
                    value={mode}
                    onChange={switchMode}
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
                    />
                  ) : selectedPatient ? (
                    <SelectedPatientCard
                      patient={selectedPatient}
                      onChange={() => {
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
                    />
                  )}

                  {mode === 'existing' && selectedPatient && patientActiveTokens.length > 0 && (
                    <div
                      role="status"
                      className="space-y-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold">Already checked in today</span>
                        <AppointmentStatusBadge status="CHECKED_IN" />
                      </div>
                      {patientActiveTokens.map((a) => (
                        <p key={a.id} className="text-sky-900">
                          {a.token_number != null ? `Token #${a.token_number} · ` : ''}
                          {a.doctor_name_en}
                        </p>
                      ))}
                    </div>
                  )}

                  {mode === 'existing' && selectedPatient && (
                    <div>
                      <span className={LABEL}>Consultation type *</span>
                      <Segmented<VisitKind>
                        label="Consultation type"
                        value={visitKind}
                        onChange={setVisitKind}
                        options={[
                          { value: 'NEW', label: 'New consultation' },
                          { value: 'FOLLOW_UP', label: 'Follow-up / Revisit' },
                        ]}
                      />
                    </div>
                  )}
                </div>

                {/* 2. Doctor & booking */}
                <div className="space-y-2">
                  {booking ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                      <span className="flex items-center gap-2">
                        <IconCalendar aria-hidden="true" className="h-4 w-4 shrink-0 text-sky-700" />
                        <span>
                          Booked appointment with <span className="font-bold">{booking.doctor_name_en}</span>
                          {booking.expected_time ? ` at ${booking.expected_time.slice(0, 5)}` : ''}
                          {booking.status === 'NO_SHOW' ? ' (marked not arrived; checking in late)' : ''}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setBooking(null)}
                        className="font-semibold text-sky-800 underline hover:text-sky-950"
                      >
                        Not this booking
                      </button>
                    </div>
                  ) : (
                    <>
                      {mode === 'existing' && patientBookings.length > 0 && (
                        <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
                          <p className="font-bold">This patient is booked for today:</p>
                          {patientBookings.map((b) => (
                            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                              <span>
                                {b.doctor_name_en}
                                {b.expected_time ? ` at ${b.expected_time.slice(0, 5)}` : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => takeBooking(b)}
                                className="inline-flex min-h-8 items-center rounded-lg bg-[#8E1C3D] px-3 font-bold text-white hover:bg-[#5D0B26]"
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
                          disabled={doctorsPending && doctorOptions.length === 0}
                          className={INPUT}
                        >
                          <option value="">{doctorsPending ? 'Loading doctors…' : 'Choose consulting doctor'}</option>
                          {departments.map(([deptId, group]) => (
                            <optgroup key={deptId} label={group.name}>
                              {group.options.map((o) => (
                                <option key={`${deptId}:${o.doctor.id}`} value={`${deptId}:${o.doctor.id}`}>
                                  {o.doctor.name_en}
                                  {o.doctor.qualification ? ` (${o.doctor.qualification})` : ''}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {!doctorsPending && doctorOptions.length === 0 && (
                          <p role="alert" className="mt-1 text-xs font-semibold text-amber-800">
                            No doctor is assigned to a department yet. Ask the administrator to add doctors to a
                            department (Admin → Departments).
                          </p>
                        )}
                      </div>
                    </>
                  )}
                  {chosenOption && (
                    <p className="text-xs text-slate-600">
                      {chosenOption.department.name_en} · Consultation fee{' '}
                      <span className="font-semibold text-slate-800">
                        {formatPaise(chosenOption.doctor.default_fee_paise)}
                      </span>
                    </p>
                  )}
                </div>

                {/* 3. Priority, Remarks & Referral */}
                <div className="space-y-2.5">
                  <div className={showRemarks ? 'grid grid-cols-1 gap-2.5 sm:grid-cols-[0.85fr_1.15fr]' : undefined}>
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
                        maxLength={500}
                        placeholder={priority === 'EMERGENCY' ? 'e.g. Severe acute pain' : 'e.g. 82 years old'}
                        className={`${INPUT} ${priority === 'EMERGENCY' ? 'border-red-400' : 'border-amber-400'}`}
                      />
                    </div>
                  )}

                  {mode === 'existing' && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700">
                          Referred by:{' '}
                          <span className="text-slate-900">
                            {selectedReferralMeta.shortLabel}
                            {referralSource !== 'SELF' && referrerName.trim()
                              ? ` (${referrerName.trim()})`
                              : ''}
                          </span>
                        </span>
                        <button
                          type="button"
                          aria-expanded={referralOpen}
                          onClick={() => setReferralOpen((open) => !open)}
                          className="text-xs font-semibold text-[#8E1C3D] hover:underline"
                        >
                          {referralOpen ? 'Hide' : 'Change'}
                        </button>
                      </div>
                      {referralOpen && (
                        <div className="space-y-2 pt-1">
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

                {/* Compact inline Next-Token preview */}
                <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2">
                  <div>
                    <span className="block text-xs font-semibold text-slate-700">Next available token</span>
                    <span className="block text-xs text-slate-600">Preview only</span>
                  </div>
                  <span
                    data-testid="next-token-preview"
                    className="font-mono text-xl font-black text-emerald-800"
                  >
                    {chosenOption
                      ? formatToken(nextTokenPreview ?? 1, chosenOption.doctor.cabin_code)
                      : '#--'}
                  </span>
                </div>

                <div className="space-y-1.5 border-t border-slate-100 pt-3">
                  {missing.length > 0 && (
                    <p className="text-xs text-slate-600">Still needed: {missing.join(', ')}.</p>
                  )}
                  <button
                    type="submit"
                    disabled={busy || missing.length > 0 || !canSubmit}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-5 text-sm font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
                  >
                    <IconTicket aria-hidden="true" className="h-4 w-4" />
                    {busy ? 'Issuing token…' : submitLabel}
                  </button>
                </div>
              </form>
            ) : liveIssued ? (
              <StepTwoIssued
                issued={liveIssued}
                canCreateArrival={canCreateArrival}
                isCancelled={issuedCancelled}
                onPrint={() => setPrintOpen(true)}
                onNext={resetAll}
              />
            ) : null}
          </section>

          {/* RIGHT: today's appointments */}
          <div>
            <TodayAppointmentsPanel
              activeBookingId={booking?.id ?? null}
              canCheckIn={canCheckIn}
              canManage={canManageBookings}
              canRegister={canCreateArrival}
              onCheckIn={takeBooking}
              onRegisterArrival={(arrival) => {
                navigate(`/reception/patients/new?arrival_id=${arrival.id}&doctor_id=${arrival.doctor_id}`)
              }}
              onRegisterPatient={(a) => {
                navigate(
                  a.patient_id
                    ? `/reception/patients/${a.patient_id}/edit?appointment_id=${a.id}`
                    : `/reception/patients/new?appointment_id=${a.id}`,
                )
              }}
            />
          </div>
        </div>
      </div>

      {liveIssued && (
        <TokenSlipModal
          issued={liveIssued}
          isCancelled={issuedCancelled}
          open={printOpen}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </AppShell>
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
}) {
  return (
    <div className="space-y-2.5">
      <div>
        <label htmlFor="np-name" className={LABEL}>
          Patient name *
        </label>
        <input
          id="np-name"
          value={props.fullName}
          onChange={(e) => props.setFullName(e.target.value)}
          maxLength={120}
          className={INPUT}
          autoComplete="name"
          required
        />
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[0.7fr_1.3fr]">
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
            className={INPUT}
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
            maxLength={15}
            placeholder="10-digit mobile"
            className={INPUT}
            required
          />
        </div>
      </div>

      {props.duplicate && (
        <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
          <p className="flex items-center gap-2 font-bold">
            <IconAlertTriangle aria-hidden="true" className="h-4 w-4 text-amber-700" />
            Already registered? {props.duplicate.full_name} ({props.duplicate.urn})
          </p>
          <p>
            Same phone number. If this is the same person, check in their existing record instead of creating a duplicate.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => props.onUseExisting(props.duplicate!)}
              className="inline-flex min-h-8 items-center rounded-lg bg-amber-800 px-3 text-xs font-bold text-white hover:bg-amber-900"
            >
              Use this patient
            </button>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={props.notDuplicate}
                onChange={(e) => props.setNotDuplicate(e.target.checked)}
                className="rounded border-slate-300 text-[#8E1C3D] focus:ring-[#8E1C3D]"
              />
              Different patient with same phone number
            </label>
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
}: {
  query: string
  setQuery: (v: string) => void
  results: PatientOut[] | undefined
  searching: boolean
  onPick: (p: PatientOut) => void
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
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
            type="text"
            aria-label="Search patient by URN, name or mobile"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Enter mobile number or hospital URN"
            className={`${INPUT} pl-9 pr-9`}
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-700"
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
        <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {searching ? (
            <p className="p-3 text-center text-xs text-slate-600">Searching…</p>
          ) : results && results.length > 0 ? (
            results.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPick(p)}
                className="flex w-full items-center justify-between gap-3 p-2.5 text-left text-xs hover:bg-[#FBF5F7]"
              >
                <span>
                  <span className="block font-bold text-slate-900">{p.full_name}</span>
                  <span className="block font-mono text-[#5D0B26]">{p.urn}</span>
                </span>
                <span className="text-right text-slate-600">
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

function SelectedPatientCard({ patient, onChange }: { patient: PatientOut; onChange: () => void }) {
  // A patient chosen from a booking carries only name, URN and mobile until their record loads.
  const { data: full } = usePatient(patient.id)
  const p = full ?? patient
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-2.5 text-xs">
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
            <IconCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-emerald-700" />
            <span className="truncate">{p.full_name}</span>
          </p>
          <p className="mt-0.5 font-mono font-bold text-[#5D0B26]">{p.urn}</p>
          <p className="mt-0.5 text-slate-600">
            {p.age_years != null ? `${p.age_years} y · ${sexLabel(p.gender)} · ` : ''}
            <span className="font-mono">{p.mobile}</span>
            {p.guardian_name ? ` · Guardian: ${p.guardian_name}` : ''}
          </p>
          {p.address && <p className="truncate text-slate-600">{p.address}</p>}
          <p className="mt-1 font-semibold text-emerald-800">Confirm with the patient that these details are theirs.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <button type="button" onClick={onChange} className="font-semibold text-slate-600 hover:text-red-700">
            Not this patient
          </button>
          <Link to={`/reception/patients/${p.id}`} className="font-semibold text-[#8E1C3D] hover:underline">
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
}: {
  issued: Issued
  canCreateArrival: boolean
  isCancelled: boolean
  onPrint: () => void
  onNext: () => void
}) {
  const isArrival = issued.kind === 'arrival'
  const tokenNumber = isArrival ? issued.arrival.token_number : issued.appointment.token_number
  const tokenText = formatToken(tokenNumber, issued.cabinCode)
  const patientName = isArrival ? issued.arrival.full_name : issued.appointment.patient_name
  const doctorName = isArrival ? issued.arrival.doctor_name_en : issued.appointment.doctor_name_en
  const priorityLevel = isArrival ? issued.arrival.priority_level : issued.appointment.priority_level
  const priorityReason = isArrival ? issued.arrival.priority_reason : issued.appointment.priority_reason

  return (
    <div role="status" className="space-y-3.5">
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
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800"
        >
          This token has been cancelled and cannot be printed.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-center">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
          OPD Token
        </span>
        <div
          data-testid="issued-token"
          className="mt-1 font-mono text-4xl font-black tracking-tight text-[#5D0B26]"
        >
          {tokenText}
        </div>
      </div>

      <dl className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
        <div className="flex items-start justify-between gap-2">
          <dt className="font-semibold text-slate-600">Patient</dt>
          <dd className="text-right font-bold text-slate-900">
            <span>{patientName}</span>
            {!isArrival && (
              <span className="block font-mono text-xs font-semibold text-[#5D0B26]">
                {issued.appointment.patient_urn}
              </span>
            )}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-2 border-t border-slate-100 pt-2">
          <dt className="font-semibold text-slate-600">Doctor</dt>
          <dd className="text-right font-semibold text-slate-900">
            <span>{doctorName}</span>
            {issued.departmentName && (
              <span className="block font-normal text-slate-600">{issued.departmentName}</span>
            )}
          </dd>
        </div>
        {!isArrival && issued.appointment.visit_kind && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <dt className="font-semibold text-slate-600">Consultation</dt>
            <dd className="font-semibold text-slate-800">
              {issued.appointment.visit_kind === 'FOLLOW_UP' ? 'Follow-up / Revisit' : 'New consultation'}
            </dd>
          </div>
        )}
        {priorityLevel && priorityLevel !== 'NORMAL' && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
            <dt className="font-semibold text-slate-600">Priority</dt>
            <dd className="flex flex-col items-end gap-0.5">
              <PriorityBadge level={priorityLevel} reason={priorityReason} />
              {priorityReason && <span className="text-xs text-slate-600">{priorityReason}</span>}
            </dd>
          </div>
        )}
      </dl>

      <div className="space-y-2 border-t border-slate-100 pt-3">
        {isArrival ? (
          <>
            {canCreateArrival && !isCancelled && (
              <Link
                to={`/reception/patients/new?arrival_id=${issued.arrival.id}&doctor_id=${issued.arrival.doctor_id}`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-4 text-sm font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Complete Registration &amp; Check In →
              </Link>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isCancelled}
                onClick={onPrint}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconPrinter aria-hidden="true" className="h-4 w-4" />
                Print Token
              </button>
              <button
                type="button"
                onClick={onNext}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50"
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
              className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-4 text-sm font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
            >
              Check in next patient
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={isCancelled}
                onClick={onPrint}
                className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <IconPrinter aria-hidden="true" className="h-4 w-4" />
                Print Token
              </button>
              <Link
                to={`/reception/patients/${issued.appointment.patient_id}`}
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 hover:bg-slate-50"
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
  issued: Issued
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
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
              Token Number
            </span>
            <div
              data-testid="print-slip-token"
              className="mt-1 font-mono text-4xl font-black text-[#5D0B26]"
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
              <dd className="font-semibold text-slate-900">{formatSlipDate(appointmentDate)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="font-semibold text-slate-600">Patient</dt>
              <dd className="text-right font-bold text-slate-900">{patientName}</dd>
            </div>
            {!isArrival && (
              <div className="flex justify-between gap-2">
                <dt className="font-semibold text-slate-600">URN</dt>
                <dd className="font-mono font-semibold text-[#5D0B26]">
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
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-4 text-sm font-bold text-white shadow-xs hover:bg-[#5D0B26] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconPrinter aria-hidden="true" className="h-4 w-4" />
            Print Slip
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default TokenGenerationPage
