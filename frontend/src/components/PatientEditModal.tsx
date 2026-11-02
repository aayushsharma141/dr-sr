import { useState, useEffect, type FormEvent } from 'react'
import { useUpdatePatient } from '../api/queries'
import { ApiError, apiFetch } from '../api/client'
import { ConflictBanner } from './ConflictBanner'
import { Modal } from './Modal'
import type { PatientOut, PatientUpdate } from '../api/types'

interface PatientEditModalProps {
  patient: PatientOut
  isOpen: boolean
  onClose: () => void
  onSuccess: (updated: PatientOut) => void
}

export function PatientEditModal({
  patient,
  isOpen,
  onClose,
  onSuccess,
}: PatientEditModalProps) {
  const updateMutation = useUpdatePatient()

  // Form states
  const [fullName, setFullName] = useState(patient.full_name)
  const [guardianName, setGuardianName] = useState(patient.guardian_name)
  const [gender, setGender] = useState<'M' | 'F' | 'O'>(patient.gender)
  const [dob, setDob] = useState(patient.dob || '')
  const [ageYears, setAgeYears] = useState<number | ''>(patient.age_years)
  const [mobile, setMobile] = useState(patient.mobile)
  const [address, setAddress] = useState(patient.address)
  const [district, setDistrict] = useState(patient.district)
  const [state, setState] = useState(patient.state)
  const [emergencyContact, setEmergencyContact] = useState(patient.emergency_contact || '')
  const [allergies, setAllergies] = useState(patient.allergies)
  const [notes, setNotes] = useState(patient.notes || '')
  const [versionId, setVersionId] = useState(patient.version_id)

  const [isConflict, setIsConflict] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  useEffect(() => {
    setFullName(patient.full_name)
    setGuardianName(patient.guardian_name)
    setGender(patient.gender)
    setDob(patient.dob || '')
    setAgeYears(patient.age_years)
    setMobile(patient.mobile)
    setAddress(patient.address)
    setDistrict(patient.district)
    setState(patient.state)
    setEmergencyContact(patient.emergency_contact || '')
    setAllergies(patient.allergies)
    setNotes(patient.notes || '')
    setVersionId(patient.version_id)
    setIsConflict(false)
    setErrorMsg(null)
  }, [patient])

  if (!isOpen) return null

  const handleReload = async () => {
    setIsReloading(true)
    try {
      const fresh = await apiFetch<PatientOut>(`/patients/${patient.id}`)
      setFullName(fresh.full_name)
      setGuardianName(fresh.guardian_name)
      setGender(fresh.gender)
      setDob(fresh.dob || '')
      setAgeYears(fresh.age_years)
      setMobile(fresh.mobile)
      setAddress(fresh.address)
      setDistrict(fresh.district)
      setState(fresh.state)
      setEmergencyContact(fresh.emergency_contact || '')
      setAllergies(fresh.allergies)
      setNotes(fresh.notes || '')
      setVersionId(fresh.version_id)
      setIsConflict(false)
      setErrorMsg(null)
    } catch {
      setErrorMsg('Failed to reload latest patient data.')
    } finally {
      setIsReloading(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setIsConflict(false)

    if (ageYears === '' || ageYears < 0) {
      setErrorMsg('Please enter a valid age in years.')
      return
    }

    const body: PatientUpdate = {
      version_id: versionId,
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
      const updated = await updateMutation.mutateAsync({ id: patient.id, body })
      onSuccess(updated)
      onClose()
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        if (err.status === 409 || err.code === 'version_conflict') {
          setIsConflict(true)
        } else {
          setErrorMsg(err.message)
        }
      } else {
        setErrorMsg('Failed to save changes. Please try again.')
      }
    }
  }

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="Edit Patient Demographics"
      description={`URN: ${patient.urn}`}
      busy={updateMutation.isPending}
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {isConflict && (
          <ConflictBanner onReload={handleReload} isReloading={isReloading} />
        )}

        {errorMsg && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-red-900 text-sm">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="edit-full-name" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Full Name *
              </label>
              <input
                id="edit-full-name"
                data-autofocus
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-guardian-name" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Father / Guardian / Spouse *
              </label>
              <input
                id="edit-guardian-name"
                type="text"
                required
                value={guardianName}
                onChange={(e) => setGuardianName(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-gender" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Gender *
              </label>
              <select
                id="edit-gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 bg-white focus:outline-hidden focus:border-red-900"
              >
                <option value="M">Male (M)</option>
                <option value="F">Female (F)</option>
                <option value="O">Other (O)</option>
              </select>
            </div>

            <div>
              <label htmlFor="edit-age-years" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Age (Years) *
              </label>
              <input
                id="edit-age-years"
                type="number"
                min={0}
                max={150}
                required
                value={ageYears}
                onChange={(e) => setAgeYears(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-mobile" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Mobile Number *
              </label>
              <input
                id="edit-mobile"
                type="tel"
                required
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-dob" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Date of Birth
              </label>
              <input
                id="edit-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="edit-address" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Address *
              </label>
              <input
                id="edit-address"
                type="text"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-district" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                District *
              </label>
              <input
                id="edit-district"
                type="text"
                required
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-state" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                State *
              </label>
              <input
                id="edit-state"
                type="text"
                required
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-emergency" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Emergency Contact
              </label>
              <input
                id="edit-emergency"
                type="text"
                value={emergencyContact}
                onChange={(e) => setEmergencyContact(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div>
              <label htmlFor="edit-allergies" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Allergies *
              </label>
              <input
                id="edit-allergies"
                type="text"
                required
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="edit-notes" className="block text-xs font-semibold text-neutral-700 uppercase mb-1">
                Notes
              </label>
              <textarea
                id="edit-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-neutral-300 rounded text-sm text-neutral-900 focus:outline-hidden focus:border-red-900"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-neutral-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-neutral-300 rounded text-sm font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending || isConflict}
              className="px-5 py-2 bg-red-900 text-white rounded text-sm font-medium hover:bg-red-800 disabled:opacity-50 cursor-pointer"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Demographic Changes'}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  )
}
