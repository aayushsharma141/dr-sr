import { useState, useEffect, type FormEvent } from 'react'
import { AppShell } from '../components/AppShell'
import { ConflictBanner } from '../components/ConflictBanner'
import { toast } from '../components/ToastHost'
import { useClinicSettings, useDoctors, useMe, useUpdateDoctorMeSettings } from '../api/queries'
import { useClinicBranding } from '../api/branding'
import { ApiError } from '../api/client'
import { withDoctorTitle } from '../format'

export function DoctorSettings({ embedded = false }: { embedded?: boolean }) {
  const { data: me } = useMe()
  const { data: doctors, isPending: isLoadingDoctors, refetch: refetchDoctors, isFetching } = useDoctors(false)
  const { data: clinicSettings } = useClinicSettings()
  const branding = useClinicBranding()
  const updateSettingsMutation = useUpdateDoctorMeSettings()

  const myDoctor = doctors?.find((d) => d.id === me?.doctor_id)

  const [feeRupees, setFeeRupees] = useState(() => (myDoctor ? String(myDoctor.default_fee_paise / 100) : ''))
  const [conflict, setConflict] = useState(false)

  // Sync fee when doctor data loads or updates
  useEffect(() => {
    if (myDoctor) {
      setFeeRupees(String(myDoctor.default_fee_paise / 100))
    }
  }, [myDoctor])

  const handleReload = async () => {
    setConflict(false)
    const result = await refetchDoctors()
    const refreshed = result.data?.find((d) => d.id === me?.doctor_id)
    if (refreshed) {
      setFeeRupees(String(refreshed.default_fee_paise / 100))
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setConflict(false)

    if (!myDoctor) {
      toast.error('Doctor profile not found for authenticated user.')
      return
    }

    const trimmed = feeRupees.trim()
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
      toast.error('Enter a valid consultation fee in rupees (e.g., 500 or 450.50).')
      return
    }

    const feePaise = Math.round(Number(trimmed) * 100)
    if (feePaise < 0) {
      toast.error('Consultation fee cannot be negative.')
      return
    }

    try {
      await updateSettingsMutation.mutateAsync({
        default_fee_paise: feePaise,
        version_id: myDoctor.version_id,
      })
      toast.success('Your default consultation fee has been updated successfully.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
      } else if (err instanceof ApiError) {
        toast.error(err.message || 'Failed to update consultation fee.')
      } else {
        toast.error('An unexpected error occurred while saving settings.')
      }
    }
  }

  const content = (
    <div className={`${embedded ? 'w-full' : 'max-w-4xl mx-auto'} space-y-4`}>
      {!embedded && <h1 className="text-xl font-bold text-slate-900">My Account</h1>}
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-2xs sm:p-6">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">{embedded ? 'Doctor Preferences' : 'My Settings'}</h2>
            {!embedded && <p className="mt-1 text-sm text-slate-500">Consultation fee and prescription letterhead</p>}
          </div>
          <span className="rounded-md bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            {myDoctor?.cabin_code ? `Cabin ${myDoctor.cabin_code}` : 'Cabin unassigned'}
          </span>
        </div>

        {conflict && <ConflictBanner onReload={handleReload} isReloading={isFetching} message="Your doctor settings were modified by another session." actionLabel="Reload latest fee" />}

        {isLoadingDoctors ? (
          <p role="status" className="text-sm text-slate-600">Loading doctor preferences…</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="consultation-fee" className="mb-2 block text-sm font-semibold text-slate-800">Consultation Fee</label>
              <div className="flex h-11 max-w-sm items-center rounded-lg border border-slate-300 bg-white focus-within:border-[#8E1C3D] focus-within:ring-2 focus-within:ring-[#8E1C3D]/15">
                <span aria-hidden="true" className="pl-3 text-sm font-medium text-slate-500">₹</span>
                <input id="consultation-fee" name="consultation_fee" type="number" inputMode="decimal" step="0.01" min={0} required value={feeRupees} onChange={(e) => setFeeRupees(e.target.value)} className="h-full min-w-0 flex-1 rounded-lg bg-transparent px-2 text-sm text-slate-900 focus:outline-none" placeholder="500" />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">Applied at reception check-in.</p>
            </div>

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <button type="submit" disabled={updateSettingsMutation.isPending} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#8E1C3D] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#721631] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8E1C3D] disabled:opacity-50">
                {updateSettingsMutation.isPending ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </form>
        )}

        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-slate-700 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-[#8E1C3D]">Official Prescription Letterhead &amp; Seal Preview</summary>
          <div className="mt-3 rounded-lg border border-slate-300 bg-slate-50 p-4">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-300 pb-3 sm:flex-row sm:items-start">
              <div>
                <h3 className="text-base font-bold uppercase text-[#5D0B26]">
                  {branding.hospitalName} ({branding.hospitalNameHi})
                </h3>
                <p className="text-xs text-slate-600">
                  {[branding.address, clinicSettings?.address_2].filter(Boolean).join(', ')}
                </p>
              </div>
              <span className="text-xs font-semibold text-slate-700">
                {[branding.locationLine, clinicSettings?.phone].filter(Boolean).join(' · ')}
              </span>
            </div>
            <div className="flex flex-col justify-between gap-3 py-3 text-sm sm:flex-row">
              <div>
                <strong>{withDoctorTitle(myDoctor?.name_en || me?.full_name || 'Doctor')}</strong>
                <p className="text-xs text-slate-600">{myDoctor?.qualification || 'Consulting Physician'}</p>
              </div>
              <div className="text-xs text-slate-600 sm:text-right">Reg: {myDoctor?.registration_number || 'N/A'}<br />Room: {myDoctor?.cabin_code || 'General OPD'}</div>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-dashed border-slate-300 pt-3 text-xs text-slate-600">
              <span>
                {clinicSettings?.consultation_validity_days
                  ? `${clinicSettings.consultation_validity_days}-day OPD validity`
                  : branding.trustNameEn}
              </span>
              <span className="rounded border border-slate-300 bg-white px-3 py-2 font-mono text-xs font-bold text-emerald-800">SEAL PREVIEW (NOT A SIGNATURE)</span>
            </div>
          </div>
        </details>
      </section>
    </div>
  )
  return embedded ? content : <AppShell name={me?.full_name || 'Consulting Doctor'} role="DOCTOR">{content}</AppShell>
}
