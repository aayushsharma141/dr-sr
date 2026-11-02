import { useEffect, useState } from 'react'
import { useDoctors, usePatients, useBookAppointment } from '../api/queries'
import type {
  Appointment,
  AppointmentBookingMode,
  AppointmentVisitType,
  PatientOut,
} from '../api/types'

interface AppointmentBookingModalProps {
  isOpen: boolean
  onClose: () => void
  initialPatient?: PatientOut | null
  initialDoctorId?: number
  lockDoctorSelection?: boolean
  initialDate?: string
  initialMode?: AppointmentBookingMode
  onSuccess?: () => void
}

function clinicToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function clinicDateAfter(days: number) {
  const [year, month, day] = clinicToday().split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

const VISIT_TYPES: { value: AppointmentVisitType; label: string; description: string }[] = [
  {
    value: 'NEW_CONSULTATION',
    label: 'New consultation',
    description: 'First visit or a new problem',
  },
  {
    value: 'FOLLOW_UP',
    label: 'Follow-up review',
    description: 'Return visit requested by the treating clinician',
  },
  {
    value: 'PHYSIOTHERAPY_SESSION',
    label: 'Physiotherapy visit',
    description: 'Administrative booking for an existing or planned therapy visit',
  },
  {
    value: 'REVIEW',
    label: 'Progress review',
    description: 'Review of progress or reassessment',
  },
]

export function AppointmentBookingModal({
  isOpen,
  onClose,
  initialPatient,
  initialDoctorId,
  lockDoctorSelection = false,
  initialDate,
  initialMode = 'WALK_IN',
  onSuccess,
}: AppointmentBookingModalProps) {
  const [bookingMode, setBookingMode] = useState<AppointmentBookingMode>(initialMode)
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(initialPatient ?? null)
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | ''>(initialDoctorId ?? '')
  const [appointmentDate, setAppointmentDate] = useState(clinicToday())
  const [visitType, setVisitType] = useState<AppointmentVisitType>('NEW_CONSULTATION')
  const [notes, setNotes] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Appointment | null>(null)

  const today = clinicToday()
  const searchQuery = patientSearch.trim()
  const { data: doctors, isPending: doctorsPending } = useDoctors(true)
  const { data: searchResults, isPending: isSearching } = usePatients(
    searchQuery,
    5,
    0,
    { activeOnly: true, enabled: isOpen && searchQuery.length >= 2 },
  )
  const bookMutation = useBookAppointment()

  useEffect(() => {
    if (!isOpen) return

    const mode = initialMode
    const currentClinicDate = clinicToday()
    setBookingMode(mode)
    setPatientSearch('')
    setSelectedPatient(initialPatient ?? null)
    setSelectedDoctorId(initialDoctorId ?? '')
    setAppointmentDate(
      mode === 'SCHEDULED'
        ? initialDate && initialDate >= currentClinicDate
          ? initialDate
          : clinicDateAfter(1)
        : currentClinicDate,
    )
    setVisitType('NEW_CONSULTATION')
    setNotes('')
    setErrorMsg(null)
    setConfirmation(null)
  }, [isOpen, initialPatient, initialDoctorId, initialDate, initialMode])

  if (!isOpen) return null

  const handleClose = () => {
    setErrorMsg(null)
    setConfirmation(null)
    onClose()
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setErrorMsg(null)

    if (!selectedPatient) {
      setErrorMsg('Search and select an active patient before continuing.')
      return
    }
    if (!selectedDoctorId) {
      setErrorMsg('Select the consulting doctor.')
      return
    }
    if (bookingMode === 'WALK_IN' && appointmentDate !== today) {
      setErrorMsg('Walk-in tokens can only be added to today’s clinic queue.')
      return
    }
    if (bookingMode === 'SCHEDULED' && appointmentDate < today) {
      setErrorMsg('Choose today or a future clinic date.')
      return
    }

    try {
      const result = await bookMutation.mutateAsync({
        patient_id: selectedPatient.id,
        doctor_id: Number(selectedDoctorId),
        appointment_date: appointmentDate,
        booking_mode: bookingMode,
        visit_type: visitType,
        notes: notes.trim() || null,
      })
      setConfirmation(result)
      onSuccess?.()
    } catch (error: unknown) {
      setErrorMsg(error instanceof Error ? error.message : 'Unable to create the booking.')
    }
  }

  const modeIsWalkIn = bookingMode === 'WALK_IN'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3 sm:p-5">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-booking-title"
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[#8E1C3D]">
              Reception · Appointment desk
            </p>
            <h2 id="appointment-booking-title" className="mt-1 text-lg font-bold text-slate-900">
              {confirmation
                ? 'Booking confirmed'
                : modeIsWalkIn
                  ? 'Add walk-in token'
                  : 'Schedule future visit'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {confirmation
                ? 'The booking has been saved to the clinic record.'
                : 'Select the visit mode first, then confirm the patient and doctor.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close appointment booking"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
          >
            ×
          </button>
        </header>

        {confirmation ? (
          <div className="overflow-y-auto px-5 py-6 sm:px-6">
            <div className="mx-auto max-w-md space-y-5 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="m5 12 4 4L19 6" />
                </svg>
              </div>
              <div>
                <h3 className="text-xl font-bold text-slate-900">
                  {confirmation.booking_mode === 'WALK_IN' ? 'Added to today’s queue' : 'Future visit scheduled'}
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {confirmation.patient_name} · {confirmation.patient_urn}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 text-left">
                <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-sm">
                  <dt className="text-slate-500">Doctor</dt>
                  <dd className="font-semibold text-slate-900">{confirmation.doctor_name_en}</dd>
                  <dt className="text-slate-500">Visit</dt>
                  <dd className="font-semibold text-slate-900">
                    {VISIT_TYPES.find((type) => type.value === confirmation.visit_type)?.label ?? 'Visit'}
                  </dd>
                  <dt className="text-slate-500">Clinic date</dt>
                  <dd className="font-semibold text-slate-900">{confirmation.appointment_date}</dd>
                  <dt className="text-slate-500">Booking mode</dt>
                  <dd className="font-semibold text-slate-900">
                    {confirmation.booking_mode === 'WALK_IN' ? 'Walk-in' : 'Scheduled visit'}
                  </dd>
                </dl>
                {confirmation.token_number !== null ? (
                  <div className="mt-4 rounded-lg border border-emerald-200 bg-white p-4 text-center">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">Daily token allocated</p>
                    <p className="mt-1 text-4xl font-extrabold text-[#5D0B26]">#{confirmation.token_number}</p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-4">
                    <p className="font-semibold text-blue-950">No token allocated yet</p>
                    <p className="mt-1 text-sm text-blue-900">
                      This is a date-based booking with no fixed time. Reception will allocate the daily token when the patient arrives on the booked date.
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-[#5D0B26] px-5 text-sm font-semibold text-white hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
              {errorMsg && (
                <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                  {errorMsg}
                </div>
              )}

              <fieldset className="space-y-2">
                <legend className="text-sm font-bold text-slate-900">1. Choose visit mode</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    aria-pressed={modeIsWalkIn}
                    onClick={() => {
                      setBookingMode('WALK_IN')
                      setAppointmentDate(today)
                      setErrorMsg(null)
                    }}
                    className={[
                      'min-h-[76px] rounded-xl border p-3 text-left transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                      modeIsWalkIn ? 'border-[#8E1C3D] bg-rose-50 ring-1 ring-[#8E1C3D]' : 'border-slate-200 hover:border-slate-400',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-bold text-slate-900">Walk-in · Today’s token</span>
                    <span className="mt-1 block text-xs text-slate-600">Patient is coming to the clinic today. Token allocated now.</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={!modeIsWalkIn}
                    onClick={() => {
                      setBookingMode('SCHEDULED')
                      setAppointmentDate((current) => current > today ? current : clinicDateAfter(1))
                      setErrorMsg(null)
                    }}
                    className={[
                      'min-h-[76px] rounded-xl border p-3 text-left transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]',
                      !modeIsWalkIn ? 'border-[#8E1C3D] bg-rose-50 ring-1 ring-[#8E1C3D]' : 'border-slate-200 hover:border-slate-400',
                    ].join(' ')}
                  >
                    <span className="block text-sm font-bold text-slate-900">Schedule a future visit</span>
                    <span className="mt-1 block text-xs text-slate-600">Reserve a clinic date. Token allocated when the patient arrives.</span>
                  </button>
                </div>
              </fieldset>

              <section className="space-y-2" aria-labelledby="booking-patient-heading">
                <h3 id="booking-patient-heading" className="text-sm font-bold text-slate-900">2. Select patient</h3>
                {selectedPatient ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-900">{selectedPatient.full_name}</p>
                      <p className="mt-0.5 text-xs font-medium text-[#5D0B26]">{selectedPatient.urn}</p>
                      <p className="mt-1 text-xs text-slate-600">
                        {selectedPatient.mobile} · {selectedPatient.age_years} years
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatient(null)
                        setPatientSearch('')
                      }}
                      className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
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
                      placeholder="Enter at least 2 characters: name, URN or mobile"
                      className="min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-[#8E1C3D] focus:ring-2 focus:ring-[#8E1C3D]/15"
                    />
                    {searchQuery.length < 2 ? (
                      <p className="text-xs text-slate-500">Search starts after two characters. No patient records are loaded in advance.</p>
                    ) : isSearching ? (
                      <p role="status" className="text-xs text-slate-500">Searching active patient records…</p>
                    ) : searchResults && searchResults.length > 0 ? (
                      <div role="listbox" aria-label="Matching active patients" className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                        {searchResults.map((patient) => (
                          <button
                            key={patient.id}
                            type="button"
                            role="option"
                            aria-selected={false}
                            onClick={() => {
                              setSelectedPatient(patient)
                              setPatientSearch('')
                            }}
                            className="flex min-h-14 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-[#8E1C3D]"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-semibold text-slate-900">{patient.full_name}</span>
                              <span className="mt-0.5 block text-xs text-slate-500">{patient.urn} · {patient.mobile}</span>
                            </span>
                            <span className="shrink-0 text-xs font-semibold text-[#5D0B26]">Select</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-600">
                        No active patient matched this search. Verify the spelling or register the patient first.
                      </p>
                    )}
                  </div>
                )}
              </section>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="appointment-visit-type" className="block text-sm font-bold text-slate-900">3. Visit category</label>
                  <select
                    id="appointment-visit-type"
                    value={visitType}
                    onChange={(event) => setVisitType(event.target.value as AppointmentVisitType)}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#8E1C3D] focus:ring-2 focus:ring-[#8E1C3D]/15"
                  >
                    {VISIT_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>{type.label}</option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    {VISIT_TYPES.find((type) => type.value === visitType)?.description}
                  </p>
                </div>
                <div className="space-y-2">
                  <label htmlFor="appointment-doctor" className="block text-sm font-bold text-slate-900">4. Consulting doctor</label>
                  <select
                    id="appointment-doctor"
                    value={selectedDoctorId}
                    onChange={(event) => setSelectedDoctorId(event.target.value ? Number(event.target.value) : '')}
                    required
                    disabled={lockDoctorSelection}
                    className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#8E1C3D] focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    <option value="">{doctorsPending ? 'Loading doctors…' : '-- Select doctor --'}</option>
                    {doctors?.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name_en}{doctor.name_hi ? ` · ${doctor.name_hi}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <section className="space-y-2" aria-labelledby="appointment-date-heading">
                <h3 id="appointment-date-heading" className="text-sm font-bold text-slate-900">5. Clinic date</h3>
                <input
                  aria-label="Clinic date"
                  type="date"
                  value={modeIsWalkIn ? today : appointmentDate}
                  min={today}
                  max={modeIsWalkIn ? today : undefined}
                  disabled={modeIsWalkIn}
                  onChange={(event) => setAppointmentDate(event.target.value)}
                  required
                  className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#8E1C3D] focus:ring-2 focus:ring-[#8E1C3D]/15 disabled:bg-slate-100 disabled:text-slate-600 sm:max-w-xs"
                />
                {modeIsWalkIn ? (
                  <p className="text-xs text-emerald-800">Walk-in tokens always join today’s clinic queue ({today}, IST).</p>
                ) : (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-950">
                    <p className="font-semibold">Date-based booking · no fixed time</p>
                    <p className="mt-1 text-xs text-blue-900">
                      The clinic has not configured doctor time slots yet. This reserves the date only; reception allocates a daily token when the patient arrives on that date.
                    </p>
                  </div>
                )}
              </section>

              <div className="space-y-2">
                <label htmlFor="appointment-reception-notes" className="block text-sm font-bold text-slate-900">6. Reception remarks <span className="font-normal text-slate-500">(optional)</span></label>
                <textarea
                  id="appointment-reception-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  maxLength={1000}
                  rows={2}
                  placeholder="Administrative note for the reception team…"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8E1C3D] focus:ring-2 focus:ring-[#8E1C3D]/15"
                />
                <p className="text-xs text-slate-500">Do not enter diagnosis or clinical notes here.</p>
              </div>
            </div>

            <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              <button
                type="button"
                onClick={handleClose}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={bookMutation.isPending || !selectedPatient || !selectedDoctorId || doctorsPending}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#5D0B26] px-5 text-sm font-semibold text-white hover:bg-[#4A081E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bookMutation.isPending
                  ? 'Saving booking…'
                  : modeIsWalkIn
                    ? 'Add to today’s queue & allocate token'
                    : 'Confirm scheduled visit'}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
