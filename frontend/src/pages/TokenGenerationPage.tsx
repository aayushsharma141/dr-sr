import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AppShell } from '../components/AppShell'
import { PriorityBadge } from '../components/checkin/PriorityBadge'
import { TodayAppointmentsPanel } from '../components/checkin/TodayAppointmentsPanel'
import {
  useAppointment,
  useAppointments,
  useBookAppointment,
  useCheckDuplicate,
  useCheckIn,
  useCheckInNewPatient,
  useConsultingDoctors,
  useCreateOpdArrival,
  useMe,
  usePatient,
  usePatients,
  useWalkIn,
} from '../api/queries'
import { ApiError } from '../api/client'
import type {
  Appointment,
  CheckInDetails,
  PatientOut,
  PriorityLevel,
  ReferralSource,
  VisitKind,
} from '../api/types'
import { formatPaise, formatToken, istToday } from '../format'
import {
  IconAlertTriangle,
  IconCalendar,
  IconCheck,
  IconSearch,
  IconTicket,
  IconUserPlus,
  IconX,
} from '../components/icons'

type PatientMode = 'new' | 'existing'

const LABEL = 'mb-1 block text-sm font-medium text-slate-700'
const SECTION_LABEL = 'text-sm font-semibold text-slate-800'
const INPUT =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:bg-slate-100'

const REFERRAL_OPTIONS: { value: ReferralSource; label: string; nameLabel: string }[] = [
  { value: 'SELF', label: 'Self (came on their own)', nameLabel: '' },
  { value: 'DOCTOR', label: 'Doctor referral', nameLabel: "Referring doctor's name" },
  { value: 'PERSONAL', label: 'Patient / personal reference', nameLabel: "Referring person's name" },
  { value: 'ORGANIZATION', label: 'Hospital / organisation', nameLabel: 'Hospital or organisation name' },
  { value: 'OTHER', label: 'Other / unknown', nameLabel: 'Details (optional)' },
]
const REFERRAL_NEEDS_NAME: ReferralSource[] = ['DOCTOR', 'PERSONAL', 'ORGANIZATION']

const PRIORITY_OPTIONS: { value: PriorityLevel; label: string; hint: string }[] = [
  { value: 'NORMAL', label: 'Normal', hint: 'Regular queue' },
  { value: 'PRIORITY', label: 'High', hint: 'Needs preferential attention' },
  { value: 'EMERGENCY', label: 'Emergency', hint: 'Immediate clinical attention' },
]

function sexLabel(gender: string): string {
  return gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Other'
}

interface Issued {
  appointment: Appointment
  isNewPatient: boolean
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
  const today = istToday()
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
  const [priority, setPriority] = useState<PriorityLevel>('NORMAL')
  const [priorityReason, setPriorityReason] = useState('')
  const [remarks, setRemarks] = useState('')

  const [issued, setIssued] = useState<Issued | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [duplicateBooking, setDuplicateBooking] = useState(false)

  // "Check In" on the Dashboard and on Appointments opens this desk with the patient and their
  // booking already chosen (?patient_id=&appointment_id=).
  const [searchParams, setSearchParams] = useSearchParams()
  const [presetApplied, setPresetApplied] = useState(false)
  const presetPatientId = Number(searchParams.get('patient_id')) || null
  const presetBookingId = Number(searchParams.get('appointment_id')) || 0
  const { data: presetPatient } = usePatient(presetApplied ? null : presetPatientId)
  const { data: presetBooking, isPending: presetBookingPending } = useAppointment(
    presetApplied ? 0 : presetBookingId,
  )
  if (!presetApplied && presetPatient && (!presetBookingId || !presetBookingPending)) {
    setPresetApplied(true)
    setMode('existing')
    setSelectedPatient(presetPatient)
    if (presetBooking && presetBooking.patient_id === presetPatient.id && isBookable(presetBooking)) {
      setBooking(presetBooking)
    }
  }

