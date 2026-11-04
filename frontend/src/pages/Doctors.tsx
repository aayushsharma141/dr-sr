import { useState, type FormEvent } from 'react'
import {
  useDoctors,
  useCreateDoctor,
  useUpdateDoctor,
  useFees,
  useCreateFee,
  useUpdateFee,
  useMe,
} from '../api/queries'
import { ApiError } from '../api/client'
import { AdminPageLayout } from '../components/AdminPageLayout'
import { ConflictBanner } from '../components/ConflictBanner'
import type { DoctorOut, DoctorCreate, DoctorUpdate, FeeOut } from '../api/types'

export function Doctors() {
  const { data: me } = useMe()
  const { data: doctors, isPending: doctorsLoading, refetch: refetchDoctors } = useDoctors()
  const { data: fees, isPending: feesLoading } = useFees()

  const createDoctorMutation = useCreateDoctor()
  const updateDoctorMutation = useUpdateDoctor()
  const createFeeMutation = useCreateFee()
  const updateFeeMutation = useUpdateFee()

  // Doctor modal state
  const [doctorModalOpen, setDoctorModalOpen] = useState(false)
  const [editingDoctor, setEditingDoctor] = useState<DoctorOut | null>(null)
  const [docNameEn, setDocNameEn] = useState('')
  const [docNameHi, setDocNameHi] = useState('')
  const [docQualification, setDocQualification] = useState('')
  const [docRegNo, setDocRegNo] = useState('')
  const [docDefaultFeeRupees, setDocDefaultFeeRupees] = useState(500)
  const [docIsActive, setDocIsActive] = useState(true)
  const [docVersionId, setDocVersionId] = useState(1)
  const [docError, setDocError] = useState<string | null>(null)
  const [docConflict, setDocConflict] = useState(false)
  const [docReloading, setDocReloading] = useState(false)

  // Fee modal state
  const [feeModalOpen, setFeeModalOpen] = useState(false)
  const [editingFee, setEditingFee] = useState<FeeOut | null>(null)
  const [feeName, setFeeName] = useState('')
  const [feeRupees, setFeeRupees] = useState(500)
  const [feeIsActive, setFeeIsActive] = useState(true)
  const [feeError, setFeeError] = useState<string | null>(null)

  const openCreateDoctor = () => {
    setEditingDoctor(null)
    setDocNameEn('')
    setDocNameHi('')
    setDocQualification('')
    setDocRegNo('')
    setDocDefaultFeeRupees(500)
    setDocIsActive(true)
    setDocVersionId(1)
    setDocError(null)
    setDocConflict(false)
    setDoctorModalOpen(true)
  }

  const openEditDoctor = (doc: DoctorOut) => {
    setEditingDoctor(doc)
    setDocNameEn(doc.name_en)
    setDocNameHi(doc.name_hi || '')
    setDocQualification(doc.qualification || '')
    setDocRegNo(doc.registration_number || '')
    setDocDefaultFeeRupees(doc.default_fee_paise / 100)
    setDocIsActive(doc.is_active)
    setDocVersionId(doc.version_id)
    setDocError(null)
    setDocConflict(false)
    setDoctorModalOpen(true)
  }

  const handleReloadDoctor = async () => {
    if (!editingDoctor) return
    setDocReloading(true)
    try {
      const refreshedList = await refetchDoctors()
      const freshDoc = refreshedList.data?.find((d) => d.id === editingDoctor.id)
      if (freshDoc) {
        setDocNameEn(freshDoc.name_en)
        setDocNameHi(freshDoc.name_hi || '')
        setDocQualification(freshDoc.qualification || '')
        setDocRegNo(freshDoc.registration_number || '')
        setDocDefaultFeeRupees(freshDoc.default_fee_paise / 100)
        setDocIsActive(freshDoc.is_active)
        setDocVersionId(freshDoc.version_id)
        setEditingDoctor(freshDoc)
      }
      setDocConflict(false)
    } finally {
      setDocReloading(false)
    }
  }

  const handleDoctorSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setDocError(null)

    if (editingDoctor) {
      const body: DoctorUpdate = {
        name_en: docNameEn.trim(),
        name_hi: docNameHi.trim() || null,
        qualification: docQualification.trim() || null,
        registration_number: docRegNo.trim() || null,
        default_fee_paise: Math.round(docDefaultFeeRupees * 100),
        is_active: docIsActive,
        version_id: docVersionId,
      }

      try {
        await updateDoctorMutation.mutateAsync({ id: editingDoctor.id, body })
        setDoctorModalOpen(false)
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setDocConflict(true)
        } else {
          setDocError(err instanceof Error ? err.message : 'Failed to update doctor profile')
        }
      }
    } else {
      const body: DoctorCreate = {
        name_en: docNameEn.trim(),
        name_hi: docNameHi.trim() || null,
        qualification: docQualification.trim() || null,
        registration_number: docRegNo.trim() || null,
        default_fee_paise: Math.round(docDefaultFeeRupees * 100),
      }

      try {
        await createDoctorMutation.mutateAsync(body)
        setDoctorModalOpen(false)
      } catch (err) {
        setDocError(err instanceof Error ? err.message : 'Failed to create doctor profile')
      }
    }
  }

  const openCreateFee = () => {
    setEditingFee(null)
    setFeeName('')
    setFeeRupees(500)
    setFeeIsActive(true)
    setFeeError(null)
    setFeeModalOpen(true)
  }

  const openEditFee = (fee: FeeOut) => {
    setEditingFee(fee)
    setFeeName(fee.name)
    setFeeRupees(fee.fee_paise / 100)
    setFeeIsActive(fee.is_active)
    setFeeError(null)
    setFeeModalOpen(true)
  }

  const handleFeeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFeeError(null)

    if (editingFee) {
      try {
        await updateFeeMutation.mutateAsync({
          id: editingFee.id,
          body: {
            name: feeName.trim(),
            fee_paise: Math.round(feeRupees * 100),
            is_active: feeIsActive,
          },
        })
        setFeeModalOpen(false)
      } catch (err) {
        setFeeError(err instanceof Error ? err.message : 'Failed to update fee schedule')
      }
    } else {
      try {
        await createFeeMutation.mutateAsync({
          name: feeName.trim(),
          fee_paise: Math.round(feeRupees * 100),
        })
        setFeeModalOpen(false)
      } catch (err) {
        setFeeError(err instanceof Error ? err.message : 'Failed to create fee schedule')
      }
    }
  }

  return (
    <AdminPageLayout name={me?.full_name ?? 'Admin'} title="Doctors & Consultation Fees" description="Maintain doctor profiles, qualifications, registration details and the consultation fee schedules used by the hospital.">
      <div className="space-y-6">
        {/* Doctors Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Doctor Profiles</h2>
              <p className="text-sm text-neutral-500">Manage doctor credentials, qualifications, and default fees</p>
            </div>
            <button
              type="button"
              onClick={openCreateDoctor}
              className="px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Add Doctor
            </button>
          </div>

          {doctorsLoading ? (
            <p className="text-sm text-neutral-500 py-6 text-center">Loading doctors...</p>
          ) : (
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
              <table className="w-full text-left text-sm text-neutral-800">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Doctor Name</th>
                    <th className="px-4 py-3">Hindi Name</th>
                    <th className="px-4 py-3">Qualification</th>
                    <th className="px-4 py-3">Registration No</th>
                    <th className="px-4 py-3">Default Fee</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {doctors && doctors.length > 0 ? (
                    doctors.map((doc) => (
                      <tr key={doc.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium text-neutral-900">{doc.name_en}</td>
                        <td className="px-4 py-3 text-neutral-700">{doc.name_hi || '-'}</td>
                        <td className="px-4 py-3 text-neutral-700">{doc.qualification || '-'}</td>
                        <td className="px-4 py-3 font-mono text-xs text-neutral-600">{doc.registration_number || '-'}</td>
                        <td className="px-4 py-3 font-medium text-neutral-900">₹{(doc.default_fee_paise / 100).toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                              doc.is_active ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-neutral-700'
                            }`}
                          >
                            {doc.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditDoctor(doc)}
                            className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-4 py-6 text-center text-neutral-500">
                        No doctors registered yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Consultation Fees Section */}
        <div className="space-y-4 pt-6 border-t border-neutral-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">Consultation Fee Schedules</h2>
              <p className="text-sm text-neutral-500">Configure standard fee rates used across departments and billing</p>
            </div>
            <button
              type="button"
              onClick={openCreateFee}
              className="px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
            >
              Add Fee Rate
            </button>
          </div>

          {feesLoading ? (
            <p className="text-sm text-neutral-500 py-6 text-center">Loading fees...</p>
          ) : (
            <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
              <table className="w-full text-left text-sm text-neutral-800">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Schedule Name</th>
                    <th className="px-4 py-3">Rate (INR)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {fees && fees.length > 0 ? (
                    fees.map((fee) => (
                      <tr key={fee.id} className="hover:bg-neutral-50">
                        <td className="px-4 py-3 font-medium text-neutral-900">{fee.name}</td>
                        <td className="px-4 py-3 font-semibold text-neutral-900">₹{(fee.fee_paise / 100).toFixed(2)}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${
                              fee.is_active ? 'bg-green-100 text-green-800' : 'bg-neutral-200 text-neutral-700'
                            }`}
                          >
                            {fee.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditFee(fee)}
                            className="px-3 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[36px] min-w-[36px] focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer"
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                        No fee schedules configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Doctor Modal */}
        {doctorModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="doctor-modal-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-lg w-full p-6 shadow-xl space-y-4">
              <h3 id="doctor-modal-title" className="text-xl font-bold text-neutral-900">
                {editingDoctor ? 'Edit Doctor Profile' : 'Add Doctor Profile'}
              </h3>

              {docConflict && (
                <ConflictBanner onReload={handleReloadDoctor} isReloading={docReloading} />
              )}

              {docError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
                  {docError}
                </div>
              )}

              <form onSubmit={handleDoctorSubmit} className="space-y-4">
                <div>
                  <label htmlFor="doc-name-en" className="block text-sm font-medium text-neutral-800 mb-1">
                    English Name
                  </label>
                  <input
                    id="doc-name-en"
                    type="text"
                    required
                    value={docNameEn}
                    onChange={(e) => setDocNameEn(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="doc-name-hi" className="block text-sm font-medium text-neutral-800 mb-1">
                    Hindi Name (Optional)
                  </label>
                  <input
                    id="doc-name-hi"
                    type="text"
                    value={docNameHi}
                    onChange={(e) => setDocNameHi(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="doc-qualification" className="block text-sm font-medium text-neutral-800 mb-1">
                    Qualification (e.g., MBBS, MS Ortho)
                  </label>
                  <input
                    id="doc-qualification"
                    type="text"
                    value={docQualification}
                    onChange={(e) => setDocQualification(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="doc-reg-no" className="block text-sm font-medium text-neutral-800 mb-1">
                    Registration Number (Optional)
                  </label>
                  <input
                    id="doc-reg-no"
                    type="text"
                    value={docRegNo}
                    onChange={(e) => setDocRegNo(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="doc-default-fee" className="block text-sm font-medium text-neutral-800 mb-1">
                    Default Consultation Fee (₹ INR)
                  </label>
                  <input
                    id="doc-default-fee"
                    type="number"
                    required
                    min={0}
                    step={10}
                    value={docDefaultFeeRupees}
                    onChange={(e) => setDocDefaultFeeRupees(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                {editingDoctor && (
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      id="doc-active"
                      type="checkbox"
                      checked={docIsActive}
                      onChange={(e) => setDocIsActive(e.target.checked)}
                      className="w-4 h-4 text-red-900 rounded border-neutral-300 focus:ring-red-800"
                    />
                    <label htmlFor="doc-active" className="text-sm font-medium text-neutral-800">
                      Active doctor profile
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setDoctorModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-neutral-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createDoctorMutation.isPending || updateDoctorMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
                  >
                    {createDoctorMutation.isPending || updateDoctorMutation.isPending ? 'Saving...' : 'Save Doctor'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Fee Modal */}
        {feeModalOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="fee-modal-title"
            className="fixed inset-0 bg-neutral-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50"
          >
            <div className="bg-white rounded-lg border border-neutral-200 max-w-md w-full p-6 shadow-xl space-y-4">
              <h3 id="fee-modal-title" className="text-xl font-bold text-neutral-900">
                {editingFee ? 'Edit Fee Rate' : 'Add Fee Rate'}
              </h3>

              {feeError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-900">
                  {feeError}
                </div>
              )}

              <form onSubmit={handleFeeSubmit} className="space-y-4">
                <div>
                  <label htmlFor="fee-name" className="block text-sm font-medium text-neutral-800 mb-1">
                    Schedule Name
                  </label>
                  <input
                    id="fee-name"
                    type="text"
                    required
                    value={feeName}
                    onChange={(e) => setFeeName(e.target.value)}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                <div>
                  <label htmlFor="fee-amount" className="block text-sm font-medium text-neutral-800 mb-1">
                    Fee Rate (₹ INR)
                  </label>
                  <input
                    id="fee-amount"
                    type="number"
                    required
                    min={0}
                    step={10}
                    value={feeRupees}
                    onChange={(e) => setFeeRupees(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-neutral-300 rounded min-h-[44px] text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
                  />
                </div>

                {editingFee && (
                  <div className="flex items-center gap-2 pt-2">
                    <input
                      id="fee-active"
                      type="checkbox"
                      checked={feeIsActive}
                      onChange={(e) => setFeeIsActive(e.target.checked)}
                      className="w-4 h-4 text-red-900 rounded border-neutral-300 focus:ring-red-800"
                    />
                    <label htmlFor="fee-active" className="text-sm font-medium text-neutral-800">
                      Active rate
                    </label>
                  </div>
                )}

                <div className="flex justify-end gap-3 pt-4 border-t border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setFeeModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-neutral-800 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createFeeMutation.isPending || updateFeeMutation.isPending}
                    className="px-4 py-2 text-sm font-medium text-white bg-red-900 hover:bg-red-800 rounded min-h-[44px] min-w-[44px] focus-visible:outline-2 focus-visible:outline-red-800 disabled:opacity-50 cursor-pointer"
                  >
                    {createFeeMutation.isPending || updateFeeMutation.isPending ? 'Saving...' : 'Save Rate'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AdminPageLayout>
  )
}
