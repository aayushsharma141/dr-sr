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
        )}
      </div>
    </AppShell>
  )
}
