import React, { useState, useEffect } from 'react'
import {
  useAdminSearchPatients,
  useCorrectPatientDemographics,
  useMe,
} from '../../api/queries'
import { apiFetch, ApiError } from '../../api/client'
import type { PatientOut, AdminPatientDemographicCorrection } from '../../api/types'
import { ConflictBanner } from '../../components/ConflictBanner'
import { DemographicCorrectionModal } from '../../components/admin/DemographicCorrectionModal'
import { AppShell } from '../../components/AppShell'

export function PatientCorrectionPage() {
  const { data: me } = useMe()
  const [searchQuery, setSearchQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<PatientOut | null>(null)

  // Form edit state
  const [fullName, setFullName] = useState('')
  const [guardianName, setGuardianName] = useState('')
  const [gender, setGender] = useState<'M' | 'F' | 'O'>('M')
  const [dob, setDob] = useState('')
  const [ageYears, setAgeYears] = useState<number>(0)
  const [mobile, setMobile] = useState('')
  const [address, setAddress] = useState('')
  const [district, setDistrict] = useState('Bhojpur')
  const [state, setState] = useState('Bihar')
  const [emergencyContact, setEmergencyContact] = useState('')

  // UI state
  const [conflictError, setConflictError] = useState<string | null>(null)
  const [isReloading, setIsReloading] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const {
    data: searchResults,
    isLoading: isSearching,
    isError: isSearchError,
  } = useAdminSearchPatients(activeQuery)

  const correctMutation = useCorrectPatientDemographics()

  // Initialize form when a patient is selected
  useEffect(() => {
    if (selectedPatient) {
      setFullName(selectedPatient.full_name)
      setGuardianName(selectedPatient.guardian_name)
      setGender(selectedPatient.gender)
      setDob(selectedPatient.dob || '')
      setAgeYears(selectedPatient.age_years)
      setMobile(selectedPatient.mobile)
      setAddress(selectedPatient.address)
      setDistrict(selectedPatient.district || 'Bhojpur')
      setState(selectedPatient.state || 'Bihar')
      setEmergencyContact(selectedPatient.emergency_contact || '')
      setConflictError(null)
      setSuccessMessage(null)
      setGeneralError(null)
    }
  }, [selectedPatient])

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (searchQuery.trim().length >= 1) {
      setActiveQuery(searchQuery.trim())
    }
  }

  const handleReloadPatient = async () => {
    if (!selectedPatient) return
    setIsReloading(true)
    try {
      const latest = await apiFetch<PatientOut>(`/patients/${selectedPatient.id}`)
      setSelectedPatient(latest)
      setConflictError(null)
    } catch {
      setGeneralError('Failed to reload latest patient record.')
    } finally {
      setIsReloading(false)
    }
  }

  const proposedCorrection: Omit<AdminPatientDemographicCorrection, 'reason' | 'version_id'> = {
    full_name: fullName.trim(),
    guardian_name: guardianName.trim(),
    gender,
    dob: dob || null,
    age_years: Number(ageYears) || 0,
    mobile: mobile.trim(),
    address: address.trim(),
    district: district.trim(),
    state: state.trim(),
    emergency_contact: emergencyContact.trim() || null,
  }

  const handleOpenReview = (e: React.FormEvent) => {
    e.preventDefault()
    setGeneralError(null)
    setSuccessMessage(null)
    setIsModalOpen(true)
  }

  const handleApplyCorrection = async (reason: string) => {
    if (!selectedPatient) return
    setGeneralError(null)
    setConflictError(null)

    const payload: AdminPatientDemographicCorrection = {
      ...proposedCorrection,
      version_id: selectedPatient.version_id,
      reason,
    }

    try {
      const updated = await correctMutation.mutateAsync({
        id: selectedPatient.id,
        payload,
      })
      setSelectedPatient(updated)
      setIsModalOpen(false)
      setSuccessMessage('Patient demographic record updated and permanently audited successfully.')
    } catch (err: unknown) {
      setIsModalOpen(false)
      if (err instanceof ApiError && err.status === 409) {
        setConflictError('Patient demographics were updated in another session.')
      } else if (err instanceof ApiError && err.message) {
        setGeneralError(err.message)
      } else {
        setGeneralError('An unexpected error occurred while applying demographic correction.')
      }
    }
  }

  return (
    <AppShell name={me?.full_name ?? 'Admin'} role={me?.role ?? 'ADMIN'}>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Patient Corrections
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Audited administrative workspace for correcting patient identity and contact records. Historical printouts retain their original issued snapshot.
          </p>
        </div>

      {/* Patient Search Section */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <form onSubmit={handleSearchSubmit} className="space-y-3">
          <label
            htmlFor="patient-search-input"
            className="block text-xs font-bold text-slate-800"
          >
            Lookup Patient by URN, Name, Mobile, or Legacy URN
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="patient-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by URN (e.g. KH-26-P-11-00001), patient name, mobile, or legacy hospital ID..."
              className="flex-1 min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
            />
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className="min-h-11 rounded-lg px-6 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-[#8E1C3D] bg-[#8E1C3D] text-white hover:bg-[#731631] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500 disabled:opacity-100 shadow-2xs"
            >
              {isSearching ? 'Searching...' : 'Search Patients'}
            </button>
          </div>
        </form>

        {/* Guidance card when no search has been initiated */}
        {!activeQuery && !selectedPatient && (
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/70 p-6">
            <h2 className="text-sm font-bold text-slate-800">
              Audited Patient Demographic Correction Guidelines
            </h2>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-slate-600">
              <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-2xs">
                <span className="font-bold text-slate-900 block mb-1">1. Lookup & Select</span>
                Search for the patient by permanent URN, mobile number, or full name to load their authoritative record.
              </div>
              <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-2xs">
                <span className="font-bold text-slate-900 block mb-1">2. Mandatory Audit Reason</span>
                Every change requires a documented justification permanently recorded in the administrative audit log.
              </div>
              <div className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-2xs">
                <span className="font-bold text-slate-900 block mb-1">3. Immutable Printouts</span>
                Historical consultation summaries, prescriptions, and receipts retain their original issued demographic snapshots.
              </div>
            </div>
          </div>
        )}

        {/* Search Results Display */}
        {activeQuery && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            {isSearching && (
              <p className="text-xs text-slate-500 italic py-2">Searching patient database...</p>
            )}

            {isSearchError && (
              <p className="text-xs text-red-600 py-2">Failed to search patient records. Try again.</p>
            )}

            {!isSearching && searchResults && searchResults.length === 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center" data-testid="empty-search-state">
                <h3 className="text-sm font-bold text-slate-800">
                  No Matching Patients Found
                </h3>
                <p className="mt-1 text-xs text-slate-600 max-w-md mx-auto">
                  No registered patient matches the search query. Verify the URN, mobile number, or spelling of the patient&apos;s name, or search by prior hospital number.
                </p>
              </div>
            )}

            {!isSearching && searchResults && searchResults.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold">Search Results ({searchResults.length})</span>
                  <span>Select a patient to open correction form</span>
                </div>
                <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 rounded-md border border-slate-200">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPatient(p)}
                      className={`w-full text-left p-3 text-xs transition-colors cursor-pointer flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 ${
                        selectedPatient?.id === p.id
                          ? 'bg-rose-50 border-l-4 border-l-[#8E1C3D]'
                          : 'hover:bg-slate-50 bg-white'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900 text-sm">{p.full_name}</span>
                          <span className="font-mono font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded text-xs">
                            {p.urn}
                          </span>
                          {p.legacy_urn && (
                            <span className="font-mono text-slate-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded text-xs">
                              Old: {p.legacy_urn}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-600">
                          Guardian: {p.guardian_name} · Age/Gender: {p.age_years} Y / {p.gender}
                        </p>
                      </div>
                      <div className="text-slate-600 sm:text-right">
                        <p className="font-mono">{p.mobile}</p>
                        <p className="truncate max-w-xs">{p.address}, {p.district}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected Patient Correction Workspace */}
      {selectedPatient && (
        <div className="space-y-5">
          {/* Concurrency Banner upon HTTP 409 */}
          {conflictError && (
            <ConflictBanner
              message={conflictError}
              actionLabel="Reload Patient Record"
              onReload={handleReloadPatient}
              isReloading={isReloading}
            />
          )}

          {successMessage && (
            <div
              role="alert"
              className="rounded-md border border-emerald-300 bg-emerald-50 p-4 text-xs font-semibold text-emerald-950 flex items-center justify-between"
            >
              <span>{successMessage}</span>
              <button
                type="button"
                onClick={() => setSuccessMessage(null)}
                className="text-emerald-800 hover:text-emerald-950 font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
          )}

          {generalError && (
            <div
              role="alert"
              className="rounded-md border border-red-300 bg-red-50 p-4 text-xs font-semibold text-red-950 flex items-center justify-between"
            >
              <span>{generalError}</span>
              <button
                type="button"
                onClick={() => setGeneralError(null)}
                className="text-red-800 hover:text-red-950 font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left Column: Editable Form Fields */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Demographic Record Editor
                </h2>
                <span className="text-xs text-slate-500 font-mono">
                  Version: {selectedPatient.version_id}
                </span>
              </div>

              <form onSubmit={handleOpenReview} className="space-y-4">
                {/* URN - Strictly Locked */}
                <div>
                  <label htmlFor="patient-urn-locked" className="block text-xs font-bold text-slate-700">
                    Patient URN (Immutable)
                  </label>
                  <input
                    id="patient-urn-locked"
                    type="text"
                    disabled
                    value={selectedPatient.urn}
                    className="mt-1 w-full min-h-11 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-mono text-slate-600 cursor-not-allowed"
                  />
                  <p className="mt-0.5 text-xs text-slate-500">
                    Official gap-free URN cannot be modified or reissued.
                  </p>
                </div>

                {/* Legacy URN if present */}
                {selectedPatient.legacy_urn && (
                  <div>
                    <label htmlFor="patient-legacy-urn-locked" className="block text-xs font-bold text-slate-700">
                      Legacy Hospital URN (Read-only)
                    </label>
                    <input
                      id="patient-legacy-urn-locked"
                      type="text"
                      disabled
                      value={selectedPatient.legacy_urn}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-200 bg-slate-100 px-3 py-2 text-sm font-mono text-slate-600 cursor-not-allowed"
                    />
                  </div>
                )}

                {/* Full Name & Guardian Name */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="patient-fullname" className="block text-xs font-bold text-slate-800">
                      Full Name <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-fullname"
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-guardian" className="block text-xs font-bold text-slate-800">
                      Guardian Name <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-guardian"
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      value={guardianName}
                      onChange={(e) => setGuardianName(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>

                {/* Gender & Age / DOB */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="patient-gender" className="block text-xs font-bold text-slate-800">
                      Gender <span className="text-red-700">*</span>
                    </label>
                    <select
                      id="patient-gender"
                      value={gender}
                      onChange={(e) => setGender(e.target.value as 'M' | 'F' | 'O')}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    >
                      <option value="M">Male (M)</option>
                      <option value="F">Female (F)</option>
                      <option value="O">Other (O)</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="patient-age" className="block text-xs font-bold text-slate-800">
                      Age (Years) <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-age"
                      type="number"
                      required
                      min={0}
                      max={150}
                      value={ageYears}
                      onChange={(e) => setAgeYears(Number(e.target.value))}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-dob" className="block text-xs font-bold text-slate-800">
                      Date of Birth
                    </label>
                    <input
                      id="patient-dob"
                      type="date"
                      value={dob}
                      onChange={(e) => setDob(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>

                {/* Mobile & Emergency Contact */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="patient-mobile" className="block text-xs font-bold text-slate-800">
                      Mobile Number (10 digits) <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-mobile"
                      type="tel"
                      required
                      pattern="^[0-9]{10}$"
                      maxLength={10}
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-emergency" className="block text-xs font-bold text-slate-800">
                      Emergency Contact
                    </label>
                    <input
                      id="patient-emergency"
                      type="text"
                      maxLength={120}
                      value={emergencyContact}
                      onChange={(e) => setEmergencyContact(e.target.value)}
                      placeholder="Name / number"
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>

                {/* Address */}
                <div>
                  <label htmlFor="patient-address" className="block text-xs font-bold text-slate-800">
                    Address / Village <span className="text-red-700">*</span>
                  </label>
                  <textarea
                    id="patient-address"
                    required
                    minLength={2}
                    maxLength={1000}
                    rows={2}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                  />
                </div>

                {/* District & State */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="patient-district" className="block text-xs font-bold text-slate-800">
                      District <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-district"
                      type="text"
                      required
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-state" className="block text-xs font-bold text-slate-800">
                      State <span className="text-red-700">*</span>
                    </label>
                    <input
                      id="patient-state"
                      type="text"
                      required
                      value={state}
                      onChange={(e) => setState(e.target.value)}
                      className="mt-1 w-full min-h-11 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-xs focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    />
                  </div>
                </div>

                {/* Read-only Clinical Allergies and Notes */}
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                  <span className="block text-xs font-bold text-slate-700">
                    Clinical Allergies &amp; Reception Notes (Protected)
                  </span>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p>
                      <strong className="text-slate-700">Allergies:</strong> {selectedPatient.allergies}
                    </p>
                    <p>
                      <strong className="text-slate-700">Notes:</strong> {selectedPatient.notes || 'None recorded'}
                    </p>
                  </div>
                  <p className="text-xs text-slate-500 italic border-t border-slate-200 pt-1.5">
                    Clinical allergies and consultation notes are managed by reception and doctors and cannot be modified via administrative correction.
                  </p>
                </div>

                {/* Review & Apply Trigger */}
                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full min-h-11 cursor-pointer rounded-md bg-[#8E1C3D] px-5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#731631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                  >
                    Apply Demographic Correction
                  </button>
                </div>
              </form>
            </div>

            {/* Right Column: Live Diff Comparison Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <h2 className="text-base font-bold text-slate-900">
                  Live Before / After Comparison
                </h2>
                <span className="text-xs text-slate-500">
                  Proposed changes
                </span>
              </div>

              <div className="rounded border border-slate-200 overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="bg-slate-100 font-semibold text-slate-700 border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3 w-1/3">Field</th>
                      <th className="py-2 px-3 w-1/3">Stored</th>
                      <th className="py-2 px-3 w-1/3">Proposed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {[
                      { label: 'Full Name', curr: selectedPatient.full_name, next: fullName.trim() },
                      { label: 'Guardian', curr: selectedPatient.guardian_name, next: guardianName.trim() },
                      { label: 'Gender', curr: selectedPatient.gender, next: gender },
                      { label: 'DOB', curr: selectedPatient.dob || '—', next: dob || '—' },
                      { label: 'Age', curr: `${selectedPatient.age_years}`, next: `${ageYears}` },
                      { label: 'Mobile', curr: selectedPatient.mobile, next: mobile.trim() },
                      { label: 'Address', curr: selectedPatient.address, next: address.trim() },
                      { label: 'District', curr: selectedPatient.district, next: district.trim() },
                      { label: 'State', curr: selectedPatient.state, next: state.trim() },
                      { label: 'Emergency', curr: selectedPatient.emergency_contact || '—', next: emergencyContact.trim() || '—' },
                    ].map((row) => {
                      const changed = row.curr !== row.next
                      return (
                        <tr
                          key={row.label}
                          className={changed ? 'bg-rose-50/70 border-l-4 border-l-[#8E1C3D]' : 'bg-white'}
                        >
                          <td className="py-2 px-3 font-medium text-slate-700">
                            {row.label}
                            {changed && (
                              <span className="ml-1.5 inline-block text-xs font-bold text-[#8E1C3D] uppercase">
                                Modified
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600 break-words">{row.curr}</td>
                          <td className={`py-2 px-3 break-words ${changed ? 'font-bold text-[#8E1C3D]' : 'text-slate-800'}`}>
                            {row.next}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-medium">
                  Demographic corrections update future patient documents, but historical printouts retain their issued details.
                </p>
              </div>
            </div>
          </div>

          {/* Demographic Correction Modal */}
          <DemographicCorrectionModal
            open={isModalOpen}
            patient={selectedPatient}
            proposed={proposedCorrection}
            onConfirm={handleApplyCorrection}
            onClose={() => setIsModalOpen(false)}
            isSubmitting={correctMutation.isPending}
          />
        </div>
      )}
      </div>
    </AppShell>
  )
}
