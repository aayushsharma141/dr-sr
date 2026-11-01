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
          // Photo upload failure is non-fatal to registration
          console.error('Failed to upload photo after registration.')
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
      <div className="space-y-6 max-w-4xl mx-auto">
        <div>
          <div className="flex items-center gap-2">
            <Link
              to={me?.role === 'ADMIN' ? '/admin' : '/reception'}
              className="text-sm text-red-900 hover:underline font-medium"
            >
              &larr; Back to Dashboard
            </Link>
          </div>
          <h2 className="text-2xl font-bold text-neutral-900 tracking-tight mt-2">
            New Patient Registration
          </h2>
          <p className="text-sm text-neutral-500">
            Register patient demographic details, capture guardian info, and assign an atomic URN.
          </p>
        </div>

        {/* Success Modal / Banner */}
        {createdPatient && (
          <div
            role="status"
            className="p-6 bg-emerald-50 border border-emerald-300 rounded-lg text-emerald-950 space-y-4 shadow-sm"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-emerald-900">
                  Registration Successful!
                </h3>
                <p className="text-sm text-emerald-800 mt-1">
                  Patient <span className="font-semibold">{createdPatient.full_name}</span> has been assigned URN:
                </p>
                <div className="mt-2 inline-block px-4 py-2 bg-emerald-100 border border-emerald-400 rounded-md font-mono text-xl font-bold text-emerald-950">
                  {createdPatient.urn}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => navigate(`/reception/patients/${createdPatient.id}`)}
                className="px-4 py-2 bg-emerald-800 text-white rounded font-medium text-sm hover:bg-emerald-900 cursor-pointer"
              >
                View Patient File & Card
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreatedPatient(null)
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
                className="px-4 py-2 border border-emerald-400 bg-white text-emerald-900 rounded font-medium text-sm hover:bg-emerald-50 cursor-pointer"
              >
                Register Another Patient
              </button>
            </div>
          </div>
        )}

        {/* Duplicate Patient Warning Banner */}
        {isDuplicateDetected && duplicateData?.matching_patient && (
          <div
            role="alert"
            className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-950 space-y-3"
          >
            <div className="flex items-center gap-2">
              <span className="font-bold text-amber-900">
                Potential Duplicate Patient Detected
              </span>
            </div>
            <p className="text-sm text-amber-900">
              A patient matching <span className="font-semibold">{duplicateData.matching_patient.full_name}</span> with mobile{' '}
              <span className="font-semibold">{duplicateData.matching_patient.mobile}</span> is already registered:
            </p>
            <div className="p-3 bg-white/80 rounded border border-amber-200 text-xs font-mono space-y-1">
              <div><strong>URN:</strong> {duplicateData.matching_patient.urn}</div>
              <div><strong>Guardian:</strong> {duplicateData.matching_patient.guardian_name}</div>
              <div><strong>Registered:</strong> {new Date(duplicateData.matching_patient.created_at).toLocaleDateString()}</div>
            </div>
            <div className="flex items-center gap-2 pt-2 border-t border-amber-200">
              <input
                id="confirm-different-checkbox"
                type="checkbox"
                checked={confirmDifferentPatient}
                onChange={(e) => setConfirmDifferentPatient(e.target.checked)}
                className="h-4 w-4 rounded border-amber-400 text-red-900 focus:ring-red-900"
              />
              <label
                htmlFor="confirm-different-checkbox"
                className="text-sm font-medium text-amber-950 cursor-pointer"
              >
                Confirm this is a different patient (allow new registration)
              </label>
            </div>
          </div>
        )}

        {formError && (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-300 rounded-md text-red-900 text-sm"
          >
            {formError}
          </div>
        )}

        {/* Registration Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg border border-neutral-200 p-6 shadow-xs space-y-6"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label htmlFor="patient-full-name" className="block text-sm font-medium text-neutral-800 mb-1">
                Full Name *
              </label>
              <input
                id="patient-full-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Patient legal or known name"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-guardian-name" className="block text-sm font-medium text-neutral-800 mb-1">
                Father / Guardian / Spouse Name *
              </label>
              <input
                id="patient-guardian-name"
                type="text"
                required
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                placeholder="Guardian name"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-gender" className="block text-sm font-medium text-neutral-800 mb-1">
                Gender *
              </label>
              <select
                id="patient-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 bg-white focus-visible:outline-2 focus-visible:outline-red-800"
              >
                <option value="M">Male (M)</option>
                <option value="F">Female (F)</option>
                <option value="O">Other (O)</option>
              </select>
            </div>

            <div>
              <label htmlFor="patient-mobile" className="block text-sm font-medium text-neutral-800 mb-1">
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
                  className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                />
                {duplicateChecking && (
                  <span className="absolute right-3 top-3 text-xs text-neutral-400">
                    Checking...
                  </span>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="patient-dob" className="block text-sm font-medium text-neutral-800 mb-1">
                Date of Birth (Optional)
              </label>
              <input
                id="patient-dob"
                type="date"
                value={dob}
                onChange={(e) => handleDobChange(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-age" className="block text-sm font-medium text-neutral-800 mb-1">
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
                placeholder="Age in years"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="patient-address" className="block text-sm font-medium text-neutral-800 mb-1">
                Address (Village / Mohalla / Ward) *
              </label>
              <input
                id="patient-address"
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Full residential address"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-district" className="block text-sm font-medium text-neutral-800 mb-1">
                District *
              </label>
              <input
                id="patient-district"
                type="text"
                required
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-state" className="block text-sm font-medium text-neutral-800 mb-1">
                State *
              </label>
              <input
                id="patient-state"
                type="text"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-emergency" className="block text-sm font-medium text-neutral-800 mb-1">
                Emergency Contact (Optional)
              </label>
              <input
                id="patient-emergency"
                type="text"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                placeholder="Alternative contact / relationship"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div>
              <label htmlFor="patient-allergies" className="block text-sm font-medium text-neutral-800 mb-1">
                Allergies *
              </label>
              <input
                id="patient-allergies"
                type="text"
                required
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="Known drug or food allergies"
                className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            <div className="md:col-span-2">
              <label htmlFor="patient-notes" className="block text-sm font-medium text-neutral-800 mb-1">
                Clinical / Administrative Notes (Optional)
              </label>
              <textarea
                id="patient-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special remarks or chief complaints"
                className="w-full px-3 py-2 border border-neutral-300 rounded text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
              />
            </div>

            {/* Photo Uploader */}
            <div className="md:col-span-2 pt-2 border-t border-neutral-200">
              <PhotoUploader
                onPhotoSelected={setPhotoFile}
                disabled={registerMutation.isPending}
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-4 pt-6 border-t border-neutral-200">
            <button
              type="submit"
              disabled={
                registerMutation.isPending ||
                (isDuplicateDetected && !confirmDifferentPatient)
              }
              className="px-6 py-2.5 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {registerMutation.isPending ? 'Registering Patient...' : 'Register Patient'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
