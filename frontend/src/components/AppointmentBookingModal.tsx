import { useEffect, useState } from 'react'
import {
  useBookAppointment,
  useDoctors,
  useMe,
  usePatientTreatmentPlans,
  usePatients,
} from '../api/queries'
import type {
  AppointmentBookingMode,
  AppointmentVisitType,
  PatientOut,
  TreatmentPlanOut,
} from '../api/types'

interface AppointmentBookingModalProps {
  isOpen: boolean
  onClose: () => void
  initialPatient?: PatientOut | null
  initialDoctorId?: number
  initialDate?: string
  onSuccess?: () => void
}

function localDateValue(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Unable to determine clinic-local date')
  return `${year}-${month}-${day}`
}

function addCalendarDays(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) throw new Error(`Invalid clinic date: ${value}`)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

const VISIT_TYPES: {
  value: AppointmentVisitType
  title: string
  description: string
}[] = [
  {
    value: 'NEW_CONSULTATION',
    title: 'New consultation',
    description: 'First assessment or a new complaint',
  },
  {
    value: 'FOLLOW_UP',
    title: 'Follow-up review',
    description: 'Return visit or reassessment',
  },
  {
    value: 'PHYSIOTHERAPY_SESSION',
    title: 'Physiotherapy session',
    description: 'Visit for an existing therapy programme',
  },
]

