import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { AppShell } from '../components/AppShell'
import { QueueTicketPreview } from '../components/QueueTicketPreview'
import {
  usePatients,
  useDepartments,
  useDepartmentDoctors,
  useAppointments,
  useWalkIn,
  useCheckIn,
  useMe,
} from '../api/queries'
import { ApiError } from '../api/client'
import {
  IconCalendar,
  IconCheck,
  IconRefresh,
  IconSearch,
  IconStethoscope,
  IconTicket,
  IconUser,
  IconUserCheck,
  IconUserPlus,
  IconWalk,
  IconX,
} from '../components/icons'
import type { PatientOut, DepartmentDoctorOut } from '../api/types'
import { formatToken, istToday } from '../format'

export function TokenGenerationPage() {
  const { data: me } = useMe()
  const navigate = useNavigate()

  // State
  const [patientMode, setPatientMode] = useState<'existing' | 'new'>('existing')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(null)

  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | ''>('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | ''>('')
  // null follows the patient: "booked" when they have a booking waiting today, else a walk-in.
  const [visitTypeChoice, setVisitTypeChoice] = useState<'walk-in' | 'booked' | null>(null)
  const [selectedBookingId, setSelectedBookingId] = useState<number | null>(null)
  const [remarks, setRemarks] = useState('')

  const [generatedTicket, setGeneratedTicket] = useState<{
    tokenLabel: string
    departmentName: string
    doctorName: string
    patientName: string
    patientUrn: string
    date: string
  } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  // Set when a walk-in was refused because the patient already has a booking with that doctor.
  const [hasDuplicateBooking, setHasDuplicateBooking] = useState(false)

  const today = istToday()

  // API Queries
  const { data: searchResults, isPending: isSearching } = usePatients(searchQuery, 8, 0)
  const { data: departments } = useDepartments()
  const { data: patientBookingsData } = useAppointments(
    { appointment_date: today, patient_id: selectedPatient?.id },
    { enabled: selectedPatient != null },
  )

  // Bookings for today that are still waiting for their patient. A patient marked "not arrived"
  // who turns up late can still be checked in, so those count too.
  const bookings = useMemo(
    () =>
      (patientBookingsData?.appointments ?? []).filter(
        (a) =>
          a.patient_id === selectedPatient?.id && (a.status === 'BOOKED' || a.status === 'NO_SHOW'),
      ),
    [patientBookingsData, selectedPatient],
  )
  const visitType = visitTypeChoice ?? (bookings.length > 0 ? 'booked' : 'walk-in')
  const selectedBooking =
    visitType === 'booked'
      ? (bookings.find((b) => b.id === selectedBookingId) ??
        (bookings.length === 1 ? bookings[0] : null))
      : null

  // The department and doctor come from the chosen booking, or from the selects for a walk-in.
  const activeDepartmentId = selectedBooking
    ? (selectedBooking.department_id ?? null)
    : selectedDepartmentId
      ? Number(selectedDepartmentId)
      : null
  const activeDoctorId = selectedBooking
    ? selectedBooking.doctor_id
    : selectedDoctorId
      ? Number(selectedDoctorId)
      : null
  const { data: departmentDoctors } = useDepartmentDoctors(activeDepartmentId)

  const selectedDepartment = useMemo(() => {
    return departments?.find((d) => d.id === activeDepartmentId)
  }, [departments, activeDepartmentId])
  const selectedDoctor = useMemo(() => {
    return departmentDoctors?.find((d: DepartmentDoctorOut) => d.id === activeDoctorId)
  }, [departmentDoctors, activeDoctorId])
  const cabinCode = selectedDoctor?.cabin_code ?? undefined

  // Today's appointments for the doctor, to show who is waiting and which token comes next.
  const { data: appointmentsData } = useAppointments(
    { appointment_date: today, doctor_id: activeDoctorId ?? undefined },
    { enabled: activeDoctorId != null },
  )

  const queueStats = useMemo(() => {
    const list = appointmentsData?.appointments || []
    const waiting = list.filter((a) =>
      a.consultation_status ? a.consultation_status === 'WAITING' : a.status === 'ARRIVED',
    ).length
    // Tokens are issued at check-in, one after another, so the next one follows the highest so far.
    const nextTokenNum = Math.max(0, ...list.map((a) => a.token_number ?? 0)) + 1
    return {
      waiting,
      nextTokenNum,
    }
  }, [appointmentsData])

  // Mutations
  const walkInMutation = useWalkIn()
  const checkInMutation = useCheckIn()
  const isIssuing = walkInMutation.isPending || checkInMutation.isPending

  // Token letter prefix (e.g. 'P' for Physiotherapy, 'O' for Ophthalmology, 'G' for General)
  const tokenPrefix = useMemo(() => {
    if (!selectedDepartment) return 'G'
    return selectedDepartment.name_en.charAt(0).toUpperCase()
  }, [selectedDepartment])

  // A booking that already holds a token keeps it; anything else gets the next one.
  const previewTokenNumber = selectedBooking?.token_number ?? queueStats.nextTokenNum

  const handleSelectPatient = (patient: PatientOut) => {
    setSelectedPatient(patient)
    setSearchQuery('')
    // A new patient has their own bookings, so start from what they have today.
    setVisitTypeChoice(null)
    setSelectedBookingId(null)
    setHasDuplicateBooking(false)
    setErrorMsg(null)
  }

  const handleClear = () => {
    setSelectedPatient(null)
    setSearchQuery('')
    setSelectedDepartmentId('')
    setSelectedDoctorId('')
    setVisitTypeChoice(null)
    setSelectedBookingId(null)
    setRemarks('')
    setErrorMsg(null)
    setHasDuplicateBooking(false)
    setGeneratedTicket(null)
  }

  // Check a booked patient in, or register a walk-in. Either one issues the token, opens or joins
  // the patient's visit and puts them in the doctor's waiting list, all or nothing: when the
  // server refuses, no token was issued and nothing was booked. No payment is taken here.
  const handleIssueToken = async () => {
    setErrorMsg(null)
    setHasDuplicateBooking(false)
    if (!selectedPatient) {
      setErrorMsg('Please select a patient or switch to New Patient.')
      return
    }

    try {
      let issued
      if (visitType === 'booked') {
        if (!selectedBooking) {
          setErrorMsg("Please choose which of today's bookings to check in.")
          return
        }
        issued = await checkInMutation.mutateAsync({
          id: selectedBooking.id,
          body: { version_id: selectedBooking.version_id },
        })
      } else {
        if (!selectedDepartmentId) {
          setErrorMsg('Please select a hospital department.')
          return
        }
        if (!selectedDoctorId) {
          setErrorMsg('Please select a consulting doctor.')
          return
        }
        issued = await walkInMutation.mutateAsync({
          patient_id: selectedPatient.id,
          department_id: Number(selectedDepartmentId),
          doctor_id: Number(selectedDoctorId),
          notes: remarks.trim() || null,
        })
      }

      setGeneratedTicket({
        tokenLabel: formatToken(issued.token_number, cabinCode),
        departmentName: selectedDepartment?.name_en || 'Consultation',
        doctorName: selectedDoctor?.name_en || 'Clinician',
        patientName: selectedPatient.full_name,
        patientUrn: selectedPatient.urn,
        date: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
      })
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'duplicate_appointment') {
        setHasDuplicateBooking(true)
        setErrorMsg('This patient already has a booking with this doctor today.')
      } else if (err instanceof Error) {
        setErrorMsg(err.message)
      } else {
        setErrorMsg('Failed to issue the token.')
      }
    }
  }

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="w-full space-y-5">
        {/* Top Header & Subtitle matching Mock 2 */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs shrink-0">
              <IconTicket className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Token Desk
              </h1>
              <p className="text-xs text-slate-500">
                Check a patient in: pick a booking for today, or register a walk-in, and issue the queue token.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              to="/reception/patients/new"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconUserPlus className="h-4 w-4 text-emerald-800" />
              New Patient Registration
            </Link>
            <Link
              to="/reception/appointments?tab=today"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconCalendar className="h-4 w-4 text-slate-500" />
              Today&apos;s OPD Queue
            </Link>
          </div>
        </div>

        {/* Success Modal / Banner when Token is generated */}
        {generatedTicket && (
          <div
            role="status"
            className="rounded-2xl border border-emerald-300 bg-emerald-50/90 p-6 text-emerald-950 shadow-sm space-y-4"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-600 text-white font-bold">
                  <IconCheck className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-emerald-950">
                    Token Allocated Successfully!
                  </h3>
                  <p className="text-xs text-emerald-800">
                    Patient <span className="font-semibold">{generatedTicket.patientName}</span> ({generatedTicket.patientUrn}) is placed in{' '}
                    <span className="font-semibold">{generatedTicket.doctorName}&apos;s</span> queue.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-300 bg-white px-5 py-3 text-center shadow-xs">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Daily Token
                </span>
                <div className="font-mono text-3xl font-black text-emerald-800">
                  {generatedTicket.tokenLabel}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-emerald-200">
              <Link
                to="/reception/appointments?tab=today"
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-4 text-xs font-bold text-white hover:bg-emerald-900 shadow-xs"
              >
                Open Today&apos;s Token Queue
              </Link>
              <button
                type="button"
                onClick={() => {
                  setGeneratedTicket(null)
                  handleClear()
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Register Next Patient
              </button>
            </div>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900 shadow-xs"
          >
            <span>{errorMsg}</span>
            {hasDuplicateBooking && (
              <button
                type="button"
                onClick={() => {
                  setVisitTypeChoice('booked')
                  setErrorMsg(null)
                  setHasDuplicateBooking(false)
                }}
                className="inline-flex min-h-9 items-center rounded-lg border border-red-300 bg-white px-3 text-xs font-bold text-red-900 hover:bg-red-100"
              >
                Check in their booking instead
              </button>
            )}
          </div>
        )}

        {/* 3-Column Cockpit matching Mock 2 */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* COLUMN 1: Patient (lg:col-span-4) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <IconUser className="h-5 w-5 text-emerald-800" />
                <h2 className="text-base font-bold text-slate-900">Patient</h2>
              </div>

              {/* Segmented Tab: Existing Patient vs New Patient */}
              <div className="flex rounded-xl border border-slate-300 bg-slate-100/70 p-1 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setPatientMode('existing')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${patientMode === 'existing'
                      ? 'border border-emerald-300 bg-[#124832] text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <IconSearch className="h-3.5 w-3.5" />
                  Existing Patient
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/reception/patients/new')}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-all"
                >
                  <IconUserPlus className="h-3.5 w-3.5 text-slate-500" />
                  New Patient
                </button>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                  <IconSearch className="h-4 w-4" />
                </div>
                <input
                  type="text"
                  aria-label="Search patient by Name, Mobile or Patient ID"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by Name, Mobile or Patient ID (URN)"
                  className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-9 py-2.5 text-xs font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-500 hover:text-slate-700"
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Autocomplete Search Dropdown */}
              {searchQuery.trim().length >= 2 && (
                <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100">
                  {isSearching ? (
                    <div className="p-3 text-center text-xs text-slate-500">Searching patients...</div>
                  ) : searchResults && searchResults.length > 0 ? (
                    searchResults.map((patient: PatientOut) => (
                      <button
                        key={patient.id}
                        type="button"
                        onClick={() => handleSelectPatient(patient)}
                        className="w-full p-2.5 text-left text-xs hover:bg-emerald-50/60 cursor-pointer flex items-center justify-between transition-colors"
                      >
                        <div>
                          <div className="font-bold text-slate-900">{patient.full_name}</div>
                          <div className="font-mono text-xs text-emerald-800">{patient.urn}</div>
                        </div>
                        <div className="text-right text-xs text-slate-500 font-mono">
                          {patient.mobile}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-500">No matching patients found.</div>
                  )}
                </div>
              )}

              {/* Selected Patient Card matching Mock 2 */}
              {selectedPatient ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3 shadow-2xs">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 font-bold">
                        <IconUser className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-slate-900 text-sm">
                            {selectedPatient.full_name}
                          </h4>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                            Existing
                          </span>
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-600 block mt-0.5">
                          {selectedPatient.urn}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-600 border-t border-slate-200/70 pt-2">
                    <span>
                      {selectedPatient.age_years} Years &bull;{' '}
                      {selectedPatient.gender === 'M' ? 'Male' : selectedPatient.gender === 'F' ? 'Female' : 'Other'}
                    </span>
                    <span className="font-mono font-medium text-slate-700">{selectedPatient.mobile}</span>
                  </div>

                  <div className="flex justify-end pt-1">
                    <Link
                      to={`/reception/patients/${selectedPatient.id}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <IconUser className="h-3.5 w-3.5 text-slate-500" />
                      View Profile
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-500">
                  Select an existing patient by searching above, or click New Patient.
                </div>
              )}
            </div>
          </section>

          {/* COLUMN 2: Visit Details (lg:col-span-4) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <IconCalendar className="h-5 w-5 text-emerald-800" />
              <h2 className="text-base font-bold text-slate-900">Visit Details</h2>
            </div>

            {/* Visit Type */}
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                Visit Type *
              </span>
              <div className="flex rounded-xl border border-slate-300 bg-slate-100/70 p-1 shadow-2xs">
                <button
                  type="button"
                  aria-pressed={visitType === 'walk-in'}
                  onClick={() => setVisitTypeChoice('walk-in')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${visitType === 'walk-in'
                      ? 'border border-emerald-300 bg-white text-emerald-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <IconWalk className="h-4 w-4 text-emerald-700" />
                  Walk-in
                </button>
                <button
                  type="button"
                  aria-pressed={visitType === 'booked'}
                  onClick={() => setVisitTypeChoice('booked')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${visitType === 'booked'
                      ? 'border border-emerald-300 bg-white text-emerald-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                    }`}
                >
                  <IconCalendar className="h-4 w-4 text-slate-500" />
                  Booked appointment
                  {bookings.length > 0 && (
                    <span className="rounded-full bg-emerald-100 px-1.5 text-xs text-emerald-800">
                      {bookings.length}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {visitType === 'booked' ? (
              /* A booking made earlier, waiting for its patient */
              <fieldset>
                <legend className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                  Booking to check in *
                </legend>
                {!selectedPatient ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                    Select a patient to see their bookings for today.
                  </p>
                ) : bookings.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                    No booking for today. Switch to Walk-in to register one.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {bookings.map((booking) => (
                      <li key={booking.id}>
                        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-300 bg-white p-3 text-xs shadow-2xs has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50/60">
                          <input
                            type="radio"
                            name="booking-to-check-in"
                            checked={selectedBooking?.id === booking.id}
                            onChange={() => setSelectedBookingId(booking.id)}
                            className="h-4 w-4 accent-emerald-800"
                          />
                          <span className="flex-1">
                            <span className="block font-bold text-slate-900">
                              {booking.doctor_name_en}
                            </span>
                            <span className="block text-slate-500">
                              {booking.expected_time
                                ? `Expected ${booking.expected_time.slice(0, 5)}`
                                : 'No time given'}
                              {booking.status === 'NO_SHOW' ? ' · marked not arrived, late' : ''}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>
            ) : (
              <>
                {/* Department Select */}
                <div>
                  <label
                    htmlFor="token-department"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                  >
                    Department *
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                      <IconStethoscope className="h-4 w-4" />
                    </div>
                    <select
                      id="token-department"
                      value={selectedDepartmentId}
                      onChange={(e) => {
                        setSelectedDepartmentId(e.target.value ? Number(e.target.value) : '')
                        setSelectedDoctorId('')
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                    >
                      <option value="">Select department</option>
                      {departments?.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Doctor Select */}
                <div>
                  <label
                    htmlFor="token-doctor"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                  >
                    Doctor *
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                      <IconUserCheck className="h-4 w-4" />
                    </div>
                    <select
                      id="token-doctor"
                      value={selectedDoctorId}
                      onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : '')}
                      disabled={!selectedDepartmentId}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px] disabled:bg-slate-100"
                    >
                      <option value="">Select doctor</option>
                      {departmentDoctors?.map((d: DepartmentDoctorOut) => (
                        <option key={d.id} value={d.id}>
                          {d.name_en} - {d.qualification || 'Clinician'}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Payment is not taken here: it is collected at checkout, after the consultation. */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 flex items-start gap-2">
              <span className="font-bold text-blue-700 mt-0.5">ⓘ</span>
              <span>
                No payment is taken here. Fees are collected at checkout, after the consultation.
                {selectedDoctor
                  ? ` Consultation fee: ₹${(selectedDoctor.default_fee_paise / 100).toFixed(2)}.`
                  : ''}
              </span>
            </div>

            {/* Remarks (a walk-in only: a booking already has its own notes) */}
            {visitType === 'walk-in' && (
              <div>
                <label
                  htmlFor="visit-remarks"
                  className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                >
                  Remarks (optional)
                </label>
                <textarea
                  id="visit-remarks"
                  rows={2}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Any specific note (e.g. referral, priority, etc.)"
                  className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                />
              </div>
            )}
          </section>

          {/* COLUMN 3: Token Preview (lg:col-span-4) */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs lg:col-span-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
              <IconTicket className="h-5 w-5 text-emerald-800" />
              <div>
                <h2 className="text-base font-bold text-slate-900">Token Preview</h2>
                <p className="text-xs text-slate-500">
                  This token is issued when the patient is checked in.
                </p>
              </div>
            </div>

            <QueueTicketPreview
              departmentName={selectedDepartment?.name_en || 'Select department'}
              doctorName={selectedDoctor?.name_en || 'Select doctor'}
              tokenPrefix={tokenPrefix}
              tokenNumber={
                activeDoctorId == null
                  ? null
                  : cabinCode
                    ? formatToken(previewTokenNumber, cabinCode)
                    : previewTokenNumber
              }
              patientName={selectedPatient?.full_name || 'No patient selected'}
              patientUrn={selectedPatient?.urn || 'KH-YYYY-XXXX'}
              cabinCode={cabinCode}
              waitingCount={queueStats.waiting}
            />
          </section>
        </div>

        {/* BOTTOM ACTION BAR matching Mock 2 */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <button
            type="button"
            onClick={() => navigate('/reception/appointments')}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <IconTicket className="h-4 w-4 text-emerald-800" />
            View Waiting Queue
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleClear}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <IconRefresh className="h-4 w-4 text-slate-500" />
              Clear
            </button>

            <button
              type="button"
              onClick={handleIssueToken}
              disabled={
                isIssuing || !selectedPatient || (visitType === 'booked' ? !selectedBooking : !selectedDoctorId)
              }
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#124832] px-6 text-sm font-bold text-white shadow-xs hover:bg-[#0D3822] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50 cursor-pointer"
            >
              <IconTicket className="h-4 w-4" />
              {isIssuing
                ? 'Issuing...'
                : visitType === 'booked'
                  ? 'Check In & Issue Token'
                  : 'Register Walk-in & Issue Token'}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
export default TokenGenerationPage
