import { useState } from 'react'
import { useNavigate } from 'react-router'
import { usePatients } from '../../../../api/queries'

interface NewConsultationModalProps {
  isOpen: boolean
  onClose: () => void
}

export function NewConsultationModal({ isOpen, onClose }: NewConsultationModalProps) {
  const navigate = useNavigate()
  const [searchTerm, setSearchTerm] = useState('')

  const { data: patients = [], isLoading } = usePatients(
    searchTerm.trim(),
    10,
    0,
    { enabled: isOpen && searchTerm.trim().length >= 2 },
  )

  if (!isOpen) return null

  const handleSelectPatient = (patientId: number) => {
    onClose()
    navigate(`/doctor/encounters/new?patient_id=${patientId}`)
  }

  return (
    <div
      data-testid="new-consultation-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-2xs p-4"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-700 flex items-center justify-center font-bold">
              +
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Start New Consultation</h3>
              <p className="text-2xs text-slate-500">
                Search an existing registered patient to begin consultation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="p-6">
          <div className="relative mb-4">
            <input
              type="text"
              autoFocus
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by URN, patient name or mobile..."
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:outline-hidden focus:border-rose-600 focus:bg-white focus:ring-2 focus:ring-rose-100 transition-all"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3 top-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

          {/* Results list */}
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-xl">
            {searchTerm.trim().length < 2 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                Type at least 2 characters to search patients.
              </div>
            ) : isLoading ? (
              <div className="py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-rose-700 border-t-transparent rounded-full animate-spin" />
                Searching patients...
              </div>
            ) : patients.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-xs">
                No matching patients found.
              </div>
            ) : (
              patients.map((pat) => (
                <div
                  key={pat.id}
                  className="p-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900">{pat.full_name}</div>
                    <div className="text-2xs text-slate-500 font-mono flex items-center gap-2">
                      <span>{pat.urn}</span>
                      <span>•</span>
                      <span>
                        {pat.age_years ?? '-'}y / {pat.gender ?? '-'}
                      </span>
                      <span>•</span>
                      <span>{pat.mobile || 'No mobile'}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectPatient(pat.id)}
                    className="px-3 py-1.5 rounded-lg bg-rose-50 text-rose-800 hover:bg-[#800020] hover:text-white border border-rose-200 text-xs font-semibold transition-all cursor-pointer"
                  >
                    Select
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-2xs text-slate-400">
          <span>Offline LAN Authorized Central Directory</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
