import { useState, type FormEvent, useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  useRegisterPatient,
  useUploadPatientPhoto,
  useCheckDuplicate,
  useMe,
} from '../api/queries'
import { ApiError } from '../api/client'
import { AppShell } from '../components/AppShell'
import { PhotoUploader } from '../components/PhotoUploader'
import { UnsavedChangesGuard } from '../components/UnsavedChangesGuard'
import type { PatientCreate, PatientOut } from '../api/types'

export function PatientRegister() {
  const { data: me } = useMe()
  const navigate = useNavigate()

  const registerMutation = useRegisterPatient()
  const uploadPhotoMutation = useUploadPatientPhoto()

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

  // Photo
  const [photoFile, setPhotoFile] = useState<File | null>(null)

  // Duplicate warning & confirmation
  const [debouncedName, setDebouncedName] = useState('')
  const [debouncedMobile, setDebouncedMobile] = useState('')
  const [confirmDifferentPatient, setConfirmDifferentPatient] = useState(false)

  // Success & Error feedback
  const [createdPatient, setCreatedPatient] = useState<PatientOut | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [photoWarning, setPhotoWarning] = useState<string | null>(null)

  // Unsaved changes protection
  const isDirty =
    !createdPatient &&
    Boolean(
      fullName.trim() ||
        guardianName.trim() ||
        mobile.trim() ||
        address.trim() ||
        notes.trim(),
    )

  // Debounce name and mobile for duplicate check
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

  // Auto-calculate age from DOB if changed
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (registerMutation.isPending || createdPatient) return
    setFormError(null)

    if (ageYears === '' || ageYears < 0) {
      setFormError('Please enter a valid age in years.')
      return
    }

    if (isDuplicateDetected && !confirmDifferentPatient) {
      setFormError('Please confirm this is a different patient before proceeding.')
      return
    }

    const payload: PatientCreate = {
      full_name: fullName.trim(),
      guardian_name: guardianName.trim(),
      gender,
      dob: dob.trim() || null,
      age_years: Number(ageYears),
      mobile: mobile.trim(),
      address: address.trim(),
      district: district.trim(),
      state: state.trim(),
      emergency_contact: emergencyContact.trim() || null,
      allergies: allergies.trim() || 'None reported',
      notes: notes.trim() || null,
    }

    try {
      const patient = await registerMutation.mutateAsync(payload)

      if (photoFile) {
        try {
          await uploadPhotoMutation.mutateAsync({
            id: patient.id,
            file: photoFile,
          })
        } catch {
          // Registration is saved; tell the user the photo is missing so it can be retaken from the patient file.
          setPhotoWarning('Patient registered, but the photo could not be uploaded. Add it from the patient file.')
        }
      }

      setCreatedPatient(patient)
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        setFormError(err.message)
      } else {
        setFormError('Registration failed. Please check the network connection.')
      }
    }
  }

  return (
    <AppShell name={me?.full_name || 'Reception Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-6 w-full max-w-7xl mx-auto">
        <UnsavedChangesGuard dirty={isDirty} />
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-neutral-200 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <Link
                to={me?.role === 'ADMIN' ? '/admin' : '/reception'}
                className="text-xs text-rose-900 hover:underline font-bold flex items-center gap-1"
              >
                &larr; Back to Dashboard
              </Link>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight mt-1">
              New Patient Registration
            </h2>
            <p className="text-xs text-neutral-600 mt-0.5">
              Register canonical patient demographic details, capture guardian info, and assign an atomic URN.
            </p>
          </div>
          <Link
            to="/reception/patients"
            className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-800 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors min-h-[40px]"
          >
            Search Existing Records
          </Link>
        </div>

        {/* Success Banner */}
        {createdPatient && (
          <div
            role="status"
            className="p-6 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-950 space-y-4 shadow-xs"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-emerald-950">
                  Registration Successful!
                </h3>
                <p className="text-sm text-emerald-900 mt-1">
                  Patient <span className="font-bold">{createdPatient.full_name}</span> has been registered and assigned URN:
                </p>
                <div className="mt-2.5 inline-block px-5 py-2.5 bg-emerald-100 border border-emerald-400 rounded-lg font-mono text-2xl font-black text-emerald-950 shadow-2xs">
                  {createdPatient.urn}
                </div>
                {photoWarning && (
                  <p role="alert" className="mt-3 text-sm font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
                    {photoWarning}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(`/reception/patients/${createdPatient.id}`)}
                className="px-5 py-2.5 bg-emerald-900 text-white rounded-lg font-semibold text-sm hover:bg-emerald-950 transition-colors cursor-pointer min-h-[44px]"
              >
                View Patient File & Card &rarr;
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedPatient(null)
                  setPhotoWarning(null)
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
                  setPhotoFile(null)
                  setConfirmDifferentPatient(false)
                }}
                className="px-5 py-2.5 border border-emerald-400 bg-white text-emerald-950 rounded-lg font-semibold text-sm hover:bg-emerald-50 transition-colors cursor-pointer min-h-[44px]"
              >
                + Register Another Patient
              </button>
            </div>
          </div>
        )}

        {/* Duplicate Patient Warning Banner */}
        {isDuplicateDetected && duplicateData?.matching_patient && (
          <div
            role="alert"
            className="p-5 bg-amber-50 border border-amber-300 rounded-xl text-amber-950 space-y-3 shadow-xs"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold text-base text-amber-950">
                Potential Duplicate Patient Detected
              </span>
            </div>
            <p className="text-sm text-amber-900">
              A patient matching <span className="font-bold">{duplicateData.matching_patient.full_name}</span> with mobile{' '}
              <span className="font-bold">{duplicateData.matching_patient.mobile}</span> is already registered:
            </p>
            <div className="p-3.5 bg-white/90 rounded-lg border border-amber-200 text-xs font-mono space-y-1">
              <div><strong>URN:</strong> {duplicateData.matching_patient.urn}</div>
              <div><strong>Guardian:</strong> {duplicateData.matching_patient.guardian_name}</div>
              <div><strong>Registered:</strong> {new Date(duplicateData.matching_patient.created_at).toLocaleDateString()}</div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-amber-200">
              <div className="flex items-center gap-2.5">
                <input
                  id="confirm-different-checkbox"
                  type="checkbox"
                  checked={confirmDifferentPatient}
                  onChange={(e) => setConfirmDifferentPatient(e.target.checked)}
                  className="h-4 w-4 rounded border-amber-400 text-red-900 focus:ring-red-900"
                />
                <label
                  htmlFor="confirm-different-checkbox"
                  className="text-sm font-semibold text-amber-950 cursor-pointer"
                >
                  Confirm this is a different patient (allow new registration)
                </label>
              </div>

              <Link
                to={`/reception/patients/${duplicateData.matching_patient.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-900 hover:bg-amber-950 text-white text-xs font-bold shadow-2xs transition-colors"
              >
                View Existing Patient Profile (URN: {duplicateData.matching_patient.urn}) &rarr;
              </Link>
            </div>
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-300 rounded-lg text-red-900 text-sm font-medium"
          >
            {formError}
          </div>
        )}

        {/* Registration Form in Landscape 2-Column Desktop Grid */}
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left Column: Demographics, Contacts & Medical (8 Cols) */}
            <div className="lg:col-span-8 space-y-6">
              {/* Card 1: Identification & Demographics */}
              <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs space-y-5">
                <div className="border-b border-neutral-100 pb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-800">
                    1. Patient Identification & Demographics
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Primary legal name, family guardian, and verified age</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="md:col-span-2">
                    <label htmlFor="patient-full-name" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Full Name *
                    </label>
                    <input
                      id="patient-full-name"
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Ramesh Chandra Verma"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-guardian-name" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Father / Guardian / Spouse Name *
                    </label>
                    <input
                      id="patient-guardian-name"
                      type="text"
                      required
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      placeholder="Guardian / Relative name"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-gender" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Gender *
                    </label>
                    <select
                      id="patient-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    >
                      <option value="M">Male (M)</option>
                      <option value="F">Female (F)</option>
                      <option value="O">Other (O)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="patient-dob" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Date of Birth (Optional)
                    </label>
                    <input
                      id="patient-dob"
                      type="date"
                      value={dob}
                      onChange={(e) => handleDobChange(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-age" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Age (Years) *
                    </label>
                    <input
                      id="patient-age"
                      type="number"
                      min={0}
                      max={150}
                      required
                      value={ageYears}
                      onChange={(e) => setAgeYears(e.target.value === '' ? '' : Number(e.target.value))}
                      placeholder="Age in completed years"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>
              </div>

              {/* Card 2: Contact & Residential Details */}
              <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs space-y-5">
                <div className="border-b border-neutral-100 pb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-800">
                    2. Contact & Residential Details
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Mobile contact for appointment tokens and full residential address</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="patient-mobile" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Mobile Number *
                    </label>
                    <div className="relative">
                      <input
                        id="patient-mobile"
                        type="tel"
                        required
                        value={mobile}
                        onChange={(e) => setMobile(e.target.value)}
                        placeholder="10-digit mobile number"
                        className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                      />
                      {duplicateChecking && (
                        <span className="absolute right-3.5 top-3.5 text-xs text-neutral-600 font-medium">
                          Checking...
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="patient-emergency" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Emergency Contact (Optional)
                    </label>
                    <input
                      id="patient-emergency"
                      type="text"
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="Alternative mobile / contact name"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div className="md:col-span-2">
                    <label htmlFor="patient-address" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Address (Village / Mohalla / Ward) *
                    </label>
                    <input
                      id="patient-address"
                      type="text"
                      required
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Full residential street / village address"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-district" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      District *
                    </label>
                    <input
                      id="patient-district"
                      type="text"
                      required
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-state" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      State *
                    </label>
                    <input
                      id="patient-state"
                      type="text"
                      required
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>
              </div>

              {/* Card 3: Medical Notes & Allergies */}
              <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs space-y-5">
                <div className="border-b border-neutral-100 pb-3">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-800">
                    3. Medical Notes & Clinical Alerts
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Drug reactions, known allergies and chief presenting complaints</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label htmlFor="patient-allergies" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Allergies *
                    </label>
                    <input
                      id="patient-allergies"
                      type="text"
                      required
                      value={allergies}
                      onChange={(e) => setAllergies(e.target.value)}
                      placeholder="e.g. Penicillin, Sulfa drugs, or 'None reported'"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg min-h-[44px] text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>

                  <div>
                    <label htmlFor="patient-notes" className="block text-xs font-bold uppercase tracking-wider text-neutral-700 mb-1.5">
                      Clinical / Administrative Notes (Optional)
                    </label>
                    <textarea
                      id="patient-notes"
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Chief complaints, reference source, or intake remarks"
                      className="w-full px-3.5 py-2.5 border border-neutral-300 rounded-lg text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Photo Capture & Registration Guidelines (4 Cols) */}
            <div className="lg:col-span-4 space-y-6">
              {/* Card 4: Patient Photograph */}
              <div className="bg-white rounded-xl border border-neutral-200 p-6 shadow-xs space-y-4">
                <div className="border-b border-neutral-100 pb-2.5">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-800">
                    Patient Photograph
                  </h3>
                  <p className="text-xs text-neutral-600 mt-0.5">Capture via webcam or upload intake photo</p>
                </div>

                <PhotoUploader
                  onPhotoSelected={setPhotoFile}
                  disabled={registerMutation.isPending}
                />
              </div>

              {/* Card 5: Registration Guidelines & URN Standard */}
              <div className="bg-neutral-50 rounded-xl border border-neutral-200 p-5 shadow-xs space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-neutral-800">
                  Registration Standards
                </h4>
                <ul className="text-xs text-neutral-700 space-y-2 list-disc list-inside font-medium">
                  <li>
                    <strong>Atomic URN:</strong> Format is <code className="font-mono text-rose-900 bg-white px-1.5 py-0.5 rounded border border-neutral-200">KH-YYYY-XXXX</code>, guaranteed collision-free under concurrent multi-user intake.
                  </li>
                  <li>
                    <strong>Duplicate Prevention:</strong> System automatically cross-checks Name and 10-digit mobile number before allocation.
                  </li>
                  <li>
                    <strong>Printable Card:</strong> After submission, an A4 double-signature registration card can be printed immediately.
                  </li>
                </ul>
              </div>
            </div>
          </div>

          {/* Form Action Bar */}
          <div className="flex items-center justify-between gap-4 p-5 bg-white rounded-xl border border-neutral-200 shadow-xs">
            <Link
              to={me?.role === 'ADMIN' ? '/admin' : '/reception'}
              className="px-5 py-2.5 border border-neutral-300 text-neutral-700 hover:bg-neutral-50 rounded-lg text-sm font-semibold transition-colors min-h-[44px] inline-flex items-center justify-center"
            >
              Cancel & Exit
            </Link>
            <button
              type="submit"
              disabled={
                registerMutation.isPending ||
                createdPatient !== null ||
                (isDuplicateDetected && !confirmDifferentPatient)
              }
              className="px-8 py-2.5 text-sm font-bold text-white bg-[#8E1C3D] hover:bg-[#721631] rounded-lg min-h-[44px] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 cursor-pointer shadow-xs transition-colors"
            >
              {registerMutation.isPending ? 'Registering Patient...' : 'Register Patient'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
