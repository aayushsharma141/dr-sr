import { useState, useEffect, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { InlineAlert } from '../components/InlineAlert'
import { useDoctors, useMe, useUpdateDoctorMeSettings } from '../api/queries'
import { ApiError } from '../api/client'

export function DoctorSettings() {
  const { data: me } = useMe()
  const { data: doctors, isPending: isLoadingDoctors, refetch: refetchDoctors, isFetching } = useDoctors(false)
  const updateSettingsMutation = useUpdateDoctorMeSettings()

  const myDoctor = doctors?.find((d) => d.id === me?.doctor_id)

  const [feeRupees, setFeeRupees] = useState('')
  const [consultationPace, setConsultationPace] = useState<string>(() => {
    return localStorage.getItem('kh_doctor_consult_pace') || '15'
  })
  const [followUpValidity, setFollowUpValidity] = useState<string>(() => {
    return localStorage.getItem('kh_doctor_followup_validity') || '7'
  })
  const [conflict, setConflict] = useState(false)
  const [savedSuccess, setSavedSuccess] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Sync fee when doctor data loads or updates
  useEffect(() => {
    if (myDoctor) {
      setFeeRupees(String(myDoctor.default_fee_paise / 100))
    }
  }, [myDoctor])

  const handleReload = async () => {
    setConflict(false)
    setErrorMessage(null)
    const result = await refetchDoctors()
    const refreshed = result.data?.find((d) => d.id === me?.doctor_id)
    if (refreshed) {
      setFeeRupees(String(refreshed.default_fee_paise / 100))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSavedSuccess(false)
    setErrorMessage(null)
    setConflict(false)

    if (!myDoctor) {
      setErrorMessage('Doctor profile not found for authenticated user.')
      return
    }

    const trimmed = feeRupees.trim()
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      setErrorMessage('Enter a valid consultation fee in rupees (e.g., 500 or 450.50).')
      return
    }

    const feePaise = Math.round(Number(trimmed) * 100)
    if (feePaise < 0) {
      setErrorMessage('Consultation fee cannot be negative.')
      return
    }

    try {
      localStorage.setItem('kh_doctor_consult_pace', consultationPace)
      localStorage.setItem('kh_doctor_followup_validity', followUpValidity)
      await updateSettingsMutation.mutateAsync({
        default_fee_paise: feePaise,
        version_id: myDoctor.version_id,
      })
      setSavedSuccess(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
      } else if (err instanceof ApiError) {
        setErrorMessage(err.message || 'Failed to update consultation fee.')
      } else {
        setErrorMessage('An unexpected error occurred while saving settings.')
      }
    }
  }

  return (
    <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">My Settings</h1>
          <p className="text-sm text-slate-600 mt-1">
            Manage your personal OPD consultation fee.
          </p>
        </div>

        {conflict && (
          <ConflictBanner
            onReload={handleReload}
            isReloading={isFetching}
            message="Your doctor settings were modified by another session."
            actionLabel="Reload latest fee"
          />
        )}

        {savedSuccess && (
          <InlineAlert tone="success">
            Your default consultation fee has been updated successfully.
          </InlineAlert>
        )}

        {errorMessage && (
          <InlineAlert tone="error">
            {errorMessage}
          </InlineAlert>
        )}

        {isLoadingDoctors ? (
          <p className="text-sm text-slate-600">Loading your profile...</p>
        ) : (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {myDoctor?.name_en || me?.full_name}
                </h2>
                <p className="text-xs text-slate-500">
                  {myDoctor?.qualification || 'Medical Practitioner'} • Reg: {myDoctor?.registration_number || 'N/A'}
                </p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-slate-500 block uppercase tracking-wider">
                  Cabin
                </span>
                <span className="inline-block px-2.5 py-1 rounded bg-slate-100 text-slate-800 font-mono font-bold text-sm">
                  {myDoctor?.cabin_code ? `Cabin ${myDoctor.cabin_code}` : 'Unassigned'}
                </span>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="consultation-fee"
                  className="block text-sm font-semibold text-slate-800 mb-1"
                >
                  Consultation Fee (₹ INR)
                </label>
                <div className="relative rounded-md shadow-xs max-w-xs">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <span className="text-slate-500 sm:text-sm font-medium">₹</span>
                  </div>
                  <input
                    id="consultation-fee"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min={0}
                    required
                    value={feeRupees}
                    onChange={(e) => setFeeRupees(e.target.value)}
                    className="block w-full rounded-md border border-slate-300 pl-7 pr-3 py-2 text-sm text-slate-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]"
                    placeholder="500"
                  />
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  This fee is applied automatically during reception token check-in.
                </p>
              </div>

              {/* Consultation Pace Preference */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Target Consultation Pace
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '10', label: '10 mins (Rapid OPD)' },
                    { value: '15', label: '15 mins (Standard Balanced)' },
                    { value: '20', label: '20 mins (In-Depth Clinical)' },
                  ].map((pace) => (
                    <button
                      key={pace.value}
                      type="button"
                      onClick={() => setConsultationPace(pace.value)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                        consultationPace === pace.value
                          ? 'bg-[#5D0B26] text-white border-[#5D0B26]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {pace.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Guides waiting hall queue pacing estimates and reception booking intervals.
                </p>
              </div>

              {/* Follow-up Validity Window */}
              <div>
                <label className="block text-sm font-semibold text-slate-800 mb-1">
                  Prescription Follow-Up Grace Validity
                </label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: '7', label: '7 Days Window' },
                    { value: '14', label: '14 Days Window' },
                  ].map((win) => (
                    <button
                      key={win.value}
                      type="button"
                      onClick={() => setFollowUpValidity(win.value)}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition ${
                        followUpValidity === win.value
                          ? 'bg-[#5D0B26] text-white border-[#5D0B26]'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {win.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Patients returning within this window for report reviews bypass new consultation charges.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={updateSettingsMutation.isPending}
                  className="inline-flex items-center justify-center rounded-md bg-[#8E1C3D] px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#721631] focus-visible:outline-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50 min-h-11 cursor-pointer"
                >
                  {updateSettingsMutation.isPending ? 'Saving...' : 'Save Settings'}
                </button>
              </div>
            </form>
          </div>

          {/* Live Prescription Letterhead & Seal Preview */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-4">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Official Prescription Letterhead & Seal Preview</h3>
              <p className="text-xs text-slate-500">Live preview of how your clinical prescriptions print and export for patients.</p>
            </div>

            <div className="rounded-xl border border-slate-300 bg-slate-50/50 p-5 space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-slate-300 pb-3 gap-2">
                <div>
                  <h4 className="text-lg font-bold text-[#5D0B26] tracking-tight">KALYAN HOSPITAL (कल्याण हॉस्पिटल)</h4>
                  <p className="text-xs text-slate-600">Station Road, Rahimatpur, Satara · 24x7 Emergency &amp; OPD</p>
                </div>
                <div className="text-right">
                  <span className="text-xs font-bold text-slate-700 block">NABH Registered LAN OPD</span>
                  <span className="text-xs text-slate-500 font-mono">LAN ID: #KH-LAN-01</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center text-xs gap-2">
                <div>
                  <span className="font-bold text-sm text-slate-900 block">{myDoctor?.name_en || me?.full_name}</span>
                  {myDoctor?.name_hi && <span className="text-slate-600 block">{myDoctor.name_hi}</span>}
                  <span className="text-slate-600">{myDoctor?.qualification || 'Consulting Physician'}</span>
                </div>
                <div className="text-right text-slate-600">
                  <span className="block font-medium">Council Reg No: <strong className="font-mono text-slate-900">{myDoctor?.registration_number || 'N/A'}</strong></span>
                  <span className="block font-medium">Room: <strong className="text-slate-900">{myDoctor?.cabin_code ? `Room ${myDoctor.cabin_code}` : 'General OPD'}</strong></span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-300 pt-3 flex justify-between items-end">
                <div className="text-xs text-slate-500">
                  <span>Target consult pace: {consultationPace} mins · Follow-up validity: {followUpValidity} days</span>
                </div>
                <div className="text-center border border-slate-300 rounded p-2 bg-white shadow-2xs">
                  <span className="text-xs font-mono block text-emerald-800 font-bold">DIGITALLY SIGNED</span>
                  <span className="text-xs text-slate-500 block font-mono">Kalyan Hospital LAN</span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
      </div>
    </AppShell>
  )
}