  // --- Data ------------------------------------------------------------------------------
  const { options: doctorOptions, isPending: doctorsPending } = useConsultingDoctors()
  const { data: searchResults, isPending: searching } = usePatients(searchQuery, 8, 0)
  const duplicateCheck = useCheckDuplicate(fullName, mobile, mode === 'new' && !issued)
  const duplicateMatch = duplicateCheck.data?.has_duplicate ? duplicateCheck.data.matching_patient : null
  const { data: patientBookingsData } = useAppointments(
    { appointment_date: today, patient_id: selectedPatient?.id },
    { enabled: mode === 'existing' && selectedPatient != null },
  )
  const patientBookings = useMemo(
    () =>
      (patientBookingsData?.appointments ?? []).filter(
        (a) => a.patient_id === selectedPatient?.id && isBookable(a),
      ),
    [patientBookingsData, selectedPatient],
  )

  const walkIn = useWalkIn()
  const checkIn = useCheckIn()
  const newPatientCheckIn = useCheckInNewPatient()
  const createArrival = useCreateOpdArrival()
  const bookAppointment = useBookAppointment()
  const busy =
    walkIn.isPending ||
    checkIn.isPending ||
    newPatientCheckIn.isPending ||
    createArrival.isPending ||
    bookAppointment.isPending

