import { useState, type FormEvent, useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  useRegisterPatient,
  useUploadPatientPhoto,
  useCheckDuplicate,
  useMe,
  useDepartments,
  useDepartmentDoctors,
  useBookAppointment,
  useUpdateAppointmentStatus,
} from '../api/queries'
import { ApiError } from '../api/client'
import { AppShell } from '../components/AppShell'
import { QueueTicketPreview } from '../components/QueueTicketPreview'
import { UnsavedChangesGuard } from '../components/UnsavedChangesGuard'
import {
  IconCamera,
  IconCalendar,
  IconCheck,
  IconDeviceFloppy,
  IconMapPin,
  IconNotes,
  IconPhone,
  IconRefresh,
  IconStethoscope,
  IconTicket,
  IconTrash,
  IconUser,
  IconUserCheck,
  IconUserPlus,
  IconWalk,
} from '../components/icons'
import type { PatientCreate, PatientOut, DepartmentDoctorOut } from '../api/types'
import { istToday } from '../format'

export function PatientRegister() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const registerMutation = useRegisterPatient()
  const uploadPhotoMutation = useUploadPatientPhoto()
  const bookAppointmentMutation = useBookAppointment()
  const updateStatusMutation = useUpdateAppointmentStatus()

  // 12 Canonical demographic fields
  const [fullName, setFullName] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | 'O'>('M')
  const [dob, setDob] = useState('')
  const [ageYears, setAgeYears] = useState<number | ''>('')
  const [mobile, setMobile] = useState('')
  const [address, setAddress] = useState('')
  const [district, setDistrict] = useState('Bhojpur')
  const [state, setState] = useState('Bihar')
  const [emergencyContact, setEmergencyContact] = useState('')
  const [allergies, setAllergies] = useState('None reported')
  const [notes, setNotes] = useState('')

  // Optional Visit & Token fields
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number | ''>('')
  const [selectedDoctorId, setSelectedDoctorId] = useState<number | ''>('')
  const [visitType, setVisitType] = useState<'walk-in' | 'appointment'>('walk-in')
  const [reasonForVisit, setReasonForVisit] = useState('')

  // Photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)

  // Options & Flags
  const [saveAndAddAnother, setSaveAndAddAnother] = useState(false)

  // Duplicate warning & confirmation
  const [debouncedName, setDebouncedName] = useState('')
  const [debouncedMobile, setDebouncedMobile] = useState('')
  const [confirmDifferentPatient, setConfirmDifferentPatient] = useState(false)

  // Feedback states
  const [createdPatient, setCreatedPatient] = useState<PatientOut | null>(null)
  const [allocatedToken, setAllocatedToken] = useState<number | null>(null)
  const [quickSuccessNotice, setQuickSuccessNotice] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // Steps after the patient record was saved that did not complete (photo, visit, check-in).
  const [registrationWarnings, setRegistrationWarnings] = useState<string[]>([])
  const [photoFailure, setPhotoFailure] = useState<{ patientId: number; fileName: string; message: string } | null>(null)
  const [photoRetrying, setPhotoRetrying] = useState(false)
  const [photoSavedNotice, setPhotoSavedNotice] = useState<string | null>(null)
  const [checkedIn, setCheckedIn] = useState(false)
  // Blocks a second submit while one is in flight (double-click, Enter key repeat).
  const submittingRef = useRef(false)
  // Set just before a deliberate post-registration navigation.
  const skipUnsavedGuardRef = useRef(false)

  // Anything typed into the form means leaving now would lose work.
  const isDirty = useMemo(
    () =>
      Boolean(
        fullName.trim() ||
          guardianName.trim() ||
          gender !== 'M' ||
          dob ||
          ageYears !== '' ||
          mobile.trim() ||
          address.trim() ||
          district.trim() !== 'Bhojpur' ||
          state.trim() !== 'Bihar' ||
          emergencyContact.trim() ||
          allergies.trim() !== 'None reported' ||
          notes.trim() ||
          selectedDepartmentId !== '' ||
          selectedDoctorId !== '' ||
          visitType !== 'walk-in' ||
          reasonForVisit.trim() ||
          photoFile,
      ),
    [
      fullName,
      guardianName,
      gender,
      dob,
      ageYears,
      mobile,
      address,
      district,
      state,
      emergencyContact,
      allergies,
      notes,
      selectedDepartmentId,
      selectedDoctorId,
      visitType,
      reasonForVisit,
      photoFile,
    ],
  )

  // Queries for departments & doctors
  const { data: departments } = useDepartments()
  const { data: departmentDoctors } = useDepartmentDoctors(
    selectedDepartmentId ? Number(selectedDepartmentId) : null,
  )

  const selectedDepartment = useMemo(() => {
    return departments?.find((d) => d.id === Number(selectedDepartmentId))
  }, [departments, selectedDepartmentId])

  const selectedDoctor = useMemo(() => {
    return departmentDoctors?.find((d: DepartmentDoctorOut) => d.id === Number(selectedDoctorId))
  }, [departmentDoctors, selectedDoctorId])

  const tokenPrefix = useMemo(() => {
    if (!selectedDepartment) return 'G'
    return selectedDepartment.name_en.charAt(0).toUpperCase()
  }, [selectedDepartment])

  // Debounce duplicate check
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedName(fullName.trim())
      setDebouncedMobile(mobile.trim())
    }, 300)
    return () => clearTimeout(handler)
  }, [fullName, mobile])

  const { data: duplicateData, isFetching: duplicateChecking } = useCheckDuplicate(
    debouncedName,
    debouncedMobile,
    debouncedName.length >= 2 && debouncedMobile.length >= 10,
  )

  const isDuplicateDetected = Boolean(duplicateData?.has_duplicate)

  // Auto-calculate age from DOB if supplied
  const handleDobChange = (value: string) => {
    setDob(value)
    if (value) {
      const birthDate = new Date(value)
      if (!isNaN(birthDate.getTime())) {
        const today = new Date()
        let age = today.getFullYear() - birthDate.getFullYear()
        const m = today.getMonth() - birthDate.getMonth()
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
          age--
        }
        if (age >= 0) {
          setAgeYears(age)
        }
      }
    }
  }

  // Handle Photo Picker
  const handlePhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setPhotoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemovePhoto = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Reset entire form
  const handleClear = () => {
    setRegistrationWarnings([])
    setPhotoFailure(null)
    setPhotoSavedNotice(null)
    setCheckedIn(false)
    setFullName('')
    setGuardianName('')
    setGender('M')
    setDob('')
    setAgeYears('')
    setMobile('')
    setAddress('')
    setDistrict('Bhojpur')
    setState('Bihar')
    setEmergencyContact('')
    setAllergies('None reported')
    setNotes('')
    setSelectedDepartmentId('')
    setSelectedDoctorId('')
    setVisitType('walk-in')
    setReasonForVisit('')
    setPhotoFile(null)
    setPhotoPreview(null)
    setConfirmDifferentPatient(false)
    setFormError(null)
    setQuickSuccessNotice(null)
    if (nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }

  const errorText = (err: unknown) =>
    err instanceof Error && err.message ? err.message : 'unknown error'

  const handleRetryPhoto = async () => {
    if (!photoFailure || !photoFile) return
    setPhotoRetrying(true)
    setPhotoSavedNotice(null)
    try {
      await uploadPhotoMutation.mutateAsync({ id: photoFailure.patientId, file: photoFile })
      setPhotoFailure(null)
      setPhotoSavedNotice('Photo uploaded and saved to the patient record.')
    } catch (retryErr) {
      setPhotoFailure({ ...photoFailure, message: errorText(retryErr) })
    } finally {
      setPhotoRetrying(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // A registered patient stays on screen until "Register Another" is used; never create a second one.
    if (submittingRef.current || createdPatient) return
    setFormError(null)
    setQuickSuccessNotice(null)
    setRegistrationWarnings([])
    setPhotoFailure(null)
    setPhotoSavedNotice(null)
    setCheckedIn(false)

    if (ageYears === '' || ageYears < 0) {
      setFormError('Please enter a valid age in years.')
      return
    }

    if (isDuplicateDetected && !confirmDifferentPatient) {
      setFormError('Please confirm this is a different patient before proceeding.')
      return
    }

    // Default guardian name if not manually expanded
    const effectiveGuardian = guardianName.trim() || 'Self / Not specified'

    const payload: PatientCreate = {
      full_name: fullName.trim(),
      guardian_name: effectiveGuardian,
      gender,
      dob: dob.trim() || null,
      age_years: Number(ageYears),
      mobile: mobile.trim(),
      address: address.trim(),
      district: district.trim() || 'Bhojpur',
      state: state.trim() || 'Bihar',
      emergency_contact: emergencyContact.trim() || null,
      allergies: allergies.trim() || 'None reported',
      notes: notes.trim() || (reasonForVisit.trim() ? `Complaint: ${reasonForVisit.trim()}` : null),
    }

    submittingRef.current = true
    try {
      // 1. Register Patient Demographics. A failure here means nothing was saved.
      const patient = await registerMutation.mutateAsync(payload)

      const warnings: string[] = []

      // 2. Upload Photo if provided. The patient is already saved, so report and continue.
      if (photoFile) {
        try {
          await uploadPhotoMutation.mutateAsync({
            id: patient.id,
            file: photoFile,
          })
        } catch (photoErr) {
          setPhotoFailure({
            patientId: patient.id,
            fileName: photoFile.name,
            message: errorText(photoErr),
          })
        }
      }

      // 3. Allocate Visit & Token if Department and Doctor selected
      let generatedToken: number | null = null
      let arrived = false
      if (selectedDepartmentId && selectedDoctorId) {
        let appt: Awaited<ReturnType<typeof bookAppointmentMutation.mutateAsync>> | null = null
        try {
          appt = await bookAppointmentMutation.mutateAsync({
            patient_id: patient.id,
            department_id: Number(selectedDepartmentId),
            doctor_id: Number(selectedDoctorId),
            appointment_date: istToday(),
            notes: reasonForVisit.trim() || null,
          })
          generatedToken = appt.token_number
        } catch (visitErr) {
          warnings.push(
            `Visit and queue token were not booked (${errorText(visitErr)}). Book them from Appointments.`,
          )
        }

        // If Walk-in, mark Arrived immediately. Only a confirmed check-in is shown as checked in.
        if (appt && visitType === 'walk-in') {
          try {
            await updateStatusMutation.mutateAsync({
              id: appt.id,
              body: {
                status: 'ARRIVED',
                version_id: appt.version_id,
              },
            })
            arrived = true
          } catch (arriveErr) {
            warnings.push(
              `Token #${appt.token_number} is booked but was not marked arrived (${errorText(arriveErr)}). Mark arrived from Appointments.`,
            )
          }
        }
      }

      setAllocatedToken(generatedToken)
      setCheckedIn(arrived)

      if (saveAndAddAnother) {
        const tokenMsg = generatedToken != null ? ` · Queue Token #${generatedToken}` : ''
        setQuickSuccessNotice(
          `Registered ${patient.full_name} (${patient.urn})${tokenMsg}. Form reset for next patient.`,
        )
        handleClear()
        setRegistrationWarnings(warnings)
      } else {
        setRegistrationWarnings(warnings)
        setCreatedPatient(patient)
      }
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setFormError(err.message)
      } else if (err instanceof Error) {
        setFormError(err.message)
      } else {
        setFormError('Registration failed. Please check local LAN connection.')
      }
    } finally {
      submittingRef.current = false
    }
  }

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <UnsavedChangesGuard dirty={isDirty && !createdPatient} bypassRef={skipUnsavedGuardRef} />
      {/* Full-width Widescreen Container: No max-w-5xl artificial constraints */}
      <div className="w-full space-y-5">
        {/* Top Header Bar filling desktop width */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 shadow-xs shrink-0">
              <IconUserPlus className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                Patient Registration
              </h1>
              <p className="text-xs text-slate-500">
                Register a new patient, allocate Universal Record Number (URN), and issue doctor queue token.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              to="/reception/tokens"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconTicket className="h-4 w-4 text-emerald-800" />
              Visit &amp; Token Desk
            </Link>
            <Link
              to="/reception/patients"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              <IconUser className="h-4 w-4 text-slate-500" />
              Patient Records
            </Link>
          </div>
        </div>

        {/* Steps that did not complete after the patient was saved */}
        {registrationWarnings.length > 0 && (
          <div
            role="alert"
            className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xs"
          >
            <p className="font-bold">Patient saved, but some steps did not complete:</p>
            <ul className="list-disc pl-5">
              {registrationWarnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {photoFailure && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xs"
          >
            <p className="font-bold">Patient saved, but the photo was not uploaded.</p>
            <p>
              {photoFailure.fileName}: {photoFailure.message}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleRetryPhoto()}
                disabled={photoRetrying || !photoFile}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-amber-800 px-4 text-sm font-semibold text-white hover:bg-amber-900 disabled:opacity-50 cursor-pointer"
              >
                <IconCamera className="h-4 w-4" />
                {photoRetrying ? 'Uploading…' : 'Retry photo upload'}
              </button>
              <button
                type="button"
                onClick={() => setPhotoFailure(null)}
                className="inline-flex min-h-11 items-center rounded-lg border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-950 hover:bg-amber-100 cursor-pointer"
              >
                Continue without photo
              </button>
            </div>
          </div>
        )}

        {photoSavedNotice && (
          <div
            role="status"
            className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-950 shadow-xs"
          >
            <span className="flex items-center gap-2">
              <IconCheck className="h-5 w-5 text-emerald-700" />
              {photoSavedNotice}
            </span>
            <button
              type="button"
              onClick={() => setPhotoSavedNotice(null)}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Quick Success Toast when 'Save and add another' is active */}
        {quickSuccessNotice && (
          <div
            role="status"
            className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-950 shadow-xs"
          >
            <div className="flex items-center gap-2">
              <IconCheck className="h-5 w-5 text-emerald-700" />
              <span>{quickSuccessNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setQuickSuccessNotice(null)}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Permanent Success Card (when not adding another) */}
        {createdPatient && (
          <div
            role="status"
            className="space-y-4 rounded-2xl border border-emerald-300 bg-emerald-50/80 p-6 shadow-sm text-emerald-950"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${photoFailure ? 'bg-amber-200/70 text-amber-900' : 'bg-emerald-200/70 text-emerald-900'}`}
                >
                  <IconCheck className="h-4 w-4 text-emerald-800" />
                  {photoFailure ? 'Patient Registered — Photo Pending' : 'Registration Successful!'}
                </span>
                <h3 className="mt-2 text-xl font-bold text-slate-900">
                  {createdPatient.full_name}
                </h3>
                <p className="text-xs text-slate-600">
                  Allocated Universal Record Number (URN):
                </p>
                <div className="mt-1.5 inline-block rounded-lg border border-emerald-400 bg-white px-4 py-1.5 font-mono text-xl font-black text-emerald-900 shadow-2xs">
                  {createdPatient.urn}
                </div>
              </div>

              {allocatedToken != null && (
                <div className="rounded-xl border border-emerald-300 bg-white p-4 text-center shadow-xs">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Allocated Queue Token
                  </span>
                  <div className="font-mono text-3xl font-black text-emerald-800">
                    #{allocatedToken}
                  </div>
                  <span className="mt-1 block rounded bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                    {checkedIn ? 'Checked In (Arrived)' : 'Booked'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-emerald-200">
              <button
                type="button"
                onClick={() => {
                  skipUnsavedGuardRef.current = true
                  navigate(`/reception/patients/${createdPatient.id}`)
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-emerald-800 px-5 text-sm font-semibold text-white hover:bg-emerald-900 shadow-xs cursor-pointer"
              >
                View Patient File &amp; Card
              </button>
              <Link
                to={`/reception/patients/${createdPatient.id}/print`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-emerald-400 bg-white px-4 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 cursor-pointer"
              >
                Print Registration Card
              </Link>
              <button
                type="button"
                onClick={() => {
                  setCreatedPatient(null)
                  setAllocatedToken(null)
                  handleClear()
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Register Another Patient
              </button>
            </div>
          </div>
        )}

        {/* Duplicate Patient Alert Banner */}
        {isDuplicateDetected && duplicateData?.matching_patient && (
          <div
            role="alert"
            className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 shadow-xs"
          >
            <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <span>Potential Duplicate Patient Detected</span>
            </div>
            <p className="text-xs text-amber-900">
              A patient matching <span className="font-semibold">{duplicateData.matching_patient.full_name}</span> with mobile{' '}
              <span className="font-semibold">{duplicateData.matching_patient.mobile}</span> is already in the system:
            </p>
            <div className="rounded-lg border border-amber-200 bg-white/90 p-3 font-mono text-xs space-y-1">
              <div><strong>URN:</strong> {duplicateData.matching_patient.urn}</div>
              <div><strong>Registered:</strong> {new Date(duplicateData.matching_patient.created_at).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-amber-200">
              <input
                id="confirm-different-checkbox"
                type="checkbox"
                checked={confirmDifferentPatient}
                onChange={(e) => setConfirmDifferentPatient(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 text-emerald-800 focus:ring-emerald-700"
              />
              <label
                htmlFor="confirm-different-checkbox"
                className="text-xs font-semibold text-amber-950 cursor-pointer"
              >
                Confirm this is a different patient (permit new registration)
              </label>
            </div>
          </div>
        )}

        {/* Error Alert */}
        {formError && (
          <div
            role="alert"
            className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900 shadow-xs"
          >
            {formError}
          </div>
        )}

        {/* The Desktop Horizontal Multi-Column Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
            {/* ========================================================= */}
            {/* LEFT COLUMN: Patient Identification & Demographics (7 cols) */}
            {/* ========================================================= */}
            <div className="space-y-5 lg:col-span-7 xl:col-span-8">
              {/* CARD 1: Core Patient Details */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
                <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3">
                  <IconUser className="h-5 w-5 text-emerald-800" />
                  <h2 className="text-base font-bold text-slate-900">Patient Details</h2>
                </div>

                <div className="flex flex-col gap-6 md:flex-row md:items-start">
                  {/* Photo Box */}
                  <div className="flex flex-col items-center gap-2 shrink-0">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      aria-label="Patient Photograph"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="group relative flex h-36 w-36 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 p-2 text-center transition-colors hover:border-emerald-600 hover:bg-emerald-50/30"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          fileInputRef.current?.click()
                        }
                      }}
                      title="Click to capture or upload patient photo"
                    >
                      {photoPreview ? (
                        <img
                          src={photoPreview}
                          alt="Patient preview"
                          className="h-full w-full rounded-lg object-cover"
                        />
                      ) : (
                        <>
                          <IconCamera className="h-8 w-8 text-slate-500 group-hover:text-emerald-700" />
                          <span className="mt-1.5 text-xs font-semibold text-slate-600 group-hover:text-emerald-900">
                            Add Photo
                          </span>
                        </>
                      )}
                    </div>
                    {photoPreview && (
                      <button
                        type="button"
                        onClick={handleRemovePhoto}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                      >
                        <IconTrash className="h-3 w-3" />
                        Remove
                      </button>
                    )}
                  </div>

                  {/* Form Input Grid */}
                  <div className="flex-1 space-y-4">
                    {/* Row 1: Name, Age, Sex */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <label
                          htmlFor="patient-full-name"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                        >
                          Patient Name *
                        </label>
                        <input
                          ref={nameInputRef}
                          id="patient-full-name"
                          aria-label="Full Name *"
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Enter full name"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label
                          htmlFor="patient-age"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                        >
                          Age *
                        </label>
                        <input
                          id="patient-age"
                          aria-label="Age (Years) *"
                          type="number"
                          min={0}
                          max={150}
                          required
                          value={ageYears}
                          onChange={(e) => setAgeYears(e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="Years"
                          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                          Sex *
                        </span>
                        <div className="flex items-center gap-4 pt-2">
                          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-800">
                            <input
                              type="radio"
                              name="gender"
                              aria-label="Gender *"
                              value="M"
                              checked={gender === 'M'}
                              onChange={() => setGender('M')}
                              className="h-4 w-4 border-slate-300 text-emerald-800 focus:ring-emerald-700"
                            />
                            Male
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer text-sm font-semibold text-slate-800">
                            <input
                              type="radio"
                              name="gender"
                              value="F"
                              checked={gender === 'F'}
                              onChange={() => setGender('F')}
                              className="h-4 w-4 border-slate-300 text-emerald-800 focus:ring-emerald-700"
                            />
                            Female
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Row 2: Mobile Number & Address */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                      <div className="sm:col-span-5">
                        <label
                          htmlFor="patient-mobile"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                        >
                          Mobile Number *
                        </label>
                        <div className="relative">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                            <IconPhone className="h-4 w-4" />
                          </div>
                          <input
                            id="patient-mobile"
                            aria-label="Mobile Number *"
                            type="tel"
                            required
                            value={mobile}
                            onChange={(e) => setMobile(e.target.value)}
                            placeholder="Enter mobile number"
                            className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                          />
                          {duplicateChecking && (
                            <span className="absolute right-3 top-3 text-xs font-semibold text-slate-500">
                              Checking...
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-7">
                        <label
                          htmlFor="patient-address"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                        >
                          Address
                        </label>
                        <div className="relative">
                          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                            <IconMapPin className="h-4 w-4" />
                          </div>
                          <input
                            id="patient-address"
                            aria-label="Address (Village / Mohalla / Ward) *"
                            type="text"
                            required
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            placeholder="Enter full address"
                            className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* CARD 2: Additional Demographics (ABDM Invariants) in Desktop Grid */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6">
                <details open className="group">
                  <summary className="flex items-center justify-between font-bold text-sm text-slate-900 cursor-pointer select-none">
                    <span className="flex items-center gap-2 text-emerald-800">
                      <IconNotes className="h-4 w-4" />
                      Additional Demographics (Guardian, DOB, District, Allergies, Notes)
                    </span>
                    <span className="text-xs font-semibold text-slate-500 group-open:rotate-180 transition-transform">
                      ▼
                    </span>
                  </summary>

                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                    {/* Guardian */}
                    <div>
                      <label htmlFor="patient-guardian-name" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Father / Guardian / Spouse Name *
                      </label>
                      <input
                        id="patient-guardian-name"
                        aria-label="Father / Guardian / Spouse Name *"
                        type="text"
                        value={guardianName}
                        onChange={(e) => setGuardianName(e.target.value)}
                        placeholder="Guardian name"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* DOB */}
                    <div>
                      <label htmlFor="patient-dob" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Date of Birth (Optional)
                      </label>
                      <input
                        id="patient-dob"
                        type="date"
                        value={dob}
                        onChange={(e) => handleDobChange(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* District */}
                    <div>
                      <label htmlFor="patient-district" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        District *
                      </label>
                      <input
                        id="patient-district"
                        type="text"
                        required
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* State */}
                    <div>
                      <label htmlFor="patient-state" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        State *
                      </label>
                      <input
                        id="patient-state"
                        type="text"
                        required
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* Emergency Contact */}
                    <div>
                      <label htmlFor="patient-emergency" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Emergency Contact (Optional)
                      </label>
                      <input
                        id="patient-emergency"
                        type="text"
                        value={emergencyContact}
                        onChange={(e) => setEmergencyContact(e.target.value)}
                        placeholder="Relationship & phone"
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* Allergies */}
                    <div>
                      <label htmlFor="patient-allergies" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Allergies *
                      </label>
                      <input
                        id="patient-allergies"
                        type="text"
                        required
                        value={allergies}
                        onChange={(e) => setAllergies(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none min-h-[38px]"
                      />
                    </div>

                    {/* Clinical Notes */}
                    <div className="sm:col-span-2 xl:col-span-3">
                      <label htmlFor="patient-notes" className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                        Clinical / Administrative Notes (Optional)
                      </label>
                      <textarea
                        id="patient-notes"
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Special remarks, past history, or reference"
                        className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none"
                      />
                    </div>
                  </div>
                </details>
              </section>
            </div>

            {/* ========================================================= */}
            {/* RIGHT COLUMN: Visit Allocation & Live Queue Desk (5 cols) */}
            {/* ========================================================= */}
            <div className="space-y-5 lg:col-span-5 xl:col-span-4">
              {/* CARD 3: Visit Details */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <IconCalendar className="h-5 w-5 text-emerald-800" />
                  <h2 className="text-base font-bold text-slate-900">Visit Details</h2>
                </div>

                {/* Department */}
                <div>
                  <label
                    htmlFor="visit-department"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                  >
                    Department *
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                      <IconStethoscope className="h-4 w-4" />
                    </div>
                    <select
                      id="visit-department"
                      value={selectedDepartmentId}
                      onChange={(e) => {
                        setSelectedDepartmentId(e.target.value ? Number(e.target.value) : '')
                        setSelectedDoctorId('')
                      }}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px]"
                    >
                      <option value="">Select department</option>
                      {departments?.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Doctor */}
                <div>
                  <label
                    htmlFor="visit-doctor"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                  >
                    Doctor *
                  </label>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                      <IconUserCheck className="h-4 w-4" />
                    </div>
                    <select
                      id="visit-doctor"
                      value={selectedDoctorId}
                      onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : '')}
                      disabled={!selectedDepartmentId}
                      className="w-full rounded-xl border border-slate-300 bg-white pl-10 pr-3.5 py-2.5 text-xs font-medium text-slate-900 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700 min-h-[44px] disabled:bg-slate-100"
                    >
                      <option value="">Select doctor</option>
                      {departmentDoctors?.map((doc: DepartmentDoctorOut) => (
                        <option key={doc.id} value={doc.id}>
                          {doc.name_en}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Visit Type Segmented Toggle */}
                <div>
                  <span className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">
                    Visit Type
                  </span>
                  <div className="flex rounded-xl border border-slate-300 bg-slate-100/70 p-1 shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setVisitType('walk-in')}
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
                      onClick={() => setVisitType('appointment')}
                      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${visitType === 'appointment'
                          ? 'border border-emerald-300 bg-white text-emerald-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                        }`}
                    >
                      <IconCalendar className="h-4 w-4 text-slate-500" />
                      Appointment
                    </button>
                  </div>
                </div>

                {/* Reason for Visit */}
                <div>
                  <label
                    htmlFor="reason-for-visit"
                    className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1"
                  >
                    Reason for Visit
                  </label>
                  <textarea
                    id="reason-for-visit"
                    rows={2}
                    value={reasonForVisit}
                    onChange={(e) => setReasonForVisit(e.target.value)}
                    placeholder="Enter main complaint / reason for visit..."
                    className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs font-medium text-slate-900 placeholder-slate-400 shadow-2xs focus:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-700"
                  />
                </div>
              </section>

              {/* CARD 4: Live Queue Ticket Preview */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs sm:p-6 space-y-4">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                  <IconTicket className="h-5 w-5 text-emerald-800" />
                  <div>
                    <h2 className="text-base font-bold text-slate-900">Token Desk</h2>
                    <p className="text-xs text-slate-500">
                      Live queue ticket preview generated upon saving.
                    </p>
                  </div>
                </div>

                <QueueTicketPreview
                  departmentName={selectedDepartment?.name_en || 'General OPD'}
                  doctorName={selectedDoctor?.name_en || 'Select doctor'}
                  tokenPrefix={tokenPrefix}
                  tokenNumber={allocatedToken || (selectedDoctorId ? 'Auto' : '—')}
                  patientName={fullName.trim() || 'New Patient'}
                  patientUrn={createdPatient?.urn || 'URN on save'}
                  waitingCount={0}
                  nextToken={allocatedToken || 'Next'}
                />
              </section>
            </div>
          </div>

          {/* ========================================================= */}
          {/* BOTTOM ACTION BAR: Full Width Desktop Dock               */}
          {/* ========================================================= */}
          <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <label className="flex items-center gap-2.5 text-sm font-semibold text-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saveAndAddAnother}
                onChange={(e) => setSaveAndAddAnother(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-emerald-800 focus:ring-emerald-700"
              />
              Save and add another
            </label>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleClear}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400 cursor-pointer"
              >
                <IconRefresh className="h-4 w-4 text-slate-500" />
                Clear
              </button>

              <button
                type="submit"
                aria-label="Register Patient"
                disabled={
                  registerMutation.isPending ||
                  !!createdPatient ||
                  (isDuplicateDetected && !confirmDifferentPatient)
                }
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#124832] px-6 text-sm font-bold text-white shadow-xs hover:bg-[#0D3822] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 disabled:opacity-50 cursor-pointer"
              >
                <IconDeviceFloppy className="h-4 w-4" />
                {registerMutation.isPending ? 'Saving...' : 'Save Registration'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
export default PatientRegister
