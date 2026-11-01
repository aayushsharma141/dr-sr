import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router'
import { usePatients, useMe } from '../api/queries'
import { AppShell } from '../components/AppShell'
import { PatientEditModal } from '../components/PatientEditModal'
import type { PatientOut } from '../api/types'

export function PatientsDirectory() {
  const { data: me } = useMe()
  const navigate = useNavigate()

  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [selectedPatientForEdit, setSelectedPatientForEdit] = useState<PatientOut | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchTerm.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [searchTerm])

  const { data: patients, isPending, isError, error, refetch } = usePatients(debouncedQuery)

  return (
    <AppShell name={me?.full_name || 'Staff'} role={me?.role || 'RECEPTION'}>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Link
                to={me?.role === 'ADMIN' ? '/admin' : me?.role === 'DOCTOR' ? '/doctor' : '/reception'}
                className="text-sm text-red-900 hover:underline font-medium"
              >
                &larr; Back to Dashboard
              </Link>
            </div>
            <h2 className="text-2xl font-bold text-neutral-900 tracking-tight mt-2">
              Patient Directory
            </h2>
            <p className="text-sm text-neutral-500">
              Multi-modal search across atomic URNs, mobile numbers, and patient names.
            </p>
          </div>
          <div>
            <Link
              to="/reception/patients/new"
              className="px-4 py-2 bg-red-900 text-white rounded font-medium text-sm hover:bg-red-800 cursor-pointer inline-flex items-center gap-2"
            >
              + Register New Patient
            </Link>
          </div>
        </div>

        {/* Search Bar */}
        <div className="bg-white p-4 rounded-lg border border-neutral-200 shadow-xs">
          <label htmlFor="patient-search-input" className="block text-xs font-semibold uppercase text-neutral-600 mb-1">
            Search Patients
          </label>
          <div className="relative">
            <input
              id="patient-search-input"
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by URN (KH-...), 10-digit mobile, or name (English / हिंदी)..."
              className="w-full pl-3 pr-10 py-2.5 border border-neutral-300 rounded text-neutral-900 focus:outline-hidden focus:border-red-900 text-sm"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-neutral-400 hover:text-neutral-700 text-sm font-bold"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Patients Table */}
        <div className="bg-white rounded-lg border border-neutral-200 shadow-xs overflow-hidden">
          <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between">
            <h3 className="text-lg font-bold text-neutral-900">Registered Patients</h3>
            <span className="text-xs font-mono text-neutral-500">
              {patients?.length ?? 0} found
            </span>
          </div>

          {isPending ? (
            <div className="p-8 text-center text-neutral-500 text-sm">
              Loading patients directory...
            </div>
          ) : isError ? (
            <div role="alert" className="p-6 text-center text-red-600 text-sm">
              Failed to load patients: {error?.message}
            </div>
          ) : !patients || patients.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-neutral-500 text-sm">
                {debouncedQuery
                  ? `No patients found matching "${debouncedQuery}".`
                  : 'No patients registered in the system.'}
              </p>
              <Link
                to="/reception/patients/new"
                className="inline-block px-4 py-2 border border-red-900 text-red-900 rounded font-medium text-sm hover:bg-red-50"
              >
                Register New Patient
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-neutral-800">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-xs font-semibold text-neutral-600 uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">Photo</th>
                    <th className="px-4 py-3">URN</th>
                    <th className="px-4 py-3">Patient Name</th>
                    <th className="px-4 py-3">Guardian</th>
                    <th className="px-4 py-3">Age / Sex</th>
                    <th className="px-4 py-3">Mobile</th>
                    <th className="px-4 py-3">District</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200">
                  {patients.map((pat) => (
                    <tr key={pat.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <div className="w-10 h-10 rounded-full bg-neutral-200 overflow-hidden flex items-center justify-center border border-neutral-300">
                          {pat.photo_path ? (
                            <img
                              src={`/api/patients/${pat.id}/photo`}
                              alt={pat.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="font-bold text-xs text-neutral-500">
                              {pat.full_name.charAt(0).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-neutral-900">
                        {pat.urn}
                      </td>
                      <td className="px-4 py-3 font-medium text-neutral-900">
                        {pat.full_name}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {pat.guardian_name}
                      </td>
                      <td className="px-4 py-3 text-neutral-700">
                        {pat.age_years}y / {pat.gender}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-neutral-700">
                        {pat.mobile}
                      </td>
                      <td className="px-4 py-3 text-neutral-600">
                        {pat.district}
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/reception/patients/${pat.id}`)}
                          className="text-xs font-medium text-neutral-700 bg-neutral-100 hover:bg-neutral-200 px-2.5 py-1.5 rounded cursor-pointer"
                        >
                          View File
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedPatientForEdit(pat)}
                          className="text-xs font-medium text-red-900 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 rounded cursor-pointer"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {selectedPatientForEdit && (
        <PatientEditModal
          patient={selectedPatientForEdit}
          isOpen={true}
          onClose={() => setSelectedPatientForEdit(null)}
          onSuccess={() => {
            refetch()
            setSelectedPatientForEdit(null)
          }}
        />
      )}
    </AppShell>
  )
}
