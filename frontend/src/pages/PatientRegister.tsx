import { useState, type FormEvent, type ReactNode, useEffect, useRef, useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  useRegisterPatient,
  useUpdatePatient,
  usePatient,
  useUploadPatientPhoto,
  useCheckDuplicate,
  useMe,
  useDepartments,
  useDepartmentDoctors,
  useBookAppointment,
  useUpdateAppointmentStatus,
} from '../api/queries'
import { ApiError, apiFetch } from '../api/client'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { QueueTicketPreview } from '../components/QueueTicketPreview'
import { UnsavedChangesGuard } from '../components/UnsavedChangesGuard'
import { PatientPhotoModal } from '../components/PatientPhotoModal'
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCamera,
  IconCalendar,
  IconCheck,
  IconDeviceFloppy,
  IconHeartRateMonitor,
  IconMapPin,
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
import type { PatientCreate, PatientOut, PatientUpdate, DepartmentDoctorOut } from '../api/types'
import { istToday } from '../format'

/** Shared field styling: one control height, one brand focus treatment, across both columns. */
const LABEL_CLASS =
  'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600'
const INPUT_CLASS =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15'
const INPUT_WITH_ICON_CLASS = `${INPUT_CLASS} pl-10`

/** Numbered section heading: the form's only structural accent, in brand maroon and gold. */
function SectionHeader({
  index,
  title,
  hint,
  icon,
}: {
  index: string
  title: string
  hint: string
  icon: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 bg-[#FBF5F7] px-5 py-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#5D0B26] text-xs font-bold text-white">
        {index}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-bold text-[#5D0B26]">
          <span className="text-[#8E1C3D]">{icon}</span>
          {title}
        </h2>
        <p className="text-xs leading-snug text-slate-500">{hint}</p>
      </div>
    </div>
  )
}

/** Photo URL the server streams to authenticated sessions (same origin, so the CSP allows it). */
const existingPhotoUrl = (p: PatientOut) => (p.photo_path ? `/api/patients/${p.id}/photo` : null)

/**
 * One form for both jobs. At /reception/patients/new it registers a patient; at
 * /reception/patients/:id/edit the same form opens pre-filled for the existing patient and
 * saves with PATCH /patients/{id} (optimistic version check). The URN never changes, and
 * visit / token booking belongs to registration only.
 */
export function PatientRegister() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  const { id: editIdParam } = useParams<{ id: string }>()
  const isEditMode = editIdParam !== undefined
  const editId = isEditMode ? Number(editIdParam) : null
  const validEditId = editId !== null && Number.isInteger(editId) && editId > 0
  const patientQuery = usePatient(isEditMode && validEditId ? editId : null)
  const recordPath = `/reception/patients/${editId}`
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const registerMutation = useRegisterPatient()
  const updateMutation = useUpdatePatient()
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
  const photoPreviewUrlRef = useRef<string | null>(null)
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false)

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
  // Edit mode: the record as last loaded (its version_id guards the save), and save state.
  const [baseline, setBaseline] = useState<PatientOut | null>(null)
  const [isConflict, setIsConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [editSaved, setEditSaved] = useState(false)
  const prefilledIdRef = useRef<number | null>(null)
  // Blocks a second submit while one is in flight (double-click, Enter key repeat).
  const submittingRef = useRef(false)
  // Set just before a deliberate post-registration navigation.
  const skipUnsavedGuardRef = useRef(false)

  // Anything typed into the form means leaving now would lose work. When editing, only a
  // change from the loaded record counts.
  const isDirty = useMemo(() => {
    if (isEditMode) {
      if (!baseline) return false
      return Boolean(
        photoFile ||
          fullName.trim() !== baseline.full_name ||
          guardianName.trim() !== baseline.guardian_name ||
          gender !== baseline.gender ||
          dob !== (baseline.dob ?? '') ||
          ageYears !== baseline.age_years ||
          mobile.trim() !== baseline.mobile ||
          address.trim() !== baseline.address ||
          district.trim() !== baseline.district ||
          state.trim() !== baseline.state ||
          emergencyContact.trim() !== (baseline.emergency_contact ?? '') ||
          allergies.trim() !== baseline.allergies ||
          notes.trim() !== (baseline.notes ?? ''),
      )
    }
    return (
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
      )
    )
  }, [
    isEditMode,
    baseline,
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
  ])

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

  // The duplicate check is for new registrations: while editing it would match the patient itself.
  const { data: duplicateData, isFetching: duplicateChecking } = useCheckDuplicate(
    debouncedName,
    debouncedMobile,
    !isEditMode && debouncedName.length >= 2 && debouncedMobile.length >= 10,
  )

  const isDuplicateDetected = !isEditMode && Boolean(duplicateData?.has_duplicate)

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
      handlePhotoConfirmed(file)
    }
  }

  /**
   * The preview is a blob: object URL, not a data: URL. The server's Content-Security-Policy
   * (img-src 'self' blob:) blocks data: images, which left the photo frame empty after a
   * capture or upload even though the file was held for saving.
   */
  const showPhotoPreview = (file: File | null, serverPhotoUrl: string | null = null) => {
    if (photoPreviewUrlRef.current) {
      URL.revokeObjectURL(photoPreviewUrlRef.current)
    }
    const blobUrl = file ? URL.createObjectURL(file) : null
    photoPreviewUrlRef.current = blobUrl
    // With no new file, an edited patient's saved photo (streamed by the server) stays shown.
    setPhotoPreview(blobUrl ?? serverPhotoUrl)
  }

  /** Load a patient record into the form: the starting point of an edit, and "Reload latest". */
  const fillFromPatient = (p: PatientOut) => {
    setFullName(p.full_name)
    setGuardianName(p.guardian_name)
    setGender(p.gender)
    setDob(p.dob ?? '')
    setAgeYears(p.age_years)
    setMobile(p.mobile)
    setAddress(p.address)
    setDistrict(p.district)
    setState(p.state)
    setEmergencyContact(p.emergency_contact ?? '')
    setAllergies(p.allergies)
    setNotes(p.notes ?? '')
    setBaseline(p)
    // A photo chosen in this session is kept; otherwise show the one on file.
    if (!photoFile) showPhotoPreview(null, existingPhotoUrl(p))
  }

  // Edit mode: fill the form once, when the patient first arrives. Later background
  // refetches must not overwrite what the receptionist is typing.
  useEffect(() => {
    const loaded = patientQuery.data
    if (!isEditMode || !loaded || prefilledIdRef.current === loaded.id) return
    prefilledIdRef.current = loaded.id
    fillFromPatient(loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditMode, patientQuery.data])

  // Release the preview's object URL when leaving the page.
  useEffect(
    () => () => {
      if (photoPreviewUrlRef.current) {
        URL.revokeObjectURL(photoPreviewUrlRef.current)
      }
    },
    [],
  )

  const handlePhotoConfirmed = (file: File) => {
    setPhotoFile(file)
    showPhotoPreview(file)
  }

  const handleRemovePhoto = () => {
    setPhotoFile(null)
    // Editing: dropping a newly chosen photo goes back to the one already on file.
    showPhotoPreview(null, baseline ? existingPhotoUrl(baseline) : null)
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
    showPhotoPreview(null)
    setConfirmDifferentPatient(false)
    setFormError(null)
    setQuickSuccessNotice(null)
    if (nameInputRef.current) {
      nameInputRef.current.focus()
    }
  }

  const errorText = (err: unknown) =>
    err instanceof Error && err.message ? err.message : 'unknown error'

  /** Editing is done: back to the patient's record, which shows the notice. */
  const finishEdit = (notice: string) => {
    skipUnsavedGuardRef.current = true
    navigate(recordPath, { state: { notice } })
  }

  const handleRetryPhoto = async () => {
    if (!photoFailure || !photoFile) return
    setPhotoRetrying(true)
    setPhotoSavedNotice(null)
    try {
      await uploadPhotoMutation.mutateAsync({ id: photoFailure.patientId, file: photoFile })
      setPhotoFailure(null)
      if (isEditMode) {
        finishEdit('Patient details and photo updated successfully.')
        return
      }
      setPhotoSavedNotice('Photo uploaded and saved to the patient record.')
    } catch (retryErr) {
      setPhotoFailure({ ...photoFailure, message: errorText(retryErr) })
    } finally {
      setPhotoRetrying(false)
    }
  }

  /** "Reload latest" after a version conflict: replace the form with the server's current record. */
  const handleReloadLatest = async () => {
    if (editId === null) return
    setIsReloading(true)
    try {
      const fresh = await apiFetch<PatientOut>(`/patients/${editId}`)
      fillFromPatient(fresh)
      setIsConflict(false)
      setFormError(null)
    } catch {
      setFormError('Failed to reload latest patient data.')
    } finally {
      setIsReloading(false)
    }
  }

  /** Save the edited patient with PATCH /patients/{id}; the photo, if changed, goes after it. */
  const handleEditSubmit = async () => {
    if (!baseline) return
    if (baseline.dob && !dob.trim()) {
      // The API treats a missing date as "leave unchanged", so a cleared date would silently not save.
      setFormError('A recorded date of birth cannot be removed. Enter the correct date instead.')
      return
    }

    const body: PatientUpdate = {
      version_id: baseline.version_id,
      full_name: fullName.trim(),
      guardian_name: guardianName.trim() || 'Self / Not specified',
      gender,
      dob: dob.trim() || null,
      age_years: Number(ageYears),
      mobile: mobile.trim(),
      address: address.trim(),
      district: district.trim() || 'Bhojpur',
      state: state.trim() || 'Bihar',
      // '' clears these on the server; null would leave the old value in place.
      emergency_contact: emergencyContact.trim(),
      allergies: allergies.trim() || 'None reported',
      notes: notes.trim(),
    }

    submittingRef.current = true
    setIsConflict(false)
    try {
      const updated = await updateMutation.mutateAsync({ id: baseline.id, body })
      // The version moved on with this save; keep it so a later save is not a false conflict.
      setBaseline(updated)
      if (photoFile) {
        try {
          await uploadPhotoMutation.mutateAsync({ id: updated.id, file: photoFile })
        } catch (photoErr) {
          setEditSaved(true)
          setPhotoFailure({
            patientId: updated.id,
            fileName: photoFile.name,
            message: errorText(photoErr),
          })
          return
        }
      }
      finishEdit('Patient details updated successfully.')
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 409 || err.code === 'version_conflict')) {
        setIsConflict(true)
      } else if (err instanceof Error && err.message) {
        setFormError(err.message)
      } else {
        setFormError('Failed to save changes. Please try again.')
      }
    } finally {
      submittingRef.current = false
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // A registered patient stays on screen until "Register Another" is used; never create a second one.
    if (submittingRef.current || createdPatient || editSaved) return
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

    if (isEditMode) {
      await handleEditSubmit()
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

  // Editing: wait for the record before showing the form (it opens pre-filled, never empty).
  if (isEditMode && (!validEditId || !baseline)) {
    return (
      <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
        <div className="w-full space-y-4 pb-2">
          {!validEditId ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-900">
              Invalid patient ID.
            </div>
          ) : patientQuery.isError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm font-medium text-red-900">
              Failed to load patient: {patientQuery.error.message}
            </div>
          ) : (
            <div role="status" className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              Loading patient record…
            </div>
          )}
          <Link to="/reception/patients" className="inline-block text-sm font-medium text-[#8E1C3D] hover:underline">
            &larr; Back to Patient Records
          </Link>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <UnsavedChangesGuard dirty={isDirty && !createdPatient} bypassRef={skipUnsavedGuardRef} />

      <div className="w-full space-y-5 pb-2">
        {/* Page header: brand maroon tile, page title, cross-links to the rest of the desk */}
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#E4C8D1] bg-[#FBF5F7] text-[#8E1C3D]">
              {isEditMode ? (
                <IconUser className="h-6 w-6" stroke={1.8} />
              ) : (
                <IconUserPlus className="h-6 w-6" stroke={1.8} />
              )}
            </span>
            <div className="min-w-0">
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                {isEditMode ? 'Edit Patient Details' : 'Patient Registration'}
              </h1>
              <p className="text-xs text-slate-500">
                {isEditMode ? (
                  <>
                    Update the saved details of{' '}
                    <span className="font-semibold text-slate-700">{baseline?.full_name}</span> · URN{' '}
                    <span className="font-mono font-semibold text-[#5D0B26]">{baseline?.urn}</span>. The
                    URN does not change.{' '}
                  </>
                ) : (
                  <>
                    Register the patient, allocate the Universal Record Number (URN) and issue the
                    doctor queue token.{' '}
                  </>
                )}
                <span className="font-semibold text-[#8E1C3D]">Fields marked * are required.</span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2.5">
            {isEditMode ? (
              <Link
                to={recordPath}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:border-[#8E1C3D] hover:text-[#5D0B26]"
              >
                <IconUser className="h-4 w-4 text-[#8E1C3D]" />
                Patient File
              </Link>
            ) : (
              <Link
                to="/reception/tokens"
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:border-[#8E1C3D] hover:text-[#5D0B26]"
              >
                <IconTicket className="h-4 w-4 text-[#8E1C3D]" />
                Visit &amp; Token Desk
              </Link>
            )}
            <Link
              to="/reception/patients"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-700 shadow-2xs transition-colors hover:border-[#8E1C3D] hover:text-[#5D0B26]"
            >
              <IconUser className="h-4 w-4 text-[#8E1C3D]" />
              Patient Records
            </Link>
          </div>
        </header>

        {isConflict && (
          <ConflictBanner onReload={() => void handleReloadLatest()} isReloading={isReloading} />
        )}

        {/* Steps that did not complete after the patient was saved */}
        {registrationWarnings.length > 0 && (
          <div
            role="alert"
            className="space-y-1 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 shadow-xs"
          >
            <p className="flex items-center gap-2 font-bold">
              <IconAlertTriangle className="h-4 w-4 text-amber-700" />
              Patient saved, but some steps did not complete:
            </p>
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
            <p className="flex items-center gap-2 font-bold">
              <IconAlertTriangle className="h-4 w-4 text-amber-700" />
              Patient saved, but the photo was not uploaded.
            </p>
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
                onClick={() => {
                  if (isEditMode) {
                    finishEdit('Patient details updated. The new photo was not saved.')
                    return
                  }
                  setPhotoFailure(null)
                }}
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
            className="space-y-4 rounded-2xl border border-[#E4C8D1] bg-[#FBF5F7] p-6 shadow-sm"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                <div className="mt-1.5 inline-block rounded-lg border border-[#C39A35] bg-white px-4 py-1.5 font-mono text-xl font-black text-[#5D0B26] shadow-2xs">
                  {createdPatient.urn}
                </div>
              </div>

              {allocatedToken != null && (
                <div className="rounded-xl border border-[#E4C8D1] bg-white p-4 text-center shadow-xs">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Allocated Queue Token
                  </span>
                  <div className="font-mono text-3xl font-black text-[#8E1C3D]">
                    #{allocatedToken}
                  </div>
                  <span className="mt-1 block rounded bg-[#FBF5F7] px-2 py-0.5 text-xs font-bold text-[#5D0B26]">
                    {checkedIn ? 'Checked In (Arrived)' : 'Booked'}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-[#E4C8D1] pt-3">
              <button
                type="button"
                onClick={() => {
                  skipUnsavedGuardRef.current = true
                  navigate(`/reception/patients/${createdPatient.id}`)
                }}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#8E1C3D] px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-[#5D0B26] cursor-pointer"
              >
                View Patient File &amp; Card
              </button>
              <Link
                to={`/reception/patients/${createdPatient.id}/print`}
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#8E1C3D] bg-white px-4 text-sm font-semibold text-[#5D0B26] transition-colors hover:bg-[#FBF5F7] cursor-pointer"
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
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
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
              <IconAlertTriangle className="h-4 w-4 text-amber-700" />
              <span>Potential Duplicate Patient Detected</span>
            </div>
            <p className="text-xs text-amber-900">
              A patient matching <span className="font-semibold">{duplicateData.matching_patient.full_name}</span> with mobile{' '}
              <span className="font-semibold">{duplicateData.matching_patient.mobile}</span> is already in the system:
            </p>
            <div className="space-y-1 rounded-lg border border-amber-200 bg-white/90 p-3 font-mono text-xs">
              <div><strong>URN:</strong> {duplicateData.matching_patient.urn}</div>
              <div><strong>Registered:</strong> {new Date(duplicateData.matching_patient.created_at).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-2 border-t border-amber-200 pt-2">
              <input
                id="confirm-different-checkbox"
                type="checkbox"
                checked={confirmDifferentPatient}
                onChange={(e) => setConfirmDifferentPatient(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 accent-[#8E1C3D] focus:ring-[#8E1C3D]"
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
            className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900 shadow-xs"
          >
            <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
            {/* ========================================================= */}
            {/* LEFT: identity, contact and clinical flags (8 of 12)      */}
            {/* ========================================================= */}
            <div className={`space-y-5 ${isEditMode ? 'xl:col-span-12' : 'xl:col-span-8'}`}>
              {/* SECTION 1: Patient identity */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <SectionHeader
                  index="1"
                  title="Patient Details"
                  hint="Name, guardian, age and sex as printed on the registration card"
                  icon={<IconUser className="h-4 w-4" />}
                />

                <div className="flex flex-col gap-6 p-5 sm:p-6 md:flex-row md:items-start">
                  {/* Photo: portrait frame, gold ring once a photo is captured */}
                  <div className="flex shrink-0 flex-col items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      aria-label="Patient Photograph"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                    <div
                      onClick={() => setIsPhotoModalOpen(true)}
                      className={`group relative flex h-40 w-32 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed p-2 text-center transition-colors ${
                        photoPreview
                          ? 'border-[#C39A35] bg-white ring-2 ring-[#C39A35]/25'
                          : 'border-slate-300 bg-[#FBF5F7]/60 hover:border-[#8E1C3D] hover:bg-[#FBF5F7]'
                      }`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setIsPhotoModalOpen(true)
                        }
                      }}
                      title="Click to capture or upload patient photo"
                    >
                      {photoPreview ? (
                        <img
                          src={photoPreview}
                          alt="Patient preview"
                          className="h-full w-full rounded-lg object-cover"
                          onError={() => {
                            // The photo on file could not be streamed (file missing): show the empty frame.
                            if (!photoFile) setPhotoPreview(null)
                          }}
                        />
                      ) : (
                        <>
                          <IconCamera className="h-8 w-8 text-[#8E1C3D]" />
                          <span className="mt-1.5 text-xs font-semibold text-slate-600 group-hover:text-[#5D0B26]">
                            Add Photo
                          </span>
                          <span className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">
                            Optional
                          </span>
                        </>
                      )}
                    </div>
                    {photoPreview && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setIsPhotoModalOpen(true)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#8E1C3D] hover:underline cursor-pointer"
                        >
                          Change
                        </button>
                        {/* The saved photo cannot be deleted here, only replaced; so while editing
                            Remove only appears for a photo chosen in this session. */}
                        {(!isEditMode || photoFile) && (
                          <>
                            <span className="text-slate-400">•</span>
                            <button
                              type="button"
                              onClick={handleRemovePhoto}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline cursor-pointer"
                            >
                              <IconTrash className="h-3 w-3" />
                              {isEditMode ? 'Discard new photo' : 'Remove'}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Identity fields */}
                  <div className="flex-1 space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-12">
                      <div className="sm:col-span-12">
                        <label htmlFor="patient-full-name" className={LABEL_CLASS}>
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
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="sm:col-span-6">
                        <label htmlFor="patient-guardian-name" className={LABEL_CLASS}>
                          Father / Guardian / Spouse *
                        </label>
                        <input
                          id="patient-guardian-name"
                          aria-label="Father / Guardian / Spouse Name *"
                          type="text"
                          value={guardianName}
                          onChange={(e) => setGuardianName(e.target.value)}
                          placeholder="Guardian name"
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="sm:col-span-6">
                        <label htmlFor="patient-mobile" className={LABEL_CLASS}>
                          Mobile Number *
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                            <IconPhone className="h-4 w-4" />
                          </span>
                          <input
                            id="patient-mobile"
                            aria-label="Mobile Number *"
                            type="tel"
                            required
                            value={mobile}
                            onChange={(e) => setMobile(e.target.value)}
                            placeholder="Enter mobile number"
                            className={INPUT_WITH_ICON_CLASS}
                          />
                          {duplicateChecking && (
                            <span className="absolute right-3 top-3.5 text-[10px] font-bold uppercase tracking-wider text-[#8E1C3D]">
                              Checking…
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="sm:col-span-4">
                        <label htmlFor="patient-dob" className={LABEL_CLASS}>
                          Date of Birth
                        </label>
                        <input
                          id="patient-dob"
                          aria-label="Date of Birth (Optional)"
                          type="date"
                          value={dob}
                          onChange={(e) => handleDobChange(e.target.value)}
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label htmlFor="patient-age" className={LABEL_CLASS}>
                          Age (Years) *
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
                          placeholder="0"
                          className={INPUT_CLASS}
                        />
                      </div>

                      <div className="sm:col-span-5">
                        <span className={LABEL_CLASS}>Sex *</span>
                        {/* Segmented like Visit Type, so the two options never wrap in a narrow column. */}
                        <div className="flex gap-1 rounded-lg border border-slate-300 bg-slate-100/70 p-1">
                          <label
                            className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors ${
                              gender === 'M'
                                ? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs'
                                : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
                            }`}
                          >
                            <input
                              type="radio"
                              name="gender"
                              aria-label="Gender *"
                              value="M"
                              checked={gender === 'M'}
                              onChange={() => setGender('M')}
                              className="h-4 w-4 shrink-0 accent-[#8E1C3D] focus:ring-[#8E1C3D]"
                            />
                            Male
                          </label>
                          <label
                            className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors ${
                              gender === 'F'
                                ? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs'
                                : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
                            }`}
                          >
                            <input
                              type="radio"
                              name="gender"
                              value="F"
                              checked={gender === 'F'}
                              onChange={() => setGender('F')}
                              className="h-4 w-4 shrink-0 accent-[#8E1C3D] focus:ring-[#8E1C3D]"
                            />
                            Female
                          </label>
                          {/* Registration offers Male / Female only; a record already saved as Other keeps it. */}
                          {baseline?.gender === 'O' && (
                            <label
                              className={`flex min-h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors ${
                                gender === 'O'
                                  ? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs'
                                  : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
                              }`}
                            >
                              <input
                                type="radio"
                                name="gender"
                                value="O"
                                checked={gender === 'O'}
                                onChange={() => setGender('O')}
                                className="h-4 w-4 shrink-0 accent-[#8E1C3D] focus:ring-[#8E1C3D]"
                              />
                              Other
                            </label>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* SECTION 2: Address & contact */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <SectionHeader
                  index="2"
                  title="Address & Contact"
                  hint="Where the patient lives and who to call in an emergency"
                  icon={<IconMapPin className="h-4 w-4" />}
                />

                <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-12 sm:p-6">
                  <div className="sm:col-span-12">
                    <label htmlFor="patient-address" className={LABEL_CLASS}>
                      Address (Village / Mohalla / Ward) *
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                        <IconMapPin className="h-4 w-4" />
                      </span>
                      <input
                        id="patient-address"
                        aria-label="Address (Village / Mohalla / Ward) *"
                        type="text"
                        required
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        placeholder="House, street, village or mohalla"
                        className={INPUT_WITH_ICON_CLASS}
                      />
                    </div>
                  </div>

                  <div className="sm:col-span-4">
                    <label htmlFor="patient-district" className={LABEL_CLASS}>
                      District *
                    </label>
                    <input
                      id="patient-district"
                      aria-label="District *"
                      type="text"
                      required
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label htmlFor="patient-state" className={LABEL_CLASS}>
                      State *
                    </label>
                    <input
                      id="patient-state"
                      aria-label="State *"
                      type="text"
                      required
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label htmlFor="patient-emergency" className={LABEL_CLASS}>
                      Emergency Contact
                    </label>
                    <input
                      id="patient-emergency"
                      aria-label="Emergency Contact (Optional)"
                      type="text"
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="Relationship & phone"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>
              </section>

              {/* SECTION 3: Alerts & notes */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <SectionHeader
                  index="3"
                  title="Medical Alerts & Notes"
                  hint="Known allergies and any administrative remark for the doctor"
                  icon={<IconHeartRateMonitor className="h-4 w-4" />}
                />

                <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-12 sm:p-6">
                  <div className="sm:col-span-5">
                    <label htmlFor="patient-allergies" className={LABEL_CLASS}>
                      Allergies *
                    </label>
                    <input
                      id="patient-allergies"
                      aria-label="Allergies *"
                      type="text"
                      required
                      value={allergies}
                      onChange={(e) => setAllergies(e.target.value)}
                      className={`${INPUT_CLASS} border-amber-300 focus:border-[#8E1C3D]`}
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Write “None reported” when the patient reports no allergy.
                    </p>
                  </div>

                  <div className="sm:col-span-7">
                    <label htmlFor="patient-notes" className={LABEL_CLASS}>
                      Clinical / Administrative Notes
                    </label>
                    <textarea
                      id="patient-notes"
                      aria-label="Clinical / Administrative Notes (Optional)"
                      rows={3}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Special remarks, past history, or reference"
                      className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
                    />
                  </div>
                </div>
              </section>
            </div>

            {/* ========================================================= */}
            {/* RIGHT: visit allocation and live token preview (4 of 12)  */}
            {/* ========================================================= */}
            {/* Editing an existing patient changes details only: no visit or token is booked. */}
            {!isEditMode && (
            <div className="space-y-5 xl:col-span-4">
              {/* SECTION 4: Visit & queue */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <SectionHeader
                  index="4"
                  title="Visit & Queue"
                  hint="Optional — allocate today's token now"
                  icon={<IconCalendar className="h-4 w-4" />}
                />

                <div className="space-y-4 p-5 sm:p-6">
                  <div>
                    <label htmlFor="visit-department" className={LABEL_CLASS}>
                      Department *
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                        <IconStethoscope className="h-4 w-4" />
                      </span>
                      <select
                        id="visit-department"
                        value={selectedDepartmentId}
                        onChange={(e) => {
                          setSelectedDepartmentId(e.target.value ? Number(e.target.value) : '')
                          setSelectedDoctorId('')
                        }}
                        className={`${INPUT_WITH_ICON_CLASS} pr-8`}
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

                  <div>
                    <label htmlFor="visit-doctor" className={LABEL_CLASS}>
                      Doctor *
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500">
                        <IconUserCheck className="h-4 w-4" />
                      </span>
                      <select
                        id="visit-doctor"
                        value={selectedDoctorId}
                        onChange={(e) => setSelectedDoctorId(e.target.value ? Number(e.target.value) : '')}
                        disabled={!selectedDepartmentId}
                        className={`${INPUT_WITH_ICON_CLASS} pr-8 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500`}
                      >
                        <option value="">
                          {selectedDepartmentId ? 'Select doctor' : 'Select a department first'}
                        </option>
                        {departmentDoctors?.map((doc: DepartmentDoctorOut) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.name_en}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <span className={LABEL_CLASS}>Visit Type</span>
                    <div className="flex gap-1 rounded-lg border border-slate-300 bg-slate-100/70 p-1">
                      <button
                        type="button"
                        onClick={() => setVisitType('walk-in')}
                        aria-pressed={visitType === 'walk-in'}
                        className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors ${
                          visitType === 'walk-in'
                            ? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs'
                            : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
                        }`}
                      >
                        <IconWalk className="h-4 w-4" />
                        Walk-in
                      </button>
                      <button
                        type="button"
                        onClick={() => setVisitType('appointment')}
                        aria-pressed={visitType === 'appointment'}
                        className={`flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-bold transition-colors ${
                          visitType === 'appointment'
                            ? 'border border-[#C39A35] bg-white text-[#5D0B26] shadow-2xs'
                            : 'border border-transparent text-slate-600 hover:text-[#5D0B26]'
                        }`}
                      >
                        <IconCalendar className="h-4 w-4" />
                        Appointment
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="reason-for-visit" className={LABEL_CLASS}>
                      Reason for Visit
                    </label>
                    <textarea
                      id="reason-for-visit"
                      rows={2}
                      value={reasonForVisit}
                      onChange={(e) => setReasonForVisit(e.target.value)}
                      placeholder="Main complaint / reason for visit…"
                      className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm font-medium text-slate-900 shadow-2xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-[#8E1C3D] focus:outline-none focus:ring-2 focus:ring-[#8E1C3D]/15"
                    />
                  </div>

                  {/* Live summary of what will be booked */}
                  <div className="rounded-lg border-l-2 border-[#C39A35] bg-[#FBF5F7] px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Booking summary
                    </p>
                    <p className="truncate text-xs font-semibold text-[#5D0B26]">
                      {selectedDepartment?.name_en || 'No department selected'}
                    </p>
                    <p className="truncate text-xs text-slate-600">
                      {selectedDoctor?.name_en || 'No doctor selected'}
                    </p>
                  </div>
                </div>
              </section>

              {/* SECTION 5: Token desk preview */}
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
                <SectionHeader
                  index="5"
                  title="Token Desk"
                  hint="Live ticket preview, printed on save"
                  icon={<IconTicket className="h-4 w-4" />}
                />

                <div className="p-5 sm:p-6">
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
                </div>
              </section>
            </div>
            )}
          </div>

          {/* Bottom action bar */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 border-l-4 border-l-[#C39A35] bg-white p-4 shadow-xs sm:flex-row sm:items-center sm:gap-4">
            {isEditMode ? (
              <p className="text-xs text-slate-600">
                Changes are saved to the patient record and shown on the registration card.
              </p>
            ) : (
              <label className="flex cursor-pointer select-none items-center gap-2.5 text-sm font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={saveAndAddAnother}
                  onChange={(e) => setSaveAndAddAnother(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-[#8E1C3D] focus:ring-[#8E1C3D]"
                />
                Save and add another
              </label>
            )}

            <div className="flex w-full items-center gap-3 sm:w-auto">
              {isEditMode ? (
                <button
                  type="button"
                  onClick={() => navigate(recordPath)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleClear}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#8E1C3D] cursor-pointer"
                >
                  <IconRefresh className="h-4 w-4 text-slate-500" />
                  Clear
                </button>
              )}

              <button
                type="submit"
                aria-label={isEditMode ? 'Save Changes' : 'Register Patient'}
                disabled={
                  isEditMode
                    ? updateMutation.isPending || editSaved || isConflict
                    : registerMutation.isPending ||
                      !!createdPatient ||
                      (isDuplicateDetected && !confirmDifferentPatient)
                }
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[#8E1C3D] px-6 text-sm font-bold text-white shadow-xs transition-colors hover:bg-[#5D0B26] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5D0B26] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer sm:flex-none"
              >
                <IconDeviceFloppy className="h-4 w-4" />
                {isEditMode
                  ? updateMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'
                  : registerMutation.isPending
                    ? 'Saving...'
                    : 'Save Registration'}
              </button>
            </div>
          </div>
        </form>
      </div>

      <PatientPhotoModal
        open={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        onPhotoSelected={handlePhotoConfirmed}
        currentPreview={photoPreview}
      />
    </AppShell>
  )
}
export default PatientRegister