export function AppointmentBookingModal({
  isOpen,
  onClose,
  initialPatient,
  initialDoctorId,
  initialDate,
  onSuccess,
}: AppointmentBookingModalProps) {
  const today = localDateValue(new Date())
  const [bookingMode, setBookingMode] = useState<AppointmentBookingMode>('WALK_IN')
  const [visitType, setVisitType] = useState<AppointmentVisitType>('NEW_CONSULTATION')
  const [patientSearch, setPatientSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(initialPatient ?? null)
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | ''>(initialDoctorId ?? '')
  const [appointmentDate, setAppointmentDate] = useState(today)
  const [selectedPlanId, setSelectedPlanId] = useState<number | ''>('')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [allocatedToken, setAllocatedToken] = useState<number | null>(null)

  const { data: me } = useMe()
  const { data: doctors, isPending: doctorsPending } = useDoctors(false)
  const canReadPlans = me?.permissions.includes('plan:read') === true
  const { data: searchResults, isPending: isSearching } = usePatients(
    debouncedSearch,
    5,
    0,
    true,
    debouncedSearch.trim().length >= 2 && !selectedPatient,
  )
  const { data: treatmentPlans, isPending: plansPending } = usePatientTreatmentPlans(
    selectedPatient?.id ?? 0,
    canReadPlans && visitType === 'PHYSIOTHERAPY_SESSION' && selectedPatient !== null,
  )
  const bookMutation = useBookAppointment()

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(patientSearch.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [patientSearch])

  useEffect(() => {
    if (!isOpen) return
    const requestedDate = initialDate && initialDate >= today ? initialDate : today
    setSelectedPatient(initialPatient ?? null)
    setSelectedDoctorId(initialDoctorId ?? '')
    setAppointmentDate(requestedDate)
    setBookingMode(requestedDate === today ? 'WALK_IN' : 'SCHEDULED')
    setVisitType('NEW_CONSULTATION')
    setPatientSearch('')
    setDebouncedSearch('')
    setSelectedPlanId('')
    setNotes('')
    setErrorMsg(null)
    setAllocatedToken(null)
  }, [isOpen, initialPatient, initialDoctorId, initialDate, today])

  useEffect(() => {
    setSelectedPlanId('')
  }, [selectedPatient?.id, visitType])

  if (!isOpen) return null

  const handleBookingModeChange = (mode: AppointmentBookingMode) => {
    setBookingMode(mode)
    setErrorMsg(null)
    if (mode === 'WALK_IN') {
      setAppointmentDate(today)
    } else if (appointmentDate <= today) {
      setAppointmentDate(addCalendarDays(today, 1))
    }
  }

  const handleSelectPatient = (patient: PatientOut) => {
    setSelectedPatient(patient)
    setPatientSearch('')
    setDebouncedSearch('')
    setSelectedPlanId('')
  }

  const handleSelectPlan = (planId: string) => {
    setSelectedPlanId(planId ? Number(planId) : '')
    const plan = treatmentPlans?.find((item) => item.id === Number(planId))
    if (plan) setSelectedDoctorId(plan.doctor_id)
  }

  const activePlans = (treatmentPlans ?? []).filter((plan) => plan.status === 'ACTIVE')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMsg(null)

    if (!selectedPatient) {
      setErrorMsg('Search for and select a patient before booking.')
      return
    }
    if (!selectedDoctorId) {
      setErrorMsg('Select the consulting doctor.')
      return
    }
    if (bookingMode === 'WALK_IN' && appointmentDate !== today) {
      setErrorMsg("Today's token queue can only be used for today's clinic date.")
      return
    }
    if (bookingMode === 'SCHEDULED' && appointmentDate <= today) {
      setErrorMsg('Choose a future date. Use Today’s Token for same-day visits.')
      return
    }

    try {
      const result = await bookMutation.mutateAsync({
        patient_id: selectedPatient.id,
        doctor_id: Number(selectedDoctorId),
        appointment_date: appointmentDate,
        booking_mode: bookingMode,
        visit_type: visitType,
        treatment_plan_id: canReadPlans && selectedPlanId ? Number(selectedPlanId) : null,
        notes: notes.trim() || null,
      })
      setAllocatedToken(result.token_number)
      onSuccess?.()
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : 'Unable to save this appointment.')
    }
  }

  const handleClose = () => {
    setAllocatedToken(null)
    setErrorMsg(null)
    setSelectedPatient(null)
    setPatientSearch('')
    setDebouncedSearch('')
    setSelectedPlanId('')
    setNotes('')
    onClose()
  }

  const selectedDoctor = doctors?.find((doctor) => doctor.id === Number(selectedDoctorId))
  const modeLabel = bookingMode === 'WALK_IN' ? "Today's Token Queue" : 'Scheduled Visit'
  const visitLabel = VISIT_TYPES.find((item) => item.value === visitType)?.title ?? 'Consultation'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/55 p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-dialog-title"
        className="my-auto w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#8E1C3D]">
              Kalyan Hospital · Reception
            </p>
            <h2 id="appointment-dialog-title" className="mt-1 text-xl font-bold text-slate-900">
              Book a patient visit
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Choose how the patient will join the doctor’s daily queue.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close appointment booking"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </header>

        {allocatedToken !== null ? (
          <div className="space-y-5 px-5 py-8 text-center sm:px-8">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="m5 12 4 4L19 6" />
              </svg>
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">
                {bookingMode === 'WALK_IN' ? 'Added to today’s token queue' : 'Future visit date reserved'}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {selectedPatient?.full_name} · {selectedPatient?.urn}
              </p>
            </div>
            <div className="mx-auto max-w-md rounded-xl border border-emerald-200 bg-emerald-50 p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-800">
                Daily queue token
              </p>
              <p className="mt-1 text-4xl font-extrabold tabular-nums text-emerald-950">
                #{allocatedToken}
              </p>
              <p className="mt-2 text-sm font-semibold text-emerald-950">
                {selectedDoctor?.name_en ?? 'Assigned doctor'} · {appointmentDate}
              </p>
              <p className="mt-1 text-xs text-emerald-800">
                {modeLabel} · {visitLabel}
              </p>
            </div>
            {bookingMode === 'SCHEDULED' && (
              <p className="mx-auto max-w-lg text-sm text-slate-600">
                This reserves a place in the selected doctor’s queue for that date. It does not reserve an exact arrival or consultation time.
              </p>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="min-h-11 rounded-lg bg-[#5D0B26] px-8 text-sm font-semibold text-white hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="max-h-[calc(100vh-170px)] space-y-6 overflow-y-auto px-5 py-5 sm:px-7 sm:py-6">
            {errorMsg && (
              <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {errorMsg}
              </div>
            )}

            <section className="space-y-3" aria-labelledby="booking-mode-heading">
              <div>
                <h3 id="booking-mode-heading" className="text-sm font-bold text-slate-900">1. Visit booking mode</h3>
                <p className="mt-1 text-xs text-slate-500">Choose whether the patient is arriving today or reserving a future queue date.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  aria-pressed={bookingMode === 'WALK_IN'}
                  onClick={() => handleBookingModeChange('WALK_IN')}
                  className={[
                    'flex min-h-[88px] items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                    bookingMode === 'WALK_IN' ? 'border-[#8E1C3D] bg-rose-50 ring-1 ring-[#8E1C3D]' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#5D0B26] text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="M4 5h16v15H4zM8 3v4M16 3v4M4 10h16M8 14h3" />
                    </svg>
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-slate-900">Today’s Token</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">Patient is at the hospital or joining today’s queue.</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-pressed={bookingMode === 'SCHEDULED'}
                  onClick={() => handleBookingModeChange('SCHEDULED')}
                  className={[
                    'flex min-h-[88px] items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                    bookingMode === 'SCHEDULED' ? 'border-[#8E1C3D] bg-rose-50 ring-1 ring-[#8E1C3D]' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50',
                  ].join(' ')}
                >
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-800">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <rect x="3" y="4" width="18" height="17" rx="2" />
                      <path d="M8 2v4M16 2v4M3 9h18M8 13h3M8 17h6" />
                    </svg>
                  </span>
                  <span>
                    <span className="block text-sm font-bold text-slate-900">Scheduled Visit</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-600">Reserve a place in a doctor’s queue on a future date.</span>
                  </span>
                </button>
              </div>
              {bookingMode === 'SCHEDULED' && (
                <p className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-900">
                  Date-based reservation only. The hospital has not configured doctor time slots, so this booking does not promise an exact arrival time.
                </p>
              )}
            </section>

            <section className="space-y-3" aria-labelledby="visit-type-heading">
              <div>
                <h3 id="visit-type-heading" className="text-sm font-bold text-slate-900">2. Visit category</h3>
                <p className="mt-1 text-xs text-slate-500">This is an administrative visit category, not a diagnosis or clinical note.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {VISIT_TYPES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={visitType === item.value}
                    onClick={() => setVisitType(item.value)}
                    className={[
                      'min-h-[82px] rounded-lg border px-3 py-3 text-left transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                      visitType === item.value ? 'border-[#8E1C3D] bg-rose-50' : 'border-slate-200 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3" aria-labelledby="patient-heading">
              <div>
                <h3 id="patient-heading" className="text-sm font-bold text-slate-900">3. Select patient</h3>
                <p className="mt-1 text-xs text-slate-500">Search by at least two characters of the name, URN or mobile number.</p>
              </div>
              {selectedPatient ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{selectedPatient.full_name}</p>
                    <p className="mt-0.5 font-mono text-xs text-slate-600">{selectedPatient.urn}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      {selectedPatient.age_years} years · {selectedPatient.mobile}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedPatient(null)}
                    className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Change patient
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <label htmlFor="appointment-patient-search" className="sr-only">Search active patients</label>
                  <input
                    id="appointment-patient-search"
                    type="search"
                    autoComplete="off"
                    value={patientSearch}
                    onChange={(event) => setPatientSearch(event.target.value)}
                    placeholder="Search patient name, URN or mobile…"
                    className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-rose-100"
                  />
                  {patientSearch.trim().length < 2 ? (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                      Start typing to search. No patient list is loaded automatically.
                    </p>
                  ) : isSearching ? (
                    <p role="status" className="px-1 py-2 text-xs text-slate-500">Searching active patient records…</p>
                  ) : searchResults && searchResults.length > 0 ? (
                    <div role="listbox" aria-label="Patient search results" className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                      {searchResults.map((patient) => (
                        <button
                          key={patient.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => handleSelectPatient(patient)}
                          className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#8E1C3D]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">{patient.full_name}</span>
                            <span className="mt-0.5 block font-mono text-xs text-slate-500">{patient.urn}</span>
                          </span>
                          <span className="shrink-0 text-xs tabular-nums text-slate-600">{patient.mobile}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                      No active patient matched this search. Verify the URN or register the patient first.
                    </p>
                  )}
                </div>
              )}
            </section>

            <section className="grid gap-4 sm:grid-cols-2" aria-labelledby="doctor-date-heading">
              <h3 id="doctor-date-heading" className="sr-only">Doctor and visit date</h3>
              <div className="space-y-1.5">
                <label htmlFor="appointment-doctor" className="block text-xs font-semibold text-slate-700">Consulting doctor</label>
                <select
                  id="appointment-doctor"
                  value={selectedDoctorId}
                  onChange={(event) => setSelectedDoctorId(event.target.value ? Number(event.target.value) : '')}
                  required
                  disabled={doctorsPending}
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-rose-100"
                >
                  <option value="">Select a doctor</option>
                  {doctors?.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name_en}{doctor.name_hi ? ` · ${doctor.name_hi}` : ''}
                    </option>
                  ))}
                </select>
                {selectedDoctorId && (
                  <p className="text-xs text-emerald-700">Preselected from the appointment schedule.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="appointment-date" className="block text-xs font-semibold text-slate-700">
                  {bookingMode === 'WALK_IN' ? 'Today’s queue date' : 'Future visit date'}
                </label>
                <input
                  id="appointment-date"
                  type="date"
                  value={appointmentDate}
                  min={bookingMode === 'WALK_IN' ? today : addCalendarDays(today, 1)}
                  max={bookingMode === 'WALK_IN' ? today : undefined}
                  disabled={bookingMode === 'WALK_IN'}
                  onChange={(event) => setAppointmentDate(event.target.value)}
                  required
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </section>

            {visitType === 'PHYSIOTHERAPY_SESSION' && canReadPlans && selectedPatient && (
              <section className="space-y-1.5">
                <label htmlFor="appointment-treatment-plan" className="block text-xs font-semibold text-slate-700">
                  Active treatment plan (optional)
                </label>
                <select
                  id="appointment-treatment-plan"
                  value={selectedPlanId}
                  onChange={(event) => handleSelectPlan(event.target.value)}
                  disabled={plansPending}
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-rose-100"
                >
                  <option value="">Link a plan later</option>
                  {activePlans.map((plan: TreatmentPlanOut) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.plan_name} · {plan.completed_sessions}/{plan.total_sessions} sessions
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  Only your own active plans for this patient are shown.
                </p>
              </section>
            )}

            <section className="space-y-1.5">
              <label htmlFor="appointment-reception-notes" className="block text-xs font-semibold text-slate-700">
                Reception remarks (optional)
              </label>
              <textarea
                id="appointment-reception-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={2}
                placeholder="Administrative note for the reception queue…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-rose-100"
              />
              <p className="text-xs text-slate-500">Do not enter diagnosis or confidential clinical notes here.</p>
            </section>

            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-5 text-slate-600">
              <strong className="text-slate-800">Token allocation:</strong> a token is reserved for this doctor and date when the booking is saved. Scheduled visits are date-based; no exact consultation time is reserved.
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="min-h-11 rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookMutation.isPending || !selectedPatient || !selectedDoctorId || doctorsPending}
                className="min-h-11 rounded-lg bg-[#5D0B26] px-6 text-sm font-semibold text-white hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bookMutation.isPending
                  ? 'Saving booking…'
                  : bookingMode === 'WALK_IN'
                    ? 'Add to Today’s Token Queue'
                    : 'Reserve Future Visit Date'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
