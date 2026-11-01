import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { usePatients, useMe } from '../api/queries'
import { AppShell } from '../components/AppShell'
import { PatientEditModal } from '../components/PatientEditModal'
import type { PatientOut } from '../api/types'

export function PatientsDirectory() {
  const { data: me } = useMe()
  const navigate = useNavigate()

  const [searchInput, setSearchInput] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedPatientForEdit, setSelectedPatientForEdit] = useState<PatientOut | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [successBanner, setSuccessBanner] = useState<string | null>(null)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(searchInput.trim())
    }, 300)
    return () => clearTimeout(handler)
  }, [searchInput])

  const {
    data: patients = [],
    isPending,
    isError,
    error,
    refetch,
  } = usePatients(debouncedQuery)

  const handleEditClick = (patient: PatientOut) => {
    setSelectedPatientForEdit(patient)
    setIsEditModalOpen(true)
  }

  const handleEditSuccess = (updated: PatientOut) => {
    setIsEditModalOpen(false)
    setSelectedPatientForEdit(null)
    setSuccessBanner(`Patient ${updated.full_name} (${updated.urn}) updated successfully.`)
    refetch()
  }

  return (
    <AppShell
      name={me?.full_name || 'Staff'}
      role={me?.role || 'RECEPTION'}
    >
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight">
              Patient Directory
            </h2>
            <p className="text-sm text-neutral-500">
              Search and manage registered patients across the hospital LAN
            </p>
          </div>
          <Link
            to="/reception/patients/new"
            className="inline-flex items-center justify-center px-4 py-2 bg-red-900 text-white rounded text-sm font-medium hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-red-800 min-h-[44px] min-w-[44px] shadow-xs"
          >
            + Register New Patient
          </Link>
        </div>

        {successBanner && (
          <div
            role="status"
            className="p-4 bg-emerald-50 border border-emerald-300 rounded text-emerald-900 text-sm flex items-center justify-between"
          >
            <span>{successBanner}</span>
            <button
              type="button"
              onClick={() => setSuccessBanner(null)}
              className="text-emerald-700 hover:text-emerald-950 font-bold ml-4"
              aria-label="Dismiss message"
            >
              &times;
            </button>
          </div>
        )}

        {/* Search Controls */}
        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs">
          <div className="relative">
            <label htmlFor="patient-search-input" className="sr-only">
              Search patients by URN, Mobile, or Name
            </label>
            <input
              id="patient-search-input"
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by URN (e.g. KH-2026-0001), mobile number, or patient name..."
              className="w-full px-4 py-3 pl-10 border border-neutral-300 rounded-md text-sm text-neutral-900 focus-visible:outline-2 focus-visible:outline-red-800"
            />
            <span
              className="absolute left-3 top-3.5 text-neutral-400 select-none text-base"
              aria-hidden="true"
            >
              🔍
            </span>
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-3 text-neutral-400 hover:text-neutral-600 text-sm font-medium px-2 py-1"
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Content Section */}
        {isPending ? (
          <div className="bg-white p-12 text-center rounded-lg border border-neutral-200">
            <p className="text-sm text-neutral-500" role="status">
              Loading patients...
            </p>
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="p-4 bg-red-50 border border-red-200 rounded text-red-900 text-sm"
          >
            Failed to load patients: {error.message}
          </div>
        ) : patients.length === 0 ? (
          <div className="bg-white p-12 text-center rounded-lg border border-neutral-200 space-y-4">
            <div className="w-12 h-12 mx-auto rounded-full bg-neutral-100 flex items-center justify-center text-neutral-400 text-xl font-bold">
              ?
            </div>
            <div>
              <p className="text-base font-semibold text-neutral-900">
                {debouncedQuery
                  ? `No patients found matching "${debouncedQuery}"`
                  : 'No patients registered yet'}
              </p>
              <p className="text-sm text-neutral-500 mt-1">
                {debouncedQuery
                  ? 'Check for spelling errors or try searching by mobile number or URN.'
                  : 'Get started by creating the first patient record.'}
              </p>
            </div>
            <Link
              to="/reception/patients/new"
              className="inline-flex items-center justify-center px-4 py-2 bg-red-900 text-white rounded text-sm font-medium hover:bg-red-800 min-h-[44px]"
            >
              Register New Patient
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-700">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="px-4 py-3">Photo</th>
                    <th scope="col" className="px-4 py-3">URN</th>
                    <th scope="col" className="px-4 py-3">Patient Name</th>
                    <th scope="col" className="px-4 py-3">Guardian</th>
                    <th scope="col" className="px-4 py-3">Age / Gender</th>
                    <th scope="col" className="px-4 py-3">Mobile</th>
                    <th scope="col" className="px-4 py-3">District</th>
                    <th scope="col" className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {patients.map((p) => (
                    <tr
                      key={p.id}
                      className="hover:bg-neutral-50 transition-colors"
                      data-testid={`patient-row-${p.id}`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="w-10 h-10 rounded-full border border-neutral-200 bg-neutral-100 flex items-center justify-center overflow-hidden">
                          {p.photo_path ? (
                            <img
                              src={`/api/patients/${p.id}/photo`}
                              alt={p.full_name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                // Fallback avatar on broken/unauthorized image
                                (e.currentTarget as HTMLImageElement).style.display = 'none'
                              }}
                            />
                          ) : (
                            <span className="text-xs font-bold text-neutral-400">
                              {p.full_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono font-bold text-red-900">
                        {p.urn}
                      </td>
                      <td className="px-4 py-3 font-semibold text-neutral-900">
                        {p.full_name}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {p.guardian_name}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-600">
                        {p.age_years}y / {p.gender}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-neutral-700">
                        {p.mobile}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {p.district}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/reception/patients/${p.id}`)}
                          className="px-2.5 py-1.5 text-xs font-medium text-red-900 bg-red-50 hover:bg-red-100 rounded focus-visible:outline-2 focus-visible:outline-red-800 cursor-pointer min-h-[36px]"
                        >
                          View Card
                        </button>
                        <button
                          type="button"
                          onClick={() => handleEditClick(p)}
                          className="px-2.5 py-1.5 text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 rounded focus-visible:outline-2 focus-visible:outline-neutral-500 cursor-pointer min-h-[36px]"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Demographic Edit Modal */}
      {selectedPatientForEdit && (
        <PatientEditModal
          patient={selectedPatientForEdit}
          isOpen={isEditModalOpen}
          onClose={() => {
            setIsEditModalOpen(false)
            setSelectedPatientForEdit(null)
          }}
          onSuccess={handleEditSuccess}
        />
      )}
    </AppShell>
  )
}