  // Today's appointments to compute next available token for the chosen doctor
  const { data: allAppointmentsData } = useAppointments({ appointment_date: today })
  const allTodayAppointments = useMemo(
    () => allAppointmentsData?.appointments ?? [],
    [allAppointmentsData],
  )

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
    const tokens = allTodayAppointments
      .filter((a) => a.doctor_id === chosenOption.doctor.id && a.token_number != null)
      .map((a) => a.token_number as number)
    const maxTok = tokens.length > 0 ? Math.max(...tokens) : 0
    return maxTok + 1
  }, [chosenOption, allTodayAppointments])

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
    setPriority('NORMAL')
    setPriorityReason('')
    setRemarks('')
  }

  const resetAll = () => {
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
    if (searchParams.has('patient_id')) setSearchParams({}, { replace: true })
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
    setIssued(null)
    setMode('existing')
    setSelectedPatient((current) =>
      current?.id === b.patient_id ? current : bookingPatient(b),
    )
    setBooking(b)
    setVisitKind(null)
    resetVisit()
    setErrorMsg(null)
    setDuplicateBooking(false)
  }

  // Everything the desk must have before the token can be issued; shown as the reason the
  // button is disabled, so reception is never left guessing.
  const missing: string[] = []
  if (mode === 'new') {
    if (fullName.trim().length < 2) missing.push('patient name')
    if (ageYears === '' || Number(ageYears) < 0 || Number(ageYears) > 150) missing.push('age')
    if (mobile.replace(/\D/g, '').length < 10) missing.push('10-digit phone number')
    if (duplicateMatch && !notDuplicate) missing.push('confirmation that this is a different patient')
  } else {
    if (!selectedPatient) missing.push('patient')
    if (booking && !visitKind) missing.push('consultation type')
  }
  if (!chosenOption) missing.push('consulting doctor')
  if (booking && REFERRAL_NEEDS_NAME.includes(referralSource) && referrerName.trim().length < 2)
    missing.push('referrer name')
  if (priority !== 'NORMAL' && priorityReason.trim().length < 3) missing.push('priority reason')

  const details = (): CheckInDetails => ({
    referral_source: referralSource,
    referrer_name: referrerName.trim() || null,
    priority_level: priority,
    priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
    visit_kind: mode === 'new' ? 'NEW' : visitKind,
  })

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setNotice(null)
    setDuplicateBooking(false)
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
        setNotice(`Token #${arrival.token_number} added to To Arrive. Complete registration from today's queue.`)
        setFullName('')
        setAgeYears('')
        setMobile('')
        setPriority('NORMAL')
        setPriorityReason('')
        setRemarks('')
        return
      }

      if (booking) {
        const appointment = await checkIn.mutateAsync({
          id: booking.id,
          body: { version_id: booking.version_id, ...details() },
        })
        setIssued({
          appointment,
          isNewPatient: false,
          departmentName: chosenOption.department.name_en,
          cabinCode: chosenOption.doctor.cabin_code ?? null,
        })
        return
      }

      if (selectedPatient) {
        const appointment = await bookAppointment.mutateAsync({
          patient_id: selectedPatient.id,
          doctor_id: chosenOption.doctor.id,
          department_id: chosenOption.department.id,
          appointment_date: today,
          issue_token: true,
          priority_level: priority,
          priority_reason: priority === 'NORMAL' ? null : priorityReason.trim(),
        })
        setNotice(`Token created; awaiting check-in. Token #${appointment.token_number} issued for ${appointment.patient_name}.`)
        setSelectedPatient(null)
        setPriority('NORMAL')
        setPriorityReason('')
        setRemarks('')
        return
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'duplicate_appointment') {
        setDuplicateBooking(true)
        setErrorMsg('This patient already has a booking with this doctor today. Check that booking in instead.')
      } else if (err instanceof Error && err.message) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('The token was not issued. Please try again.')
      }
    }
  }

  const submitLabel = booking
    ? 'Check in & Send to Waiting'
    : 'Create Entry & Generate Token'

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        {/* Header */}
        <header className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E4C8D1] bg-[#FBF5F7] text-[#8E1C3D]">
              <IconTicket className="h-6 w-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">Check-in &amp; Token</h1>
              <p className="text-sm text-slate-600">Issue doctor-wise tokens and manage today&apos;s queue.</p>
            </div>
          </div>
        </header>

        {issued && (
          <IssuedCard issued={issued} onNext={resetAll} />
        )}

        {notice && (
          <div
            role="status"
            className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900 shadow-2xs"
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
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900"
          >
            <span>{errorMsg}</span>
            {duplicateBooking && patientBookings.length > 0 && (
              <button
                type="button"
                onClick={() => takeBooking(patientBookings[0])}
                className="inline-flex min-h-9 items-center rounded-lg border border-red-300 bg-white px-3 text-xs font-bold text-red-900 hover:bg-red-100"
              >
                Check in their booking instead
              </button>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(24rem,0.75fr)_minmax(0,2.25fr)]">
          {/* LEFT: the check-in form */}
          <form
            onSubmit={handleSubmit}
            aria-labelledby="check-in-form-heading"
            className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <h2 id="check-in-form-heading" className="flex items-center gap-2 text-base font-bold text-slate-900">
                <IconTicket className="h-5 w-5 text-[#8E1C3D]" />
                Create OPD Token
              </h2>
              {(selectedPatient || fullName || booking) && !issued && (
                <button type="button" onClick={resetAll} className="text-xs font-semibold text-slate-500 hover:text-red-700">
                  Clear form
                </button>
              )}
            </div>

            {/* 1. Who is the patient? */}
            <fieldset className="space-y-3">
              <legend className={SECTION_LABEL}>Patient</legend>
              <Segmented<PatientMode>
                label="Patient type"
                value={mode}
                onChange={switchMode}
                options={[
                  {
                    value: 'new',
                    label: (
                      <>
                        <IconUserPlus className="h-4 w-4" /> New patient
                      </>
                    ),
                  },
                  {
                    value: 'existing',
                    label: (
                      <>
                        <IconSearch className="h-4 w-4" /> Existing patient
                      </>
                    ),
                  },
                ]}
              />
              {mode === 'new' ? (
                <NewPatientFields
                  fullName={fullName}
                  setFullName={setFullName}
                  ageYears={ageYears}
                  setAgeYears={setAgeYears}
                  mobile={mobile}
                  setMobile={setMobile}
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
                  searching={searching}
                  onPick={choosePatient}
                />
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
            </fieldset>

            {/* 2. Which doctor? */}
            <fieldset className="space-y-3">
              <legend className={SECTION_LABEL}>Doctor</legend>
              {booking ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                  <span className="flex items-center gap-2">
                    <IconCalendar className="h-4 w-4 text-sky-700" />
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
                    <div className="space-y-1.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
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
                  <span className="font-semibold">{formatPaise(chosenOption.doctor.default_fee_paise)}</span>, collected at
                  Billing after the consultation.
                </p>
              )}
            </fieldset>

            {/* 3. Referral and priority */}
            <fieldset className="space-y-3">
              <legend className={SECTION_LABEL}>Referral &amp; priority</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="checkin-referral" className={LABEL}>
                    Referred by *
                  </label>
                  <select
                    id="checkin-referral"
                    value={referralSource}
                    onChange={(e) => {
                      setReferralSource(e.target.value as ReferralSource)
                      setReferrerName('')
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
                    <label htmlFor="checkin-referrer" className={LABEL}>
                      {REFERRAL_OPTIONS.find((o) => o.value === referralSource)?.nameLabel}
                      {REFERRAL_NEEDS_NAME.includes(referralSource) ? ' *' : ''}
                    </label>
                    <input
                      id="checkin-referrer"
                      value={referrerName}
                      onChange={(e) => setReferrerName(e.target.value)}
                      maxLength={120}
                      className={INPUT}
                    />
                  </div>
                )}
              </div>

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
                <p className="mt-1 text-xs text-slate-500">
                  {PRIORITY_OPTIONS.find((o) => o.value === priority)?.hint}.
                </p>
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

              {!booking && (
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
            </fieldset>

            {/* Next available token preview (Image 5) */}
            <div className="space-y-1.5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <span className="block text-sm font-semibold text-slate-700">
                Next available token
              </span>
              <div
                data-testid="next-token-preview"
                className="font-mono text-3xl font-black text-emerald-700"
              >
                {chosenOption
                  ? nextTokenPreview != null
                    ? `#${String(nextTokenPreview).padStart(2, '0')}`
                    : '#01'
                  : '#--'}
              </div>
              <p className="text-xs text-slate-600">Preview only. Assigned when created.</p>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-4">
              {missing.length > 0 && !issued && (
                <p className="text-xs text-slate-500">Still needed: {missing.join(', ')}.</p>
              )}
              <button
                type="submit"
                disabled={busy || missing.length > 0 || !canCheckIn || issued != null}
                className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-6 text-sm font-bold text-white shadow-xs hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50"
              >
                <IconTicket className="h-4 w-4" />
                {busy ? 'Issuing token…' : submitLabel}
              </button>
            </div>
          </form>

          {/* RIGHT: today's appointments */}
          <div>
            <TodayAppointmentsPanel
              activeBookingId={booking?.id ?? null}
              canCheckIn={canCheckIn}
              canManage={canManageBookings}
              canRegister={canCheckIn}
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
    </AppShell>
  )
}

/** A booking that can still be checked in today (a late arrival marked not arrived too). */
function isBookable(a: Appointment): boolean {
  return a.appointment_date === istToday() && (a.status === 'BOOKED' || a.status === 'NO_SHOW')
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-6">
        <div className="sm:col-span-4">
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
        <div className="sm:col-span-2">
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
        <div className="sm:col-span-6">
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
        <div role="alert" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <p className="flex items-center gap-2 font-bold">
            <IconAlertTriangle className="h-4 w-4 text-amber-700" />
            Already registered? {props.duplicate.full_name} ({props.duplicate.urn})
          </p>
          <p>
            Same phone number. If this is the same person, check in their existing record instead of creating a duplicate.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
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
      <div className="space-y-1.5">
        <label htmlFor="find-existing-input" className="block text-xs font-semibold text-slate-700">
          Find existing patient
        </label>
        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
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
              <IconX className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {}}
          className="inline-flex w-full items-center justify-center rounded-lg border border-slate-300 bg-slate-50 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Search patient
        </button>
        <p className="text-xs text-slate-500">
          Verify the matching patient before creating today&apos;s visit.
        </p>
      </div>
      {query.trim().length >= 2 && (
        <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {searching ? (
            <p className="p-3 text-center text-xs text-slate-500">Searching…</p>
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
                <span className="text-right text-slate-500">
                  <span className="block font-mono">{p.mobile}</span>
                  <span className="block">
                    {p.age_years} y · {sexLabel(p.gender)}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="p-3 text-center text-xs text-slate-500">
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
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
            <IconCheck className="h-4 w-4 text-emerald-700" />
            {p.full_name}
          </p>
          <p className="mt-0.5 font-mono font-bold text-[#5D0B26]">{p.urn}</p>
          <p className="mt-1 text-slate-600">
            {p.age_years != null ? `${p.age_years} y · ${sexLabel(p.gender)} · ` : ''}
            <span className="font-mono">{p.mobile}</span>
            {p.guardian_name ? ` · Guardian: ${p.guardian_name}` : ''}
          </p>
          {p.address && <p className="text-slate-600">{p.address}</p>}
          <p className="mt-1 font-semibold text-emerald-800">Confirm with the patient that these details are theirs.</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
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

function IssuedCard({ issued, onNext }: { issued: Issued; onNext: () => void }) {
  const a = issued.appointment
  return (
    <div role="status" className="space-y-4 rounded-2xl border border-emerald-300 bg-emerald-50/90 p-5 text-emerald-950 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="flex items-center gap-2 text-lg font-bold">
            <IconCheck className="h-5 w-5 text-emerald-700" />
            {issued.isNewPatient ? 'Patient registered and checked in' : 'Patient checked in'}
          </p>
          <p className="text-sm">
            <span className="font-semibold">{a.patient_name}</span> · URN{' '}
            <span className="font-mono font-bold">{a.patient_urn}</span>
            {issued.isNewPatient && <span className="ml-1 text-xs">(new, permanent)</span>}
          </p>
          <p className="text-sm">
            Doctor: <span className="font-semibold">{a.doctor_name_en}</span>
            {issued.departmentName ? ` · ${issued.departmentName}` : ''}
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <PriorityBadge level={a.priority_level} reason={a.priority_reason} />
            {a.visit_kind && <span>{a.visit_kind === 'FOLLOW_UP' ? 'Follow-up / Revisit' : 'New consultation'}</span>}
            {a.referral_source && (
              <span>
                · Referred by:{' '}
                {a.referral_source === 'SELF'
                  ? 'Self'
                  : `${REFERRAL_OPTIONS.find((o) => o.value === a.referral_source)?.label}${a.referrer_name ? ` (${a.referrer_name})` : ''}`}
              </span>
            )}
          </div>
        </div>
        <div className="rounded-xl border border-emerald-300 bg-white px-6 py-3 text-center shadow-xs">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Token</span>
          <div data-testid="issued-token" className="font-mono text-4xl font-black text-[#5D0B26]">
            {formatToken(a.token_number, issued.cabinCode)}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-emerald-200 pt-3">
        <button
          type="button"
          onClick={onNext}
          className="inline-flex min-h-11 items-center rounded-lg bg-[#8E1C3D] px-4 text-sm font-bold text-white hover:bg-[#5D0B26]"
        >
          Check in next patient
        </button>
        {issued.isNewPatient && (
          <Link
            to={`/reception/patients/${a.patient_id}/print`}
            className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Print registration card
          </Link>
        )}
        <Link
          to={`/reception/patients/${a.patient_id}`}
          className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Patient file
        </Link>
      </div>
    </div>
  )
}

export default TokenGenerationPage
